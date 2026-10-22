# Flat Hunt Phase 2 (Applicant Profile and Document Vault) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner keeps an applicant profile and application documents in an encrypted vault, logs when a landlord asks for documents, and shares chosen documents through an expiring, revocable, rate-limited link that serves each one as a watermarked PDF and logs every view. A browser redaction helper covers sensitive numbers before sharing.

**Architecture:** Phase 1's `createApp` stays the entry point. New library modules hold all logic and are covered by unit tests: `lib/vault.js` (AES-256-GCM, key check, encrypted files), `lib/applicant.js`, `lib/documents.js`, `lib/pdf.js` (pdf-lib), `lib/shares.js`, `lib/ratelimit.js`. Two Express routers carry the routes: `lib/vault-api.js` (password-protected, mounted after the password check) and `lib/share-public.js` (mounted at `/s` before the password check). The page gets two browser modules, `public/vault-ui.js` (About me section and the listing's Documents section) and `public/redact.js` (redaction helper), plus `public/imagepdf.js` (JPEG pages → PDF, shared with Node tests).

**Tech Stack:** Node ≥ 18, Express 4, pdf-lib 1.17.1, Node `crypto` (AES-256-GCM, SHA-256), plain browser JavaScript, pdf.js 3.11.174 from cdnjs (redaction helper only), `node --test`.

**Spec:** `docs/design.md` (sections "Applicant profile and vault (phase 2)", "Security", "Testing"), plus the phase-2 decisions recorded in the Global Constraints below.

## Global Constraints

Carried over from phase 1:

- No personal data in the repository. Before every push: `grep -rn -i -f "$PATTERNS" --exclude-dir=node_modules --exclude-dir=.superpowers . || echo clean` must print `clean` (`$PATTERNS` is a private file outside the repo). Tests and examples use only "Alex Example", "alex@example.com", "Beispielstraße 1, 40210 Düsseldorf" and "Example GmbH".
- Commits use the repo-local no-reply author already configured; no AI attribution lines.
- Node ≥ 18.
- All user-facing text in English (`en`), German (`de`) and Brazilian Portuguese (`pt`).
- `SITE_PASSWORD` required to start unless `ALLOW_OPEN=1`.
- Writes to `DATA_DIR` are atomic; failed saves answer 500 `{ error: "save failed" }` and roll back in-memory changes.
- Money shown in euros, de-DE/en-GB/pt-BR number formats.

New in phase 2:

- Runtime dependencies: `express` and `pdf-lib` (`^1.17.1`) only. Browser: Leaflet (phase 1) and pdf.js 3.11.174 from cdnjs, loaded lazily by the redaction helper only.
- `VAULT_KEY`: 32 random bytes, base64 (44 characters, from `openssl rand -base64 32`), environment variable only; never written to disk, logged or sent to the page. `createApp` takes `options.vaultKey` (base64 text; `""` = no key) for tests and falls back to `process.env.VAULT_KEY`.
- Every file in `DATA_DIR/vault/` is AES-256-GCM with a random 12-byte IV per write, stored as `iv || tag || ciphertext`: `keycheck.bin` (a constant text), `index.json` (document metadata as an encrypted JSON blob), `applicant.json` (encrypted JSON blob) and one `<random>.bin` per document. Plain document bytes exist only in memory.
- If `DATA_DIR/vault/` holds files and `VAULT_KEY` is missing, malformed or wrong, the server refuses to start (`require.main` block, exit 1, clear message). A malformed `VAULT_KEY` is refused even with an empty vault. Inside `createApp` a key that does not open the vault leaves the vault closed.
- Without an open vault, `/api/applicant*`, `/api/vault*` (except `/api/vault/status`), `/api/shares*` and the listing share routes answer 503 `{ error: "vault not configured" }`.
- Public routes: `/healthz` and `/s/*` only. Everything else needs the password.
- Share tokens: 32 random bytes, base64url (43 characters). Only `sha256(token)` is stored (`DATA_DIR/shares.json`, plain JSON: ids, dates, hashes, the watermark subject, opens). The link is returned once, by the create call.
- `/s/*` answers unknown, expired and revoked links (and documents not in the share) with the same 404: status 404, `Content-Type: text/plain; charset=utf-8`, body `Not found`. Every `/s/*` response carries `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`. In-memory rate limit: 30 requests per minute per `req.ip`, then 429 with `Retry-After: 60`.
- Opens are logged as `{ at, docId }`; no IP address is stored anywhere.
- New `createApp` options (tests): `vaultKey`, `now` (function returning a `Date`; default `() => new Date()`), `shareRateLimit` (default 30), `trustProxy` (default `process.env.TRUST_PROXY === "1"`).

## File structure

| File | Responsibility |
|---|---|
| `lib/store.js` | atomic JSON writes; new `writeFileAtomic` for binary files |
| `lib/vault.js` | key parsing, AES-256-GCM, key check, vault status, open vault (encrypted index, applicant, documents), magic-byte sniffing |
| `lib/applicant.js` | applicant defaults and strict validation |
| `lib/profile.js` | exports its validation combinators as `check` (reused by `lib/applicant.js`) |
| `lib/documents.js` | document types, metadata validation, outdated-payslip rule, owner list view |
| `lib/pdf.js` | image → PDF, watermark, applicant summary PDF, PDF readability check |
| `lib/shares.js` | tokens and hashes, share input validation, watermark subject, share creation, owner view |
| `lib/ratelimit.js` | fixed-window rate limiter |
| `lib/vault-api.js` | router: vault status, applicant, summary PDF, documents, document requests, shares (password-protected) |
| `lib/share-public.js` | router at `/s`: share page and watermarked documents (public) |
| `server.js` | opens the vault, mounts both routers, shares state, JSON body errors, start-up refusal |
| `public/vault-ui.js` | About me section (applicant form, vault list, upload) and the listing's Documents section |
| `public/redact.js` | redaction helper dialog (pdf.js / image → canvas → black boxes → image PDF) |
| `public/imagepdf.js` | JPEG pages → PDF (browser + Node) |
| `public/index.html` | About me entry point, Documents section host, script tags, styles |
| `README.md` | `VAULT_KEY`, `TRUST_PROXY`, what is shared and how |
| `test/*.test.js` | tests (new: `vault`, `applicant`, `documents`, `pdf`, `shares`, `ratelimit`, `imagepdf`, `vault-server`, `shares-server`) |

---

### Task 1: Vault encryption, key check and start-up refusal

**Files:** modify `lib/store.js`, `server.js`, `test/helpers.js`; create `lib/vault.js`, `lib/vault-api.js`, `test/vault.test.js`, `test/vault-server.test.js`.

**Interfaces:**
- Produces (`lib/store.js`): `writeFileAtomic(file, data) → Promise<void>`; `writeJsonAtomic` now delegates to it.
- Produces (`lib/vault.js`): `parseVaultKey(text) → Buffer(32)` (throws `Error(KEY_HELP)` otherwise); `encrypt(key, buf) → Buffer` (`iv(12) || tag(16) || ciphertext`); `decrypt(key, blob) → Buffer` (throws on wrong key or changed data); `encryptJson(key, value)`, `decryptJson(key, blob)`; `vaultStatus(dataDir, key) → "empty" | "ok" | "missing-key" | "wrong-key"` (never writes); `openVault(dataDir, key) → vault` (throws unless status is `empty` or `ok`; writes `keycheck.bin` on first use) where `vault = { index: { docs: {} }, applicant: object | null, saveIndex(), saveApplicant(value), writeDoc(name, buf), readDoc(name) → Promise<Buffer>, removeDoc(name), newId() → 16 hex chars }`; `sniffMime(buf) → "application/pdf" | "image/jpeg" | "image/png" | null`; `KEY_HELP`.
- Produces (`lib/vault-api.js`): `vaultApi(ctx) → express.Router` with `ctx = { state, vault, vaultStatus, persist, persistShares, now }`. Route `GET /api/vault/status` → 200 `{ status: "ready" | "off" | "missing-key" | "wrong-key" }`. Middleware: `/api/applicant*`, `/api/vault*`, `/api/shares*` → 503 `{ error: "vault not configured" }` when `ctx.vault` is null.
- Produces (`server.js`): `createApp` options `vaultKey`, `now`; `app.locals.vault`. `require.main`: exits 1 on malformed key (message contains `openssl rand -base64 32`), on `missing-key` ("…holds data but VAULT_KEY is not set…") and on `wrong-key` ("VAULT_KEY does not open the document vault…"); warns "VAULT_KEY is not set: …" when running without a key.
- Produces (`test/helpers.js`): `start()` passes `vaultKey: ""` by default (tests never pick up a developer's `VAULT_KEY`); exports `TEST_VAULT_KEY`, `OTHER_VAULT_KEY`.

- [ ] **Step 1: Failing unit tests** — create `test/vault.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const V = require("../lib/vault");

const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";      // bytes 0..31, test only
const OTHER = "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA=";    // a different test key
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-vault-"));

test("parseVaultKey accepts 32 bytes of base64 and rejects everything else", () => {
  assert.equal(V.parseVaultKey(KEY).length, 32);
  assert.equal(V.parseVaultKey(crypto.randomBytes(32).toString("base64")).length, 32);
  for (const bad of ["", "abc", crypto.randomBytes(16).toString("base64"), crypto.randomBytes(48).toString("base64"), KEY.replace("A", "*")])
    assert.throws(() => V.parseVaultKey(bad), /openssl rand -base64 32/);
});

test("encrypt/decrypt round trip with a fresh IV each time; a wrong key or a changed byte throws", () => {
  const key = V.parseVaultKey(KEY), plain = Buffer.from("Alex Example, Beispielstraße 1, 40210 Düsseldorf");
  const a = V.encrypt(key, plain), b = V.encrypt(key, plain);
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12));
  assert.equal(a.length, 12 + 16 + plain.length);
  assert.ok(!a.includes(plain));
  assert.deepEqual(V.decrypt(key, a), plain);
  assert.throws(() => V.decrypt(V.parseVaultKey(OTHER), a));
  const changed = Buffer.from(a); changed[changed.length - 1] ^= 1;
  assert.throws(() => V.decrypt(key, changed));
  assert.deepEqual(V.decryptJson(key, V.encryptJson(key, { name: "Alex Example" })), { name: "Alex Example" });
});

test("vaultStatus: empty, ok, missing-key, wrong-key", () => {
  const dir = tmp(), key = V.parseVaultKey(KEY);
  assert.equal(V.vaultStatus(dir, null), "empty");
  assert.equal(V.vaultStatus(dir, key), "empty");
  V.openVault(dir, key);
  assert.ok(fs.existsSync(path.join(dir, "vault", "keycheck.bin")));
  assert.equal(V.vaultStatus(dir, key), "ok");
  assert.equal(V.vaultStatus(dir, null), "missing-key");
  assert.equal(V.vaultStatus(dir, V.parseVaultKey(OTHER)), "wrong-key");
  assert.throws(() => V.openVault(dir, V.parseVaultKey(OTHER)), /wrong-key/);
  fs.rmSync(path.join(dir, "vault", "keycheck.bin"));
  fs.writeFileSync(path.join(dir, "vault", "abc.bin"), "x");
  assert.equal(V.vaultStatus(dir, key), "wrong-key");
});

test("openVault stores the index, the applicant and documents encrypted", async () => {
  const dir = tmp(), key = V.parseVaultKey(KEY);
  const v = V.openVault(dir, key);
  assert.deepEqual(v.index, { docs: {} });
  assert.equal(v.applicant, null);
  const id = v.newId();
  assert.match(id, /^[0-9a-f]{16}$/);
  await v.writeDoc(id, Buffer.from("%PDF-1.4 Example GmbH"));
  v.index.docs[id] = { id, label: "Example GmbH" };
  await v.saveIndex();
  await v.saveApplicant({ name: "Alex Example" });
  for (const f of fs.readdirSync(path.join(dir, "vault"))) assert.ok(!fs.readFileSync(path.join(dir, "vault", f)).includes("Example"), f + " is not encrypted");
  const again = V.openVault(dir, key);
  assert.equal(again.index.docs[id].label, "Example GmbH");
  assert.equal(again.applicant.name, "Alex Example");
  assert.equal((await again.readDoc(id)).toString(), "%PDF-1.4 Example GmbH");
  await again.removeDoc(id);
  assert.ok(!fs.existsSync(path.join(dir, "vault", id + ".bin")));
});

test("sniffMime reads magic bytes", () => {
  assert.equal(V.sniffMime(Buffer.from("%PDF-1.7\n")), "application/pdf");
  assert.equal(V.sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), "image/jpeg");
  assert.equal(V.sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(V.sniffMime(Buffer.from("GIF89a")), null);
  assert.equal(V.sniffMime(Buffer.alloc(0)), null);
});
```

- [ ] **Step 2: Run** — `node --test test/vault.test.js`; expected: fails with `Cannot find module '../lib/vault'`.

- [ ] **Step 3: Implement `lib/store.js`** (whole file):

```js
// lib/store.js — JSON and binary files in DATA_DIR, written atomically.
const fs = require("fs");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeFileAtomic(file, data) {
  const tmp = file + "." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8) + ".tmp";
  return fs.promises.writeFile(tmp, data).then(() => fs.promises.rename(tmp, file));
}

const writeJsonAtomic = (file, value) => writeFileAtomic(file, JSON.stringify(value));

module.exports = { readJson, writeJsonAtomic, writeFileAtomic };
```

- [ ] **Step 4: Implement `lib/vault.js`:**

```js
// lib/vault.js — the encrypted vault: AES-256-GCM per file, key check, encrypted JSON blobs and stored documents.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { writeFileAtomic } = require("./store");

const KEYCHECK = "keycheck.bin", INDEX = "index.json", APPLICANT = "applicant.json";
const CHECK_TEXT = "flat-hunt vault v1";
const KEY_HELP = "VAULT_KEY must be 32 random bytes in base64, e.g. from: openssl rand -base64 32";

// Base64 text → 32-byte key. Throws with a readable message on anything else.
function parseVaultKey(text) {
  const s = String(text || "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(s)) throw new Error(KEY_HELP);
  const key = Buffer.from(s, "base64");
  if (key.length !== 32) throw new Error(KEY_HELP);
  return key;
}

// iv (12) || tag (16) || ciphertext
function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

// Throws when the key is wrong or the data was changed.
function decrypt(key, blob) {
  if (!Buffer.isBuffer(blob) || blob.length < 28) throw new Error("vault blob too short");
  const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

const encryptJson = (key, value) => encrypt(key, Buffer.from(JSON.stringify(value), "utf8"));
const decryptJson = (key, blob) => JSON.parse(decrypt(key, blob).toString("utf8"));

const vaultDir = dataDir => path.join(dataDir, "vault");
const vaultFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => !f.endsWith(".tmp")) : [];

// "empty" (nothing stored yet), "ok" (key opens the vault), "missing-key" or "wrong-key". Never writes.
function vaultStatus(dataDir, key) {
  const dir = vaultDir(dataDir), files = vaultFiles(dir);
  if (!files.length) return "empty";
  if (!key) return "missing-key";
  if (!files.includes(KEYCHECK)) return "wrong-key"; // data without a key check cannot be verified
  try { return decrypt(key, fs.readFileSync(path.join(dir, KEYCHECK))).toString("utf8") === CHECK_TEXT ? "ok" : "wrong-key"; }
  catch (e) { return "wrong-key"; }
}

// Opens (and on first use creates) the vault. Throws unless vaultStatus is "empty" or "ok".
function openVault(dataDir, key) {
  const status = vaultStatus(dataDir, key);
  if (status !== "empty" && status !== "ok") throw new Error("vault: " + status);
  const dir = vaultDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  if (status === "empty") fs.writeFileSync(path.join(dir, KEYCHECK), encrypt(key, Buffer.from(CHECK_TEXT, "utf8")));
  const readBlob = (name, fallback) => { const f = path.join(dir, name); return fs.existsSync(f) ? decryptJson(key, fs.readFileSync(f)) : fallback; };
  const docFile = name => path.join(dir, name + ".bin");
  let writing = Promise.resolve();
  const queue = fn => (writing = writing.catch(() => {}).then(fn));
  const vault = {
    index: readBlob(INDEX, { docs: {} }),
    applicant: readBlob(APPLICANT, null),
    saveIndex: () => queue(() => writeFileAtomic(path.join(dir, INDEX), encryptJson(key, vault.index))),
    saveApplicant: value => queue(() => writeFileAtomic(path.join(dir, APPLICANT), encryptJson(key, value))),
    // Documents live in <name>.bin; the index maps document ids to file names, so a replacement is a new file.
    writeDoc: (name, buf) => writeFileAtomic(docFile(name), encrypt(key, buf)),
    readDoc: async name => decrypt(key, await fs.promises.readFile(docFile(name))),
    removeDoc: name => fs.promises.unlink(docFile(name)).catch(() => {}),
    newId: () => crypto.randomBytes(8).toString("hex")
  };
  return vault;
}

// Magic bytes → MIME type, or null.
function sniffMime(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

module.exports = { parseVaultKey, encrypt, decrypt, encryptJson, decryptJson, vaultStatus, openVault, sniffMime, KEY_HELP };
```

- [ ] **Step 5: Run** — `node --test test/vault.test.js`; expected: all pass.

- [ ] **Step 6: Failing server tests** — append to `test/helpers.js` before `module.exports`, and change the export line to `module.exports = { start, TEST_VAULT_KEY, OTHER_VAULT_KEY };`:

```js
// Test-only vault keys (bytes 0..31 and 31..0), never used outside tests.
const TEST_VAULT_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const OTHER_VAULT_KEY = "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA=";
```

In `start()`, change the `createApp` call to `createApp({ dataDir: dir, password: "pw", syncKey: "key", vaultKey: "", ...options })`.

Create `test/vault-server.test.js` with this header (later tasks extend the `require` lines and add helpers below it):

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { start, TEST_VAULT_KEY, OTHER_VAULT_KEY } = require("./helpers");

const json = (h = {}) => ({ ...h, "Content-Type": "application/json" });
const withVault = (o = {}) => start({ vaultKey: TEST_VAULT_KEY, ...o });
const runServer = env => spawnSync(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { PATH: process.env.PATH, PORT: "0", SITE_PASSWORD: "pw", ...env }, timeout: 1500, encoding: "utf8" });
```

and these tests:

```js
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
```

- [ ] **Step 7: Run** — `node --test test/vault-server.test.js`; expected: fails (`/api/vault/status` answers 404 from the static handler; the start-up tests see the server running instead of exit 1).

- [ ] **Step 8: Implement `lib/vault-api.js`:**

```js
// lib/vault-api.js — password-protected routes for the applicant profile, the document vault, document requests and shares.
const express = require("express");

