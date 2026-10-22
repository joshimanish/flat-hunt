// Phase 4 final review: owner messages are appended, rollbacks undo only their own fields, the routine cannot move a
// listing to another portal, claims whose message reached the listing close as sent, profile writes are serialized,
// no decline after a rejection, and smaller hardening (safeEqual, commute job, profile upgrade, start-up writes).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { outreachApp } = require("./outreach-fixtures");
const { start } = require("./helpers");
const { createApp } = require("../server");
const { prune } = require("../lib/outreach");
const { safeEqual } = require("../lib/routine-auth");
const { upgradeProfile, defaultProfile, OUTREACH_DEFAULTS } = require("../lib/profile");
const { createCommuteJob } = require("../lib/commute-job");

const offline = async () => { throw new Error("no network in tests"); };
const tick = ms => new Promise(r => setTimeout(r, ms));
const j = async r => ({ status: r.status, body: await r.json().catch(() => null) });
const listingsOf = async s => (await (await s.call("GET", "/api/listings")).json()).listings;
const onDisk = (s, id) => JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"))[id];
const reply = { date: "2026-10-22T09:00:00+02:00", from: "Example GmbH", via: "immowelt", text: "Besichtigung am Montag?", intent: "viewing-invite", proposedTimes: ["2026-10-26T18:00:00+01:00"], externalId: "m-1" };

// The first atomic rename of `file` waits on a gate and then fails; every other rename goes through.
function failOnce(file) {
  const real = fs.promises.rename;
  let open; const gate = new Promise(r => { open = r; });
  fs.promises.rename = async (a, b) => {
    if (String(b).endsWith(file)) { fs.promises.rename = real; await gate; throw new Error("EIO"); }
    return real(a, b);
  };
  return { release: () => open(), restore: () => { fs.promises.rename = real; } };
}
// The first atomic rename of `file` waits on a gate, then succeeds.
function slowOnce(file) {
  const real = fs.promises.rename;
  let open; const gate = new Promise(r => { open = r; });
  fs.promises.rename = async (a, b) => {
    if (String(b).endsWith(file)) { fs.promises.rename = real; await gate; }
    return real(a, b);
  };
  return { release: () => open(), restore: () => { fs.promises.rename = real; } };
}

// ---------- owner messages ----------

test("a stale owner message list never drops a routine reply; the routine's re-read stays a repeat", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    await s.call("PATCH", "/api/listings/flat-1", { status: "contacted" });
    const stale = (await listingsOf(s))["flat-1"].messages || [];
    const rep = await j(await s.routine("POST", "/api/listings/flat-1/replies", reply));
    assert.equal(rep.status, 201);
    // The page still holds the list from before the reply and sends it back with a new message.
    const r = await s.call("PATCH", "/api/listings/flat-1", { messages: [...stale, { date: "2026-10-22T09:05:00Z", dir: "out", from: "", via: "phone", text: "called" }] });
    assert.equal(r.status, 200);
    let l = (await listingsOf(s))["flat-1"];
    assert.deepEqual(l.messages.map(m => m.externalId || m.via), ["m-1", "phone"]);
    assert.equal(l.viewings.length, 1);
    await s.call("PATCH", "/api/listings/flat-1", { status: "applied" });
    const again = await j(await s.routine("POST", "/api/listings/flat-1/replies", reply));
    assert.equal(again.status, 200);
    assert.equal(again.body.repeated, true);
    l = (await listingsOf(s))["flat-1"];
    assert.equal(l.status, "applied");
    assert.equal(l.viewings.length, 1);
    assert.equal(l.messages.length, 2);
  } finally { await s.close(); }
});

