const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PDFDocument } = require("pdf-lib");
const { docMeta, start, TEST_VAULT_KEY, OTHER_VAULT_KEY, TINY_PNG, TINY_JPEG, pdfPageStreams, hasPdfText } = require("./helpers");
const onePagePdf = async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); return Buffer.from(await d.save()); };
const upload = (s, body, type, meta = "type=payslip&label=September&date=2026-09-30", headers = {}) =>
  fetch(s.base + "/api/vault", { method: "POST", headers: { ...s.auth, "Content-Type": type, "X-Doc-Meta": docMeta(meta), ...headers }, body });

const json = (h = {}) => ({ ...h, "Content-Type": "application/json" });
const withVault = (o = {}) => start({ vaultKey: TEST_VAULT_KEY, ...o });
const runServer = env => spawnSync(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { PATH: process.env.PATH, PORT: "0", SITE_PASSWORD: "pw", ...env }, timeout: 1500, encoding: "utf8" });
const { defaultApplicant } = require("../lib/applicant");
const applicant = () => ({ ...defaultApplicant(), name: "Alex Example", email: "alex@example.com", job: { title: "Engineer", employer: "Example GmbH", since: "2022-04", permanent: true } });

// ---------- Task 1: key and start-up ----------
test("without VAULT_KEY the vault routes answer 503 and the status says off", async () => {
  const s = await start();
  try {
    assert.deepEqual(await (await fetch(s.base + "/api/vault/status", { headers: s.auth })).json(), { status: "off" });
    for (const p of ["/api/vault", "/api/applicant", "/api/vault/0123456789abcdef"]) {
      const r = await fetch(s.base + p, { headers: s.auth });
      assert.equal(r.status, 503, p);
      assert.deepEqual(await r.json(), { error: "vault not configured" });
    }
    assert.ok(!fs.existsSync(path.join(s.dir, "vault")));
  } finally { await s.close(); }
});

test("with VAULT_KEY the vault is created with a key check and reported ready", async () => {
  const s = await withVault();
  try {
    assert.deepEqual(await (await fetch(s.base + "/api/vault/status", { headers: s.auth })).json(), { status: "ready" });
    assert.ok(fs.existsSync(path.join(s.dir, "vault", "keycheck.bin")));
  } finally { await s.close(); }
});

test("createApp with a wrong key keeps the vault closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-test-"));
  await (await withVault({ dataDir: dir })).close();
  const s = await start({ dataDir: dir, vaultKey: OTHER_VAULT_KEY });
  try {
    assert.deepEqual(await (await fetch(s.base + "/api/vault/status", { headers: s.auth })).json(), { status: "wrong-key" });
    assert.equal((await fetch(s.base + "/api/vault", { headers: s.auth })).status, 503);
  } finally { await s.close(); }
});

test("the server refuses to start with vault data and a missing, wrong or malformed VAULT_KEY", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-start-"));
  await (await withVault({ dataDir: dir })).close();
  const missing = runServer({ DATA_DIR: dir });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /holds data but VAULT_KEY is not set/);
  const wrong = runServer({ DATA_DIR: dir, VAULT_KEY: OTHER_VAULT_KEY });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /VAULT_KEY does not open the document vault/);
  const malformed = runServer({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-start-")), VAULT_KEY: "short" });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /openssl rand -base64 32/);
  const right = runServer({ DATA_DIR: dir, VAULT_KEY: TEST_VAULT_KEY });
  assert.equal(right.status, null); // still running when the timeout kills it
  assert.match(right.stdout, /Flat Hunt on/);
  const empty = runServer({ DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-start-")) });
  assert.equal(empty.status, null);
  assert.match(empty.stderr, /VAULT_KEY is not set/);
});

test("the server refuses a VAULT_KEY without SITE_PASSWORD, even with ALLOW_OPEN=1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-start-"));
  const r = runServer({ DATA_DIR: dir, SITE_PASSWORD: "", ALLOW_OPEN: "1", VAULT_KEY: TEST_VAULT_KEY });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /document vault needs SITE_PASSWORD/);
  const open = runServer({ DATA_DIR: dir, SITE_PASSWORD: "", ALLOW_OPEN: "1" });
  assert.equal(open.status, null);
  assert.match(open.stderr, /vault is disabled/);
});

