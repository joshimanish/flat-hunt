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

test("document names must be vault ids; anything else throws and writes nothing", async () => {
  const dir = tmp(), v = V.openVault(dir, V.parseVaultKey(KEY));
  for (const bad of ["../escape", "abc", "0123456789abcdeg", "", "0123456789abcdef/../x", undefined]) {
    await assert.rejects(async () => v.writeDoc(bad, Buffer.from("x")), /bad document name/, String(bad));
  }
  assert.ok(!fs.existsSync(path.join(dir, "escape.bin")));
  assert.deepEqual(fs.readdirSync(path.join(dir, "vault")), ["keycheck.bin"]);
});

test("each file is bound to its role: swapped files do not decrypt", async () => {
  const dir = tmp(), key = V.parseVaultKey(KEY), v = V.openVault(dir, key);
  await v.saveIndex(); await v.saveApplicant({ name: "Alex Example" });
  const a = path.join(dir, "vault", "applicant.json"), i = path.join(dir, "vault", "index.json"), t = a + ".swap";
  fs.renameSync(a, t); fs.renameSync(i, a); fs.renameSync(t, i);
  assert.throws(() => V.openVault(dir, key));
  const id = "0123456789abcdef", other = "fedcba9876543210";
  await v.writeDoc(id, Buffer.from("%PDF-1.4 x"));
  fs.copyFileSync(path.join(dir, "vault", id + ".bin"), path.join(dir, "vault", other + ".bin"));
  await assert.rejects(v.readDoc(other));
});

test("vaultStatus ignores dotfiles and temp files", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "vault"));
  fs.writeFileSync(path.join(dir, "vault", ".DS_Store"), "x");
  fs.writeFileSync(path.join(dir, "vault", "keycheck.bin.1.tmp"), "x");
  assert.equal(V.vaultStatus(dir, null), "empty");
  assert.ok(V.openVault(dir, V.parseVaultKey(KEY)));
  assert.equal(V.vaultStatus(dir, V.parseVaultKey(KEY)), "ok");
});

test("an unreadable key check is 'unreadable', not 'wrong-key'", { skip: process.getuid && process.getuid() === 0 }, () => {
  const dir = tmp(), key = V.parseVaultKey(KEY);
  V.openVault(dir, key);
  const f = path.join(dir, "vault", "keycheck.bin");
  fs.chmodSync(f, 0);
  try { assert.equal(V.vaultStatus(dir, key), "unreadable"); } finally { fs.chmodSync(f, 0o600); }
});
