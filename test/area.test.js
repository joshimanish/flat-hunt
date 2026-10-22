const test = require("node:test");
const assert = require("node:assert/strict");
const { computeArea } = require("../lib/area");
const { createAreaQueue, needsArea } = require("../lib/area-job");
const { createSpacer } = require("../lib/area-http");
const { areaFetch, CRIME_TABLE, rentGrid } = require("./area-fixtures");

const KOE = { lat: 51.2254, lon: 6.7787 };
const NOW = new Date("2026-10-21T09:00:00Z");
const deps = (f, extra = {}) => ({ fetchImpl: f, now: () => NOW, crimeTable: CRIME_TABLE, rentGrid: rentGrid(), overpass: createSpacer(0), delays: [], overpassDelays: [], sleep: async () => {}, ...extra });

test("computeArea in Düsseldorf: every figure with status, source, level and fetch time", async () => {
  const a = await computeArea(KOE, deps(areaFetch({ flood: ["low"] })));
  assert.equal(a.computedAt, NOW.toISOString());
  assert.deepEqual([a.lat, a.lon], [KOE.lat, KOE.lon]);
  for (const k of ["kreis", "flood", "noise", "crime", "rent", "amenities"]) {
    assert.equal(a[k].status, "ok", k);
    assert.equal(a[k].fetchedAt, NOW.toISOString(), k);
    assert.ok(a[k].source && a[k].level, k);
  }
  assert.equal(a.kreis.ags, "05111");
  assert.deepEqual([a.flood.worst, a.flood.zones, a.flood.source, a.flood.level], ["low", ["low"], "bfg-nz", "point"]);
  assert.deepEqual([a.noise.source, a.noise.max, a.noise.band, a.noise.dominant, a.noise.dataYear], ["nrw-noise", 70, "70–74", "road", 2022]);
  assert.deepEqual([a.crime.source, a.crime.level, a.crime.year, a.crime.ratio.total], ["bka-pks", "kreis", 2025, 2]);
  assert.deepEqual([a.rent.source, a.rent.level, a.rent.eurPerSqm, a.rent.refDate], ["zensus-rent", "cell-1km", 11.15, "2022-05-15"]);
  assert.equal(a.amenities.routing, "osm-foot");
  assert.equal(a.amenities.items.supermarket.minutes, 4);
  assert.equal(a.amenities.items.doctors, null);
});

test("an empty flood answer is no-data, not 'no risk'; no noise adapter and an unknown Kreis are no-data", async () => {
  const a = await computeArea({ lat: 48.137, lon: 11.575 }, deps(areaFetch({ kreis: "09162" })));
  assert.equal(a.flood.status, "no-data");
  assert.equal(a.flood.zones, undefined);
  assert.equal(a.noise.status, "no-data");
  assert.equal(a.crime.status, "no-data", "München is not in the test table");
  assert.equal(a.rent.status, "no-data", "outside the test grid");
  const abroad = await computeArea({ lat: 47.0, lon: 8.0 }, deps(areaFetch({ kreis: null })));
  assert.equal(abroad.kreis.status, "no-data");
  assert.equal(abroad.crime.status, "no-data");
  assert.equal(abroad.noise.status, "no-data");
});

test("failed sources are errors with a short reason; the others still compute", async () => {
  const f = areaFetch({ fail: new Set(["sgx.geodatenzentrum.de", "overpass-api.de"]) });
  const a = await computeArea(KOE, deps(f, { crimeTable: null, rentGrid: null }));
  assert.deepEqual([a.kreis.status, a.kreis.error], ["error", "HTTP 503"]);
  assert.deepEqual([a.noise.status, a.noise.error], ["error", "Kreis unknown"]);
  assert.deepEqual([a.crime.status, a.crime.error], ["error", "Kreis unknown"]);
  assert.deepEqual([a.rent.status, a.rent.error], ["error", "rent grid missing"]);
  assert.deepEqual([a.amenities.status, a.amenities.error], ["error", "HTTP 503"]);
  assert.equal(a.flood.status, "no-data");
});

test("the queue runs one listing at a time, applies results only to unchanged coordinates and dedupes", async () => {
  const state = { listings: { a: { lat: 1, lon: 1 }, b: { lat: 2, lon: 2 }, c: { title: "no coordinates" } } };
  let active = 0, maxActive = 0, persisted = 0;
  const seen = [];
  const compute = async (point, { force }) => {
    active++; maxActive = Math.max(maxActive, active); seen.push([point.lat, force]);
    await new Promise(r => setTimeout(r, 5));
    if (point.lat === 2) state.listings.b.lat = 3; // moved while computing
    active--;
    return { lat: point.lat, lon: point.lon, computedAt: "x" };
  };
  const q = createAreaQueue({ state, persist: async () => { persisted++; }, compute });
  q.enqueue("a"); q.enqueue("b"); q.enqueue("a", { force: true }); q.enqueue("c");
  assert.deepEqual(q.status().queued, ["a", "b", "c"]);
  await q.idle();
  assert.equal(maxActive, 1);
  assert.deepEqual(seen, [[1, true], [2, false]]);
  assert.equal(state.listings.a.area.lat, 1);
  assert.equal(state.listings.b.area, undefined, "b moved: result dropped");
  assert.equal(persisted, 1);
  assert.deepEqual(q.status(), { queued: [], running: null });
  assert.equal(needsArea(state.listings.a), false);
  assert.equal(needsArea(state.listings.b), true);
  assert.equal(needsArea(state.listings.c), false);
});