test("the server refuses to start when the vault cannot be read", { skip: process.getuid && process.getuid() === 0 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-start-"));
  await (await withVault({ dataDir: dir })).close();
  const f = path.join(dir, "vault", "keycheck.bin");
  fs.chmodSync(f, 0);
  try {
    const r = runServer({ DATA_DIR: dir, VAULT_KEY: TEST_VAULT_KEY });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot be read/);
  } finally { fs.chmodSync(f, 0o600); }
});

// ---------- Task 2: applicant ----------
test("applicant: 404 first, validated PUT, stored encrypted, survives a restart", async () => {
  const s = await withVault();
  try {
    assert.equal((await fetch(s.base + "/api/applicant", { headers: s.auth })).status, 404);
    const badPut = await fetch(s.base + "/api/applicant", { method: "PUT", headers: json(s.auth), body: JSON.stringify({ ...applicant(), iban: "x" }) });
    assert.equal(badPut.status, 400);
    assert.deepEqual((await badPut.json()).details, ["iban: unknown field"]);
    const put = await fetch(s.base + "/api/applicant", { method: "PUT", headers: json(s.auth), body: JSON.stringify(applicant()) });
    assert.equal(put.status, 200);
    assert.equal((await put.json()).applicant.name, "Alex Example");
    const raw = fs.readFileSync(path.join(s.dir, "vault", "applicant.json"));
    assert.ok(!raw.includes("Alex Example"));
  } finally { await s.close(); }
  const again = await withVault({ dataDir: s.dir });
  try { assert.equal((await (await fetch(again.base + "/api/applicant", { headers: again.auth })).json()).applicant.job.employer, "Example GmbH"); }
  finally { await again.close(); }
});

test("applicant: a failed save answers 500 and keeps the previous applicant", async () => {
  const s = await withVault();
  try {
    await fetch(s.base + "/api/applicant", { method: "PUT", headers: json(s.auth), body: JSON.stringify(applicant()) });
    fs.rmSync(path.join(s.dir, "vault", "applicant.json"));
    fs.mkdirSync(path.join(s.dir, "vault", "applicant.json"));
    const r = await fetch(s.base + "/api/applicant", { method: "PUT", headers: json(s.auth), body: JSON.stringify({ ...applicant(), name: "Someone Else" }) });
    assert.equal(r.status, 500);
    assert.equal((await (await fetch(s.base + "/api/applicant", { headers: s.auth })).json()).applicant.name, "Alex Example");
  } finally { await s.close(); }
});

test("vault and applicant routes need the password", async () => {
  const s = await withVault();
  try {
    for (const [m, p] of [["GET", "/api/applicant"], ["PUT", "/api/applicant"], ["GET", "/api/vault"], ["POST", "/api/vault"], ["GET", "/api/vault/status"], ["GET", "/api/applicant/summary.pdf"], ["DELETE", "/api/shares/x"], ["POST", "/api/listings/x/doc-requests"], ["POST", "/api/listings/x/shares"], ["GET", "/api/listings/x/shares"]])
      assert.equal((await fetch(s.base + p, { method: m })).status, 401, m + " " + p);
  } finally { await s.close(); }
});

// ---------- Task 3: applicant summary ----------
test("summary.pdf: 404 without applicant, 400 for an unknown language, one page with the name otherwise", async () => {
  const s = await withVault();
  try {
    assert.equal((await fetch(s.base + "/api/applicant/summary.pdf", { headers: s.auth })).status, 404);
    await fetch(s.base + "/api/applicant", { method: "PUT", headers: json(s.auth), body: JSON.stringify(applicant()) });
    assert.equal((await fetch(s.base + "/api/applicant/summary.pdf?lang=fr", { headers: s.auth })).status, 400);
    const r = await fetch(s.base + "/api/applicant/summary.pdf?lang=de", { headers: s.auth });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    const pages = await pdfPageStreams(Buffer.from(await r.arrayBuffer()));
    assert.equal(pages.length, 1);
    assert.ok(hasPdfText(pages[0], "Alex Example"));
    assert.ok(hasPdfText(pages[0], "Selbstauskunft (Kurzfassung)"));
  } finally { await s.close(); }
});

