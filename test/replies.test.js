const test = require("node:test");
const assert = require("node:assert/strict");
const { validateReply } = require("../lib/replies");
const { outreachApp, keyOnly } = require("./outreach-fixtures");

const NOW = new Date("2026-10-22T08:00:00Z");
const reply = (extra = {}) => ({ date: "2026-10-22T07:30:00+02:00", from: "Example GmbH", via: "immowelt", text: "Guten Tag, Sie können die Wohnung am Dienstag um 18 Uhr ansehen.", intent: "viewing-invite", proposedTimes: ["2026-10-27T18:00:00+01:00", "2026-10-28T17:30:00+01:00"], ...extra });

test("validateReply: normalises times and line ends, checks every field", () => {
  const { errors, value } = validateReply(reply({ text: "Zeile 1\r\nZeile 2", externalId: "<msg-1@example.org>" }), NOW);
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { date: "2026-10-22T05:30:00.000Z", from: "Example GmbH", via: "immowelt", text: "Zeile 1\nZeile 2", intent: "viewing-invite", externalId: "<msg-1@example.org>", proposedTimes: ["2026-10-27T17:00:00.000Z", "2026-10-28T16:30:00.000Z"], docTypes: null });
  const bad = [
    [{ intent: "maybe" }, /^intent:/], [{ via: "immoscout" }, /^via:/], [{ text: "" }, /^text:/], [{ text: "x".repeat(5001) }, /^text:/],
    [{ text: "a\u0000b" }, /control/], [{ date: "2026-10-22 07:30" }, /^date:/], [{ date: "2026-10-23T08:00:00Z" }, /^date:/],
    [{ proposedTimes: ["2026-10-27T18:00:00"] }, /^proposedTimes:/], [{ proposedTimes: Array(6).fill("2026-10-27T18:00:00Z") }, /^proposedTimes:/],
    [{ proposedTimes: ["2027-06-01T18:00:00Z"] }, /^proposedTimes:/], [{ intent: "question" }, /^proposedTimes: only/],
    [{ intent: "rejection", proposedTimes: undefined, docTypes: ["payslip"] }, /^docTypes: only/], [{ intent: "documents-request", proposedTimes: undefined, docTypes: ["passport"] }, /^docTypes:/],
    [{ externalId: "a b" }, /^externalId:/], [{ from: 7 }, /^from:/], [{ password: "x" }, /^password: unknown field/]
  ];
  for (const [patch, re] of bad) {
    const r = validateReply(reply(patch), NOW);
    assert.ok(r.errors.some(e => re.test(e)), JSON.stringify(patch) + " → " + r.errors.join("; "));
  }
});

test("a viewing invitation is logged with its intent, opens a pending proposal and sets viewing-invited", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const r = await s.routine("POST", "/api/listings/flat-1/replies", reply({ externalId: "immowelt-123" }));
    assert.equal(r.status, 201);
    const out = await r.json();
    assert.equal(out.status, "viewing-invited");
    assert.match(out.viewingId, /^[0-9a-f]{16}$/);
    const l = s.app.locals.state.listings["flat-1"];
    assert.deepEqual(l.messages.at(-1), { date: "2026-10-22T05:30:00.000Z", dir: "in", from: "Example GmbH", via: "immowelt", text: reply().text, intent: "viewing-invite", externalId: "immowelt-123" });
    assert.deepEqual(l.viewings, [{ id: out.viewingId, createdAt: "2026-10-22T08:00:00.000Z", proposedTimes: ["2026-10-27T17:00:00.000Z", "2026-10-28T16:30:00.000Z"], status: "pending", time: null, decidedAt: null, confirmationSentAt: null }]);
    // The same reply again (same id, or same time and text) is not logged twice.
    assert.deepEqual(await (await s.routine("POST", "/api/listings/flat-1/replies", reply({ externalId: "immowelt-123" }))).json(), { ok: true, repeated: true });
    assert.deepEqual(await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json(), { ok: true, repeated: true });
    assert.equal(l.messages.length, 1);
    const log = (await (await s.call("GET", "/api/meta")).json()).log;
    assert.deepEqual(log[0], { date: "2026-10-22", type: "reply", id: "flat-1", text: "Helle 2-Zimmer-Wohnung", intent: "viewing-invite" });
    assert.ok(!JSON.stringify(log).includes("Dienstag"), "no message text in the log");
  } finally { await s.close(); }
});