test("PATCH messages keeps every message with claimId, externalId or intent; the owner's own ones are replaced", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    assert.equal((await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`, {})).status, 200);
    await s.call("POST", "/api/listings/flat-1/messages", { date: "2026-10-22T08:10:00Z", dir: "in", from: "Example GmbH", via: "phone", text: "Called back" });
    // Clearing the list, or sending a forged copy, keeps the routine's message as it was.
    const r = await j(await s.call("PATCH", "/api/listings/flat-1", { messages: [{ text: "forged", claimId: claim.id, dir: "out" }, { text: "mine", dir: "in", via: "email" }] }));
    assert.equal(r.status, 200);
    const msgs = s.app.locals.state.listings["flat-1"].messages;
    assert.deepEqual(msgs.map(m => m.text === "mine" ? "mine" : m.claimId), [claim.id, "mine"]);
    assert.notEqual(msgs[0].text, "forged");
    s.advance(30);
    assert.equal((await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json()).reason, "already-sent");
  } finally { await s.close(); }
});

test("POST /api/listings/:id/messages appends one owner message; owner-only, validated like PATCH", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    await s.routine("POST", "/api/listings/flat-1/replies", reply);
    const msg = { date: "2026-10-22T09:05:00Z", dir: "in", from: "Example GmbH", via: "phone", text: "Called: viewing Monday" };
    const r = await j(await s.call("POST", "/api/listings/flat-1/messages", msg));
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.listing.messages.map(m => m.text), [reply.text, msg.text]);
    assert.deepEqual(onDisk(s, "flat-1").messages.at(-1), msg);
    // The sync key never reaches it, with or without the password.
    assert.equal((await s.routine("POST", "/api/listings/flat-1/messages", msg)).status, 403);
    assert.equal((await s.call("POST", "/api/listings/flat-1/messages", msg, { ...s.auth, "x-sync-key": "key", "Content-Type": "application/json" })).status, 403);
    for (const bad of [null, [], { dir: "in" }, { text: 5 }, { text: "x".repeat(10001) }, { text: "x", claimId: "0123456789abcdef" }, { text: "x", intent: "rejection" }, { text: "x", externalId: "e" }]) {
      assert.equal((await s.call("POST", "/api/listings/flat-1/messages", bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await s.call("POST", "/api/listings/nope/messages", msg)).status, 404);
    s.app.locals.state.listings["flat-1"].messages = Array.from({ length: 200 }, (_, i) => ({ dir: "in", text: "m" + i }));
    assert.equal((await s.call("POST", "/api/listings/flat-1/messages", msg)).status, 400);
  } finally { await s.close(); }
});

test("a failed owner message save removes only that message", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const f = failOnce("listings.json");
    let p;
    try {
      p = s.call("POST", "/api/listings/flat-1/messages", { dir: "in", via: "phone", text: "Called" });
      await tick(40);
      const p2 = s.routine("POST", "/api/listings/flat-1/replies", reply);
      await tick(20);
      f.release();
      const [r, r2] = await Promise.all([p, p2]);
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { error: "save failed" });
      assert.equal(r2.status, 201);
    } finally { f.restore(); }
    assert.deepEqual(s.app.locals.state.listings["flat-1"].messages.map(m => m.externalId), ["m-1"]);
    assert.deepEqual(onDisk(s, "flat-1").messages.map(m => m.externalId), ["m-1"]);
  } finally { await s.close(); }
});

// ---------- targeted rollbacks ----------

test("a failed sync followed by a successful queued 'sent' keeps the sent message and status contacted", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    const f = failOnce("listings.json");
    let r1, r2;
    try {
      const p1 = s.routine("POST", "/api/sync", { seen: { "flat-1": { warmRent: 990, coldRent: 840 } } });
      await tick(40);
      const p2 = s.routine("POST", `/api/outreach/claims/${claim.id}/sent`, {});
      await tick(40);
      f.release();
      [r1, r2] = await Promise.all([p1, p2]);
    } finally { f.restore(); }
    assert.equal(r1.status, 500);
    assert.equal(r2.status, 200);
    const l = s.app.locals.state.listings["flat-1"], disk = onDisk(s, "flat-1");
    for (const x of [l, disk]) {
      assert.equal(x.status, "contacted");
      assert.equal(x.messages.length, 1);
      assert.equal(x.messages[0].claimId, claim.id);
      assert.equal(x.warmRent, 950, "the sync's own amounts are undone");
      assert.equal(x.coldRent, 800);
    }
    assert.equal(s.app.locals.state.outreach.claims[0].status, "sent");
  } finally { await s.close(); }
});

test("a failed routine upsert undoes only its own fields; a failed create removes only the listing it made", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const f = failOnce("listings.json");
    try {
      const p1 = s.routine("PUT", "/api/listings/flat-1", { title: "Neuer Titel", rooms: 3 });
      await tick(40);
      const p2 = s.call("PATCH", "/api/listings/flat-1", { status: "contacted", notes: "call Monday" });
      await tick(20);
      f.release();
      const [r1, r2] = await Promise.all([p1, p2]);
      assert.equal(r1.status, 500);
      assert.deepEqual(await r1.json(), { error: "save failed" });
      assert.equal(r2.status, 200);
    } finally { f.restore(); }
    const l = s.app.locals.state.listings["flat-1"];
    assert.equal(l.title, "Helle 2-Zimmer-Wohnung");
    assert.equal(l.rooms, 2);
    assert.equal(l.status, "contacted");
    assert.equal(l.notes, "call Monday");

    // Create: the listing goes away only while it is still the object this request created.
    const g = failOnce("listings.json");
    try {
      const p = s.routine("PUT", "/api/listings/flat-2", { title: "Zweite Wohnung", mode: "rent", warmRent: 900 });
      await tick(40);
      const created = s.app.locals.state.listings["flat-2"];
      assert.ok(created);
      g.release();
      assert.equal((await p).status, 500);
    } finally { g.restore(); }
    assert.equal(s.app.locals.state.listings["flat-2"], undefined);
    assert.ok(!s.app.locals.state.meta.log.some(e => e.id === "flat-2"));
  } finally { await s.close(); }
});

test("a failed owner listing edit undoes only its own fields; a reply saved meanwhile stays", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const f = failOnce("listings.json");
    try {
      const p1 = s.call("PATCH", "/api/listings/flat-1/listing", { rooms: 3, coldRent: 850 });
      await tick(40);
      const p2 = s.routine("POST", "/api/listings/flat-1/replies", reply);
      await tick(20);
      f.release();
      const [r1, r2] = await Promise.all([p1, p2]);
      assert.equal(r1.status, 500);
      assert.equal(r2.status, 201);
    } finally { f.restore(); }
    const l = s.app.locals.state.listings["flat-1"], disk = onDisk(s, "flat-1");
    for (const x of [l, disk]) {
      assert.equal(x.rooms, 2);
      assert.equal(x.coldRent, 800);
      assert.equal(x.warmRent, 950);
      assert.equal(x.status, "viewing-invited");
      assert.equal(x.messages.length, 1);
      assert.equal(x.viewings.length, 1);
    }
    assert.ok(!s.app.locals.state.meta.log.some(e => e.type === "price"), "the edit's price line is gone");
  } finally { await s.close(); }
});

// ---------- the routine cannot move a listing ----------

test("the routine's upsert ignores url and source on an existing listing, so the ImmoScout block holds", async () => {
  const s = await outreachApp({ options: { fetchImpl: offline } });
  try {
    await s.approve("first-contact");
    const add = await (await s.call("POST", "/api/listings", { title: "Scout flat", mode: "rent", coldRent: 800, utilities: 150, rooms: 2, size: 60, url: "https://www.immobilienscout24.de/expose/1", address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf" })).json();
    await s.call("PATCH", "/api/listings/" + add.id, { pick: true });
    assert.equal((await (await s.claim({ listingId: add.id, templateId: "first-contact" })).json()).reason, "portal-not-allowed");
    const r = await s.routine("PUT", "/api/listings/" + add.id, { url: "https://www.immowelt.de/expose/zz", source: "immowelt", rooms: 3 });
    assert.equal(r.status, 200);
    const l = s.app.locals.state.listings[add.id];
    assert.equal(l.url, "https://www.immobilienscout24.de/expose/1");
    assert.equal(l.source, add.listing.source);
    assert.equal(l.rooms, 3, "other fields are still updated");
    const c = await s.claim({ listingId: add.id, templateId: "first-contact" });
    assert.equal(c.status, 409);
    assert.equal((await c.json()).reason, "portal-not-allowed");
    // A new listing still takes both.
    await s.routine("PUT", "/api/listings/new-1", { title: "Neu", url: "https://www.immowelt.de/expose/new-1", source: "immowelt" });
    assert.equal(s.app.locals.state.listings["new-1"].source, "immowelt");
    assert.equal(s.app.locals.state.listings["new-1"].url, "https://www.immowelt.de/expose/new-1");
  } finally { await s.close(); }
});

test("PUT /api/listings/recalc-commute is refused as an id", async () => {
  const s = await start();
  try {
    const r = await fetch(s.base + "/api/listings/recalc-commute", { method: "PUT", headers: { "x-sync-key": "key", "Content-Type": "application/json" }, body: JSON.stringify({ title: "x" }) });
    assert.equal(r.status, 400);
    assert.equal(s.app.locals.state.listings["recalc-commute"], undefined);
  } finally { await s.close(); }
});

// ---------- claims ----------

test("prune closes an old claim whose message reached the listing as sent, not expired", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  const claim = { id: "0123456789abcdef", key: "flat-1:first-contact", listingId: "flat-1", templateId: "first-contact", claimedAt: "2026-10-22T08:00:00.000Z", status: "claimed", sentAt: null, releasedAt: null, text: "t" };
  const listings = { "flat-1": { messages: [{ dir: "out", claimId: claim.id, date: "2026-10-22T08:01:00.000Z", text: "t" }] } };
  const expired = [];
  const [c] = prune([claim], now, new Set(), expired, listings);
  assert.equal(c.status, "sent");
  assert.equal(c.sentAt, "2026-10-22T08:01:00.000Z");
  assert.equal(c.text, undefined);
  assert.deepEqual(expired, []);
  // Without the message it expires as before.
  const [e] = prune([claim], now, new Set(), expired, { "flat-1": { messages: [] } });
  assert.equal(e.status, "skipped");
  assert.equal(e.reason, "expired");
});

test("a claim whose 'sent' reached only the listing closes as sent after 24 hours, with no skipped line", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    s.app.locals.state.listings["flat-1"].messages = [{ date: "2026-10-22T08:01:00.000Z", dir: "out", from: "", via: "immowelt", text: "t", claimId: claim.id }];
    s.advance(25 * 60);
    assert.equal((await s.call("GET", "/api/outreach/status")).status, 200);
    const c = s.app.locals.state.outreach.claims.find(x => x.id === claim.id);
    assert.equal(c.status, "sent");
    assert.equal(c.sentAt, "2026-10-22T08:01:00.000Z");
    assert.ok(!s.app.locals.state.meta.log.some(e => e.type === "skipped"));
  } finally { await s.close(); }
});

test("no decline after the landlord said no", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact"); await s.approve("decline");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`, {});
    await s.routine("POST", "/api/listings/flat-1/replies", { date: "2026-10-22T09:00:00+02:00", from: "Example GmbH", via: "immowelt", text: "Leider vergeben.", intent: "rejection" });
    await s.call("PATCH", "/api/listings/flat-1", { status: "dropped" });
    s.advance(30);
    const r = await s.claim({ listingId: "flat-1", templateId: "decline" });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).reason, "rejected");
  } finally { await s.close(); }
});