// ctx: { state, vault (null when VAULT_KEY is not set or does not open the vault), vaultStatus, persist, persistShares, now }
function vaultApi(ctx) {
  const { state, vault } = ctx;
  const router = express.Router();
  const nowIso = () => ctx.now().toISOString();

  router.get("/api/vault/status", (req, res) => res.json({ status: ctx.vaultStatus }));

  const requireVault = (req, res, next) => vault ? next() : res.status(503).json({ error: "vault not configured" });
  router.use(["/api/applicant", "/api/vault", "/api/shares"], requireVault);

  return router;
}

module.exports = { vaultApi };
```

Later tasks insert their route blocks immediately before `return router;` and extend the `require` lines at the top.

- [ ] **Step 9: Wire into `server.js`:**
  - Requires, after the `./public/money` line:
    ```js
    const { parseVaultKey, vaultStatus, openVault } = require("./lib/vault");
    const { vaultApi } = require("./lib/vault-api");
    ```
  - In `createApp`, directly after `fs.mkdirSync(path.join(dataDir, "img"), { recursive: true });`:
    ```js
    const now = options.now || (() => new Date());
    // The vault opens only with the right key; otherwise its routes answer 503 (the start-up check refuses to run in that case).
    const vaultText = options.vaultKey ?? process.env.VAULT_KEY ?? "";
    const vaultKey = vaultText ? parseVaultKey(vaultText) : null;
    const vStatus = vaultStatus(dataDir, vaultKey);
    const vault = vaultKey && (vStatus === "ok" || vStatus === "empty") ? openVault(dataDir, vaultKey) : null;
    ```
  - After `app.locals.fetchImpl = …;` add `app.locals.vault = vault;`.
  - After `app.locals.requireKey = requireKey;` (so after the password check):
    ```js
    app.use(vaultApi({ state, vault, vaultStatus: vault ? "ready" : vStatus === "empty" ? "off" : vStatus, persist, persistShares: null, now }));
    ```
    (`persistShares` is filled in by Task 5.)
  - In the `require.main` block, after the `SITE_PASSWORD` check and before `const port = …`:
    ```js
    let vaultKey = null;
    try { vaultKey = process.env.VAULT_KEY ? parseVaultKey(process.env.VAULT_KEY) : null; }
    catch (e) { console.error(e.message); process.exit(1); }
    const vs = vaultStatus(process.env.DATA_DIR || path.join(__dirname, "data"), vaultKey);
    if (vs === "missing-key") { console.error("The document vault (DATA_DIR/vault) holds data but VAULT_KEY is not set. Set the VAULT_KEY it was created with; without it the documents cannot be read."); process.exit(1); }
    if (vs === "wrong-key") { console.error("VAULT_KEY does not open the document vault (DATA_DIR/vault). Set the VAULT_KEY it was created with."); process.exit(1); }
    if (!vaultKey) console.warn("VAULT_KEY is not set: the applicant profile, documents and share links are off.");
    ```

- [ ] **Step 10: Run** — `npm test`; expected: all tests pass (phase 1 tests unchanged).

- [ ] **Step 11: Commit and push** — personal-data grep (Global Constraints) prints `clean`; `git add lib/store.js lib/vault.js lib/vault-api.js server.js test/helpers.js test/vault.test.js test/vault-server.test.js && git commit -m "Vault: AES-256-GCM files, key check and start-up refusal" && git push`.

---

### Task 2: Applicant profile

**Files:** modify `lib/profile.js` (export line only), `lib/vault-api.js`, `test/vault-server.test.js`; create `lib/applicant.js`, `test/applicant.test.js`.

**Interfaces:**
- Consumes: `vault.applicant`, `vault.saveApplicant` (Task 1).
- Produces (`lib/profile.js`): `check: { isObj, str, bool, int, nullable, obj }` added to `module.exports` (the existing combinators, unchanged).
- Produces (`lib/applicant.js`): `defaultApplicant()` → `{ name: "", email: "", phone: "", household: { adults: 1, children: 0, pets: "" }, job: { title: "", employer: "", since: null, permanent: false }, schufaAvailable: false, landlordReferenceAvailable: false, about: "" }`; `validateApplicant(input) → { errors, value }`. Rules: unknown keys rejected at every level; `name` 1–120 (trimmed in `value`); `email` `""` or an address ≤ 200; `phone` `""` or `+?[0-9 ()/-]{5,30}`; `household.adults` 1–10, `children` 0–10 (whole numbers), `pets` text 0–100 (`""` = none); `job.title`, `job.employer` 0–120; `job.since` `null` or `YYYY-MM`, not in the future; `job.permanent`, `schufaAvailable`, `landlordReferenceAvailable` booleans; `about` 0–1000.
- Produces (routes): `GET /api/applicant` → 200 `{ applicant }` or 404 `{ error: "no applicant" }`; `PUT /api/applicant` (whole applicant) → 200 `{ ok: true, applicant }`, 400 `{ error: "invalid applicant", details: [...] }`, 500 `{ error: "save failed" }` (previous applicant kept). Stored only in `DATA_DIR/vault/applicant.json`, encrypted.

- [ ] **Step 1: Failing unit tests** — create `test/applicant.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultApplicant, validateApplicant } = require("../lib/applicant");

const valid = () => ({ ...defaultApplicant(), name: "Alex Example", email: "alex@example.com", phone: "+49 211 000000", job: { title: "Engineer", employer: "Example GmbH", since: "2022-04", permanent: true }, about: "Quiet household, no smokers." });
const bad = (mutate, expected) => {
  const a = valid(); mutate(a);
  const { errors, value } = validateApplicant(a);
  assert.equal(value, null);
  assert.ok(errors.some(e => e.includes(expected)), `expected "${expected}" in ${JSON.stringify(errors)}`);
};

test("a filled applicant is valid; the default needs a name", () => {
  assert.deepEqual(validateApplicant(valid()).errors, []);
  assert.equal(validateApplicant(valid()).value.name, "Alex Example");
  assert.ok(validateApplicant(defaultApplicant()).errors.some(e => e.startsWith("name:")));
  assert.notEqual(defaultApplicant(), defaultApplicant());
});

test("shape: non-object, missing and unknown fields", () => {
  assert.deepEqual(validateApplicant(null).errors, ["applicant must be an object"]);
  assert.deepEqual(validateApplicant([]).errors, ["applicant must be an object"]);
  bad(a => { delete a.household; }, "household: missing");
  bad(a => { a.iban = "x"; }, "iban: unknown field");
  bad(a => { a.job.constructor = 1; }, "job.constructor: unknown field");
  bad(a => { a.household.cats = 1; }, "household.cats: unknown field");
});

test("field rules", () => {
  bad(a => { a.name = "x".repeat(121); }, "name");
  bad(a => { a.email = "not-an-email"; }, "email");
  bad(a => { a.phone = "call me"; }, "phone");
  bad(a => { a.household.adults = 0; }, "household.adults");
  bad(a => { a.household.children = 1.5; }, "household.children");
  bad(a => { a.household.pets = "x".repeat(101); }, "household.pets");
  bad(a => { a.job.since = "2022-13"; }, "job.since");
  bad(a => { a.job.since = "2999-01"; }, "job.since: must not be in the future");
  bad(a => { a.job.permanent = "yes"; }, "job.permanent");
  bad(a => { a.schufaAvailable = 1; }, "schufaAvailable");
  bad(a => { a.landlordReferenceAvailable = null; }, "landlordReferenceAvailable");
  bad(a => { a.about = "x".repeat(1001); }, "about");
  const ok = valid(); ok.email = ""; ok.phone = ""; ok.job.since = null; ok.about = "x".repeat(1000);
  assert.deepEqual(validateApplicant(ok).errors, []);
});
```

- [ ] **Step 2: Run** — `node --test test/applicant.test.js`; expected: `Cannot find module '../lib/applicant'`.

- [ ] **Step 3: Implement** — in `lib/profile.js` change the export line to:

```js
module.exports = { defaultProfile, validateProfile, LANGS, PLACE_MODES, OUTDOOR, KITCHEN, WBS, STATES, WEIGHT_KEYS, check: { isObj, str, bool, int, nullable, obj } };
```

Create `lib/applicant.js`:

```js
// lib/applicant.js — the applicant profile (who is applying): defaults and strict validation.
const { check: { isObj, str, bool, int, nullable, obj } } = require("./profile");

