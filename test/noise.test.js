const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../lib/noise");

const KOE = { lat: 51.2254, lon: 6.7787 }, MITTE = { lat: 52.52, lon: 13.405 };
const noWait = { delays: [], sleep: async () => {} };
const reply = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => typeof body === "string" ? body : JSON.stringify(body) });

test("featureInfoUrl asks for the centre pixel of a small lat,lon box (WMS 1.3.0)", () => {
  const u = new URL(N.featureInfoUrl("https://www.wms.nrw.de/umwelt/laerm_stufe4", "STR_DEN", 51.2254, 6.7787, "text/xml"));
  assert.equal(u.searchParams.get("REQUEST"), "GetFeatureInfo");
  assert.equal(u.searchParams.get("QUERY_LAYERS"), "STR_DEN");
  assert.equal(u.searchParams.get("CRS"), "EPSG:4326");
  assert.equal(u.searchParams.get("BBOX"), "51.224400,6.777700,51.226400,6.779700");
  assert.equal(u.searchParams.get("I"), "50");
  assert.equal(u.searchParams.get("J"), "50");
});

test("parseNrw reads the class lower bound from the pixel value", () => {
  assert.equal(N.parseNrw('<FeatureInfoResponse><FIELDS Classify.PixelValue="70111000" Classify.Classvalue="4"/></FeatureInfoResponse>'), 70);
  assert.equal(N.parseNrw('<FIELDS Classify.PixelValue="55000000" Classify.Classvalue="1"/>'), 55);
  assert.equal(N.parseNrw('<FIELDS Classify.PixelValue="NoData" Classify.Classvalue="NoData"/>'), null);
  assert.equal(N.parseNrw("<FeatureInfoResponse/>"), null);
});

test("parseBerlin reads the band from the first dB property", () => {
  assert.equal(N.parseBerlin({ features: [{ properties: { "Lärmindex L DEN (Tag/Abend/Nacht) in dB(A)": "ab 75 dB(A)" } }] }), 75);
  assert.equal(N.parseBerlin({ features: [{ properties: { id: 3, "L DEN": "> 55 - 59 dB(A)" } }] }), 55);
  assert.equal(N.parseBerlin({ features: [] }), null);
});

test("noiseAt in NRW asks all five layers in turn and reports the loudest source", async () => {
  const urls = [];
  const f = async url => { urls.push(url); return reply(url.includes("STR_DEN") ? '<FIELDS Classify.PixelValue="70111000"/>' : url.includes("SCS_DEN") ? '<FIELDS Classify.PixelValue="60000000"/>' : '<FIELDS Classify.PixelValue="NoData"/>'); };
  const r = await N.noiseAt(KOE, "05111", f, noWait);
  assert.equal(urls.length, 5);
  assert.deepEqual(r, { state: "NW", source: "nrw-noise", uncovered: [], lden: { road: 70, rail: null, tram: 60, air: null, industry: null }, max: 70, band: "70–74", dominant: "road" });
});

test("noiseAt in Berlin uses the Berlin layers; nothing mapped gives max null", async () => {
  const f = async url => reply({ features: url.includes("bb_strasse") ? [{ properties: { "L DEN": "ab 75 dB(A)" } }] : [] });
  const r = await N.noiseAt(MITTE, "11000", f, noWait);
  assert.equal(r.state, "BE");
  assert.equal(r.band, "75+");
  assert.equal(r.dominant, "road");
  const quiet = await N.noiseAt(MITTE, "11000", async () => reply({ features: [] }), noWait);
  assert.equal(quiet.max, null);
  assert.equal(quiet.band, null);
});

test("noiseAt has no adapter outside NRW and Berlin, and fails as a whole when one layer fails", async () => {
  assert.equal(await N.noiseAt({ lat: 48.137, lon: 11.575 }, "09162", async () => { throw new Error("must not be called"); }, noWait), null);
  assert.equal(N.adapterFor(undefined), null);
  let n = 0;
  const f = async () => { n++; if (n === 3) return { ok: false, status: 500, headers: { get: () => null } }; return reply("<FeatureInfoResponse/>"); };
  await assert.rejects(N.noiseAt(KOE, "05111", f, noWait), /HTTP 500/);
});

test("featureInfoUrl refuses coordinates outside Germany before building a URL", () => {
  assert.throws(() => N.featureInfoUrl("https://x.example", "L", 0, 0, "text/xml"), /bad coordinates/);
  assert.throws(() => N.featureInfoUrl("https://x.example", "L", "abc", 6, "text/xml"), /bad coordinates/);
});