test("the owner confirms one proposed time; only then the routine may send the viewing confirmation, once", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    await s.approve("viewing-confirmation");
    const { viewingId } = await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json();
    const early = await s.claim({ listingId: "flat-1", templateId: "viewing-confirmation", viewingId });
    assert.equal((await early.json()).reason, "no-confirmed-viewing");
    // The routine cannot confirm.
    assert.equal((await s.routine("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-27T17:00:00.000Z" })).status, 403);
    assert.equal((await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-29T17:00:00.000Z" })).status, 400);
    const c = await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-27T18:00:00+01:00" });
    assert.equal(c.status, 200);
    assert.deepEqual((await c.json()).listing.viewings[0], { id: viewingId, createdAt: "2026-10-22T08:00:00.000Z", proposedTimes: ["2026-10-27T17:00:00.000Z", "2026-10-28T16:30:00.000Z"], status: "confirmed", time: "2026-10-27T17:00:00.000Z", decidedAt: "2026-10-22T08:00:00.000Z", confirmationSentAt: null });
    assert.equal((await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-28T16:30:00.000Z" })).status, 409);
    const r = await s.claim({ listingId: "flat-1", templateId: "viewing-confirmation", viewingId });
    assert.equal(r.status, 201);
    const { claim, text } = await r.json();
    assert.match(text, /Besichtigung von „Helle 2-Zimmer-Wohnung“ am Dienstag, 27\.10\.2026, 18:00 Uhr\./);
    await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`);
    const v = s.app.locals.state.listings["flat-1"].viewings[0];
    assert.equal(v.confirmationSentAt, "2026-10-22T08:00:00.000Z");
    assert.equal((await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/decline`)).status, 409, "a confirmed and answered viewing cannot be declined");
    s.advance(30);
    assert.equal((await (await s.claim({ listingId: "flat-1", templateId: "viewing-confirmation", viewingId })).json()).reason, "already-sent");
  } finally { await s.close(); }
});

