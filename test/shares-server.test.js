const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const { docMeta, start, TEST_VAULT_KEY, TINY_JPEG, pdfPageStreams, hasPdfText } = require("./helpers");
const { defaultApplicant } = require("../lib/applicant");
const { defaultProfile } = require("../lib/profile");
const { hashToken } = require("../lib/shares");

const CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const json = (h = {}) => ({ ...h, "Content-Type": "application/json" });
const flat = { title: "2 rooms with balcony", url: "https://example.com/flat/1", source: "manual", mode: "rent", warmRent: 900, rooms: 2, size: 60, address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf", status: "contacted" };

// A vault with an applicant, a two-page PDF payslip and a JPEG id, plus one listing "flat".
async function setup(o = {}) {
  let clock = new Date("2026-10-20T10:00:00Z");
  const s = await start({ vaultKey: TEST_VAULT_KEY, now: () => clock, ...o });
  s.setClock = d => { clock = new Date(d); };
  const profile = defaultProfile(); profile.outreach.language = o.lang || "en"; profile.money.netIncome = 3200;
  await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(profile) });
  await fetch(s.base + "/api/applicant", { method: "PUT", headers: json(s.auth), body: JSON.stringify({ ...defaultApplicant(), name: "Alex Example" }) });
  await fetch(s.base + "/api/listings/flat", { method: "PUT", headers: s.sync, body: JSON.stringify(flat) });
  const d = await PDFDocument.create(); d.addPage(); d.addPage();
  const up = (body, type, q) => fetch(s.base + "/api/vault", { method: "POST", headers: { ...s.auth, "Content-Type": type, "X-Doc-Meta": docMeta(q) }, body }).then(r => r.json()).then(j => j.doc.id);
  s.payslip = await up(Buffer.from(await d.save()), "application/pdf", "type=payslip&date=2026-09-30");
  s.idDoc = await up(TINY_JPEG, "image/jpeg", "type=id");
  s.share = async (body = { docIds: [s.payslip, s.idDoc, "summary"] }, id = "flat") => {
    const r = await fetch(s.base + `/api/listings/${id}/shares`, { method: "POST", headers: json(s.auth), body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return s;
}
const get = (s, p) => fetch(s.base + p); // no password: share links are public

// ---------- Task 5: document requests and shares (owner side) ----------
test("logging a document request stores the types and sets docs-requested", async () => {
  const s = await setup();
  try {
    const r = await fetch(s.base + "/api/listings/flat/doc-requests", { method: "POST", headers: json(s.auth), body: JSON.stringify({ types: ["payslip", "schufa", "summary"] }) });
    assert.equal(r.status, 200);
    const { listing } = await r.json();
    assert.equal(listing.status, "docs-requested");
    assert.deepEqual(listing.docRequests, [{ at: "2026-10-20T10:00:00.000Z", types: ["payslip", "schufa", "summary"] }]);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"));
    assert.equal(saved.flat.status, "docs-requested");
    for (const body of [{ types: [] }, { types: ["passport"] }, { types: ["id", "id"] }, { types: ["id"], extra: 1 }, []])
      assert.equal((await fetch(s.base + "/api/listings/flat/doc-requests", { method: "POST", headers: json(s.auth), body: JSON.stringify(body) })).status, 400, JSON.stringify(body));
    assert.equal((await fetch(s.base + "/api/listings/nope/doc-requests", { method: "POST", headers: json(s.auth), body: JSON.stringify({ types: ["id"] }) })).status, 404);
  } finally { await s.close(); }
});

test("creating a share returns the link once and stores only the token's hash", async () => {
  const s = await setup();
  try {
    const { status, body } = await s.share();
    assert.equal(status, 201);
    assert.match(body.url, /^\/s\/[A-Za-z0-9_-]{43}$/);
    const token = body.url.slice(3);
    assert.deepEqual([body.share.listingId, body.share.docIds, body.share.subject, body.share.expiresAt, body.share.revokedAt, body.share.opens, body.share.active], ["flat", [s.payslip, s.idDoc, "summary"], "Beispielstraße 1, 40210 Düsseldorf", "2026-10-27T10:00:00.000Z", null, [], true]);
    assert.equal(body.share.tokenHash, undefined);
    const disk = fs.readFileSync(path.join(s.dir, "shares.json"), "utf8");
    assert.ok(!disk.includes(token));
    assert.ok(disk.includes(hashToken(token)));
    const list = await (await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).json();
    assert.equal(list.shares.length, 1);
    assert.ok(!JSON.stringify(list).includes(token) && !JSON.stringify(list).includes(hashToken(token)));
  } finally { await s.close(); }
});

test("share input: days 1–30, known documents only, the summary needs an applicant, unknown listing 404", async () => {
  const s = await setup();
  try {
    assert.equal((await s.share({ docIds: [s.payslip], days: 30 })).body.share.expiresAt, "2026-11-19T10:00:00.000Z");
    assert.equal((await s.share({ docIds: [s.payslip], days: 31 })).status, 400);
    assert.equal((await s.share({ docIds: [s.payslip], days: 0 })).status, 400);
    assert.equal((await s.share({ docIds: ["0123456789abcdef"] })).status, 400);
    assert.equal((await s.share({ docIds: [] })).status, 400);
    assert.equal((await s.share({ docIds: [s.payslip] }, "nope")).status, 404);
  } finally { await s.close(); }
  const t = await start({ vaultKey: TEST_VAULT_KEY });
  try {
    await fetch(t.base + "/api/listings/flat", { method: "PUT", headers: t.sync, body: JSON.stringify(flat) });
    const r = await fetch(t.base + "/api/listings/flat/shares", { method: "POST", headers: json(t.auth), body: JSON.stringify({ docIds: ["summary"] }) });
    assert.deepEqual([r.status, (await r.json()).details], [400, ["docIds: the summary needs the applicant profile first"]]);
  } finally { await t.close(); }
});

test("revoking a share; deleting the listing revokes its shares", async () => {
  const s = await setup();
  try {
    const a = (await s.share()).body.share, b = (await s.share()).body.share;
    const r = await fetch(s.base + "/api/shares/" + a.id, { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).share.revokedAt, "2026-10-20T10:00:00.000Z");
    assert.equal((await fetch(s.base + "/api/shares/" + a.id, { method: "DELETE", headers: s.auth })).status, 200);
    assert.equal((await fetch(s.base + "/api/shares/nope", { method: "DELETE", headers: s.auth })).status, 404);
    assert.equal((await fetch(s.base + "/api/listings/flat", { method: "DELETE", headers: s.auth })).status, 200);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "shares.json"), "utf8")).shares;
    assert.ok(saved.find(x => x.id === b.id).revokedAt);
  } finally { await s.close(); }
});