function defaultApplicant() {
  return {
    name: "", email: "", phone: "",
    household: { adults: 1, children: 0, pets: "" },
    job: { title: "", employer: "", since: null, permanent: false },
    schufaAvailable: false, landlordReferenceAvailable: false,
    about: ""
  };
}

const email = (v, p, e) => { if (typeof v !== "string" || (v !== "" && (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))) e.push(`${p}: email address expected`); };
const phone = (v, p, e) => { if (typeof v !== "string" || (v !== "" && !/^\+?[0-9 ()\/-]{5,30}$/.test(v))) e.push(`${p}: phone number expected`); };
const month = (v, p, e) => { if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) e.push(`${p}: month YYYY-MM expected`); };

const SCHEMA = obj({
  name: str(1, 120), email, phone,
  household: obj({ adults: int(1, 10), children: int(0, 10), pets: str(0, 100) }),
  job: obj({ title: str(0, 120), employer: str(0, 120), since: nullable(month), permanent: bool }),
  schufaAvailable: bool, landlordReferenceAvailable: bool,
  about: str(0, 1000)
});

function validateApplicant(input) {
  if (!isObj(input)) return { errors: ["applicant must be an object"], value: null };
  const errors = [];
  SCHEMA(input, "", errors);
  if (!errors.length && input.job.since && input.job.since > new Date().toISOString().slice(0, 7)) errors.push("job.since: must not be in the future");
  return { errors, value: errors.length ? null : { ...input, name: input.name.trim() } };
}

module.exports = { defaultApplicant, validateApplicant };
```

- [ ] **Step 4: Run** — `node --test test/applicant.test.js test/profile.test.js`; expected: all pass.

- [ ] **Step 5: Failing server tests** — in `test/vault-server.test.js` add below the requires:

```js
const { defaultApplicant } = require("../lib/applicant");
const applicant = () => ({ ...defaultApplicant(), name: "Alex Example", email: "alex@example.com", job: { title: "Engineer", employer: "Example GmbH", since: "2022-04", permanent: true } });
```

and append:

```js
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
```

- [ ] **Step 6: Run** — `node --test test/vault-server.test.js`; expected: the two applicant tests fail (PUT answers 404).

- [ ] **Step 7: Implement the routes** — in `lib/vault-api.js` add `const { validateApplicant } = require("./applicant");` to the requires and insert before `return router;`:

```js
  // ---------- applicant ----------
  router.get("/api/applicant", (req, res) => vault.applicant ? res.json({ applicant: vault.applicant }) : res.status(404).json({ error: "no applicant" }));

  router.put("/api/applicant", async (req, res) => {
    const { errors, value } = validateApplicant(req.body);
    if (errors.length) return res.status(400).json({ error: "invalid applicant", details: errors });
    const prev = vault.applicant;
    vault.applicant = value;
    try { await vault.saveApplicant(value); }
    catch (e) { if (vault.applicant === value) vault.applicant = prev; return res.status(500).json({ error: "save failed" }); }
    res.json({ ok: true, applicant: value });
  });
```

- [ ] **Step 8: Run** — `npm test`; expected: all pass.

- [ ] **Step 9: Commit and push** — grep prints `clean`; `git add lib/profile.js lib/applicant.js lib/vault-api.js test/applicant.test.js test/vault-server.test.js && git commit -m "Applicant profile: strict validation, stored encrypted" && git push`.

---

### Task 3: PDF module and applicant summary

**Files:** modify `package.json` / `package-lock.json` (pdf-lib), `test/helpers.js`, `lib/vault-api.js`, `test/vault-server.test.js`; create `lib/pdf.js`, `test/pdf.test.js`.

**Interfaces:**
- Consumes: `vault.applicant` (Task 2), `state.profile.money.netIncome`, `state.profile.outreach.language`.
- Produces (`lib/pdf.js`): `LANGS` (`en, de, pt`); `fmtDate(iso) → "DD.MM.YYYY"`; `winAnsi(text)` (characters the standard fonts cannot draw become `?`); `watermarkText(lang, subject, isoDate)` → en "Only for the application for <subject> · <DD.MM.YYYY>", de "Nur für die Bewerbung um <subject> · <DD.MM.YYYY>", pt "Somente para a candidatura ao imóvel <subject> · <DD.MM.YYYY>" (unknown language → en); `canReadPdf(buf) → Promise<boolean>` (pdf-lib opens it and it has ≥ 1 page); `toPdf(buf, mime) → Promise<Uint8Array | Buffer>` (PDF passes through; JPEG/PNG → one A4 page, landscape for wide images, image fitted inside 36 pt margins); `watermarkPdf(bytes, text) → Promise<Uint8Array>` (every page: diagonal Helvetica-Bold text, red, opacity 0.28, sized to ~85 % of the diagonal within 8–40 pt, plus an 8 pt line at the bottom left); `summaryPdf(applicant, netIncome, lang, now) → Promise<Uint8Array>` (one A4 page: title, name, contact, household, job with "since MM/YYYY" and permanent/fixed-term, net income per month when > 0, SCHUFA and landlord reference yes/no, "about" wrapped, "Created on DD.MM.YYYY" footer).
- Produces (route): `GET /api/applicant/summary.pdf?lang=en|de|pt` (default `profile.outreach.language`, else `en`) → 200 `application/pdf`, `Content-Disposition: inline; filename="applicant-summary-<lang>.pdf"`; 400 `{ error: "lang: one of en, de, pt expected" }`; 404 `{ error: "no applicant" }`; 503 without vault.
- Produces (`test/helpers.js`): `TINY_PNG` (4×2), `TINY_JPEG` (1×1 baseline, hand-built), `pdfPageStreams(bytes) → Promise<string[]>` (decoded content stream per page, latin1), `hasPdfText(stream, text)` (pdf-lib writes standard-font text as a hex string of WinAnsi bytes; works for Latin-1 text).

- [ ] **Step 1: Add the dependency** — `npm install pdf-lib@^1.17.1` (adds it to `dependencies`; nothing else).

- [ ] **Step 2: Test helpers** — append to `test/helpers.js` before `module.exports`, and export the new names (`module.exports = { start, TEST_VAULT_KEY, OTHER_VAULT_KEY, TINY_PNG, TINY_JPEG, pdfPageStreams, hasPdfText };`):

```js
// A 4×2 grey PNG and a 1×1 grey baseline JPEG, small enough to inline.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAADklEQVR4nGNoQAIMyBwAnBoMATyCc0QAAAAASUVORK5CYII=", "base64");
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(1),
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, ...Array(15).fill(0), 0x00,
  0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, ...Array(15).fill(0), 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x3f, 0xff, 0xd9
]);

// The decoded content streams of every page, as latin1 text (one string per page).
async function pdfPageStreams(bytes) {
  const { PDFDocument, PDFArray } = require("pdf-lib");
  const zlib = require("node:zlib");
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map(p => {
    const c = p.node.Contents();
    const streams = c instanceof PDFArray ? c.asArray().map(r => doc.context.lookup(r)) : [c];
    return streams.map(s => { const raw = Buffer.from(s.getContents()); try { return zlib.inflateSync(raw).toString("latin1"); } catch (e) { return raw.toString("latin1"); } }).join("\n");
  });
}
// How pdf-lib writes text drawn with a standard font: a hex string of WinAnsi bytes.
const pdfHex = text => Buffer.from(text, "latin1").toString("hex");
const hasPdfText = (stream, text) => stream.toLowerCase().includes(pdfHex(text));
```

- [ ] **Step 3: Failing unit tests** — create `test/pdf.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const P = require("../lib/pdf");
const { defaultApplicant } = require("../lib/applicant");
const { TINY_PNG, TINY_JPEG, pdfPageStreams, hasPdfText } = require("./helpers");

const twoPagePdf = async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); d.addPage([841.89, 595.28]); return Buffer.from(await d.save()); };
const applicant = () => ({ ...defaultApplicant(), name: "Alex Example", email: "alex@example.com", household: { adults: 2, children: 1, pets: "" }, job: { title: "Engineer", employer: "Example GmbH", since: "2022-04", permanent: true }, schufaAvailable: true, about: "We are a quiet family. ".repeat(30) });

test("watermark text in each language with DD.MM.YYYY", () => {
  assert.equal(P.watermarkText("en", "Beispielstraße 1, 40210 Düsseldorf", "2026-10-20T09:00:00.000Z"), "Only for the application for Beispielstraße 1, 40210 Düsseldorf · 20.10.2026");
  assert.equal(P.watermarkText("de", "Beispielstraße 1", "2026-10-20"), "Nur für die Bewerbung um Beispielstraße 1 · 20.10.2026");
  assert.equal(P.watermarkText("pt", "Beispielstraße 1", "2026-10-20"), "Somente para a candidatura ao imóvel Beispielstraße 1 · 20.10.2026");
  assert.equal(P.watermarkText("fr", "X", "2026-10-20"), "Only for the application for X · 20.10.2026");
});

test("winAnsi keeps German and Portuguese letters and replaces the rest", () => {
  assert.equal(P.winAnsi("Düsseldorf ç ã € –"), "Düsseldorf ç ã € –");
  assert.equal(P.winAnsi("Łódź 🏠"), "?ód? ??");
});

test("canReadPdf", async () => {
  assert.equal(await P.canReadPdf(await twoPagePdf()), true);
  assert.equal(await P.canReadPdf(Buffer.from("%PDF-1.7 broken")), false);
});

test("toPdf passes PDFs through and puts an image on one page", async () => {
  const pdf = await twoPagePdf();
  assert.equal(await P.toPdf(pdf, "application/pdf"), pdf);
  for (const [buf, mime] of [[TINY_PNG, "image/png"], [TINY_JPEG, "image/jpeg"]]) {
    const doc = await PDFDocument.load(await P.toPdf(buf, mime));
    assert.equal(doc.getPageCount(), 1, mime);
  }
  const landscape = await PDFDocument.load(await P.toPdf(TINY_PNG, "image/png")); // 4×2 px → landscape page
  assert.ok(landscape.getPage(0).getWidth() > landscape.getPage(0).getHeight());
});

test("watermarkPdf writes the text on every page", async () => {
  const text = P.watermarkText("de", "Beispielstraße 1, 40210 Düsseldorf", "2026-10-20");
  const out = await P.watermarkPdf(await twoPagePdf(), text);
  const pages = await pdfPageStreams(out);
  assert.equal(pages.length, 2);
  for (const s of pages) assert.ok(hasPdfText(s, text), "watermark missing on a page");
});

test("summaryPdf: one page in each language with name, job and income", async () => {
  for (const lang of ["en", "de", "pt"]) {
    const bytes = await P.summaryPdf(applicant(), 3200, lang, new Date("2026-10-20T10:00:00Z"));
    const [page, ...rest] = await pdfPageStreams(bytes);
    assert.equal(rest.length, 0);
    assert.ok(hasPdfText(page, "Alex Example"), lang);
    assert.ok(hasPdfText(page, "Engineer, Example GmbH, " + { en: "since", de: "seit", pt: "desde" }[lang] + " 04/2022"), lang);
  }
  const de = (await pdfPageStreams(await P.summaryPdf(applicant(), 3200, "de", new Date("2026-10-20T10:00:00Z"))))[0];
  assert.ok(hasPdfText(de, "SCHUFA-Auskunft vorhanden: ja"));
  assert.ok(hasPdfText(de, "Erstellt am 20.10.2026"));
  const en = (await pdfPageStreams(await P.summaryPdf(applicant(), 3200, "en")))[0];
  assert.ok(hasPdfText(en, "3,200 per month"));
  const noIncome = (await pdfPageStreams(await P.summaryPdf(applicant(), 0, "en")))[0];
  assert.ok(!hasPdfText(noIncome, "Household net income"));
});
```

- [ ] **Step 4: Run** — `node --test test/pdf.test.js`; expected: `Cannot find module '../lib/pdf'`.

- [ ] **Step 5: Implement `lib/pdf.js`.** Note: pdf-lib reads embedded images through a `DataView` that ignores a Node `Buffer`'s `byteOffset`, so every buffer is copied into a fresh `Uint8Array` before `embedJpg`/`embedPng`/`load`.

```js
// lib/pdf.js — PDFs for sharing: images to PDF, the diagonal watermark and the applicant summary (pdf-lib, standard fonts).
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