test("declining a proposal sends nothing; a rejection closes the listing and cancels open proposals", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const { viewingId } = await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json();
    const d = await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/decline`);
    assert.equal((await d.json()).listing.viewings[0].status, "declined");
    const second = await (await s.routine("POST", "/api/listings/flat-1/replies", reply({ text: "Oder am Mittwoch?", proposedTimes: ["2026-10-28T16:30:00Z"] }))).json();
    const r = await (await s.routine("POST", "/api/listings/flat-1/replies", { via: "immowelt", text: "Leider haben wir uns für andere Bewerber entschieden.", intent: "rejection" })).json();
    assert.equal(r.status, "rejected");
    const vs = s.app.locals.state.listings["flat-1"].viewings;
    assert.deepEqual(vs.map(v => [v.id === second.viewingId, v.status]), [[false, "declined"], [true, "cancelled"]]);
  } finally { await s.close(); }
});

test("a documents request records the types and sets docs-requested; the routine still cannot create a share", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const r = await s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Bitte schicken Sie Gehaltsnachweise und SCHUFA.", intent: "documents-request", docTypes: ["payslip", "schufa"] });
    assert.equal((await r.json()).status, "docs-requested");
    const l = s.app.locals.state.listings["flat-1"];
    assert.deepEqual(l.docRequests, [{ at: "2026-10-22T08:00:00.000Z", types: ["payslip", "schufa"] }]);
    await s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Und eine Selbstauskunft bitte.", intent: "documents-request" });
    assert.deepEqual(l.docRequests[1].types, ["summary"], "without types the applicant summary is assumed");
    assert.equal((await s.routine("POST", "/api/listings/flat-1/shares", { docIds: ["summary"] })).status, 403);
    assert.equal(s.app.locals.state.shares.length, 0);
    // A question changes nothing but the conversation.
    await s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Haben Sie Haustiere?", intent: "question" });
    assert.equal(l.status, "docs-requested");
    assert.equal(l.messages.at(-1).intent, "question");
  } finally { await s.close(); }
});

test("replies need the sync key; unknown listings 404; a failed save rolls everything back", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    assert.equal((await s.call("POST", "/api/listings/flat-1/replies", reply())).status, 401);
    assert.equal((await s.routine("POST", "/api/listings/nope/replies", reply())).status, 404);
    assert.equal((await s.routine("POST", "/api/listings/flat-1/replies", { ...reply(), intent: "maybe" })).status, 400);
    const fs = require("node:fs"), path = require("node:path");
    fs.rmSync(path.join(s.dir, "listings.json")); fs.mkdirSync(path.join(s.dir, "listings.json"));
    const before = structuredClone(s.app.locals.state.listings["flat-1"]);
    assert.equal((await s.routine("POST", "/api/listings/flat-1/replies", reply())).status, 500);
    assert.deepEqual(s.app.locals.state.listings["flat-1"], before);
    assert.ok(!s.app.locals.state.meta.log.some(e => e.type === "reply"));
  } finally { await s.close(); }
});

test("documents-follow needs a documents request; decline needs a dropped listing that was contacted", async () => {
  const s = await outreachApp({ outreach: { minGapMin: 5 } });
  try {
    await s.addFlat("flat-1");
    await s.approve("documents-follow"); await s.approve("decline"); await s.approve("first-contact");
    assert.equal((await (await s.claim({ listingId: "flat-1", templateId: "documents-follow" })).json()).reason, "no-doc-request");
    assert.equal((await (await s.claim({ listingId: "flat-1", templateId: "decline" })).json()).reason, "not-dropped");
    await s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Bitte Unterlagen schicken.", intent: "documents-request" });
    const docs = await (await s.claim({ listingId: "flat-1", templateId: "documents-follow" })).json();
    assert.match(docs.text, /Die gewünschten Unterlagen schicken wir Ihnen in Kürze als Link\./);
    await s.routine("POST", `/api/outreach/claims/${docs.claim.id}/sent`);
    await s.call("PATCH", "/api/listings/flat-1", { status: "dropped" });
    s.advance(5);
    assert.equal((await s.claim({ listingId: "flat-1", templateId: "decline" })).status, 201);
  } finally { await s.close(); }
});

test("a reply body over 64 KB is refused with 413", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    assert.equal((await s.routine("POST", "/api/listings/flat-1/replies", reply({ text: "x".repeat(70000) }))).status, 413);
  } finally { await s.close(); }
});

// ---------- fix round 1 ----------
const fs = require("node:fs"), path = require("node:path");
const wait = ms => new Promise(r => setTimeout(r, ms));
// Holds the next write of listings.json until released, then makes it fail.
function gateNextListingsWrite() {
  const real = fs.promises.rename;
  let release; const p = new Promise(r => { release = r; });
  fs.promises.rename = async (a, b) => {
    if (String(b).endsWith("listings.json")) { fs.promises.rename = real; await p; throw new Error("EIO simulated"); }
    return real.call(fs.promises, a, b);
  };
  return { release, restore: () => { fs.promises.rename = real; } };
}
const onDisk = s => JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"))["flat-1"];

test("race: a failed reply save keeps what /sent recorded meanwhile", async () => {
  const s = await outreachApp();
  let g = null;
  try {
    await s.addFlat("flat-1");
    await s.approve("first-contact");
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "first-contact" })).json();
    g = gateNextListingsWrite();
    const pReply = s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Haben Sie Haustiere?", intent: "question" });
    await wait(80);
    const pSent = s.routine("POST", `/api/outreach/claims/${claim.id}/sent`);
    await wait(80);
    g.release();
    const [a, b] = await Promise.all([pReply, pSent]);
    assert.equal(a.status, 500);
    assert.equal(b.status, 200);
    const l = s.app.locals.state.listings["flat-1"];
    assert.deepEqual(l.messages.map(m => m.dir), ["out"]);
    assert.equal(l.status, "contacted");
    assert.deepEqual(onDisk(s).messages.map(m => m.dir), ["out"]);
    assert.equal(onDisk(s).status, "contacted");
  } finally { if (g) g.restore(); await s.close(); }
});

test("race: a failed confirm save keeps a documents-request reply logged meanwhile", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const { viewingId } = await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json();
    const g = gateNextListingsWrite();
    const pConf = s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-27T17:00:00Z" });
    await wait(80);
    const pRep = s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Bitte Unterlagen schicken.", intent: "documents-request" });
    await wait(80);
    g.release();
    const [a, b] = await Promise.all([pConf, pRep]);
    assert.equal(a.status, 500);
    assert.equal(b.status, 201);
    const l = s.app.locals.state.listings["flat-1"];
    assert.equal(l.viewings[0].status, "pending");
    assert.equal(l.status, "docs-requested");
    assert.equal(l.docRequests.length, 1);
    const d = onDisk(s);
    assert.deepEqual(d.messages.map(m => m.intent), ["viewing-invite", "documents-request"]);
    assert.equal(d.docRequests.length, 1);
    assert.equal(d.viewings[0].status, "pending");
  } finally { await s.close(); }
});

test("a reply without date or externalId that is posted again is a repeat", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const inv = { via: "immowelt", from: "Example GmbH", text: "Dienstag 18 Uhr?", intent: "viewing-invite", proposedTimes: ["2026-10-27T18:00:00+01:00"] };
    assert.equal((await s.routine("POST", "/api/listings/flat-1/replies", inv)).status, 201);
    s.advance(1);
    const again = await s.routine("POST", "/api/listings/flat-1/replies", inv);
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), { ok: true, repeated: true });
    assert.equal(s.app.locals.state.listings["flat-1"].viewings.length, 1);
  } finally { await s.close(); }
});

test("the 200-message limit answers 409; replies share the routine rate limit", async () => {
  const s = await outreachApp({ options: { routineRateLimit: { limit: 3 } } });
  try {
    await s.addFlat("flat-1");
    const l = s.app.locals.state.listings["flat-1"];
    l.messages = Array.from({ length: 200 }, (_, i) => ({ date: "2026-10-01T00:00:00.000Z", dir: "in", from: "", via: "email", text: "m" + i }));
    const r = await s.routine("POST", "/api/listings/flat-1/replies", reply());
    assert.equal(r.status, 409);
    assert.equal((await r.json()).reason, "too-many-messages");
    assert.equal(l.messages.length, 200);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await s.routine("POST", "/api/listings/flat-1/replies", reply())).status);
    assert.ok(codes.includes(429), codes.join());
  } finally { await s.close(); }
});

test("a rejection also cancels a confirmed viewing whose confirmation was sent", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    await s.approve("viewing-confirmation");
    const { viewingId } = await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json();
    await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-27T17:00:00.000Z" });
    const { claim } = await (await s.claim({ listingId: "flat-1", templateId: "viewing-confirmation", viewingId })).json();
    await s.routine("POST", `/api/outreach/claims/${claim.id}/sent`);
    await s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Leider vergeben.", intent: "rejection" });
    assert.equal(s.app.locals.state.listings["flat-1"].viewings[0].status, "cancelled");
  } finally { await s.close(); }
});

test("decline and a changed confirm answer 409 claim-open while a confirmation claim is open", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    await s.approve("viewing-confirmation");
    const { viewingId } = await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json();
    await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-27T17:00:00.000Z" });
    assert.equal((await s.claim({ listingId: "flat-1", templateId: "viewing-confirmation", viewingId })).status, 201);
    const d = await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/decline`);
    assert.equal(d.status, 409);
    assert.equal((await d.json()).reason, "claim-open");
    const c = await s.call("POST", `/api/listings/flat-1/viewings/${viewingId}/confirm`, { time: "2026-10-28T16:30:00.000Z" });
    assert.equal(c.status, 409);
    assert.equal((await c.json()).reason, "claim-open");
  } finally { await s.close(); }
});

