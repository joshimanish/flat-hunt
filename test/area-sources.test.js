const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { kreisUrl, parseKreis, lookupKreis } = require("../lib/kreis");
const { crimeFor } = require("../lib/crime");
const { toLaea, createRentGrid, loadRentGrid } = require("../lib/rent-grid");
const { floodUrl, parseFlood, floodAt } = require("../lib/flood");

const KOE = { lat: 51.2254, lon: 6.7787 };
const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const recorder = body => { const urls = []; const f = async url => { urls.push(url); return ok(body); }; f.urls = urls; return f; };
const noWait = { delays: [], sleep: async () => {} };

test("kreisUrl asks the VG250 WFS for the Kreis polygon under the point", () => {
  const u = new URL(kreisUrl(51.2254, 6.7787));
  assert.equal(u.origin + u.pathname, "https://sgx.geodatenzentrum.de/wfs_vg250");
  assert.equal(u.searchParams.get("TYPENAMES"), "vg250:vg250_krs");
  assert.equal(u.searchParams.get("OUTPUTFORMAT"), "application/json");
  assert.match(u.searchParams.get("FILTER"), /<fes:Intersects>.*<gml:pos>51\.2254 6\.7787<\/gml:pos>/);
  assert.ok(!kreisUrl(51.2254, 6.7787).includes("+"), "spaces are %20");
});

test("parseKreis and lookupKreis read ags, name and type", async () => {
  const body = { type: "FeatureCollection", features: [{ properties: { ags: "05111", gen: "Düsseldorf", bez: "Kreisfreie Stadt" } }] };
  assert.deepEqual(parseKreis(body), { ags: "05111", name: "Düsseldorf", type: "Kreisfreie Stadt" });
  assert.equal(parseKreis({ features: [] }), null);
  assert.equal(parseKreis({ features: [{ properties: { ags: "DE" } }] }), null);
  const f = recorder(body);
  assert.equal((await lookupKreis(KOE, f, noWait)).ags, "05111");
  assert.equal(f.urls.length, 1);
});

const TABLE = { year: 2025, columns: ["name", "kind", "total", "violent", "street", "burglary"], national: { total: 6485, violent: 250, street: 1500, burglary: 95 },
  kreise: { "05111": ["Düsseldorf", "Kreisfreie Stadt", 12999, 499, 3106, 249], "99999": ["Example-Land", "Landkreis", 3243, null, 750, 48] } };

test("crimeFor compares the Kreis rates with the national rates", () => {
  const c = crimeFor({ ags: "05111", name: "Düsseldorf" }, TABLE);
  assert.equal(c.kreis, "Düsseldorf");
  assert.equal(c.year, 2025);
  assert.deepEqual(c.hz, { total: 12999, violent: 499, street: 3106, burglary: 249 });
  assert.equal(c.ratio.total, 2);
  assert.equal(c.ratio.burglary, 2.62);
  assert.equal(crimeFor({ ags: "99999" }, TABLE).ratio.violent, null);
  assert.equal(crimeFor({ ags: "01001" }, TABLE), null);
  assert.throws(() => crimeFor({ ags: "05111" }, null), /crime table missing/);
});

test("toLaea matches the EPSG guidance example and the projection origin", () => {
  const p = toLaea(50, 5);
  assert.ok(Math.abs(p.x - 3962799.45) < 0.01 && Math.abs(p.y - 2999718.85) < 0.01, JSON.stringify(p));
  const o = toLaea(52, 10);
  assert.ok(Math.abs(o.x - 4321000) < 1e-6 && Math.abs(o.y - 3210000) < 1e-6);
});

test("the rent grid returns the cell value in euros, null for empty or outside cells", () => {
  const { x, y } = toLaea(KOE.lat, KOE.lon), cx = Math.floor(x / 1000), cy = Math.floor(y / 1000);
  const meta = { x0: cx - 1, y0: cy - 1, width: 3, height: 3 };
  const data = Buffer.alloc(18); data.writeUInt16LE(1115, (1 * 3 + 1) * 2);
  const g = createRentGrid(meta, data);
  assert.deepEqual(g.at(KOE.lat, KOE.lon), { cell: `CRS3035RES1000mN${cy * 1000}E${cx * 1000}`, eurPerSqm: 11.15 });
  assert.equal(g.at(KOE.lat + 0.012, KOE.lon), null, "the cell to the north is empty");
  assert.equal(g.at(52.52, 13.405), null, "outside the grid");
  assert.throws(() => createRentGrid(meta, Buffer.alloc(4)), /size/);
  assert.equal(loadRentGrid("/nonexistent/zensus.json"), null);
});

test("floodUrl identifies on the NZ hazard layer at the point", () => {
  const u = new URL(floodUrl(51.233, 6.765));
  assert.equal(u.origin + u.pathname, "https://geoportal.bafg.de/arcgis1/rest/services/INSPIRE/NZ/MapServer/identify");
  assert.equal(u.searchParams.get("geometry"), "6.765,51.233");
  assert.equal(u.searchParams.get("layers"), "all:1");
  assert.equal(u.searchParams.get("f"), "json");
});