test("a failed save rolls the area back", async () => {
  const state = { listings: { a: { lat: 1, lon: 1, area: { lat: 1, lon: 1, computedAt: "old" } } } };
  const q = createAreaQueue({ state, persist: async () => { throw new Error("disk full"); }, compute: async p => ({ lat: p.lat, lon: p.lon, computedAt: "new" }) });
  q.enqueue("a"); await q.idle();
  assert.equal(state.listings.a.area.computedAt, "old");
});

test("cached amenities carry the cache entry's time as fetchedAt, fresh ones the current time", async () => {
  const os = require("node:os"), path = require("node:path"), fs = require("node:fs");
  const { createAreaCache } = require("../lib/area-cache");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "area-cache-"));
  const t0 = new Date("2026-10-01T08:00:00Z");
  const cache = createAreaCache(path.join(dir, "c.json"), { now: () => t0 });
  const first = await computeArea(KOE, deps(areaFetch(), { cache, now: () => t0 }));
  assert.equal(first.amenities.cached, false);
  assert.equal(first.amenities.fetchedAt, t0.toISOString());
  const second = await computeArea(KOE, deps(areaFetch(), { cache, now: () => NOW }));
  assert.equal(second.amenities.cached, true);
  assert.equal(second.amenities.fetchedAt, t0.toISOString());
  assert.equal(second.flood.fetchedAt, NOW.toISOString());
  const forced = await computeArea(KOE, deps(areaFetch(), { cache, now: () => NOW, force: true }));
  assert.equal(forced.amenities.fetchedAt, NOW.toISOString());
});

test("the Berlin noise figure carries the uncovered kinds through", async () => {
  const f = async (url, init) => /gdi\.berlin\.de/.test(url) ? { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"features":[]}' }
    : areaFetch({ kreis: "11000" })(url, init);
  const KB = require("../lib/kreis");
  const wrap = async (url, init) => /sgx/.test(url) ? { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ features: [{ properties: { ags: "11000", gen: "Berlin", bez: "Kreisfreie Stadt" } }] }) } : f(url, init);
  void KB;
  const a = await computeArea({ lat: 52.52, lon: 13.405 }, deps(wrap));
  assert.equal(a.noise.status, "ok");
  assert.deepEqual(a.noise.uncovered, ["rail"]);
});

test("queue: a pause between listings applies to slow sources only; a crashing compute does not kill the loop; forced is cleared for coordinate-less listings", async () => {
  const state = { listings: { a: { lat: 1, lon: 1 }, b: { lat: 2, lon: 2 }, n: { title: "x" } } };
  const sleeps = [];
  const q = createAreaQueue({ state, persist: async () => {}, compute: async p => ({ lat: p.lat, lon: p.lon, computedAt: "x" }), gapMs: 1500, sleep: async ms => { sleeps.push(ms); } });
  q.enqueue("a"); q.enqueue("b"); await q.idle();
  assert.deepEqual(sleeps, [1500], "one gap between two listings, none after the last");
  const quick = createAreaQueue({ state, persist: async () => {}, compute: async p => ({ lat: p.lat, lon: p.lon }), sleep: async () => { throw new Error("no gap expected"); } });
  quick.enqueue("a"); quick.enqueue("b"); await quick.idle();

  const seen = [];
  const crash = createAreaQueue({ state, persist: async () => { throw new Error("boom"); }, compute: async (p, o) => { seen.push(o.force); return { lat: p.lat, lon: p.lon }; } });
  crash.enqueue("n", { force: true }); await crash.idle();
  Object.assign(state.listings.n, { lat: 3, lon: 3 });
  crash.enqueue("n"); await crash.idle();
  assert.deepEqual(seen, [false], "n's forced flag did not leak to its next run");
});

test("queue: an unexpected error in the loop resets it so later enqueues still run", async () => {
  const state = { listings: { a: { lat: 1, lon: 1 } } };
  let n = 0;
  const q = createAreaQueue({ state, persist: async () => {}, compute: async p => ({ lat: p.lat, lon: p.lon }), sleep: async () => {} });
  Object.defineProperty(state.listings, "z", { get() { if (n++ === 0) throw new Error("getter failed"); return undefined; }, enumerable: true, configurable: true });
  q.enqueue("z"); await q.idle();
  q.enqueue("a"); await q.idle();
  assert.equal(state.listings.a.area.lat, 1);
});
