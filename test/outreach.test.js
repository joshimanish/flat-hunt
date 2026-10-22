const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { outreachApp, keyOnly } = require("./outreach-fixtures");

test("templates: defaults on a fresh copy, editing makes a new unapproved version, approval names the version", async () => {
  const s = await outreachApp();
  try {
    const all = await (await s.call("GET", "/api/templates")).json();
    assert.deepEqual(all.ids, ["first-contact", "viewing-confirmation", "documents-follow", "decline"]);
    assert.deepEqual(all.langs, ["de", "en"]);
    assert.ok(all.placeholders["viewing-confirmation"].includes("viewingTime"));
    assert.equal(all.templates["first-contact"].de.approvedAt, null);
    assert.equal((await s.approve("first-contact")).status, 200);
    const approved = (await (await s.call("GET", "/api/templates")).json()).templates["first-contact"].de;
    assert.equal(approved.approvedAt, "2026-10-22T08:00:00.000Z");
    const r = await s.call("PUT", "/api/templates/first-contact/de", { body: "Guten Tag,\n\nwir möchten „{listingTitle}“ besichtigen.\n\n{name}" });
    assert.equal(r.status, 200);
    const t = (await r.json()).template;
    assert.equal(t.version, 2);
    assert.equal(t.approvedAt, null, "editing withdraws the approval");
    const stale = await s.call("POST", "/api/templates/first-contact/de/approve", { version: 1 });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), { error: "version-changed", version: 2 });
    assert.equal((await s.call("POST", "/api/templates/first-contact/de/approve", { version: 2 })).status, 200);
    assert.equal((await s.call("DELETE", "/api/templates/first-contact/de/approve")).status, 200);
    assert.equal((await (await s.call("GET", "/api/templates")).json()).templates["first-contact"].de.approvedAt, null);
    const onDisk = JSON.parse(fs.readFileSync(path.join(s.dir, "outreach.json"), "utf8"));
    assert.equal(onDisk.templates["first-contact"].de.version, 2);
  } finally { await s.close(); }
});

test("templates: unknown placeholders are rejected on save; unchanged text keeps the version; unknown template 404", async () => {
  const s = await outreachApp();
  try {
    const bad = await s.call("PUT", "/api/templates/decline/en", { body: "Hello {greeting}, see you at {viewingTime}. {name}" });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).details[0], /unknown placeholder \{viewingTime\}/);
    const same = (await (await s.call("GET", "/api/templates")).json()).templates.decline.en.body;
    assert.equal((await (await s.call("PUT", "/api/templates/decline/en", { body: same })).json()).template.version, 1);
    assert.equal((await s.call("PUT", "/api/templates/decline/pt", { body: same })).status, 404);
    assert.equal((await s.call("PUT", "/api/templates/hello/de", { body: same })).status, 404);
    assert.equal((await s.call("PUT", "/api/templates/decline/en", { body: same, approvedAt: "x" })).status, 400);
  } finally { await s.close(); }
});

test("templates and approvals are owner-only: the sync key gets 403, with or without the password", async () => {
  const s = await outreachApp();
  try {
    for (const headers of [keyOnly, { ...keyOnly, Authorization: s.auth.Authorization }]) {
      for (const [method, p, body] of [["GET", "/api/templates"], ["PUT", "/api/templates/first-contact/de", { body: "Guten Tag, {name} schreibt Ihnen." }], ["POST", "/api/templates/first-contact/de/approve", { version: 1 }], ["DELETE", "/api/templates/first-contact/de/approve"], ["POST", "/api/templates/preview", { id: "decline", lang: "de", body: "Guten Tag, wir sagen ab. {name}" }], ["PUT", "/api/outreach/pause", { paused: false }]]) {
        assert.equal((await s.call(method, p, body, headers)).status, 403, `${method} ${p}`);
      }
    }
    assert.equal((await (await s.call("GET", "/api/templates")).json()).templates["first-contact"].de.approvedAt, null);
    assert.equal((await fetch(s.base + "/api/templates")).status, 401);
  } finally { await s.close(); }
});