// ---------- Task 4: documents ----------
test("upload, list, download, edit and delete a document; everything on disk is encrypted", async () => {
  const s = await withVault();
  try {
    const pdf = await onePagePdf();
    const up = await upload(s, pdf, "application/pdf");
    assert.equal(up.status, 201);
    const { doc } = await up.json();
    assert.match(doc.id, /^[0-9a-f]{16}$/);
    assert.deepEqual({ ...doc, id: 0, uploadedAt: 0 }, { id: 0, type: "payslip", label: "September", date: "2026-09-30", mime: "application/pdf", size: pdf.length, uploadedAt: 0, redactedAt: null, outdated: false });
    const png = await (await upload(s, TINY_PNG, "image/png", "type=id")).json();
    assert.deepEqual([png.doc.label, png.doc.date], ["", null]);

    const list = (await (await fetch(s.base + "/api/vault", { headers: s.auth })).json()).docs;
    assert.deepEqual(list.map(d => d.id).sort(), [doc.id, png.doc.id].sort());
    assert.ok(list.every(d => d.file === undefined));

    const dl = await fetch(s.base + "/api/vault/" + doc.id, { headers: s.auth });
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("content-type"), "application/pdf");
    assert.equal(dl.headers.get("content-disposition"), 'attachment; filename="payslip-2026-09-30.pdf"');
    assert.equal(dl.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()), pdf);

    const ed = await fetch(s.base + "/api/vault/" + doc.id, { method: "PUT", headers: json(s.auth), body: JSON.stringify({ label: "Payslip September", date: "2026-06-30" }) });
    assert.equal(ed.status, 200);
    assert.deepEqual([(await ed.json()).doc.label], ["Payslip September"]);
    assert.equal((await fetch(s.base + "/api/vault/" + doc.id, { method: "PUT", headers: json(s.auth), body: JSON.stringify({ size: 1 }) })).status, 400);

    for (const f of fs.readdirSync(path.join(s.dir, "vault"))) {
      const raw = fs.readFileSync(path.join(s.dir, "vault", f));
      assert.ok(!raw.includes("Payslip September") && !raw.includes("%PDF") && !raw.includes("PNG"), f + " is not encrypted");
    }
    assert.equal((await fetch(s.base + "/api/vault/" + doc.id, { method: "DELETE", headers: s.auth })).status, 200);
    assert.equal((await fetch(s.base + "/api/vault/" + doc.id, { headers: s.auth })).status, 404);
    assert.equal(fs.readdirSync(path.join(s.dir, "vault")).filter(f => f.endsWith(".bin") && f !== "keycheck.bin").length, 1);
  } finally { await s.close(); }
});

test("uploads: wrong magic bytes 400, other types 415, empty 400, bad metadata 400, unreadable PDF 400", async () => {
  const s = await withVault();
  try {
    const pdf = await onePagePdf();
    const mismatch = await upload(s, TINY_PNG, "application/pdf");
    assert.equal(mismatch.status, 400);
    assert.deepEqual(await mismatch.json(), { error: "file content does not match its type" });
    assert.equal((await upload(s, pdf, "image/jpeg")).status, 400);
    assert.equal((await upload(s, Buffer.from("GIF89a"), "image/gif")).status, 415);
    assert.equal((await upload(s, Buffer.alloc(0), "image/png")).status, 400);
    assert.equal((await upload(s, pdf, "application/pdf", "type=passport")).status, 400);
    assert.equal((await upload(s, pdf, "application/pdf", "type=id&date=31.12.2026")).status, 400);
    assert.equal((await upload(s, pdf, "application/pdf", "type=id&owner=x")).status, 400);
    const broken = await upload(s, Buffer.from("%PDF-1.7 not really"), "application/pdf", "type=id");
    assert.deepEqual([broken.status, (await broken.json()).error], [400, "pdf cannot be read (encrypted or damaged)"]);
    assert.equal((await upload(s, TINY_JPEG, "image/jpeg", "type=id")).status, 201);
    assert.equal((await (await fetch(s.base + "/api/vault", { headers: s.auth })).json()).docs.length, 1);
  } finally { await s.close(); }
});