test("share routes answer 503 without a vault", async () => {
  const s = await start();
  try {
    await fetch(s.base + "/api/listings/flat", { method: "PUT", headers: s.sync, body: JSON.stringify(flat) });
    assert.equal((await fetch(s.base + "/api/listings/flat/shares", { method: "POST", headers: json(s.auth), body: JSON.stringify({ docIds: ["summary"] }) })).status, 503);
    assert.equal((await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).status, 503);
    assert.equal((await fetch(s.base + "/api/shares/x", { method: "DELETE", headers: s.auth })).status, 503);
  } finally { await s.close(); }
});

// ---------- fix round 1: rollbacks, status ruling, delete ordering ----------
const breakFile = (s, name) => { const p = path.join(s.dir, name); fs.rmSync(p, { force: true }); fs.mkdirSync(p); };
const listingsDisk = s => JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"));
const sharesDisk = s => JSON.parse(fs.readFileSync(path.join(s.dir, "shares.json"), "utf8")).shares;

test("a failed save rolls back a logged document request", async () => {
  const s = await setup();
  try {
    breakFile(s, "listings.json");
    const r = await fetch(s.base + "/api/listings/flat/doc-requests", { method: "POST", headers: json(s.auth), body: JSON.stringify({ types: ["id"] }) });
    assert.deepEqual([r.status, (await r.json()).error], [500, "save failed"]);
    const l = await (await fetch(s.base + "/api/listings", { headers: s.auth })).json();
    const flatNow = (l.listings || l).flat;
    assert.equal(flatNow.status, "new");
    assert.equal(flatNow.docRequests, undefined);
  } finally { await s.close(); }
});

