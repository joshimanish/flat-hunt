const test = require("node:test");
const assert = require("node:assert/strict");
const { pdfOptions, pageScales, decodeSize, outward, L, MAX_SIDE, PIXEL_BUDGET } = require("../public/redact");

const A4 = { width: 595.28, height: 841.89 };
const A0 = { width: 2383.94, height: 3370.39 };
const pixels = (sizes, scales) => sizes.reduce((n, s, i) => n + Math.ceil(s.width * scales[i]) * Math.ceil(s.height * scales[i]), 0);

test("pdf.js runs without eval and without XFA", () => {
  const data = new Uint8Array([1, 2, 3]);
  const o = pdfOptions(data);
  assert.equal(o.isEvalSupported, false);
  assert.equal(o.enableXfa, false);
  assert.equal(o.data, data);
});

test("pageScales renders ordinary pages at scale 2", () => {
  assert.deepEqual(pageScales([A4, A4]), [2, 2]);
});

test("pageScales keeps the longest canvas side within 4096 pixels", () => {
  const [s] = pageScales([A0]);
  assert.ok(s < 2);
  assert.ok(Math.ceil(A0.height * s) <= MAX_SIDE);
  assert.ok(Math.ceil(A0.height * s) >= MAX_SIDE - 1);
});

test("pageScales reduces every page by the same factor when the pixel budget is exceeded", () => {
  const sizes = Array.from({ length: 20 }, (_, i) => (i % 2 ? A0 : A4));
  const unbounded = pageScales(sizes, { budget: Infinity });
  const scales = pageScales(sizes);
  assert.ok(pixels(sizes, unbounded) > PIXEL_BUDGET);
  assert.ok(pixels(sizes, scales) <= PIXEL_BUDGET);
  const k = scales[0] / unbounded[0];
  scales.forEach((s, i) => assert.ok(Math.abs(s / unbounded[i] - k) < 1e-9));
  assert.ok(pixels(sizes, scales) > PIXEL_BUDGET * 0.95, "does not shrink much more than needed");
});

test("pageScales honours custom limits", () => {
  const [s] = pageScales([{ width: 1000, height: 500 }], { maxScale: 3, maxSide: 1500, budget: Infinity });
  assert.ok(Math.ceil(1000 * s) <= 1500 && s > 1.49);
});

test("decodeSize shrinks only images longer than 4096 pixels, keeping the aspect ratio", () => {
  assert.equal(decodeSize(4000, 3000), null);
  assert.equal(decodeSize(4096, 4096), null);
  assert.deepEqual(decodeSize(8192, 6144), { resizeWidth: 4096, resizeHeight: 3072 });
  assert.deepEqual(decodeSize(3000, 12000), { resizeWidth: 1024, resizeHeight: 4096 });
  assert.deepEqual(decodeSize(100000, 10), { resizeWidth: 4096, resizeHeight: 1 });
});

test("outward rounds a box to whole pixels without shrinking it", () => {
  assert.deepEqual(outward({ x: 10.6, y: 20.2, w: 5.1, h: 3.3 }), { x: 10, y: 20, w: 6, h: 4 });
  assert.deepEqual(outward({ x: 1, y: 2, w: 3, h: 4 }), { x: 1, y: 2, w: 3, h: 4 });
});

test("redaction texts exist in en, de and pt with the same keys", () => {
  const keys = Object.keys(L.en).sort();
  for (const lang of ["de", "pt"]) assert.deepEqual(Object.keys(L[lang]).sort(), keys, lang);
  assert.ok(L.en.tooLarge && L.de.tooLarge && L.pt.tooLarge);
});