test("uploads over 10 MB answer 413 with JSON", async () => {
  const s = await withVault();
  try {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1); big.write("%PDF-1.7");
    const r = await upload(s, big, "application/pdf");
    assert.equal(r.status, 413);
    assert.deepEqual(await r.json(), { error: "file too large" });
  } finally { await s.close(); }
});

test("payslips older than three months are flagged in the list", async () => {
  const s = await withVault({ now: () => new Date("2026-10-20T12:00:00Z") });
  try {
    const pdf = await onePagePdf();
    await upload(s, pdf, "application/pdf", "type=payslip&date=2026-06-30");
    await upload(s, pdf, "application/pdf", "type=payslip&date=2026-09-30");
    const docs = (await (await fetch(s.base + "/api/vault", { headers: s.auth })).json()).docs;
    assert.deepEqual(docs.map(d => [d.date, d.outdated]).sort(), [["2026-06-30", true], ["2026-09-30", false]]);
  } finally { await s.close(); }
});

test("replace stores a new version, keeps the metadata, records redactedAt and removes the old file", async () => {
  const s = await withVault();
  try {
    const { doc } = await (await upload(s, TINY_PNG, "image/png")).json();
    const before = fs.readdirSync(path.join(s.dir, "vault")).filter(f => f.endsWith(".bin") && f !== "keycheck.bin");
    const pdf = await onePagePdf();
    const r = await fetch(s.base + "/api/vault/" + doc.id + "/replace", { method: "POST", headers: { ...s.auth, "Content-Type": "application/pdf" }, body: pdf });
    assert.equal(r.status, 200);
    const after = (await r.json()).doc;
    assert.deepEqual([after.id, after.type, after.label, after.date, after.mime, after.size], [doc.id, "payslip", "September", "2026-09-30", "application/pdf", pdf.length]);
    assert.ok(after.redactedAt);
    const files = fs.readdirSync(path.join(s.dir, "vault")).filter(f => f.endsWith(".bin") && f !== "keycheck.bin");
    assert.equal(files.length, 1);
    assert.notEqual(files[0], before[0]);
    assert.deepEqual(Buffer.from(await (await fetch(s.base + "/api/vault/" + doc.id, { headers: s.auth })).arrayBuffer()), pdf);
    assert.equal((await fetch(s.base + "/api/vault/" + doc.id + "/replace", { method: "POST", headers: { ...s.auth, "Content-Type": "application/pdf" }, body: TINY_PNG })).status, 400);
    assert.equal((await fetch(s.base + "/api/vault/0123456789abcdef/replace", { method: "POST", headers: { ...s.auth, "Content-Type": "application/pdf" }, body: pdf })).status, 404);
  } finally { await s.close(); }
});

test("a failed index save on upload answers 500 and leaves no document behind", async () => {
  const s = await withVault();
  try {
    fs.mkdirSync(path.join(s.dir, "vault", "index.json"));
    const r = await upload(s, await onePagePdf(), "application/pdf");
    assert.equal(r.status, 500);
    fs.rmdirSync(path.join(s.dir, "vault", "index.json"));
    assert.deepEqual((await (await fetch(s.base + "/api/vault", { headers: s.auth })).json()).docs, []);
    assert.deepEqual(fs.readdirSync(path.join(s.dir, "vault")).filter(f => f.endsWith(".bin")), ["keycheck.bin"]);
  } finally { await s.close(); }
});

test("a damaged image with the right magic bytes answers 400 JSON", async () => {
  const s = await withVault();
  try {
    const r = await upload(s, Buffer.concat([TINY_PNG.subarray(0, 8), Buffer.from("garbage")]), "image/png", "type=id");
    assert.deepEqual([r.status, (await r.json()).error], [400, "image cannot be read"]);
  } finally { await s.close(); }
});