// ---------- profile writes ----------

test("a pause switched during a slow profile save survives, in memory and on disk", async () => {
  const s = await outreachApp();
  try {
    const p = (await (await s.call("GET", "/api/profile")).json());
    p.name = "Alex Example";
    const slow = slowOnce("profile.json");
    let r1, r2;
    try {
      const p1 = s.call("PUT", "/api/profile", p);
      await tick(40);
      const p2 = s.call("PUT", "/api/outreach/pause", { paused: true });
      await tick(40);
      slow.release();
      [r1, r2] = await Promise.all([p1, p2]);
    } finally { slow.restore(); }
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const disk = JSON.parse(fs.readFileSync(path.join(s.dir, "profile.json"), "utf8"));
    for (const x of [s.app.locals.state.profile, disk]) {
      assert.equal(x.outreach.paused, true);
      assert.equal(x.name, "Alex Example");
    }
  } finally { await s.close(); }
});

test("a failed profile save does not undo a pause switched meanwhile", async () => {
  const s = await outreachApp();
  try {
    const p = (await (await s.call("GET", "/api/profile")).json());
    p.name = "Alex Example";
    const f = failOnce("profile.json");
    let r1, r2;
    try {
      const p1 = s.call("PUT", "/api/profile", p);
      await tick(40);
      const p2 = s.call("PUT", "/api/outreach/pause", { paused: true });
      await tick(40);
      f.release();
      [r1, r2] = await Promise.all([p1, p2]);
    } finally { f.restore(); }
    assert.equal(r1.status, 500);
    assert.equal(r2.status, 200);
    const disk = JSON.parse(fs.readFileSync(path.join(s.dir, "profile.json"), "utf8"));
    assert.equal(s.app.locals.state.profile.outreach.paused, true);
    assert.deepEqual(disk, s.app.locals.state.profile, "memory and disk agree");
  } finally { await s.close(); }
});