const A4 = [595.28, 841.89];
const LANGS = ["en", "de", "pt"];

// Standard fonts only cover WinAnsi; anything else becomes "?" instead of failing the whole PDF.
const winAnsi = s => String(s ?? "").replace(/[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, "?");
const fmtDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}.${m}.${y}`; };

const WATERMARK = {
  en: (s, d) => `Only for the application for ${s} · ${d}`,
  de: (s, d) => `Nur für die Bewerbung um ${s} · ${d}`,
  pt: (s, d) => `Somente para a candidatura ao imóvel ${s} · ${d}`
};
const watermarkText = (lang, subject, isoDate) => (WATERMARK[lang] || WATERMARK.en)(subject, fmtDate(isoDate));

// True when pdf-lib can open the file (not encrypted, not broken).
async function canReadPdf(buf) {
  try { return (await PDFDocument.load(new Uint8Array(buf))).getPageCount() > 0; } catch (e) { return false; }
}

// PDFs pass through; a JPEG or PNG becomes one A4 page with the image scaled to fit inside 36 pt margins.
async function toPdf(buf, mime) {
  if (mime === "application/pdf") return buf;
  const doc = await PDFDocument.create();
  // A copy, because pdf-lib reads the image through a DataView that ignores a Node Buffer's byteOffset.
  const bytes = new Uint8Array(buf);
  const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const landscape = img.width > img.height;
  const [w, h] = landscape ? [A4[1], A4[0]] : A4;
  const scale = Math.min((w - 72) / img.width, (h - 72) / img.height);
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  return doc.save();
}

// The text across every page, diagonal and semi-transparent, plus a small line at the bottom edge.
async function watermarkPdf(bytes, text) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = winAnsi(text);
  for (const page of doc.getPages()) {
    const { width: w, height: h } = page.getSize();
    const diag = Math.hypot(w, h), angle = Math.atan2(h, w);
    const size = Math.max(8, Math.min(40, (diag * 0.85) / font.widthOfTextAtSize(t, 1)));
    const tw = font.widthOfTextAtSize(t, size);
    // Start so that the text's centre sits on the page centre.
    const x = w / 2 - (tw / 2) * Math.cos(angle) + (size / 3) * Math.sin(angle);
    const y = h / 2 - (tw / 2) * Math.sin(angle) - (size / 3) * Math.cos(angle);
    page.drawText(t, { x, y, size, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.28, rotate: degrees(angle * 180 / Math.PI) });
    page.drawText(t, { x: 18, y: 12, size: 8, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.6 });
  }
  return doc.save();
}

const SUMMARY = {
  en: { title: "Applicant summary", contact: "Contact", household: "Household", adults: "Adults", children: "Children", pets: "Pets", none: "none", job: "Job", since: "since", permanent: "permanent contract", fixedTerm: "fixed-term contract", income: "Household net income", perMonth: "per month", schufa: "SCHUFA credit report available", reference: "Reference from the current landlord available", yes: "yes", no: "no", about: "About us", made: "Created on" },
  de: { title: "Selbstauskunft (Kurzfassung)", contact: "Kontakt", household: "Haushalt", adults: "Erwachsene", children: "Kinder", pets: "Haustiere", none: "keine", job: "Beruf", since: "seit", permanent: "unbefristet", fixedTerm: "befristet", income: "Haushaltsnettoeinkommen", perMonth: "pro Monat", schufa: "SCHUFA-Auskunft vorhanden", reference: "Vermieterbescheinigung vorhanden", yes: "ja", no: "nein", about: "Über uns", made: "Erstellt am" },
  pt: { title: "Resumo do candidato", contact: "Contato", household: "Moradores", adults: "Adultos", children: "Crianças", pets: "Animais", none: "nenhum", job: "Trabalho", since: "desde", permanent: "contrato por prazo indeterminado", fixedTerm: "contrato temporário", income: "Renda líquida do domicílio", perMonth: "por mês", schufa: "Relatório SCHUFA disponível", reference: "Referência do locador atual disponível", yes: "sim", no: "não", about: "Sobre nós", made: "Criado em" }
};
const LOCALE = { en: "en-GB", de: "de-DE", pt: "pt-BR" };

// One A4 page: name, contact, household, job, income, SCHUFA/reference and the "about" text, wrapped.
async function summaryPdf(applicant, netIncome, lang = "en", now = new Date()) {
  const L = SUMMARY[lang] || SUMMARY.en, a = applicant;
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(`${L.title} · ${a.name}`));
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 56, right = A4[0] - 56;
  let y = A4[1] - 72;
  const line = (text, { f = font, size = 11, gap = 6 } = {}) => { page.drawText(winAnsi(text), { x: left, y, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + gap; };
  const wrap = (text, size = 11) => {
    for (const para of winAnsi(text).split(/\n+/)) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(next, size) > right - left && cur) { line(cur, { size, gap: 4 }); cur = word; } else cur = next;
      }
      if (cur) line(cur, { size, gap: 4 });
    }
  };
  const field = (label, value) => line(`${label}: ${value}`);
  line(L.title, { f: bold, size: 20, gap: 14 });
  line(a.name, { f: bold, size: 15, gap: 12 });
  const contact = [a.email, a.phone].filter(Boolean).join(" · ");
  if (contact) field(L.contact, contact);
  y -= 6; line(L.household, { f: bold, size: 12 });
  field(L.adults, a.household.adults); field(L.children, a.household.children); field(L.pets, a.household.pets || L.none);
  if (a.job.title || a.job.employer) {
    y -= 6; line(L.job, { f: bold, size: 12 });
    line([a.job.title, a.job.employer].filter(Boolean).join(", ") + (a.job.since ? `, ${L.since} ${a.job.since.slice(5)}/${a.job.since.slice(0, 4)}` : ""));
    line(a.job.permanent ? L.permanent : L.fixedTerm);
  }
  if (netIncome > 0) { y -= 6; field(L.income, new Intl.NumberFormat(LOCALE[lang] || "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(netIncome) + " " + L.perMonth); }
  y -= 6; field(L.schufa, a.schufaAvailable ? L.yes : L.no); field(L.reference, a.landlordReferenceAvailable ? L.yes : L.no);
  if (a.about) { y -= 6; line(L.about, { f: bold, size: 12 }); wrap(a.about); }
  page.drawText(winAnsi(`${L.made} ${fmtDate(now.toISOString())}`), { x: left, y: 40, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
  return doc.save();
}

module.exports = { LANGS, watermarkText, canReadPdf, toPdf, watermarkPdf, summaryPdf, winAnsi, fmtDate };
```

- [ ] **Step 6: Run** — `node --test test/pdf.test.js`; expected: all pass.

- [ ] **Step 7: Failing server test** — in `test/vault-server.test.js` extend the helpers require to `const { start, TEST_VAULT_KEY, OTHER_VAULT_KEY, pdfPageStreams, hasPdfText } = require("./helpers");` and append:

```js
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
```

- [ ] **Step 8: Run** — `node --test test/vault-server.test.js`; expected: the summary test fails (404 for `?lang=fr`, the route does not exist yet).

- [ ] **Step 9: Implement the route** — in `lib/vault-api.js` add `const { summaryPdf, LANGS } = require("./pdf");` and insert before `return router;`:

```js
  // ---------- applicant summary ----------
  const summaryLang = q => q === undefined ? (state.profile && state.profile.outreach.language) || "en" : LANGS.includes(q) ? q : null;

  router.get("/api/applicant/summary.pdf", async (req, res) => {
    const lang = summaryLang(req.query.lang);
    if (!lang) return res.status(400).json({ error: "lang: one of en, de, pt expected" });
    if (!vault.applicant) return res.status(404).json({ error: "no applicant" });
    const bytes = await summaryPdf(vault.applicant, (state.profile && state.profile.money.netIncome) || 0, lang, ctx.now());
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="applicant-summary-${lang}.pdf"`);
    res.send(Buffer.from(bytes));
  });
```

- [ ] **Step 10: Run** — `npm test`; expected: all pass.

- [ ] **Step 11: Commit and push** — grep prints `clean`; `git add package.json package-lock.json lib/pdf.js lib/vault-api.js test/helpers.js test/pdf.test.js test/vault-server.test.js && git commit -m "PDF module: watermark, image to PDF, applicant summary" && git push`.

---

### Task 4: Vault documents

**Files:** modify `lib/vault-api.js`, `server.js`, `test/vault-server.test.js`; create `lib/documents.js`, `test/documents.test.js`.

**Interfaces:**
- Consumes: `vault.index`, `vault.saveIndex`, `vault.writeDoc/readDoc/removeDoc/newId`, `sniffMime` (Task 1); `canReadPdf` (Task 3).
- Produces (`lib/documents.js`): `DOC_TYPES` (`payslip, contract, schufa, id, rent-confirmation, landlord-reference, other`); `MIMES` (`application/pdf, image/jpeg, image/png`); `MAX_BYTES` (10 MiB); `validateDocMeta(input, { partial }) → { errors, value }` (upload: `type` required, `label` 0–120 default `""`, `date` `YYYY-MM-DD` or empty → `null`; edit: any subset, `null` clears the date, empty edit → `"nothing to change"`; unknown keys rejected); `isOutdated(doc, todayIso)` (payslip dated before today minus three calendar months); `docView(doc, todayIso)` (without `file`, plus `outdated`); `listDocs(index, todayIso)` (newest upload first).
- Index entry (inside encrypted `index.json`): `{ id, file, type, label, date, mime, size, uploadedAt, redactedAt }`. `file` is the encrypted file's name (`<file>.bin`); a replacement gets a new file, so a failed save never loses the old version.
- Produces (routes; all 503 without vault, 401 without password):
  - `GET /api/vault` → 200 `{ docs: [docView…] }`.
  - `POST /api/vault?type=&label=&date=` raw body, `Content-Type` one of `MIMES`, ≤ 10 MiB → 201 `{ ok: true, doc }`; 415 `{ error: "pdf, jpeg or png expected" }` (other content types); 400 `{ error: "file expected" }` (empty); 400 `{ error: "file content does not match its type" }` (magic bytes ≠ `Content-Type`); 400 `{ error: "pdf cannot be read (encrypted or damaged)" }`; 400 `{ error: "invalid metadata", details }`; 413 `{ error: "file too large" }`; 500 `{ error: "save failed" }` (no file or entry left behind).
  - `GET /api/vault/:id` → 200 decrypted bytes, `Content-Type` = stored mime, `Content-Disposition: attachment; filename="<type>[-<date>].<pdf|jpg|png>"`, `Cache-Control: no-store`; 404 `{ error: "unknown document" }`.
  - `PUT /api/vault/:id` JSON `{ type?, label?, date? }` → 200 `{ ok: true, doc }`; 400 `{ error: "invalid metadata", details }`; 404.
  - `DELETE /api/vault/:id` → 200 `{ ok: true }` (entry removed, then file); 404.
  - `POST /api/vault/:id/replace` raw body (same checks as upload) → 200 `{ ok: true, doc }` with the new `mime`, `size` and `redactedAt` = now; `type`, `label`, `date`, `uploadedAt` kept; old file removed; 404.
- Produces (`server.js`): a final error middleware: body-parser `entity.too.large` → 413 `{ error: "file too large" }`, `entity.parse.failed` → 400 `{ error: "invalid json" }`.

- [ ] **Step 1: Failing unit tests** — create `test/documents.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../lib/documents");

test("constants", () => {
  assert.deepEqual(D.DOC_TYPES, ["payslip", "contract", "schufa", "id", "rent-confirmation", "landlord-reference", "other"]);
  assert.deepEqual(D.MIMES, ["application/pdf", "image/jpeg", "image/png"]);
  assert.equal(D.MAX_BYTES, 10485760);
});

test("upload metadata: type required, label and date optional", () => {
  assert.deepEqual(D.validateDocMeta({ type: "payslip", label: " September ", date: "2026-09-30" }), { errors: [], value: { type: "payslip", label: "September", date: "2026-09-30" } });
  assert.deepEqual(D.validateDocMeta({ type: "id" }).value, { type: "id", label: "", date: null });
  assert.deepEqual(D.validateDocMeta({ type: "id", date: "" }).value, { type: "id", label: "", date: null });
  assert.deepEqual(D.validateDocMeta({}).errors, ["type: missing"]);
  assert.match(D.validateDocMeta({ type: "passport" }).errors[0], /^type: one of/);
  assert.match(D.validateDocMeta({ type: "id", date: "2026-02-30" }).errors[0], /^date:/);
  assert.match(D.validateDocMeta({ type: "id", label: "x".repeat(121) }).errors[0], /^label:/);
  assert.deepEqual(D.validateDocMeta({ type: "id", size: 1 }).errors, ["size: unknown field"]);
  assert.deepEqual(D.validateDocMeta(null).errors, ["metadata must be an object"]);
});

test("edit metadata: any subset, null clears the date, empty edits are refused", () => {
  assert.deepEqual(D.validateDocMeta({ label: "Contract" }, { partial: true }).value, { label: "Contract" });
  assert.deepEqual(D.validateDocMeta({ date: null }, { partial: true }).value, { date: null });
  assert.deepEqual(D.validateDocMeta({}, { partial: true }).errors, ["nothing to change"]);
  assert.deepEqual(D.validateDocMeta({ redactedAt: "x" }, { partial: true }).errors, ["redactedAt: unknown field"]);
});