test("confirming the same time again is idempotent; decline twice and no proposed times are refused", async () => {
  const s = await outreachApp();
  try {
    await s.addFlat("flat-1");
    const { viewingId } = await (await s.routine("POST", "/api/listings/flat-1/replies", reply())).json();
    const url = `/api/listings/flat-1/viewings/${viewingId}`;
    assert.equal((await s.call("POST", url + "/confirm", { time: "2026-10-27T17:00:00.000Z" })).status, 200);
    assert.equal((await s.call("POST", url + "/confirm", { time: "2026-10-27T17:00:00.000Z" })).status, 200);
    assert.equal((await s.call("POST", url + "/confirm", { time: "2026-10-28T16:30:00.000Z" })).status, 409);
    const inv = await (await s.routine("POST", "/api/listings/flat-1/replies", { via: "email", text: "Besichtigung möglich, wir melden uns.", intent: "viewing-invite" })).json();
    const u2 = `/api/listings/flat-1/viewings/${inv.viewingId}`;
    assert.equal((await s.call("POST", u2 + "/confirm", { time: "2026-10-27T17:00:00.000Z" })).status, 400);
    assert.equal((await s.call("POST", u2 + "/decline")).status, 200);
    assert.equal((await s.call("POST", u2 + "/decline")).status, 409);
  } finally { await s.close(); }
});

test("impossible dates, a date over a year back and a multi-line from are refused", () => {
  const { isoTime } = require("../lib/replies");
  assert.equal(isoTime("2026-02-30T10:00:00Z"), null);
  assert.equal(isoTime("2026-10-27T24:00:00Z"), null);
  assert.equal(isoTime("2026-10-27T10:60:00Z"), null);
  assert.equal(isoTime("2026-10-27T10:00:00+25:00"), null);
  assert.equal(isoTime("2026-10-27T18:00:00+01:00"), "2026-10-27T17:00:00.000Z");
  const bad = [[{ date: "2025-10-01T10:00:00Z" }, /^date:/], [{ from: "A\nB" }, /^from:/], [{ from: "A\tB" }, /^from:/], [{ date: "2026-02-30T10:00:00Z" }, /^date:/]];
  for (const [patch, re] of bad) assert.ok(validateReply(reply(patch), NOW).errors.some(e => re.test(e)), JSON.stringify(patch));
});