test("preview fills the real applicant and an example listing (or a tracked one) and lists missing values", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const body = "{greeting},\n{name}: {household}, {job}, {income}, {moveIn} – {listingTitle}, {address} am {viewingTime}";
    const ex = await (await s.call("POST", "/api/templates/preview", { id: "viewing-confirmation", lang: "de", body })).json();
    assert.equal(ex.example, true);
    assert.deepEqual(ex.missing, []);
    assert.equal(ex.text, "Guten Tag,\nAlex Example: 2 Erwachsene, Engineer bei Example GmbH, unbefristet, 3.200 €, jederzeit – Helle 2-Zimmer-Wohnung, Beispielstraße 1, 40210 Düsseldorf am Sonntag, 25.10.2026, 09:00 Uhr", "08:00 UTC three days on, after the switch to winter time");
    const own = await (await s.call("POST", "/api/templates/preview", { id: "first-contact", lang: "en", body: "{greeting}, about {listingTitle} – {name}", listingId: "flat-1" })).json();
    assert.equal(own.example, false);
    assert.equal(own.text, "Hello, about Helle 2-Zimmer-Wohnung – Alex Example");
    const bad = await s.call("POST", "/api/templates/preview", { id: "first-contact", lang: "de", body: "Hallo {iban}, wie geht es Ihnen?" });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
  const n = await outreachApp({ applicant: false });
  try {
    const r = await (await n.call("POST", "/api/templates/preview", { id: "decline", lang: "de", body: "{greeting}, wir sagen ab. {name}" })).json();
    assert.deepEqual(r.missing, ["name"]);
  } finally { await n.close(); }
});

test("the pause switch is saved in the profile; status shows today's count, the cap and approvals", async () => {
  const s = await outreachApp();
  try {
    const r = await s.call("PUT", "/api/outreach/pause", { paused: true });
    assert.deepEqual(await r.json(), { ok: true, paused: true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "profile.json"), "utf8")).outreach.paused, true);
    assert.equal((await s.call("PUT", "/api/outreach/pause", { paused: "yes" })).status, 400);
    await s.approve("first-contact");
    const st = await (await s.routine("GET", "/api/outreach/status")).json();
    assert.deepEqual(st, { enabled: true, paused: true, language: "de", minGapMin: 20, dailyCap: 3, today: { used: 0, cap: 3 }, nextAt: null, approved: { "first-contact": { de: true, en: false }, "viewing-confirmation": { de: false, en: false }, "documents-follow": { de: false, en: false }, decline: { de: false, en: false } } });
  } finally { await s.close(); }
});

test("a claim returns the filled text of the approved template; sent logs it once and marks the listing contacted", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    await s.approve("first-contact");
    const r = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.equal(r.status, 201);
    const { claim, text, repeated } = await r.json();
    assert.equal(repeated, false);
    assert.match(claim.id, /^[0-9a-f]{16}$/);
    assert.deepEqual({ ...claim, id: "x" }, { id: "x", listingId: "flat-1", templateId: "first-contact", lang: "de", version: 1, viewingId: null, via: "immowelt", claimedAt: "2026-10-22T08:00:00.000Z", status: "claimed", sentAt: null, releasedAt: null });
    assert.match(text, /^Guten Tag,\n\nwir interessieren uns sehr für Ihre Wohnung „Helle 2-Zimmer-Wohnung“ \(Beispielstraße 1, 40210 Düsseldorf\)\. Kurz zu uns: 2 Erwachsene, Engineer bei Example GmbH, unbefristet, Haushaltsnettoeinkommen 3\.200 € im Monat/);
    // A retry before "sent" gets the same slot and text, never a second one.
    const again = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    assert.equal(again.repeated, true);
    assert.equal(again.claim.id, claim.id);
    assert.equal(again.text, text);
    const sent = await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`);
    assert.deepEqual(await sent.json(), { ok: true, repeated: false });
    assert.deepEqual(await (await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`)).json(), { ok: true, repeated: true });
    const l = s.app.locals.state.listings["flat-1"];
    assert.equal(l.status, "contacted");
    assert.equal(l.messages.length, 1);
    assert.deepEqual({ ...l.messages[0], text: "…" }, { date: "2026-10-22T08:00:00.000Z", dir: "out", from: "", via: "immowelt", text: "…", lang: "de", templateId: "first-contact", templateVersion: 1, claimId: claim.id });
    const after = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.equal(after.status, 409);
    assert.equal((await after.json()).reason, "already-sent");
    const ledger = JSON.parse(fs.readFileSync(path.join(s.dir, "outreach.json"), "utf8")).claims;
    assert.equal(ledger[0].status, "sent");
    assert.equal(ledger[0].text, undefined, "the sent text lives on the listing only");
    // The log names the listing and the template, never the message or the applicant.
    const log = (await (await s.call("GET", "/api/meta")).json()).log;
    assert.deepEqual(log[0], { date: "2026-10-22", type: "sent", id: "flat-1", text: "Helle 2-Zimmer-Wohnung", template: "first-contact" });
    assert.ok(!JSON.stringify(log).includes("Alex Example"));
  } finally { await s.close(); }
});