test("upgradeProfile gives a profile without an outreach object the switched-off defaults", () => {
  for (const outreach of [undefined, null, "x", 5, []]) {
    const p = defaultProfile();
    if (outreach === undefined) delete p.outreach; else p.outreach = outreach;
    assert.deepEqual(upgradeProfile(p).outreach, { enabled: false, paused: false, language: "de", ...OUTREACH_DEFAULTS }, String(outreach));
  }
});

// ---------- hardening ----------

test("safeEqual compares fixed-length digests: any lengths, no throw", () => {
  assert.equal(safeEqual("key", "key"), true);
  assert.equal(safeEqual("key", "key2"), false);
  assert.equal(safeEqual("", "key"), false);
  assert.equal(safeEqual("ä", "a"), false);
  assert.equal(safeEqual("x".repeat(10000), "x"), false);
});

test("commute job: places changed before the clean-up of listings without coordinates skips it and runs again", async () => {
  const placeA = { label: "Work", address: "Königsallee 1, Düsseldorf", lat: 51.22, lon: 6.78, maxMin: 30, mode: "transit", time: "08:00" };
  const placeB = { ...placeA, label: "Gym", address: "Berlin Mitte" };
  const state = {
    profile: { places: [placeA] },
    // b first: the places change while the last listing (a) is written, after the loop's own checks.
    listings: { b: { commute: [{ minutes: 9 }, { minutes: 9 }, { minutes: 9 }], commuteStale: true }, a: { lat: 51.2, lon: 6.7, commuteStale: true } }
  };
  const written = [];
  let calls = 0;
  const persist = async () => {
    written.push(structuredClone(state.listings.b));
    // The owner saves new places while the first listing's result is being written.
    if (++calls === 1) state.profile = { places: [placeA, placeB] };
  };
  const job = createCommuteJob({ state, persist, commuteFor: async (pt, places) => places.map(() => ({ minutes: 20 })), fetchImpl: () => null, pauseMs: 0, sleep: async () => {} });
  job.start();
  await job.idle();
  assert.ok(!written.some(b => JSON.stringify(b.commute) === "[null]"), "never cleaned up with the old places");
  assert.deepEqual(state.listings.b.commute, [null, null]);
  assert.equal(state.listings.b.commuteStale, undefined);
  assert.equal(state.listings.a.commute.length, 2);
});

