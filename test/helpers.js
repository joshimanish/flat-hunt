const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server");

async function start(options = {}) {
  const dir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-test-"));
  // areaAuto off by default: tests that add listings must not start background area lookups unless they ask for them.
  const app = createApp({ dataDir: dir, password: "pw", syncKey: "key", vaultKey: "", areaAuto: false, ...options });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: "Basic " + Buffer.from("u:pw").toString("base64") };
  const sync = { ...auth, "x-sync-key": "key", "Content-Type": "application/json" };
  return { app, base, auth, sync, dir, close: () => new Promise(r => server.close(r)) };
}

// Test-only vault keys (bytes 0..31 and 31..0), never used outside tests.
const TEST_VAULT_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const OTHER_VAULT_KEY = "Hx4dHBsaGRgXFhUUExIREA8ODQwLCgkIBwYFBAMCAQA=";

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

// The X-Doc-Meta header value for an upload: "type=id&label=x" or an object, as base64url JSON.
const docMeta = m => Buffer.from(JSON.stringify(typeof m === "string" ? Object.fromEntries(new URLSearchParams(m)) : m)).toString("base64url");

module.exports = { docMeta, start, TEST_VAULT_KEY, OTHER_VAULT_KEY, TINY_PNG, TINY_JPEG, pdfPageStreams, hasPdfText };