test("claims honour enabled, pause, approval, shortlist, criteria, ImmoScout and missing values with a 409 reason", async () => {
  const s = await outreachApp({ applicant: false });
  try {
    await s.addFlat("flat-1");
    await s.addFlat("flat-2", { pick: false });
    await s.addFlat("too-dear", { warmRent: 1500, coldRent: 1350 });
    await s.addFlat("scout", { source: "immoscout", url: "https://www.immobilienscout24.de/expose/1" });
    const reason = async body => { const r = await s.claim(body); assert.equal(r.status, 409, JSON.stringify(body)); return r.json(); };
    assert.equal((await reason({ listingId: "flat-1", templateId: "first-contact" })).reason, "not-approved");
    await s.approve("first-contact");
    assert.equal((await reason({ listingId: "flat-2", templateId: "first-contact" })).reason, "not-shortlisted");
    assert.deepEqual(await reason({ listingId: "too-dear", templateId: "first-contact" }), { error: "criteria", reason: "criteria", failed: ["warm"] });
    assert.equal((await reason({ listingId: "scout", templateId: "first-contact" })).reason, "portal-not-allowed");
    assert.deepEqual(await reason({ listingId: "flat-1", templateId: "first-contact" }), { error: "missing-values", reason: "missing-values", missing: ["household", "job", "name"] });
    await s.call("PUT", "/api/outreach/pause", { paused: true });
    assert.equal((await reason({ listingId: "flat-1", templateId: "first-contact" })).reason, "paused");
    const p = s.app.locals.state.profile; await s.call("PUT", "/api/profile", { ...p, outreach: { ...p.outreach, enabled: false, paused: false } });
    assert.equal((await reason({ listingId: "flat-1", templateId: "first-contact" })).reason, "disabled");
    assert.equal(s.app.locals.state.outreach.claims.length, 0);
    assert.equal((await s.claim({ listingId: "nope", templateId: "first-contact" })).status, 404);
    for (const body of [{ listingId: "flat-1", templateId: "hello" }, { listingId: "flat-1", templateId: "first-contact", via: "immoscout" }, { listingId: "flat-1", templateId: "first-contact", lang: "pt" }, { listingId: "flat-1", templateId: "first-contact", viewingId: "0123456789abcdef" }, { listingId: "flat-1", templateId: "viewing-confirmation" }, { listingId: "flat-1", templateId: "first-contact", text: "free text" }]) {
      assert.equal((await s.claim(body)).status, 400, JSON.stringify(body));
    }
  } finally { await s.close(); }
});