test("a failed start-up write removes its temp file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-test-"));
  const real = fs.renameSync;
  fs.renameSync = () => { throw new Error("EIO"); };
  try { assert.throws(() => createApp({ dataDir: dir, password: "pw", syncKey: "key", vaultKey: "", areaAuto: false }), /EIO/); }
  finally { fs.renameSync = real; }
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith(".tmp")), []);
});

test("a profile save whose listings write fails leaves the old profile on disk", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const p = await (await s.call("GET", "/api/profile")).json();
    const real = fs.promises.rename;
    fs.promises.rename = async (a, b) => { if (String(b).endsWith("listings.json")) { fs.promises.rename = real; throw new Error("EIO"); } return real(a, b); };
    p.name = "Changed Name";
    p.places = [...(p.places || []), { label: "Gym", address: "Königsallee 1, Düsseldorf", lat: 51.22, lon: 6.78, maxMin: 30, mode: "car", time: "08:00" }].slice(0, 5);
    const r = await s.call("PUT", "/api/profile", p);
    fs.promises.rename = real;
    assert.equal(r.status, 500);
    const disk = JSON.parse(fs.readFileSync(path.join(s.dir, "profile.json"), "utf8"));
    assert.notEqual(disk.name, "Changed Name");
    assert.notEqual(s.app.locals.state.profile.name, "Changed Name");
  } finally { await s.close(); }
});