test("a failed index save on replace, edit and delete answers 500 and keeps the old document", async () => {
  const s = await withVault();
  try {
    const pdf = await onePagePdf();
    const { doc } = await (await upload(s, TINY_PNG, "image/png")).json();
    const bins = () => fs.readdirSync(path.join(s.dir, "vault")).filter(f => f.endsWith(".bin")).sort();
    const before = bins();
    const idx = path.join(s.dir, "vault", "index.json"), saved = fs.readFileSync(idx);
    fs.rmSync(idx); fs.mkdirSync(idx);
    const rep = await fetch(s.base + "/api/vault/" + doc.id + "/replace", { method: "POST", headers: { ...s.auth, "Content-Type": "application/pdf" }, body: pdf });
    assert.deepEqual([rep.status, (await rep.json()).error], [500, "save failed"]);
    const ed = await fetch(s.base + "/api/vault/" + doc.id, { method: "PUT", headers: json(s.auth), body: JSON.stringify({ label: "New" }) });
    assert.equal(ed.status, 500);
    assert.equal((await fetch(s.base + "/api/vault/" + doc.id, { method: "DELETE", headers: s.auth })).status, 500);
    assert.deepEqual(bins(), before);
    fs.rmdirSync(idx); fs.writeFileSync(idx, saved);
    const list = (await (await fetch(s.base + "/api/vault", { headers: s.auth })).json()).docs;
    assert.deepEqual([list.length, list[0].label, list[0].mime, list[0].redactedAt], [1, "September", "image/png", null]);
    assert.deepEqual(Buffer.from(await (await fetch(s.base + "/api/vault/" + doc.id, { headers: s.auth })).arrayBuffer()), TINY_PNG);
  } finally { await s.close(); }
});

test("malformed JSON answers 400 JSON; unknown or malformed ids answer 404", async () => {
  const s = await withVault();
  try {
    const bad = await fetch(s.base + "/api/vault/0123456789abcdef", { method: "PUT", headers: json(s.auth), body: "{nope" });
    assert.deepEqual([bad.status, await bad.json()], [400, { error: "invalid json" }]);
    for (const id of ["0123456789abcdef", "..%2Fkeycheck", "constructor"]) assert.equal((await fetch(s.base + "/api/vault/" + id, { headers: s.auth })).status, 404, id);
  } finally { await s.close(); }
});

test("upload metadata travels in X-Doc-Meta; the URL carries none and query parameters are refused", async () => {
  const s = await withVault();
  try {
    const pdf = await onePagePdf();
    const post = (url, headers) => fetch(s.base + url, { method: "POST", headers: { ...s.auth, "Content-Type": "application/pdf", ...headers }, body: pdf });
    const q = await post("/api/vault?type=payslip", { "X-Doc-Meta": docMeta({ type: "payslip" }) });
    assert.equal(q.status, 400);
    assert.equal((await post("/api/vault?type=payslip", {})).status, 400); // no silent fallback to the URL
    assert.equal((await post("/api/vault", {})).status, 400); // no header: type missing
    const ok = await upload(s, pdf, "application/pdf", { type: "contract", label: "Jürgen – Ünï", date: "2026-01-02" });
    assert.equal(ok.status, 201);
    assert.deepEqual((await ok.json()).doc.label, "Jürgen – Ünï");
    for (const bad of ["!!!", Buffer.from("not json").toString("base64url"), Buffer.from("[1]").toString("base64url"), Buffer.from("null").toString("base64url"), "A".repeat(2049), Buffer.from(JSON.stringify({ type: "id", label: "x".repeat(3000) })).toString("base64url")]) {
      const r = await post("/api/vault", { "X-Doc-Meta": bad });
      assert.equal(r.status, 400, bad.slice(0, 20));
      assert.ok((await r.json()).error);
    }
    assert.equal((await upload(s, pdf, "application/pdf", { type: "id", label: "a\u0000b" })).status, 400);
    assert.equal((await upload(s, pdf, "application/pdf", { type: "id", label: "a\nb" })).status, 400);
    assert.equal((await post("/api/vault", { "X-Doc-Meta": "A".repeat(2048) })).status, 400);
    assert.equal(Object.keys((await (await fetch(s.base + "/api/vault", { headers: s.auth })).json()).docs).length, 1);
  } finally { await s.close(); }
});