test("claims keep the minimum gap and the daily cap (Berlin day), and a released slot frees the listing", async () => {
  const s = await outreachApp({ outreach: { minGapMin: 20, dailyCap: 2 } });
  try {
    await s.approve("first-contact");
    for (const id of ["a-1", "a-2", "a-3", "a-4"]) await s.addFlat(id);
    const first = await (await s.claim({ listingId: "a-1", templateId: "first-contact" })).json();
    const soon = await s.claim({ listingId: "a-2", templateId: "first-contact" });
    assert.equal(soon.status, 409);
    assert.deepEqual(await soon.json(), { error: "too-soon", reason: "too-soon", retryAt: "2026-10-22T08:20:00.000Z" });
    // Releasing a slot (nothing went out) frees the gap and the listing.
    assert.deepEqual(await (await s.routine("POST", `/api/outreach/claims/${first.claim.id}/release`)).json(), { ok: true, repeated: false, status: "released" });
    assert.equal((await s.routine("POST", `/api/outreach/claims/${first.claim.id}/sent`)).status, 409);
    const a1 = await s.claim({ listingId: "a-1", templateId: "first-contact" });
    assert.equal(a1.status, 201);
    assert.notEqual((await a1.json()).claim.id, first.claim.id);
    s.advance(20);
    assert.equal((await s.claim({ listingId: "a-2", templateId: "first-contact" })).status, 201);
    s.advance(20);
    const cap = await s.claim({ listingId: "a-3", templateId: "first-contact" });
    assert.deepEqual(await cap.json(), { error: "daily-cap", reason: "daily-cap", used: 2, cap: 2 });
    const st = await (await s.call("GET", "/api/outreach/status")).json();
    assert.deepEqual(st.today, { used: 2, cap: 2 });
    // 22:00 UTC is midnight in Berlin (CEST): a new day.
    s.clock.t = new Date("2026-10-22T22:00:00Z").getTime();
    assert.equal((await s.claim({ listingId: "a-3", templateId: "first-contact" })).status, 201);
  } finally { await s.close(); }
});

test("two claims at once never both pass the cap, the gap or once-per-listing", async () => {
  const s = await outreachApp({ outreach: { minGapMin: 5, dailyCap: 5 } });
  try {
    await s.approve("first-contact");
    await s.addFlat("b-1"); await s.addFlat("b-2");
    const rs = await Promise.all([s.claim({ listingId: "b-1", templateId: "first-contact" }), s.claim({ listingId: "b-2", templateId: "first-contact" }), s.claim({ listingId: "b-1", templateId: "first-contact" })]);
    const codes = rs.map(r => r.status).sort();
    assert.equal(codes.filter(c => c === 201).length, 1);
    const won = s.app.locals.state.outreach.claims[0].listingId;
    assert.equal((await s.claim({ listingId: won, templateId: "first-contact" })).status, 200, "once saved, a duplicate gets the same slot");
    s.advance(5);
    await s.addFlat("b-3");
    const dup = await Promise.all([s.claim({ listingId: "b-3", templateId: "first-contact" }), s.claim({ listingId: "b-3", templateId: "first-contact" })]);
    assert.deepEqual(dup.map(r => r.status).sort(), [201, 409]);
    assert.equal((await dup.find(r => r.status === 409).json()).reason, "busy", "a duplicate while the first save is pending is told to wait");
    assert.equal(s.app.locals.state.outreach.claims.length, 2);
  } finally { await s.close(); }
});

test("a failed save of a claim answers 500 and reserves nothing; a failed 'sent' save can be retried without a second message", async () => {
  const s = await outreachApp();
  try {
    await s.approve("first-contact");
    await s.addFlat("flat-1");
    const file = path.join(s.dir, "outreach.json");
    fs.rmSync(file); fs.mkdirSync(file);
    assert.equal((await s.claim({ listingId: "flat-1", templateId: "first-contact" })).status, 500);
    assert.equal(s.app.locals.state.outreach.claims.length, 0);
    fs.rmdirSync(file);
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    fs.rmSync(file); fs.mkdirSync(file);
    assert.equal((await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`)).status, 500);
    assert.equal(s.app.locals.state.listings["flat-1"].messages.length, 1, "the message is logged on the listing");
    assert.equal(s.app.locals.state.outreach.claims[0].status, "claimed");
    fs.rmdirSync(file);
    assert.deepEqual(await (await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`)).json(), { ok: true, repeated: false });
    assert.equal(s.app.locals.state.listings["flat-1"].messages.length, 1, "the retry adds no second message");
  } finally { await s.close(); }
});

test("routine calls are rate limited and oversized bodies are refused", async () => {
  const s = await outreachApp({ options: { routineRateLimit: { limit: 2 } } });
  try {
    await s.addFlat("flat-1");
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await s.claim({ listingId: "flat-1", templateId: "first-contact" })).status);
    assert.deepEqual(codes, [409, 409, 429]);
    const big = await s.call("PUT", "/api/templates/decline/de", { body: "x".repeat(70 * 1024) });
    assert.equal(big.status, 413);
  } finally { await s.close(); }
});