test("payslips older than three months are outdated; other types and undated payslips never", () => {
  const now = "2026-10-20";
  assert.equal(D.isOutdated({ type: "payslip", date: "2026-07-20" }, now), false);
  assert.equal(D.isOutdated({ type: "payslip", date: "2026-07-19" }, now), true);
  assert.equal(D.isOutdated({ type: "payslip", date: null }, now), false);
  assert.equal(D.isOutdated({ type: "contract", date: "2020-01-01" }, now), false);
});

test("listDocs sorts newest first, adds the outdated flag and hides the file name", () => {
  const index = { docs: {
    a: { id: "a", file: "f1", type: "payslip", date: "2026-01-31", uploadedAt: "2026-02-01T10:00:00.000Z" },
    b: { id: "b", type: "contract", date: null, uploadedAt: "2026-10-01T10:00:00.000Z" }
  } };
  assert.deepEqual(D.listDocs(index, "2026-10-20").map(d => [d.id, d.outdated]), [["b", false], ["a", true]]);
  assert.equal(D.listDocs(index, "2026-10-20")[1].file, undefined);
});
```

- [ ] **Step 2: Run** — `node --test test/documents.test.js`; expected: `Cannot find module '../lib/documents'`.

- [ ] **Step 3: Implement `lib/documents.js`:**

```js
// lib/documents.js — vault document metadata: types, validation and the list the owner sees.
const DOC_TYPES = ["payslip", "contract", "schufa", "id", "rent-confirmation", "landlord-reference", "other"];
const MIMES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;
const PAYSLIP_MAX_MONTHS = 3;

const isDate = s => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const FIELDS = {
  type: v => DOC_TYPES.includes(v) ? null : `one of ${DOC_TYPES.join(", ")} expected`,
  label: v => typeof v === "string" && v.length <= 120 ? null : "text up to 120 characters expected",
  date: v => v === null || isDate(v) ? null : "date YYYY-MM-DD expected"
};

// Upload (query strings, partial: false): type required, label defaults to "", date to null; "" counts as not given.
// Edit (JSON, partial: true): any subset of type, label, date; unknown fields are rejected.
function validateDocMeta(input, { partial = false } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { errors: ["metadata must be an object"], value: null };
  const errors = [], value = {};
  for (const k of Object.keys(input)) if (!Object.hasOwn(FIELDS, k)) errors.push(`${k}: unknown field`);
  for (const [k, check] of Object.entries(FIELDS)) {
    let v = input[k];
    if (!partial && k === "date" && v === "") v = null;
    if (v === undefined) {
      if (partial) continue;
      if (k === "type") { errors.push("type: missing"); continue; }
      v = k === "label" ? "" : null;
    }
    const msg = check(v);
    if (msg) errors.push(`${k}: ${msg}`); else value[k] = typeof v === "string" ? v.trim() : v;
  }
  if (partial && !errors.length && !Object.keys(value).length) errors.push("nothing to change");
  return { errors, value: errors.length ? null : value };
}

// A payslip dated more than three calendar months before `now` (YYYY-MM-DD) is out of date for most landlords.
function isOutdated(doc, now = new Date().toISOString().slice(0, 10)) {
  if (doc.type !== "payslip" || !doc.date) return false;
  const n = new Date(now + "T00:00:00Z");
  const limit = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - PAYSLIP_MAX_MONTHS, n.getUTCDate()));
  return doc.date < limit.toISOString().slice(0, 10);
}

// What the owner's page sees of one document: everything but the internal file name, plus the outdated flag.
const docView = ({ file, ...d }, now) => ({ ...d, outdated: isOutdated(d, now) });
// Newest first.
const listDocs = (index, now) => Object.values(index.docs).map(d => docView(d, now)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

module.exports = { DOC_TYPES, MIMES, MAX_BYTES, validateDocMeta, isOutdated, docView, listDocs };
```

- [ ] **Step 4: Run** — `node --test test/documents.test.js`; expected: all pass.

- [ ] **Step 5: Failing server tests** — in `test/vault-server.test.js` extend the requires and helpers:

```js
const { PDFDocument } = require("pdf-lib");
const { start, TEST_VAULT_KEY, OTHER_VAULT_KEY, TINY_PNG, TINY_JPEG, pdfPageStreams, hasPdfText } = require("./helpers");
const onePagePdf = async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); return Buffer.from(await d.save()); };
const upload = (s, body, type, query = "type=payslip&label=September&date=2026-09-30") =>
  fetch(s.base + "/api/vault?" + query, { method: "POST", headers: { ...s.auth, "Content-Type": type }, body });
```

and append:

```js
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
```

- [ ] **Step 6: Run** — `node --test test/vault-server.test.js`; expected: the document tests fail (upload answers 404; the 10 MB upload gets an HTML 404 instead of JSON 413).

- [ ] **Step 7: Implement the routes** — in `lib/vault-api.js` add to the requires:

```js
const { MIMES, MAX_BYTES, validateDocMeta, docView, listDocs } = require("./documents");
const { sniffMime } = require("./vault");
```

change the pdf require to `const { canReadPdf, summaryPdf, LANGS } = require("./pdf");`, add `const EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };` below the requires, and insert before `return router;`:

```js
  // ---------- documents ----------
  const upload = express.raw({ type: MIMES, limit: MAX_BYTES });
  const contentType = req => String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  // The uploaded body, checked: one of the three types, not empty, magic bytes match the declared type, PDFs readable.
  async function fileError(req) {
    if (!Buffer.isBuffer(req.body)) return [415, "pdf, jpeg or png expected"];
    if (!req.body.length) return [400, "file expected"];
    if (sniffMime(req.body) !== contentType(req)) return [400, "file content does not match its type"];
    if (contentType(req) === "application/pdf" && !(await canReadPdf(req.body))) return [400, "pdf cannot be read (encrypted or damaged)"];
    return null;
  }
  const findDoc = (req, res) => {
    const d = /^[0-9a-f]{16}$/.test(req.params.id) && Object.hasOwn(vault.index.docs, req.params.id) ? vault.index.docs[req.params.id] : null;
    if (!d) res.status(404).json({ error: "unknown document" });
    return d;
  };

  router.get("/api/vault", (req, res) => res.json({ docs: listDocs(vault.index, nowIso().slice(0, 10)) }));

  router.post("/api/vault", upload, async (req, res) => {
    const bad = await fileError(req);
    if (bad) return res.status(bad[0]).json({ error: bad[1] });
    const { errors, value: meta } = validateDocMeta({ ...req.query });
    if (errors.length) return res.status(400).json({ error: "invalid metadata", details: errors });
    const id = vault.newId(), file = vault.newId();
    const doc = { id, file, ...meta, mime: contentType(req), size: req.body.length, uploadedAt: nowIso(), redactedAt: null };
    try {
      await vault.writeDoc(file, req.body);
      vault.index.docs[id] = doc;
      await vault.saveIndex();
    } catch (e) {
      if (vault.index.docs[id] === doc) delete vault.index.docs[id];
      await vault.removeDoc(file);
      return res.status(500).json({ error: "save failed" });
    }
    res.status(201).json({ ok: true, doc: docView(doc, nowIso().slice(0, 10)) });
  });

  router.get("/api/vault/:id", async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    let buf;
    try { buf = await vault.readDoc(d.file); } catch (e) { return res.status(500).json({ error: "read failed" }); }
    res.set("Content-Type", d.mime);
    res.set("Content-Disposition", `attachment; filename="${d.type}${d.date ? "-" + d.date : ""}.${EXT[d.mime]}"`);
    res.send(buf);
  });

  router.put("/api/vault/:id", async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    const { errors, value } = validateDocMeta(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: "invalid metadata", details: errors });
    const prev = { ...d };
    Object.assign(d, value);
    try { await vault.saveIndex(); }
    catch (e) { Object.assign(d, prev); return res.status(500).json({ error: "save failed" }); }
    res.json({ ok: true, doc: docView(d, nowIso().slice(0, 10)) });
  });

  router.delete("/api/vault/:id", async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    delete vault.index.docs[d.id];
    try { await vault.saveIndex(); }
    catch (e) { vault.index.docs[d.id] = d; return res.status(500).json({ error: "save failed" }); }
    await vault.removeDoc(d.file);
    res.json({ ok: true });
  });

  // A redacted version replaces the file; type, label and date stay.
  router.post("/api/vault/:id/replace", upload, async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    const bad = await fileError(req);
    if (bad) return res.status(bad[0]).json({ error: bad[1] });
    const prev = { ...d }, file = vault.newId();
    try {
      await vault.writeDoc(file, req.body);
      Object.assign(d, { file, mime: contentType(req), size: req.body.length, redactedAt: nowIso() });
      await vault.saveIndex();
    } catch (e) {
      Object.assign(d, prev);
      await vault.removeDoc(file);
      return res.status(500).json({ error: "save failed" });
    }
    await vault.removeDoc(prev.file);
    res.json({ ok: true, doc: docView(d, nowIso().slice(0, 10)) });
  });
```

- [ ] **Step 8: JSON body errors** — in `server.js`, after the `express.static(…public…)` line and before `return app;`:

```js
  // Body-parser errors as JSON: too large → 413, broken JSON → 400.
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "file too large" });
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid json" });
    next(err);
  });
```

- [ ] **Step 9: Run** — `npm test`; expected: all pass.

- [ ] **Step 10: Commit and push** — grep prints `clean`; `git add lib/documents.js lib/vault-api.js server.js test/documents.test.js test/vault-server.test.js && git commit -m "Vault documents: upload with type check, list, download, edit, delete, replace" && git push`.

---

### Task 5: Document requests and share links (owner side)

**Files:** modify `lib/vault-api.js`, `server.js`; create `lib/shares.js`, `test/shares.test.js`, `test/shares-server.test.js`.

**Interfaces:**
- Consumes: `vault.index`, `vault.applicant`, `DOC_TYPES` (Task 4), `ctx.persist` (listings), `STATUSES` value `docs-requested` (phase 1).
- Produces (`lib/shares.js`): `SUMMARY_ID` (`"summary"`), `DEFAULT_DAYS` (7), `TOKEN_RE` (`/^[A-Za-z0-9_-]{43}$/`), `newToken()`, `hashToken(token) → sha256 hex`, `validateShareInput(body, docExists) → { errors, value: { docIds, days } }` (1–20 unique ids, each an existing document or `"summary"`; `days` integer 1–30, default 7; unknown keys rejected), `shareSubject(listing)` (address + ", " + postcode city; else postcode city; else title), `createShare({ listingId, listing, docIds, days, now }) → { share, token }`, `isActive(share, now)`, `shareView(share, now)` (no `tokenHash`, plus `active`).
- Share record (`DATA_DIR/shares.json` = `{ shares: [...] }`): `{ id (16 hex), listingId, subject, docIds, tokenHash, createdAt, expiresAt, revokedAt (null | ISO), opens: [{ at, docId }] }`. `subject` is fixed at creation so the watermark does not change when the listing is edited.
- Listing field (owner, phase 1 spec): `docRequests: [{ at, types }]` (last 50 kept).
- Produces (routes):
  - `POST /api/listings/:id/doc-requests` `{ types: [...] }` (1+ unique of `DOC_TYPES` + `"summary"`) → 200 `{ ok: true, listing }` with the request appended and `status: "docs-requested"`; 400 `{ error: "unsupported field" }` / `{ error: "types: list of … expected" }`; 404 `{ error: "unknown listing" }`; 500 with rollback. Works without a vault (it only touches the listing).
  - `POST /api/listings/:id/shares` `{ docIds, days? }` → 201 `{ ok: true, share: shareView, url: "/s/<token>" }` (the only time the token leaves the server); 400 `{ error: "invalid share", details }` (incl. `"docIds: the summary needs the applicant profile first"`); 404; 503 without vault; 500 with rollback.
  - `GET /api/listings/:id/shares` → 200 `{ shares: [shareView…] }` newest first; 404; 503.
  - `DELETE /api/shares/:shareId` → 200 `{ ok: true, share }` (sets `revokedAt` once; repeating is a no-op 200); 404 `{ error: "unknown share" }`; 503.
  - `DELETE /api/listings/:id` (phase 1) now also revokes that listing's active shares; on a failed save the revocation is rolled back too.
- Produces (`server.js`): `files.shares`, `state.shares`, `persistShares()` (own write queue), passed to `vaultApi`.

- [ ] **Step 1: Failing unit tests** — create `test/shares.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/shares");