test("a request on a decided listing is recorded but keeps its status", async () => {
  const s = await setup();
  try {
    for (const status of ["accepted", "rejected", "dropped", "gone"]) {
      await fetch(s.base + "/api/listings/flat", { method: "PUT", headers: s.sync, body: JSON.stringify({ ...flat, status }) });
      await fetch(s.base + "/api/listings/flat", { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ status }) });
      const r = await fetch(s.base + "/api/listings/flat/doc-requests", { method: "POST", headers: json(s.auth), body: JSON.stringify({ types: ["id"] }) });
      const { listing } = await r.json();
      assert.equal(listing.status, status);
      assert.ok(listing.docRequests.length >= 1);
    }
  } finally { await s.close(); }
});

test("a failed save rolls back share creation; a failed revocation stays revoked (fails closed)", async () => {
  const s = await setup();
  try {
    const { share: a, url } = (await s.share()).body;
    const before = fs.readFileSync(path.join(s.dir, "shares.json"), "utf8");
    fs.rmSync(path.join(s.dir, "shares.json")); fs.mkdirSync(path.join(s.dir, "shares.json"));
    const c = await s.share();
    assert.deepEqual([c.status, c.body.error], [500, "save failed"]);
    const r = await fetch(s.base + "/api/shares/" + a.id, { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 500);
    assert.equal((await get(s, url)).status, 404); // the link is dead although the save failed
    fs.rmSync(path.join(s.dir, "shares.json"), { recursive: true }); fs.writeFileSync(path.join(s.dir, "shares.json"), before);
    const list = await (await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).json();
    assert.equal(list.shares.length, 1);
    assert.ok(list.shares[0].revokedAt);
    assert.equal(list.shares[0].active, false);
    assert.equal(fs.readFileSync(path.join(s.dir, "shares.json"), "utf8"), before);
  } finally { await s.close(); }
});

test("revoking twice keeps the first revokedAt", async () => {
  const s = await setup();
  try {
    const a = (await s.share()).body.share;
    const first = (await (await fetch(s.base + "/api/shares/" + a.id, { method: "DELETE", headers: s.auth })).json()).share.revokedAt;
    s.setClock("2026-10-21T10:00:00Z");
    const second = (await (await fetch(s.base + "/api/shares/" + a.id, { method: "DELETE", headers: s.auth })).json()).share.revokedAt;
    assert.equal(second, first);
  } finally { await s.close(); }
});

test("deleting a listing: shares are written first; a failed shares write rolls back everything", async () => {
  const s = await setup();
  try {
    const sh = (await s.share()).body.share;
    const sharesBefore = fs.readFileSync(path.join(s.dir, "shares.json"), "utf8");
    const listingsBefore = fs.readFileSync(path.join(s.dir, "listings.json"), "utf8");
    fs.rmSync(path.join(s.dir, "shares.json")); fs.mkdirSync(path.join(s.dir, "shares.json"));
    const r = await fetch(s.base + "/api/listings/flat", { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 500);
    assert.equal(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"), listingsBefore);
    fs.rmSync(path.join(s.dir, "shares.json"), { recursive: true }); fs.writeFileSync(path.join(s.dir, "shares.json"), sharesBefore);
    assert.equal(sharesDisk(s).find(x => x.id === sh.id).revokedAt, null);
    const list = await (await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).json();
    assert.equal(list.shares[0].revokedAt, null);
    assert.equal((await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).status, 200);
  } finally { await s.close(); }
});

test("deleting a listing: a failed listing write after the shares were revoked keeps them revoked", async () => {
  const s = await setup();
  try {
    const sh = (await s.share()).body.share;
    breakFile(s, "listings.json");
    const r = await fetch(s.base + "/api/listings/flat", { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 500);
    assert.ok(sharesDisk(s).find(x => x.id === sh.id).revokedAt);
    const list = await (await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).json();
    assert.ok(list.shares[0].revokedAt);
    assert.equal((await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).status, 200);
  } finally { await s.close(); }
});

// ---------- Task 6: public share page and documents ----------
test("the share page is public, lists the documents and sends no-store, noindex and no-referrer", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    const r = await get(s, body.url);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    const html = await r.text();
    assert.match(html, /Alex Example shares these documents for the application for Beispielstraße 1, 40210 Düsseldorf/);
    for (const id of [s.payslip, s.idDoc, "summary"]) assert.ok(html.includes(`href="${body.url}/${id}"`), id);
    assert.match(html, /until 27\.10\.2026/);
  } finally { await s.close(); }
});

test("each shared document is a PDF with the watermark on every page, and each view is logged without the IP", async () => {
  const s = await setup({ lang: "de" });
  try {
    const { body } = await s.share();
    const text = "Nur für die Bewerbung um Beispielstraße 1, 40210 Düsseldorf · 20.10.2026";
    for (const [id, pages] of [[s.payslip, 2], [s.idDoc, 1], ["summary", 1]]) {
      const r = await get(s, body.url + "/" + id);
      assert.equal(r.status, 200, id);
      assert.equal(r.headers.get("content-type"), "application/pdf");
      assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
      const streams = await pdfPageStreams(Buffer.from(await r.arrayBuffer()));
      assert.equal(streams.length, pages, id);
      for (const st of streams) assert.ok(hasPdfText(st, text), "watermark missing in " + id);
    }
    const share = (await (await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).json()).shares[0];
    assert.deepEqual(share.opens.map(o => o.docId), [s.payslip, s.idDoc, "summary"]);
    assert.deepEqual(Object.keys(share.opens[0]).sort(), ["at", "docId"]);
    assert.ok(!fs.readFileSync(path.join(s.dir, "shares.json"), "utf8").includes("127.0.0.1"));
  } finally { await s.close(); }
});

test("unknown, expired and revoked links and documents outside the share all get the same 404", async () => {
  const s = await setup();
  try {
    const live = (await s.share({ docIds: [s.payslip] })).body;
    const revoked = (await s.share({ docIds: [s.payslip] })).body;
    await fetch(s.base + "/api/shares/" + revoked.share.id, { method: "DELETE", headers: s.auth });
    const short = (await s.share({ docIds: [s.payslip], days: 1 })).body;
    s.setClock("2026-10-21T10:00:01Z");
    const answers = [];
    for (const p of ["/s/" + "A".repeat(43), "/s/short", short.url, short.url + "/" + s.payslip, revoked.url, revoked.url + "/" + s.payslip, live.url + "/" + s.idDoc, live.url + "/x/y", "/s/"]) {
      const r = await get(s, p);
      answers.push([p, r.status, r.headers.get("content-type"), await r.text(), r.headers.get("cache-control")]);
    }
    for (const [p, ...a] of answers) assert.deepEqual(a, [404, "text/plain; charset=utf-8", "Not found", "no-store"], p);
    assert.equal((await get(s, live.url)).status, 200);
  } finally { await s.close(); }
});

test("share links are rate limited to 30 requests a minute per address", async () => {
  const s = await setup();
  try {
    for (let i = 0; i < 30; i++) assert.equal((await get(s, "/s/" + "B".repeat(43))).status, 404);
    const r = await get(s, "/s/" + "B".repeat(43));
    assert.equal(r.status, 429);
    assert.equal(r.headers.get("retry-after"), "60");
    assert.equal(r.headers.get("content-security-policy"), CSP);
    s.setClock("2026-10-20T10:01:00Z");
    assert.equal((await get(s, "/s/" + "B".repeat(43))).status, 404);
    assert.equal((await fetch(s.base + "/api/vault", { headers: s.auth })).status, 200); // the API is not limited
  } finally { await s.close(); }
});

test("without a vault every share link is 404", async () => {
  const first = await setup();
  const { url } = (await first.share()).body;
  await first.close();
  const s = await start({ dataDir: first.dir });
  try { assert.equal((await get(s, url)).status, 404); }
  finally { await s.close(); }
});

// ---------- Task 6 review fixes ----------
const NF = [404, "text/plain; charset=utf-8", "Not found", "no-store"];
const answer = async r => [r.status, r.headers.get("content-type"), await r.text(), r.headers.get("cache-control")];

test("malformed percent-encoding under /s gets the uniform 404, no stack", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    for (const p of ["/s/%E0%A4%A", body.url + "/%ZZ", "/s/%"]) assert.deepEqual(await answer(await get(s, p)), NF, p);
  } finally { await s.close(); }
});