test("a claim released as already-contacted closes the listing for good without using the cap or the gap", async () => {
  const s = await outreachApp({ outreach: { minGapMin: 20, dailyCap: 1 } });
  try {
    await s.approve("first-contact");
    await s.addFlat("c-1"); await s.addFlat("c-2");
    const { claim } = await (await s.claim({ listingId: "c-1", templateId: "first-contact" })).json();
    assert.equal((await s.routine("POST", `/api/outreach/claims/${claim.id}/release`, { reason: "maybe" })).status, 400);
    assert.deepEqual(await (await s.routine("POST", `/api/outreach/claims/${claim.id}/release`, { reason: "already-contacted" })).json(), { ok: true, repeated: false, status: "skipped" });
    assert.equal((await (await s.claim({ listingId: "c-1", templateId: "first-contact" })).json()).reason, "already-contacted");
    assert.equal((await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`)).status, 409);
    assert.equal((await s.claim({ listingId: "c-2", templateId: "first-contact" })).status, 201, "no gap and no cap used by the skipped claim");
    const log = (await (await s.call("GET", "/api/meta")).json()).log;
    assert.deepEqual(log[0], { date: "2026-10-22", type: "skipped", id: "c-1", text: "Helle 2-Zimmer-Wohnung", template: "first-contact" });
  } finally { await s.close(); }
});

// Replaces the atomic rename so a save waits on a gate and then fails; restore() puts the real one back.
function failingSaves() {
  const real = fs.promises.rename;
  let open; const gate = new Promise(r => { open = r; }); let armed = true;
  fs.promises.rename = async (a, b) => { if (armed) { await gate; throw new Error("EIO"); } return real(a, b); };
  return { release: () => open(), restore: () => { armed = false; fs.promises.rename = real; } };
}
const tick = ms => new Promise(r => setTimeout(r, ms));

test("a repeated claim runs the approval, version and eligibility checks again and releases the stale slot", async () => {
  for (const [name, change, reason] of [
    ["approval withdrawn", s => s.call("DELETE", "/api/templates/first-contact/de/approve"), "not-approved"],
    ["template edited", s => s.call("PUT", "/api/templates/first-contact/de", { body: "Guten Tag, ganz neuer Text hier. {name}" }), "not-approved"],
    ["listing dropped", s => s.call("PATCH", "/api/listings/flat-1", { status: "dropped" }), "already-contacted"],
    ["owner moved the link to ImmoScout", s => s.call("PATCH", "/api/listings/flat-1/listing", { url: "https://www.immobilienscout24.de/expose/1" }), "portal-not-allowed"]
  ]) {
    const s = await outreachApp();
    try {
      await s.addFlat("flat-1"); await s.approve("first-contact");
      const first = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
      await change(s);
      const r = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
      assert.equal(r.status, 409, name);
      assert.equal((await r.json()).reason, reason, name);
      const c = s.app.locals.state.outreach.claims.find(x => x.id === first.claim.id);
      assert.equal(c.status, "released", name);
      assert.equal(c.releaseReason, "stale", name);
      assert.equal(c.text, undefined, name);
      assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "outreach.json"), "utf8")).claims[0].text, undefined, name);
    } finally { await s.close(); }
  }
});

test("a repeat with another language or portal is a mismatch; release removes the text from the file", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    assert.deepEqual(await (await s.claim({ listingId: "flat-1", templateId: "first-contact", lang: "en" })).json(), { error: "claim-mismatch", reason: "claim-mismatch", claimId: claim.id });
    assert.equal((await s.claim({ listingId: "flat-1", templateId: "first-contact", via: "email" })).status, 409);
    const file = path.join(s.dir, "outreach.json");
    assert.ok(JSON.parse(fs.readFileSync(file, "utf8")).claims[0].text, "a reserved claim keeps its text on disk");
    await s.routine("POST", `/api/outreach/claims/${claim.id}/release`);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).claims[0].text, undefined);
  } finally { await s.close(); }
});

test("a repeat while the first save is pending is told to wait; when that save fails no slot exists", async () => {
  const s = await outreachApp();
  await s.addFlat("flat-1");
  try {
    await s.approve("first-contact");
    const g = failingSaves();
    try {
      const p1 = s.claim({ listingId: "flat-1", templateId: "first-contact" });
      await tick(80);
      const r2 = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
      assert.equal(r2.status, 409);
      assert.equal((await r2.json()).reason, "busy");
      g.release();
      assert.equal((await p1).status, 500);
    } finally { g.restore(); }
    assert.equal(s.app.locals.state.outreach.claims.length, 0);
  } finally { await s.close(); }
});

test("a repeat finds the message already logged on the listing and finishes the sent step", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    const file = path.join(s.dir, "outreach.json");
    fs.rmSync(file); fs.mkdirSync(file);
    assert.equal((await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`)).status, 500);
    fs.rmdirSync(file);
    const r = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.equal(r.status, 409);
    const j = await r.json();
    assert.equal(j.reason, "already-sent");
    assert.equal(j.text, undefined);
    const c = s.app.locals.state.outreach.claims[0];
    assert.equal(c.status, "sent");
    assert.equal(c.text, undefined);
    assert.equal(s.app.locals.state.listings["flat-1"].messages.length, 1);
  } finally { await s.close(); }
});

