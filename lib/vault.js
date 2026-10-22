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
// `role` binds the ciphertext to its purpose (AAD), so one vault file cannot be swapped for another.
function encrypt(key, plain, role) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  if (role !== undefined) c.setAAD(Buffer.from(role));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

// Throws when the key is wrong or the data was changed.
function decrypt(key, blob, role) {
  if (!Buffer.isBuffer(blob) || blob.length < 28) throw new Error("vault blob too short");
  const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  if (role !== undefined) d.setAAD(Buffer.from(role));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

const encryptJson = (key, value, role) => encrypt(key, Buffer.from(JSON.stringify(value), "utf8"), role);
const decryptJson = (key, blob, role) => JSON.parse(decrypt(key, blob, role).toString("utf8"));

const vaultDir = dataDir => path.join(dataDir, "vault");
// Only files the vault itself writes count; dotfiles (.DS_Store) and temp files are ignored.
const KNOWN = f => f === INDEX || f === APPLICANT || f.endsWith(".bin");
const vaultFiles = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(KNOWN) : [];
const ID_FORMAT = /^[0-9a-f]{16}$/;

// "empty" (nothing stored yet), "ok" (key opens the vault), "missing-key", "wrong-key" or "unreadable" (I/O error). Never writes.
function vaultStatus(dataDir, key) {
  const dir = vaultDir(dataDir);
  let files;
  try { files = vaultFiles(dir); } catch (e) { return "unreadable"; }
  if (!files.length) return "empty";
  if (!key) return "missing-key";
  if (!files.includes(KEYCHECK)) return "wrong-key"; // data without a key check cannot be verified
  let blob;
  try { blob = fs.readFileSync(path.join(dir, KEYCHECK)); } catch (e) { return "unreadable"; }
  try { return decrypt(key, blob, "keycheck").toString("utf8") === CHECK_TEXT ? "ok" : "wrong-key"; }
  catch (e) { return "wrong-key"; }
}

// Opens (and on first use creates) the vault. Throws unless vaultStatus is "empty" or "ok".
function openVault(dataDir, key) {
  const status = vaultStatus(dataDir, key);
  if (status !== "empty" && status !== "ok") throw new Error("vault: " + status);
  const dir = vaultDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  if (status === "empty") {
    const tmp = path.join(dir, KEYCHECK + "." + process.pid + ".tmp");
    fs.writeFileSync(tmp, encrypt(key, Buffer.from(CHECK_TEXT, "utf8"), "keycheck"));
    fs.renameSync(tmp, path.join(dir, KEYCHECK));
  }
  const readBlob = (name, role, fallback) => { const f = path.join(dir, name); return fs.existsSync(f) ? decryptJson(key, fs.readFileSync(f), role) : fallback; };
  const docFile = name => {
    if (typeof name !== "string" || !ID_FORMAT.test(name)) throw new Error("vault: bad document name");
    return path.join(dir, name + ".bin");
  };
  let writing = Promise.resolve();
  const queue = fn => (writing = writing.catch(() => {}).then(fn));
  const vault = {
    index: readBlob(INDEX, "index", { docs: {} }),
    applicant: readBlob(APPLICANT, "applicant", null),
    saveIndex: () => queue(() => writeFileAtomic(path.join(dir, INDEX), encryptJson(key, vault.index, "index"))),
    saveApplicant: value => queue(() => writeFileAtomic(path.join(dir, APPLICANT), encryptJson(key, value, "applicant"))),
    // Documents live in <name>.bin; the index maps document ids to file names, so a replacement is a new file.
    writeDoc: (name, buf) => writeFileAtomic(docFile(name), encrypt(key, buf, "doc:" + name)),
    readDoc: async name => decrypt(key, await fs.promises.readFile(docFile(name)), "doc:" + name),
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