test("parseNrw: only a recognised FeatureInfo answer can mean 'nothing mapped'", () => {
  assert.throws(() => N.parseNrw("<html><body>Bad gateway</body></html>"), /unrecognised answer/);
  assert.throws(() => N.parseNrw('<ServiceExceptionReport><ServiceException>x</ServiceException></ServiceExceptionReport>'), /unrecognised answer/);
  assert.throws(() => N.parseNrw(""), /unrecognised answer/);
  assert.equal(N.parseNrw('<FIELDS Classify.PixelValue="75111000"/>'), 75);
  assert.equal(N.parseNrw('<FIELDS Classify.PixelValue="40000000"/>'), null);
});

test("parseBerlin: empty features is null, unreadable features throw, forms and maxima are read", () => {
  assert.throws(() => N.parseBerlin({ features: [{ properties: { id: 7 } }] }), /unrecognised answer/);
  assert.throws(() => N.parseBerlin({ features: [{ properties: { x: "hello" } }] }), /unrecognised answer/);
  assert.throws(() => N.parseBerlin({}), /unrecognised answer/);
  assert.throws(() => N.parseBerlin(null), /unrecognised answer/);
  for (const [v, want] of [["75", 75], ["> 75", 75], ["75 dB(A)", 75], ["55 - 59", 55], ["55–59", 55], ["55 bis 59", 55], ["ab 75 dB(A)", 75]])
    assert.equal(N.parseBerlin({ features: [{ properties: { L: v } }] }), want, v);
  assert.equal(N.parseBerlin({ features: [{ properties: { a: "55 - 59", b: "65 - 69" } }, { properties: { a: "60 - 64" } }] }), 65);
  assert.equal(N.parseBerlin({ features: [{ properties: { a: "30 - 34 dB(A)", b: "60 - 64" } }] }), 60);
});

test("noise bands: 75+ and lower classes", () => {
  assert.equal(N.band(75), "75+");
  assert.equal(N.band(80), "75+");
  assert.equal(N.band(55), "55–59");
  assert.equal(N.band(null), null);
});

test("noiseAt retries a 503 once, and an unrecognised answer fails the figure without retry", async () => {
  let n = 0;
  const f = async () => { n++; return n === 1 ? { ok: false, status: 503, headers: { get: () => null } } : reply('<FIELDS Classify.PixelValue="NoData"/>'); };
  const r = await N.noiseAt(KOE, "05111", f, { delays: [1], sleep: async () => {} });
  assert.equal(r.max, null);
  assert.equal(n, 6);
  let m = 0;
  await assert.rejects(N.noiseAt(KOE, "05111", async () => { m++; return reply("<html>oops</html>"); }, { delays: [1], sleep: async () => {} }), /unrecognised answer/);
  assert.equal(m, 1);
  await assert.rejects(N.noiseAt(MITTE, "11000", async () => reply("<html>oops</html>"), noWait));
});

test("noiseAt: on a tie the first layer in order is dominant; adapters are frozen", async () => {
  const r = await N.noiseAt(KOE, "05111", async () => reply('<FIELDS Classify.PixelValue="65000000"/>'), noWait);
  assert.equal(r.max, 65);
  assert.equal(r.dominant, "road");
  assert.ok(Object.isFrozen(N.ADAPTERS));
  const hi = await N.noiseAt(KOE, "05111", async () => reply('<FIELDS Classify.PixelValue="78000000"/>'), noWait);
  assert.equal(hi.band, "75+");
});

test("parseBerlin: the live lowest class \"bis 55 dB(A)\" is readable and gives no band; \"ab 64 - 69\" is read as published", () => {
  const f = v => ({ features: [{ properties: { "Lärmindex L DEN (Tag/Abend/Nacht) in dB(A)": v } }] });
  assert.equal(N.parseBerlin(f("bis 55 dB(A)")), null);
  assert.equal(N.parseBerlin(f("ab 64 - 69 dB(A)")), 64);
  assert.equal(N.parseBerlin({ features: [f("bis 55 dB(A)").features[0], f("ab 75 dB(A)").features[0]] }), 75);
});

test("Berlin does not cover federal railways; the figure carries that, NRW covers all kinds", async () => {
  const be = await N.noiseAt(MITTE, "11000", async () => reply({ features: [] }), noWait);
  assert.deepEqual(be.uncovered, ["rail"]);
  assert.ok(!be.lden || !("rail" in be.lden), "no rail layer is asked in Berlin");
  const nw = await N.noiseAt(KOE, "05111", async () => reply('<FIELDS Classify.PixelValue="NoData"/>'), noWait);
  assert.deepEqual(nw.uncovered, []);
});