test("parseFlood lists the scenarios the point lies in, worst first; an empty answer lists none", async () => {
  const hit = l => ({ layerName: "NZ.HazardArea", attributes: { LikelihoodOfOccurrence: l, NaturalHazardCategory: "flood", SpecificHazardType: "fluvial" } });
  assert.deepEqual(parseFlood({ results: [hit("low/extrem"), hit("high"), hit("medium")] }).zones, ["high", "medium", "low"]);
  assert.deepEqual(parseFlood({ results: [hit("low/extrem")] }).zones, ["low"]);
  assert.deepEqual(parseFlood({ results: [] }).zones, []);
  assert.deepEqual(parseFlood({ results: [{ attributes: { LikelihoodOfOccurrence: "high", NaturalHazardCategory: "earthquake" } }] }).zones, []);
  assert.throws(() => parseFlood({ error: { code: 500 } }), /unexpected/);
  assert.deepEqual((await floodAt(KOE, recorder({ results: [hit("medium")] }), noWait)).zones, ["medium"]);
});

const status = (code, headers = {}) => ({ ok: false, status: code, headers: { get: k => headers[k] ?? null }, text: async () => "" });
const seq = (...rs) => { let i = 0; const f = async () => { const r = rs[Math.min(i++, rs.length - 1)]; return typeof r === "function" ? r() : r; }; f.calls = () => i; return f; };
const raw = text => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => text });
const KBODY = { features: [{ properties: { ags: "05111", gen: "Düsseldorf", bez: "Kreisfreie Stadt" } }] };

test("lookupKreis retries a 503, rejects garbage, returns null for an empty answer", async () => {
  const f = seq(status(503), ok(KBODY));
  assert.equal((await lookupKreis(KOE, f, { delays: [1], sleep: async () => {} })).ags, "05111");
  assert.equal(f.calls(), 2);
  await assert.rejects(lookupKreis(KOE, seq(raw("<html>nope")), noWait));
  assert.equal(await lookupKreis(KOE, seq(ok({ features: [] })), noWait), null);
});

test("floodAt retries a 502, rejects garbage and ArcGIS error objects", async () => {
  const hit = { results: [{ attributes: { LikelihoodOfOccurrence: "high", NaturalHazardCategory: "flood" } }] };
  const f = seq(status(502), ok(hit));
  assert.deepEqual((await floodAt(KOE, f, { delays: [1], sleep: async () => {} })).zones, ["high"]);
  assert.equal(f.calls(), 2);
  await assert.rejects(floodAt(KOE, seq(raw("not json")), noWait));
  await assert.rejects(floodAt(KOE, seq(ok({ error: { code: 500 } })), noWait), /unexpected/);
});

test("bad coordinates are refused before any URL, filter or grid lookup", async () => {
  for (const [la, lo] of [["1</gml:pos><x/>", "2"], [NaN, 6], [51, Infinity], [10, 6], [51, 30], [null, null], [undefined, 6]]) {
    assert.throws(() => kreisUrl(la, lo), /bad coordinates/);
    assert.throws(() => floodUrl(la, lo), /bad coordinates/);
  }
  const f = recorder(KBODY);
  await assert.rejects(lookupKreis({ lat: NaN, lon: 6 }, f, noWait), /bad coordinates/);
  assert.equal(f.urls.length, 0);
  const g = createRentGrid({ x0: 0, y0: 0, width: 1, height: 1 }, Buffer.alloc(2));
  assert.equal(g.at(NaN, 6), null);
  assert.equal(g.at(undefined, undefined), null);
});

test("an unclassified flood result counts as zone unknown, not as no data", () => {
  const r = a => ({ attributes: { NaturalHazardCategory: "flood", ...a } });
  assert.deepEqual(parseFlood({ results: [r({})] }).zones, ["unknown"]);
  assert.deepEqual(parseFlood({ results: [r({ LikelihoodOfOccurrence: "weird" }), r({ LikelihoodOfOccurrence: "medium" })] }).zones, ["medium", "unknown"]);
});

test("the crime table and rent grid are loaded once per process", () => {
  const crime = require("../lib/crime"), rent = require("../lib/rent-grid");
  crime.reload(); rent.reload();
  assert.equal(crime.loadCrimeTable(), crime.loadCrimeTable());
  assert.equal(rent.loadRentGrid(), rent.loadRentGrid());
});

test("every area source has a dataset link and a licence link, both https", () => {
  const S = require("../public/area-sources");
  for (const id of S.ORDER) {
    const s = S.SOURCES[id];
    assert.match(s.url, /^https:\/\//, id + " url");
    assert.match(s.licenceUrl, /^https:\/\//, id + " licenceUrl");
    assert.notEqual(s.url, s.licenceUrl, id);
  }
  assert.doesNotMatch(S.SOURCES["bfg-nz"].licence, /equivalent/);
});