test("a failed approval save never re-approves a version edited meanwhile", async () => {
  const s = await outreachApp();
  try {
    await s.approve("first-contact");
    s.advance(1);
    const f = failingSaves();
    let ra, re;
    try {
      const pa = s.call("POST", "/api/templates/first-contact/de/approve", { version: 1 });
      await tick(80);
      const pe = s.call("PUT", "/api/templates/first-contact/de", { body: "Guten Tag, ungeprüfter neuer Text. {name}" });
      await tick(80);
      f.release();
      [ra, re] = await Promise.all([pa, pe]);
    } finally { f.restore(); }
    assert.equal(ra.status, 500);
    const t = s.app.locals.state.outreach.templates["first-contact"].de;
    assert.equal(t.approvedAt, null, "the unreviewed version 2 stays unapproved");
    assert.ok(t.version === 2 || re.status === 500);
  } finally { await s.close(); }
});

test("claims older than 24 hours are closed as skipped and expired, without their text, and log a skipped line", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    s.advance(25 * 60);
    await s.routine("GET", "/api/outreach/status");
    const c = s.app.locals.state.outreach.claims.find(x => x.id === claim.id);
    assert.equal(c.status, "skipped");
    assert.equal(c.reason, "expired");
    assert.equal(c.text, undefined);
    const logged = s.app.locals.state.meta.log.find(e => e.type === "skipped" && e.id === "flat-1");
    assert.equal(logged.template, "first-contact");
    const after = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.equal(after.status, 409, "an expired claim blocks its slot for good");
    const body = await after.json();
    assert.equal(body.reason, "already-contacted");
    assert.equal(body.expired, true);
    assert.equal(logged.reason, "expired");
    await s.app.locals.persistOutreach(); await s.app.locals.persist(); await tick(20);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "outreach.json"), "utf8")).claims.find(x => x.id === claim.id).text, undefined);
  } finally { await s.close(); }
});

test("a listing on an ImmoScout address is refused whatever its source says", async () => {
  const s = await outreachApp();
  try {
    await s.approve("first-contact");
    for (const [id, url] of [["s-1", "https://www.immobilienscout24.de/expose/1"], ["s-2", "https://immobilienscout24.de/expose/2"], ["s-3", "https://m.immobilienscout24.de/expose/3"]]) {
      await s.addFlat(id, { url });
      assert.equal((await (await s.claim({ listingId: id, templateId: "first-contact" })).json()).reason, "portal-not-allowed", url);
    }
    await s.addFlat("ok", { url: "https://www.immowelt.de/expose/immobilienscout24.de" });
    assert.equal((await s.claim({ listingId: "ok", templateId: "first-contact" })).status, 201);
  } finally { await s.close(); }
});

