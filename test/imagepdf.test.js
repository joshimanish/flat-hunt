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