test("tokens are 32 random bytes in base64url and hashed with SHA-256", () => {
  const t = S.newToken();
  assert.match(t, S.TOKEN_RE);
  assert.notEqual(t, S.newToken());
  assert.equal(S.hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("validateShareInput", () => {
  const exists = id => id === "d1" || id === "d2";
  assert.deepEqual(S.validateShareInput({ docIds: ["d1", "summary"] }, exists), { errors: [], value: { docIds: ["d1", "summary"], days: 7 } });
  assert.deepEqual(S.validateShareInput({ docIds: ["d2"], days: 30 }, exists).value, { docIds: ["d2"], days: 30 });
  assert.match(S.validateShareInput({ docIds: [] }, exists).errors[0], /^docIds/);
  assert.match(S.validateShareInput({ docIds: ["d1", "d1"] }, exists).errors[0], /^docIds/);
  assert.deepEqual(S.validateShareInput({ docIds: ["nope"] }, exists).errors, ["docIds: unknown document nope"]);
  for (const days of [0, 31, 1.5, "7"]) assert.match(S.validateShareInput({ docIds: ["d1"], days }, exists).errors[0], /^days/);
  assert.deepEqual(S.validateShareInput({ docIds: ["d1"], token: "x" }, exists).errors, ["token: unknown field"]);
  assert.deepEqual(S.validateShareInput(null, exists).errors, ["share must be an object"]);
});

test("shareSubject prefers the address, then postcode and city, then the title", () => {
  assert.equal(S.shareSubject({ address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf", title: "2 rooms" }), "Beispielstraße 1, 40210 Düsseldorf");
  assert.equal(S.shareSubject({ postcode: "40210", city: "Düsseldorf", title: "2 rooms" }), "40210 Düsseldorf");
  assert.equal(S.shareSubject({ title: "2 rooms" }), "2 rooms");
});

test("createShare stores only the hash; expiry, revocation and the owner view", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const { share, token } = S.createShare({ listingId: "l1", listing: { address: "Beispielstraße 1", title: "x" }, docIds: ["d1"], days: 7, now });
  assert.equal(share.tokenHash, S.hashToken(token));
  assert.ok(!JSON.stringify(share).includes(token));
  assert.equal(share.expiresAt, "2026-10-27T10:00:00.000Z");
  assert.deepEqual([share.revokedAt, share.opens, share.subject], [null, [], "Beispielstraße 1"]);
  assert.equal(S.isActive(share, new Date("2026-10-27T09:59:59Z")), true);
  assert.equal(S.isActive(share, new Date("2026-10-27T10:00:00Z")), false);
  assert.equal(S.isActive({ ...share, revokedAt: now.toISOString() }, now), false);
  const view = S.shareView(share, now);
  assert.equal(view.tokenHash, undefined);
  assert.equal(view.active, true);
});
```

- [ ] **Step 2: Run** — `node --test test/shares.test.js`; expected: `Cannot find module '../lib/shares'`.

- [ ] **Step 3: Implement `lib/shares.js`:**

```js
// lib/shares.js — share links: tokens (only their hash is stored), input validation and the public view of a share.
const crypto = require("crypto");

const SUMMARY_ID = "summary";
const DEFAULT_DAYS = 7;

const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = token => crypto.createHash("sha256").update(String(token)).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// { docIds: 1–20 unique ids of existing documents or "summary", days: 1–30 (default 7) }
function validateShareInput(body, docExists) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { errors: ["share must be an object"], value: null };
  const errors = [];
  for (const k of Object.keys(body)) if (!["docIds", "days"].includes(k)) errors.push(`${k}: unknown field`);
  const ids = body.docIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) errors.push("docIds: list of 1–20 different documents expected");
  else for (const id of ids) if (id !== SUMMARY_ID && (typeof id !== "string" || !docExists(id))) errors.push(`docIds: unknown document ${String(id).slice(0, 40)}`);
  const days = body.days === undefined ? DEFAULT_DAYS : body.days;
  if (!Number.isInteger(days) || days < 1 || days > 30) errors.push("days: whole number 1–30 expected");
  return { errors, value: errors.length ? null : { docIds: ids, days } };
}

// The text a watermark names: the listing's address, else its postcode and city, else its title.
const shareSubject = l => [l.address, [l.postcode, l.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || l.title || "";

function createShare({ listingId, listing, docIds, days, now = new Date() }) {
  const token = newToken();
  const share = {
    id: crypto.randomBytes(8).toString("hex"), listingId, subject: shareSubject(listing), docIds,
    tokenHash: hashToken(token), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86400000).toISOString(), revokedAt: null, opens: []
  };
  return { share, token };
}

const isActive = (share, now = new Date()) => !share.revokedAt && new Date(share.expiresAt) > now;

// What the owner's page sees: everything except the token hash.
const shareView = (share, now = new Date()) => { const { tokenHash, ...rest } = share; return { ...rest, active: isActive(share, now) }; };

module.exports = { SUMMARY_ID, DEFAULT_DAYS, TOKEN_RE, newToken, hashToken, validateShareInput, shareSubject, createShare, isActive, shareView };
```

- [ ] **Step 4: Run** — `node --test test/shares.test.js`; expected: all pass.

- [ ] **Step 5: Failing server tests** — create `test/shares-server.test.js` (the header is shared with Task 6):

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument } = require("pdf-lib");
const { start, TEST_VAULT_KEY, TINY_JPEG, pdfPageStreams, hasPdfText } = require("./helpers");
const { defaultApplicant } = require("../lib/applicant");
const { defaultProfile } = require("../lib/profile");
const { hashToken } = require("../lib/shares");

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
  const up = (body, type, q) => fetch(s.base + "/api/vault?" + q, { method: "POST", headers: { ...s.auth, "Content-Type": type }, body }).then(r => r.json()).then(j => j.doc.id);
  s.payslip = await up(Buffer.from(await d.save()), "application/pdf", "type=payslip&date=2026-09-30");
  s.idDoc = await up(TINY_JPEG, "image/jpeg", "type=id");
  s.share = async (body = { docIds: [s.payslip, s.idDoc, "summary"] }, id = "flat") => {
    const r = await fetch(s.base + `/api/listings/${id}/shares`, { method: "POST", headers: json(s.auth), body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return s;
}
const get = (s, p) => fetch(s.base + p); // no password: share links are public
```


```js
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
```

- [ ] **Step 6: Run** — `node --test test/shares-server.test.js`; expected: fails (`/api/listings/flat/doc-requests` answers 404; `state.shares` is undefined).

- [ ] **Step 7: Server state** — in `server.js`:
  - `files` gets `shares: path.join(dataDir, "shares.json")`.
  - `state` gets `shares: readJson(files.shares, { shares: [] }).shares`.
  - After `const persist = …`:
    ```js
    let writingShares = Promise.resolve();
    const persistShares = () => (writingShares = writingShares.catch(() => {}).then(() => writeJsonAtomic(files.shares, { shares: state.shares })));
    ```
  - In the `vaultApi({ … })` call replace `persistShares: null` with `persistShares`.
  - In `app.delete("/api/listings/:id")` replace the two lines `try { await persist(); }` and `catch (e) {` with:
    ```js
    // Its share links stop working with it.
    const revoked = state.shares.filter(s => s.listingId === id && !s.revokedAt);
    const at = now().toISOString();
    for (const s of revoked) s.revokedAt = at;
    try { await persist(); if (revoked.length) await persistShares(); }
    catch (e) {
      for (const s of revoked) if (s.revokedAt === at) s.revokedAt = null;
    ```
    (the rest of the existing `catch` body — restoring the listing and its log entries — stays).

- [ ] **Step 8: Routes** — in `lib/vault-api.js` change the documents require to include `DOC_TYPES` (`const { DOC_TYPES, MIMES, MAX_BYTES, validateDocMeta, docView, listDocs } = require("./documents");`), add `const { SUMMARY_ID, validateShareInput, createShare, shareView } = require("./shares");` and `const REQUEST_TYPES = [...DOC_TYPES, SUMMARY_ID];` below the requires, change the export to `module.exports = { vaultApi, REQUEST_TYPES };`, and insert before `return router;`:

```js
  // ---------- document requests and shares ----------
  const findListing = (req, res) => {
    const l = Object.hasOwn(state.listings, req.params.id) ? state.listings[req.params.id] : null;
    if (!l) res.status(404).json({ error: "unknown listing" });
    return l;
  };

  // The landlord asked for documents: log which, and move the listing to "docs-requested".
  router.post("/api/listings/:id/doc-requests", async (req, res) => {
    const l = findListing(req, res);
    if (!l) return;
    const b = req.body, types = b && b.types;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some(k => k !== "types")) return res.status(400).json({ error: "unsupported field" });
    if (!Array.isArray(types) || !types.length || new Set(types).size !== types.length || types.some(t => !REQUEST_TYPES.includes(t))) return res.status(400).json({ error: `types: list of ${REQUEST_TYPES.join(", ")} expected` });
    const prev = { docRequests: l.docRequests, status: l.status };
    l.docRequests = [...(l.docRequests || []), { at: nowIso(), types }].slice(-50);
    l.status = "docs-requested";
    try { await ctx.persist(); }
    catch (e) {
      if (prev.docRequests === undefined) delete l.docRequests; else l.docRequests = prev.docRequests;
      l.status = prev.status;
      return res.status(500).json({ error: "save failed" });
    }
    res.json({ ok: true, listing: l });
  });

  router.post("/api/listings/:id/shares", requireVault, async (req, res) => {
    const l = findListing(req, res);
    if (!l) return;
    const { errors, value } = validateShareInput(req.body, id => Object.hasOwn(vault.index.docs, id));
    if (errors.length) return res.status(400).json({ error: "invalid share", details: errors });
    if (value.docIds.includes(SUMMARY_ID) && !vault.applicant) return res.status(400).json({ error: "invalid share", details: ["docIds: the summary needs the applicant profile first"] });
    const { share, token } = createShare({ listingId: req.params.id, listing: l, docIds: value.docIds, days: value.days, now: ctx.now() });
    state.shares.push(share);
    try { await ctx.persistShares(); }
    catch (e) {
      const at = state.shares.indexOf(share);
      if (at >= 0) state.shares.splice(at, 1);
      return res.status(500).json({ error: "save failed" });
    }
    // The token leaves the server only here, once.
    res.status(201).json({ ok: true, share: shareView(share, ctx.now()), url: "/s/" + token });
  });

  router.get("/api/listings/:id/shares", requireVault, (req, res) => {
    if (!findListing(req, res)) return;
    const now = ctx.now();
    res.json({ shares: state.shares.filter(s => s.listingId === req.params.id).map(s => shareView(s, now)).reverse() });
  });

  router.delete("/api/shares/:shareId", async (req, res) => {
    const s = state.shares.find(x => x.id === req.params.shareId);
    if (!s) return res.status(404).json({ error: "unknown share" });
    if (!s.revokedAt) {
      s.revokedAt = nowIso();
      try { await ctx.persistShares(); }
      catch (e) { s.revokedAt = null; return res.status(500).json({ error: "save failed" }); }
    }
    res.json({ ok: true, share: shareView(s, ctx.now()) });
  });
```

- [ ] **Step 9: Run** — `npm test`; expected: all pass.

- [ ] **Step 10: Commit and push** — grep prints `clean`; `git add lib/shares.js lib/vault-api.js server.js test/shares.test.js test/shares-server.test.js && git commit -m "Document requests and share links: hashed tokens, expiry, revocation" && git push`.

---

### Task 6: Public share page and watermarked documents

**Files:** modify `server.js`, `test/shares-server.test.js`; create `lib/ratelimit.js`, `lib/share-public.js`, `test/ratelimit.test.js`.

**Interfaces:**
- Consumes: `state.shares`, `persistShares` (Task 5); `hashToken`, `TOKEN_RE`, `isActive`, `SUMMARY_ID` (Task 5); `toPdf`, `watermarkPdf`, `watermarkText`, `summaryPdf`, `fmtDate` (Task 3); `vault.readDoc`, `vault.index`, `vault.applicant`.
- Produces (`lib/ratelimit.js`): `createRateLimiter({ limit = 30, windowMs = 60000, now = Date.now }) → { hit(key) → boolean }` (fixed window per key; prunes old keys past 10 000 entries).
- Produces (`lib/share-public.js`): `publicShares(ctx) → express.Router` with `ctx = { state, vault, persistShares, now, rateLimit }`, mounted at `/s` **before** the password check:
  - every response: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`; over the limit → 429 `text/plain` "Too many requests", `Retry-After: 60`.
  - `GET /s/:token` → 200 HTML in `profile.outreach.language` (fallback `en`): title, "<applicant name> shares these documents for the application for <subject>.", one link per available document (`/s/<token>/<docId>`, label = document type name + " (label)" or the summary name), "This link works until DD.MM.YYYY."
  - `GET /s/:token/:docId` → 200 `application/pdf`, `Content-Disposition: inline; filename="<type|summary>.pdf"`: the document (images converted by `toPdf`, the summary generated by `summaryPdf`) with `watermarkText(lang, share.subject, share.createdAt)` on every page; appends `{ at, docId }` to `share.opens` (last 500) and saves best effort; 500 `text/plain` "Document unavailable" if decryption or PDF work fails.
  - unknown token, malformed token, expired, revoked, document not in the share or no longer in the vault, no vault, any other `/s` path → the identical 404 (`text/plain`, "Not found").
- Produces (`server.js`): `app.use("/s", publicShares({ state, vault, persistShares, now, rateLimit: options.shareRateLimit }))` directly after `/healthz`; `trust proxy` = 1 hop when `options.trustProxy ?? process.env.TRUST_PROXY === "1"` (Railway sits behind one proxy; without it every visitor shares the proxy's address in the rate limit).

- [ ] **Step 1: Failing unit test** — create `test/ratelimit.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../lib/ratelimit");

test("rate limiter: 30 per window per key, then a fresh window", () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 30, windowMs: 60000, now: () => t });
  for (let i = 0; i < 30; i++) assert.equal(rl.hit("a"), true);
  assert.equal(rl.hit("a"), false);
  assert.equal(rl.hit("b"), true);
  t = 60000;
  assert.equal(rl.hit("a"), true);
});
```

- [ ] **Step 2: Run** — `node --test test/ratelimit.test.js`; expected: `Cannot find module '../lib/ratelimit'`.

- [ ] **Step 3: Implement `lib/ratelimit.js`:**

```js
// lib/ratelimit.js — fixed-window request counter per key (in memory; resets on restart).
function createRateLimiter({ limit = 30, windowMs = 60000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    // true while the key is within its limit for the current window
    hit(key) {
      const t = now();
      if (hits.size > 10000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      const h = hits.get(key);
      if (!h || t - h.start >= windowMs) { hits.set(key, { start: t, count: 1 }); return true; }
      h.count++;
      return h.count <= limit;
    }
  };
}

module.exports = { createRateLimiter };
```

- [ ] **Step 4: Failing server tests** — append to `test/shares-server.test.js`:

```js
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
```

- [ ] **Step 5: Run** — `node --test test/shares-server.test.js`; expected: the Task 6 tests fail (`/s/...` answers 401 because it sits behind the password).

- [ ] **Step 6: Implement `lib/share-public.js`:**

```js
// lib/share-public.js — the only public routes besides /healthz: a share's page and its watermarked documents.
const express = require("express");
const { SUMMARY_ID, TOKEN_RE, hashToken, isActive } = require("./shares");
const { toPdf, watermarkPdf, watermarkText, summaryPdf, fmtDate } = require("./pdf");
const { createRateLimiter } = require("./ratelimit");

const TEXT = {
  en: { title: "Application documents", intro: (n, s) => `${n ? n + " shares" : "Shared"} these documents for the application for ${s}.`, until: d => `This link works until ${d}.`, summary: "Applicant summary", types: { payslip: "Payslip", contract: "Employment contract", schufa: "SCHUFA credit report", id: "ID document", "rent-confirmation": "Rent payment confirmation", "landlord-reference": "Landlord reference", other: "Document" } },
  de: { title: "Bewerbungsunterlagen", intro: (n, s) => `${n ? n + " teilt" : "Geteilt werden"} diese Unterlagen für die Bewerbung um ${s}.`, until: d => `Dieser Link gilt bis ${d}.`, summary: "Selbstauskunft (Kurzfassung)", types: { payslip: "Gehaltsnachweis", contract: "Arbeitsvertrag", schufa: "SCHUFA-Auskunft", id: "Ausweis", "rent-confirmation": "Mietzahlungsbestätigung", "landlord-reference": "Vermieterbescheinigung", other: "Dokument" } },
  pt: { title: "Documentos da candidatura", intro: (n, s) => `${n ? n + " compartilha" : "Compartilhados"} estes documentos para a candidatura ao imóvel ${s}.`, until: d => `Este link vale até ${d}.`, summary: "Resumo do candidato", types: { payslip: "Contracheque", contract: "Contrato de trabalho", schufa: "Relatório SCHUFA", id: "Documento de identidade", "rent-confirmation": "Comprovante de pagamento do aluguel", "landlord-reference": "Referência do locador", other: "Documento" } }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ctx: { state, vault, persistShares, now, rateLimit }
function publicShares(ctx) {
  const { state, vault } = ctx;
  const router = express.Router();
  const limiter = createRateLimiter({ limit: ctx.rateLimit ?? 30, windowMs: 60000, now: () => ctx.now().getTime() });
  const lang = () => (state.profile && state.profile.outreach && state.profile.outreach.language) || "en";
  // One answer for unknown, expired and revoked links alike.
  const notFound = res => res.status(404).type("text/plain").send("Not found");

  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" });
    if (!limiter.hit(req.ip)) return res.status(429).set("Retry-After", "60").type("text/plain").send("Too many requests");
    next();
  });

  const activeShare = token => {
    if (!vault || !TOKEN_RE.test(token)) return null;
    const h = hashToken(token);
    const s = state.shares.find(x => x.tokenHash === h);
    return s && isActive(s, ctx.now()) ? s : null;
  };
  const available = (s, id) => s.docIds.includes(id) && (id === SUMMARY_ID ? !!vault.applicant : Object.hasOwn(vault.index.docs, id));

  router.get("/:token", (req, res) => {
    const s = activeShare(req.params.token);
    if (!s) return notFound(res);
    const L = TEXT[lang()] || TEXT.en, name = vault.applicant ? vault.applicant.name : "";
    const items = s.docIds.filter(id => available(s, id)).map(id => {
      const d = id === SUMMARY_ID ? null : vault.index.docs[id];
      const label = d ? L.types[d.type] + (d.label ? ` (${d.label})` : "") : L.summary;
      return `<li><a href="/s/${esc(req.params.token)}/${esc(id)}">${esc(label)}</a></li>`;
    });
    res.type("html").send(`<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(L.title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1d2125;background:#fff}a{color:#0b57d0}li{margin:8px 0}.muted{color:#5f6368;font-size:14px}</style></head>
<body><h1>${esc(L.title)}</h1><p>${esc(L.intro(name, s.subject))}</p><ul>${items.join("")}</ul><p class="muted">${esc(L.until(fmtDate(s.expiresAt)))}</p></body></html>`);
  });

  router.get("/:token/:docId", async (req, res) => {
    const s = activeShare(req.params.token), id = req.params.docId;
    if (!s || !available(s, id)) return notFound(res);
    let pdf;
    try {
      const base = id === SUMMARY_ID
        ? await summaryPdf(vault.applicant, (state.profile && state.profile.money.netIncome) || 0, lang(), ctx.now())
        : await toPdf(await vault.readDoc(vault.index.docs[id].file), vault.index.docs[id].mime);
      pdf = await watermarkPdf(base, watermarkText(lang(), s.subject, s.createdAt));
    } catch (e) { return res.status(500).type("text/plain").send("Document unavailable"); }
    s.opens = [...s.opens, { at: ctx.now().toISOString(), docId: id }].slice(-500);
    ctx.persistShares().catch(() => {}); // the access log is best effort; the document is still served
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="${id === SUMMARY_ID ? "summary" : vault.index.docs[id].type}.pdf"`);
    res.send(Buffer.from(pdf));
  });

  router.use((req, res) => notFound(res));
  return router;
}

module.exports = { publicShares };
```

- [ ] **Step 7: Mount** — in `server.js` add `const { publicShares } = require("./lib/share-public");` to the requires; after `app.disable("x-powered-by");`:

```js
  // Behind one reverse proxy (Railway), req.ip is the visitor's address; needed for the share-link rate limit.
  if (options.trustProxy ?? process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
```

and directly after the `/healthz` route:

```js
  // Share links are public; everything registered after the password check is not.
  app.use("/s", publicShares({ state, vault, persistShares, now, rateLimit: options.shareRateLimit }));
```

`persistShares` must be defined above this line (Task 5 put it after `persist`, which is above `const app = express()`).

- [ ] **Step 8: Run** — `npm test`; expected: all pass. Also confirm `/healthz` and `/s/*` are the only routes answering without the password (the Task 1 test lists the protected ones).

- [ ] **Step 9: Commit and push** — grep prints `clean`; `git add lib/ratelimit.js lib/share-public.js server.js test/ratelimit.test.js test/shares-server.test.js && git commit -m "Public share links: watermarked PDFs, access log, rate limit, identical 404s" && git push`.

---

### Task 7: "About me" section — applicant form and vault list

**Files:** create `public/vault-ui.js`; modify `public/index.html`.

**Interfaces:**
- Consumes: `GET /api/vault/status`, `GET/PUT /api/applicant`, `GET /api/applicant/summary.pdf?lang=`, `GET/POST /api/vault`, `GET/PUT/DELETE /api/vault/:id` (Tasks 1–4); `window.FlatHunt.profile()`, `window.FlatHunt.lang()` (phase 1).
- Produces: `window.VaultUI = { mountAbout(host, { lang }), listingDocs(host, listing, { lang, onChanged }), TYPES, L }` (UMD-free plain browser script, IIFE like `setup.js`). `listingDocs` is a stub in this task (`host.hidden = true`) and is filled in Task 9. `VaultUI.L` holds the en/de/pt strings, `VaultUI.TYPES` the document types in `lib/documents.js` order.

Requirements (each text in en/de/pt; the document type names use the same wording as `lib/share-public.js`):
- [ ] **Entry point:** a header chip "About me" (de "Über mich", pt "Sobre mim") next to Settings toggles a new `<section class="aboutme" id="aboutme" hidden>` placed after `#stale`; the jump nav gets an "About me" link while it is open; the open/closed state is kept in `localStorage` (`flathunt-aboutme`, wrapped in try/catch). Changing the language re-renders the section.
- [ ] **Vault off:** when `/api/vault/status` is not `ready`, the section shows only a notice: documents and the applicant profile need `VAULT_KEY` (one sentence each on what it is, `openssl rand -base64 32`, keep a copy, see README) — no form.
- [ ] **Applicant form** (`404` → start from the same defaults as `defaultApplicant()` in `lib/applicant.js`, copied into `vault-ui.js` with a comment pointing at the server file): name, email, phone; household adults, children, pets (free text, placeholder "e.g. one cat"); job title, employer, since (`<input type="month">`), permanent contract (checkbox); SCHUFA report available, landlord reference available (checkboxes); "About us" textarea with a live `n / 1000` counter. Save → `PUT /api/applicant`; on 400 show the `details` next to the form; "Saved" note as in phase 1.
- [ ] **Summary:** one button per enabled profile language ("Summary PDF (DE)") opening `/api/applicant/summary.pdf?lang=xx` in a new tab; disabled with a hint until the applicant has been saved.
- [ ] **Upload:** file input (`accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"`), type select (`TYPES`), label (max 120), date (`<input type="date">`, label "Document date (e.g. pay month)"). Before sending: reject files over 10 MB with the localized message (no request). Send `fetch("/api/vault?" + new URLSearchParams({ type, label, date }), { method: "POST", headers: { "Content-Type": mime }, body: file })`, where `mime` is `file.type` or derived from the extension when empty. Map 413 → "File is larger than 10 MB", 415 → "Only PDF, JPEG or PNG", 400 "file content does not match its type" → "The file is not really a <type>", 400 "pdf cannot be read…" → "This PDF is encrypted or damaged; print it to a new PDF and try again"; any other error → generic save failure.
- [ ] **Vault list** (`GET /api/vault`): one row per document — type name, label, date (locale format), size (KB/MB, locale), uploaded date; badges "Redacted" (`redactedAt`) and, for `outdated` payslips, a warning badge "Older than 3 months" with a tooltip that landlords usually ask for the last three payslips. Actions: Download (link to `/api/vault/:id`), Edit (inline type/label/date → `PUT`, only changed fields), Redact (calls `Redact.open({ doc, lang, onSaved })` from Task 8; hidden until `window.Redact` exists), Delete (confirm naming the document → `DELETE`). Empty state: one sentence on what to upload (recent payslips, SCHUFA report, ID, rent payment confirmation, landlord reference).
- [ ] **Layout:** the form and the list sit side by side on desktop and stack on phones (≤ 700 px), no horizontal scroll; dark mode via the existing CSS variables; `[hidden]` respected.
- [ ] **Script tag:** `<script src="vault-ui.js"></script>` after `setup.js`; `index.html` calls `VaultUI.mountAbout($("#aboutme"), { lang })` when the section opens and on language change.
- [ ] **Browser check:** with `VAULT_KEY` unset (notice shown) and set (`ALLOW_OPEN=1 DATA_DIR=./data VAULT_KEY=$(openssl rand -base64 32) npm start`, test data only): save "Alex Example", open the DE summary, upload a PDF and a PNG, edit a label, try a renamed `.txt` as PDF (error shown), delete one; desktop and phone width; de/pt; no console errors.
- [ ] **Commit and push** — grep prints `clean`; `git add public/vault-ui.js public/index.html && git commit -m "About me: applicant form, summary and document vault on the page" && git push`.

---

### Task 8: Redaction helper

**Files:** create `public/imagepdf.js`, `test/imagepdf.test.js`, `public/redact.js`; modify `public/index.html` (script tags, dialog styles), `public/vault-ui.js` (Redact button wiring).

**Interfaces:**
- Consumes: `GET /api/vault/:id`, `POST /api/vault/:id/replace` (Task 4); `VaultUI.L` (Task 7).
- Produces (`public/imagepdf.js`, UMD → `window.ImagePdf` / `module.exports`): `fromJpegs(pages) → Uint8Array`, `pages = [{ jpeg: Uint8Array, width, height (pixels), pageWidth, pageHeight (points) }]`; a PDF 1.4 with one page per JPEG (`/DCTDecode` image drawn over the whole page) and a valid xref table; throws "at least one page expected" on an empty list.
- Produces (`public/redact.js`): `window.Redact = { open({ doc, lang, onSaved }) }`.

- [ ] **Step 1: Failing test** — create `test/imagepdf.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, PDFName } = require("pdf-lib");
const { fromJpegs } = require("../public/imagepdf");
const { TINY_JPEG } = require("./helpers");

test("fromJpegs builds a PDF with one image page per JPEG and a valid cross-reference table", async () => {
  const jpeg = new Uint8Array(TINY_JPEG);
  const bytes = fromJpegs([
    { jpeg, width: 1, height: 1, pageWidth: 595.28, pageHeight: 841.89 },
    { jpeg, width: 1, height: 1, pageWidth: 841.89, pageHeight: 595.28 }
  ]);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual(doc.getPage(1).getSize(), { width: 841.89, height: 595.28 });
  const xobjects = doc.getPage(0).node.Resources().lookup(PDFName.of("XObject"));
  const img = xobjects.lookup(PDFName.of("Im0"));
  assert.equal(img.dict.get(PDFName.of("Filter")).toString(), "/DCTDecode");
  assert.deepEqual(Buffer.from(img.getContents()), TINY_JPEG);
  // Every xref offset points at "<n> 0 obj".
  const text = Buffer.from(bytes).toString("latin1");
  const start = Number(/startxref\n(\d+)/.exec(text)[1]);
  const rows = text.slice(start).split("\n").slice(3, 3 + 8);
  rows.forEach((row, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, Number(row.slice(0, 10))), `object ${i + 1}`));
});

test("fromJpegs refuses an empty page list", () => {
  assert.throws(() => fromJpegs([]), /at least one page/);
});
```

- [ ] **Step 2: Run** — `node --test test/imagepdf.test.js`; expected: `Cannot find module '../public/imagepdf'`.

- [ ] **Step 3: Implement `public/imagepdf.js`:**

```js
// public/imagepdf.js — builds a PDF from JPEG page images (browser + Node). Used by the redaction helper: the
// covered text is gone because each page is only a picture.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ImagePdf = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const enc = s => new TextEncoder().encode(s);

  // pages: [{ jpeg: Uint8Array, width, height (pixels), pageWidth, pageHeight (points) }] → Uint8Array (PDF 1.4)
  function fromJpegs(pages) {
    if (!Array.isArray(pages) || !pages.length) throw new Error("at least one page expected");
    const chunks = [], offsets = [];
    let length = 0;
    const push = b => { chunks.push(b); length += b.length; };
    const obj = (n, body, stream) => {
      offsets[n] = length;
      push(enc(`${n} 0 obj\n${body}\n`));
      if (stream) { push(enc("stream\n")); push(stream); push(enc("\nendstream\n")); }
      push(enc("endobj\n"));
    };
    const pageIds = pages.map((_, i) => 3 + i * 3);
    push(enc("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
    obj(2, `<< /Type /Pages /Kids [${pageIds.map(n => n + " 0 R").join(" ")}] /Count ${pages.length} >>`);
    pages.forEach((p, i) => {
      const n = pageIds[i], w = +p.pageWidth.toFixed(2), h = +p.pageHeight.toFixed(2);
      const content = enc(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
      obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
      obj(n + 1, `<< /Length ${content.length} >>`, content);
      obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
    });
    const count = 3 + pages.length * 3, xref = length;
    let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let n = 1; n < count; n++) table += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
    push(enc(table + `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  return { fromJpegs };
});
```

- [ ] **Step 4: Run** — `npm test`; expected: all pass. Commit: `git add public/imagepdf.js test/imagepdf.test.js && git commit -m "Image PDF writer for redacted pages"`.

- [ ] **Step 5: Redaction dialog** (`public/redact.js`), requirements (texts en/de/pt):
  - Opens a full-screen `<dialog>` (same `sx` dialog styles as `setup.js`) titled "Cover sensitive details" with the hint: cover the tax ID (Steuer-ID), social-security number (Sozialversicherungsnummer), bank details (IBAN) and anything else the landlord does not need; the saved version replaces the stored file and the covered parts cannot be restored.
  - Loads pdf.js on first use only, by injecting `<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js">` and setting `pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"`; a load failure shows "The PDF viewer could not be loaded" and closes nothing else.
  - Fetches the document from `/api/vault/:id` as an `ArrayBuffer`. PDF → `pdfjsLib.getDocument({ data })`, each page rendered at scale 2 to its own canvas; the page size in points is the scale-1 viewport. Image → `createImageBitmap(blob)` drawn to one canvas; page size = A4 fitted like `toPdf` (portrait or landscape by aspect). More than 20 pages → message, no editing.
  - Drawing: pointer events (`pointerdown/move/up`, `setPointerCapture`, `touch-action: none` on the canvases) draw a rectangle preview; on release a black box is stored in canvas pixel coordinates for that page and painted solid black on an overlay canvas. Buttons: "Undo last box", "Clear page", "Cancel", "Save redacted copy" (disabled until at least one box exists).
  - Save: confirm ("The original is replaced and cannot be restored"); per page, copy the rendered canvas to a new canvas, `fillRect` every box in `#000`, `toBlob("image/jpeg", 0.92)` → `Uint8Array`; `ImagePdf.fromJpegs([...])`; `POST /api/vault/:id/replace` with `Content-Type: application/pdf`; on success close and call `onSaved(doc)`; on error keep the dialog open with the message.
  - Keyboard: Escape cancels; the canvases scroll vertically on phones; works with mouse, pen and touch.
- [ ] **Step 6: Wire** — `index.html` loads `imagepdf.js` and `redact.js` after `vault-ui.js`; the vault list's Redact button (Task 7) now shows and opens the dialog; after saving the row shows the "Redacted" badge.
- [ ] **Step 7: Browser check** — redact a two-page PDF and a PNG (test files only): boxes appear where drawn, the saved PDF downloads with the boxes burned in (text under them is not selectable/searchable), `redactedAt` badge shows; phone width with touch emulation; de/pt; no console errors.
- [ ] **Step 8: Commit and push** — grep prints `clean`; `git add public/redact.js public/vault-ui.js public/index.html && git commit -m "Redaction helper: cover parts of a document and save a flattened copy" && git push`.

---

### Task 9: Listing "Documents" section, payslip warning and README

**Files:** modify `public/vault-ui.js` (`listingDocs`), `public/index.html` (listing detail host), `README.md`.

**Interfaces:**
- Consumes: `POST /api/listings/:id/doc-requests`, `POST/GET /api/listings/:id/shares`, `DELETE /api/shares/:shareId` (Task 5), `GET /api/vault`, `GET /api/applicant` (Tasks 2, 4), `GET /api/vault/status`, `Redact.open` (Task 8).
- Produces: `VaultUI.listingDocs(host, listing, { lang, onChanged })` rendering into a `<div class="docs">` that `index.html` places in the listing detail's right column, after the conversation controls and before Edit/Delete.

Requirements (each text in en/de/pt):
- [ ] **Vault off:** the section shows the short `VAULT_KEY` notice from Task 7 and nothing else; logging a request still works (it needs no vault).
- [ ] **Requests:** heading "Documents"; the listing's `docRequests` newest first ("20.10.2026: payslip, SCHUFA report, summary"). "Log a request" opens checkboxes for the seven types plus "Applicant summary"; Save → `POST …/doc-requests`; afterwards `onChanged()` reloads (the status pill becomes "Documents requested").
- [ ] **Approve and create a link:** a checklist of the vault documents (type, label, date; "Older than 3 months" and "Redacted" badges as in Task 7) plus "Applicant summary" (disabled with a hint until the applicant is saved); boxes whose type is in the newest request are pre-ticked; "Link valid for" number input 1–30 days, default 7. Create → `POST …/shares`; 400 `details` shown inline.
- [ ] **Payslip warning:** if the selection contains a payslip with `redactedAt: null` that has not been confirmed before, show before sending: "Before you share a payslip, cover your tax ID, social-security number and bank details." with buttons "Redact now" (opens `Redact.open` for that document, then returns to the checklist) and "Share as it is". "Share as it is" stores the document id in `localStorage` (`flathunt-payslip-ok`, a JSON list, try/catch) so the warning appears once per document.
- [ ] **New link:** shows the full URL (`location.origin + url`) in a read-only input with "Copy" (`navigator.clipboard.writeText`, fallback select-all) and the note "Copy it now — for your safety it is shown only this once. Anyone with the link can open the documents until it expires or you revoke it."
- [ ] **Shares list** (`GET …/shares`): per share — created, valid until, state (active / expired / revoked, colour like the status pills), document names, "Opened N times" with the last open time; a `<details>` lists every open ("21.10.2026 14:03 · Payslip"). "Revoke" (confirm) → `DELETE /api/shares/:id`, then re-render. No link is shown for existing shares (the server never has it again).
- [ ] **Browser check:** log a request, create a link with a payslip (warning shown once), open the link in a private window (no password asked; watermark on every page in the profile's outreach language), see the open counted, revoke, reload the link (plain "Not found"); phone width; de/pt; no console errors.
- [ ] **README:**
  - Status: phase 2 built; move phase 2 out of "Coming next" into a "What it does in phase 2" list: applicant profile and one-page summary (de/en/pt), encrypted vault for PDF/JPEG/PNG up to 10 MB, document requests on a listing, approval-gated share links (default 7 days, 1–30, revocable, rate-limited, watermark "Only for the application for <address> · <date>" on every page, every view logged with time but no IP address), payslips older than three months flagged, redaction helper (works in your browser; the covered parts are removed, not just hidden).
  - "Run your own copy": new variable `VAULT_KEY` — create it with `openssl rand -base64 32`, set it on the service, and keep a copy in your password manager: without the same key the vault cannot be read and the server will not start once documents are stored; it is never written to the volume. New optional variable `TRUST_PROXY=1` on Railway (one proxy in front), so the share-link rate limit counts visitors, not the proxy.
  - Public routes: `/healthz` and share links `/s/<token>`; everything else needs `SITE_PASSWORD`.
  - What a landlord sees: a page listing the shared documents and each document as a PDF with the watermark; nothing else of the hunt.
  - Local run line: `ALLOW_OPEN=1 DATA_DIR=./data SYNC_KEY=dev VAULT_KEY=$(openssl rand -base64 32) npm start` with the note that a new key each start cannot open the vault of the previous run — keep one key per data directory.
  - "Data and services": pdf.js (cdnjs) for the redaction helper, pdf-lib for watermarks and summaries.
- [ ] **Final check:** `npm test` all green; personal-data grep prints `clean`.
- [ ] **Commit and push** — `git add public/vault-ui.js public/index.html README.md && git commit -m "Listing documents: requests, share links with opens, payslip warning; README for the vault" && git push`.

---

## Self-review notes

- Spec coverage (phase 2): applicant fields and encryption (Task 2), summary PDF in de/en/pt with net income (Task 3), vault uploads with type, label, date, size, 10 MB limit, encrypted metadata and files (Tasks 1, 4), start-up refusal with missing or wrong key (Task 1), outdated payslips (Task 4 server flag, Tasks 7 and 9 badges), document requests and `docs-requested` (Task 5), shares with 32-byte token stored as SHA-256, 1–30 days default 7, revocation (Task 5), public `/s` with no-store, noindex, no-referrer, rate limit, identical 404s, watermark on every page and per-view log without IP (Task 6), redaction helper with pdf.js and flattened image PDF (Task 8), payslip reminder before the first share (Task 9), README (Task 9). Public routes stay `/healthz` and `/s/*` (tested in Tasks 1 and 6).
- Test list from the brief: crypto round trip and wrong key (Task 1 unit), wrong-key refusal at start (Task 1 server), 503 without key (Tasks 1, 5), magic-byte mismatch 400 and 413 JSON (Task 4), token stored only hashed (Task 5), expired/revoked/unknown identical 404 (Task 6), rate limit 429 (Tasks 6 unit and server), watermark text in the output PDF via the decoded content streams (Tasks 3, 6), opens logged (Task 6), password on owner routes but not `/s` (Tasks 1, 6), applicant validation (Task 2), summary PDF (Task 3).
- Names used across tasks: `parseVaultKey`, `vaultStatus`, `openVault`, `vault.{index, applicant, saveIndex, saveApplicant, writeDoc, readDoc, removeDoc, newId}`, `sniffMime`, `validateApplicant`, `defaultApplicant`, `validateDocMeta`, `docView`, `listDocs`, `isOutdated`, `canReadPdf`, `toPdf`, `watermarkPdf`, `watermarkText`, `summaryPdf`, `newToken`, `hashToken`, `validateShareInput`, `shareSubject`, `createShare`, `isActive`, `shareView`, `createRateLimiter`, `vaultApi`, `publicShares`, `persistShares`, `ImagePdf.fromJpegs`, `VaultUI.mountAbout/listingDocs`, `Redact.open`.
- Tasks 7–9 are specified as requirements because they adapt `public/index.html` (1,200 lines) and add browser code that is checked in the browser; all server and library code is given in full and was run green (147 tests) on a scratch copy of the phase 1 repository before this plan was written.