test("claim and release in a loop stops after three tries a day per listing", async () => {
  const s = await outreachApp({ outreach: { dailyCap: 1, minGapMin: 60 } });
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    for (let i = 0; i < 3; i++) {
      const r = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
      assert.equal(r.status, 201, "try " + i);
      await s.routine("POST", `/api/outreach/claims/${(await r.json()).claim.id}/release`);
    }
    const r = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).reason, "retry-limit");
    s.clock.t = new Date("2026-10-22T22:00:00Z").getTime();
    assert.equal((await s.claim({ listingId: "flat-1", templateId: "first-contact" })).status, 201, "a new Berlin day");
  } finally { await s.close(); }
});

test("saving the profile keeps the pause switch where the pause route left it", async () => {
  const s = await outreachApp();
  try {
    const p = s.app.locals.state.profile;
    await s.call("PUT", "/api/outreach/pause", { paused: true });
    assert.equal((await s.call("PUT", "/api/profile", { ...p, outreach: { ...p.outreach, paused: false } })).status, 200);
    assert.equal(s.app.locals.state.profile.outreach.paused, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "profile.json"), "utf8")).outreach.paused, true);
    await s.call("PUT", "/api/outreach/pause", { paused: false });
    await s.call("PUT", "/api/profile", { ...p, outreach: { ...p.outreach, paused: true } });
    assert.equal(s.app.locals.state.profile.outreach.paused, false);
  } finally { await s.close(); }
});

// Holds the next save of one file (matched by name) until release(), then lets it succeed or fail.
function gateSave(name, mode) {
  const real = fs.promises.rename;
  let open; const gate = new Promise(r => { open = r; }); let used = false;
  fs.promises.rename = async (a, b) => { if (!used && path.basename(b) === name) { used = true; await gate; if (mode === "fail") throw new Error("EIO"); } return real(a, b); };
  return { release: () => open(), restore: () => { fs.promises.rename = real; } };
}
const onDisk = s => JSON.parse(fs.readFileSync(path.join(s.dir, "outreach.json"), "utf8"));

test("while 'sent' is being saved, a repeat claim, sent or release for it is told to wait; a failed save loses nothing", async () => {
  const s = await outreachApp();
  let g = { restore() {} };
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    g = gateSave("listings.json", "fail");
    const sent = s.routine("POST", `/api/outreach/claims/${claim.id}/sent`);
    await tick(80);
    for (const r of [await s.claim({ listingId: "flat-1", templateId: "first-contact" }), await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`), await s.routine("POST", `/api/outreach/claims/${claim.id}/release`)]) {
      assert.equal(r.status, 409);
      assert.equal((await r.json()).reason, "busy");
    }
    g.release();
    assert.equal((await sent).status, 500);
    g.restore();
    const c = onDisk(s).claims.find(x => x.id === claim.id);
    assert.equal(c.status, "claimed");
    assert.ok(c.text, "the text is still there to be sent");
    assert.equal((s.app.locals.state.listings["flat-1"].messages || []).length, 0);
    assert.deepEqual(await (await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`)).json(), { ok: true, repeated: false });
  } finally { g.restore(); await s.close(); }
});

test("a failed approve save does not undo a withdrawal made while it was pending", async () => {
  const s = await outreachApp();
  let h = { restore() {} };
  try {
    await s.approve("first-contact"); s.advance(1);
    h = gateSave("outreach.json", "fail");
    const pa = s.call("POST", "/api/templates/first-contact/de/approve", { version: 1 });
    await tick(60);
    const pw = s.call("DELETE", "/api/templates/first-contact/de/approve");
    await tick(60);
    h.release();
    const [ra, rw] = await Promise.all([pa, pw]);
    h.restore();
    assert.equal(ra.status, 500);
    assert.equal(rw.status, 200);
    assert.equal(s.app.locals.state.outreach.templates["first-contact"].de.approvedAt, null);
    assert.equal(onDisk(s).templates["first-contact"].de.approvedAt, null);
  } finally { h.restore(); await s.close(); }
});