test("a forced generic error shows no stack, JSON for the API and plain text elsewhere", async () => {
  const s = await setup();
  try {
    s.app.locals.state.listings = { toJSON() { throw new Error("boom /secret/path"); } };
    const r = await fetch(s.base + "/api/listings", { headers: s.auth });
    const t = await r.text();
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(t), { error: "server error" });
    const bad = await fetch(s.base + "/%E0%A4%A", { headers: s.auth });
    const bt = await bad.text();
    assert.ok(!/URIError|\bat \S+ \(|\/Users\//.test(bt), bt);
  } finally { await s.close(); }
});

test("HEAD on a document sends headers only and logs no open", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    const r = await fetch(s.base + body.url + "/" + s.payslip, { method: "HEAD" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    assert.equal((await fetch(s.base + body.url + "/" + s.payslip + "x", { method: "HEAD" })).status, 404);
    const share = (await (await fetch(s.base + "/api/listings/flat/shares", { headers: s.auth })).json()).shares[0];
    assert.deepEqual(share.opens, []);
  } finally { await s.close(); }
});

test("a POST with broken JSON to /s gets the uniform 404", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    for (const p of [body.url, "/s/" + "A".repeat(43)]) {
      const r = await fetch(s.base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{nope" });
      assert.deepEqual(await answer(r), NF, p);
    }
  } finally { await s.close(); }
});

test("a share whose listing is gone, and a document not in the share, are 404; the HTML page has a CSP", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    const only = (await s.share({ docIds: [s.payslip] })).body;
    assert.deepEqual(await answer(await get(s, only.url + "/summary")), NF);
    const page = await get(s, body.url);
    assert.equal(page.headers.get("content-security-policy"), CSP);
    delete s.app.locals.state.listings.flat;
    assert.deepEqual(await answer(await get(s, body.url)), NF);
    assert.deepEqual(await answer(await get(s, body.url + "/" + s.payslip)), NF);
  } finally { await s.close(); }
});