test("expired claims leave the file: status saves in the background, and start-up prunes too", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.ok(onDisk(s).claims[0].text);
    s.advance(25 * 60);
    const st = await (await s.routine("GET", "/api/outreach/status")).json();
    assert.equal(st.today.used, 0);
    await tick(80);
    await s.app.locals.persistOutreach(); await s.app.locals.persist();
    const c = onDisk(s).claims[0];
    assert.equal(c.status, "skipped");
    assert.equal(c.reason, "expired");
    assert.equal(c.text, undefined);
    assert.ok(JSON.parse(fs.readFileSync(path.join(s.dir, "meta.json"), "utf8")).log.some(e => e.type === "skipped" && e.id === "flat-1"), "the log line is saved too");
  } finally { await s.close(); }
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "flat-hunt-test-"));
  fs.writeFileSync(path.join(dir, "outreach.json"), JSON.stringify({ claims: [{ id: "0123456789abcdef", key: "x-1:first-contact", listingId: "x-1", templateId: "first-contact", lang: "de", version: 1, viewingId: null, via: "immowelt", claimedAt: "2026-10-20T08:00:00.000Z", status: "claimed", sentAt: null, releasedAt: null, text: "Guten Tag, Beispieltext" }] }));
  const r = await outreachApp({ options: { dataDir: dir } });
  try {
    const c = onDisk(r).claims[0];
    assert.equal(c.status, "skipped");
    assert.equal(c.text, undefined);
  } finally { await r.close(); }
});

test("prune leaves a claim alone while a request is still changing it", () => {
  const { prune } = require("../lib/outreach");
  const claim = { id: "0123456789abcdef", key: "x:first-contact", listingId: "x", templateId: "first-contact", status: "claimed", claimedAt: "2026-10-20T08:00:00.000Z", text: "t" };
  const now = new Date("2026-10-22T08:00:00.000Z"), expired = [];
  assert.equal(prune([claim], now, new Set([claim.id]), expired)[0], claim);
  assert.equal(expired.length, 0);
  assert.equal(prune([claim], now, new Set(), expired)[0].status, "skipped");
  assert.equal(expired.length, 1);
});

test("a blocked claim that was never expired does not say expired", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    await s.routine("POST", `/api/outreach/claims/${claim.id}/release`, { reason: "already-contacted" });
    const r = await s.claim({ listingId: "flat-1", templateId: "first-contact" });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).expired, undefined);
  } finally { await s.close(); }
});

test("a failed sync save keeps update-log lines that others added meanwhile", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1"); await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    s.advance(25 * 60);
    const f = failingSaves();
    let pSync;
    try {
      pSync = s.routine("POST", "/api/sync", { seen: {}, complete: false, checkedAt: "2026-10-23T09:00:00.000Z" });
      await tick(40); // the sync has replaced meta.log and waits for its save
      const rc = await s.claim({ listingId: "flat-1", templateId: "first-contact" }); // prunes: the expiry line is logged
      assert.equal(rc.status, 409);
      f.release();
      assert.equal((await pSync).status, 500);
      await tick(40);
    } finally { f.restore(); }
    const st = s.app.locals.state;
    assert.equal(st.outreach.claims.find(c => c.id === claim.id).status, "skipped");
    assert.ok(st.meta.log.some(e => e.type === "skipped" && e.reason === "expired"), "the expiry line survives the rollback");
    assert.notEqual(st.meta.lastCheck, "2026-10-23T09:00:00.000Z");
    await s.routine("PUT", "/api/meta", { lastCheck: "2026-10-23T10:00:00Z" });
    const disk = JSON.parse(fs.readFileSync(path.join(s.dir, "meta.json"), "utf8"));
    assert.ok(disk.log.some(e => e.type === "skipped" && e.reason === "expired"));
  } finally { await s.close(); }
});

test("start-up writes leave no temp file behind and log the expiry once", async () => {
  const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "flat-hunt-test-"));
  const claim = { id: "0123456789abcdef", key: "x-1:first-contact", listingId: "x-1", templateId: "first-contact", lang: "de", version: 1, viewingId: null, via: "immowelt", claimedAt: "2026-10-20T08:00:00.000Z", status: "claimed", sentAt: null, releasedAt: null, text: "t" };
  fs.writeFileSync(path.join(dir, "outreach.json"), JSON.stringify({ claims: [claim] }));
  const r = await outreachApp({ options: { dataDir: dir } });
  await r.close();
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith(".tmp")), []);
  const r2 = await outreachApp({ options: { dataDir: dir } });
  try { assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")).log.filter(e => e.type === "skipped" && e.reason === "expired").length, 1); }
  finally { await r2.close(); }
});