test("an unreadable stored document answers 500 Document unavailable", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    for (const f of walk(s.dir)) if (f.endsWith(".bin") && !f.endsWith("keycheck.bin")) fs.writeFileSync(f, Buffer.from("garbage"));
    const r = await get(s, body.url + "/" + s.payslip);
    assert.equal(r.status, 500);
    assert.equal(await r.text(), "Document unavailable");
  } finally { await s.close(); }
});

test("trustProxy decides whether X-Forwarded-For separates visitors in the rate limit", async () => {
  const hit = (s, ip) => fetch(s.base + "/s/" + "C".repeat(43), { headers: { "X-Forwarded-For": ip } });
  const on = await setup({ trustProxy: true });
  try {
    for (let i = 0; i < 30; i++) assert.equal((await hit(on, "9.9.9.9")).status, 404);
    assert.equal((await hit(on, "9.9.9.9")).status, 429);
    assert.equal((await hit(on, "8.8.8.8")).status, 404);
  } finally { await on.close(); }
  const off = await setup({ trustProxy: false });
  try {
    for (let i = 0; i < 30; i++) await hit(off, "9." + i + ".9.9");
    assert.equal((await hit(off, "8.8.8.8")).status, 429);
  } finally { await off.close(); }
});

test("every /s response and the API carry nosniff and X-Frame-Options DENY", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    const ok = r => { assert.equal(r.headers.get("x-content-type-options"), "nosniff"); assert.equal(r.headers.get("x-frame-options"), "DENY"); };
    ok(await get(s, body.url));
    ok(await get(s, body.url + "/" + s.payslip));
    ok(await get(s, "/s/" + "D".repeat(43)));
    ok(await fetch(s.base + "/api/vault", { headers: s.auth }));
    for (let i = 0; i < 40; i++) await get(s, "/s/" + "D".repeat(43));
    const r = await get(s, "/s/" + "D".repeat(43));
    assert.equal(r.status, 429);
    ok(r);
  } finally { await s.close(); }
});

test("every non-PDF share answer carries the CSP; PDFs are exempt", async () => {
  const s = await setup();
  try {
    const { body } = await s.share();
    for (const p of [body.url, "/s/" + "E".repeat(43), body.url + "/nope", "/s/%E0%A4%A", body.url + "/summary/extra"]) {
      const r = await get(s, p);
      assert.equal(r.headers.get("content-security-policy"), CSP, p);
    }
    const pdf = await get(s, body.url + "/" + s.payslip);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.headers.get("content-security-policy"), null);
  } finally { await s.close(); }
});
