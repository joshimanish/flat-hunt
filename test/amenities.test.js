const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const A = require("../lib/amenities");
const { createAreaCache } = require("../lib/area-cache");
const { createSpacer } = require("../lib/area-http");

const P = { lat: 51.2254, lon: 6.7787 };
const reply = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
const noWait = { delays: [], overpassDelays: [], sleep: async () => {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-area-"));

// Düsseldorf-like sample: a platform served by two route relations, one without relations but with route_ref, shops, a park (way with center).
const OVERPASS = { elements: [
  { type: "node", id: 1, lat: 51.2292, lon: 6.7772, tags: { public_transport: "platform", highway: "bus_stop", name: "Heinrich-Heine-Allee" } },
  { type: "way", id: 2, center: { lat: 51.2262, lon: 6.7790 }, tags: { public_transport: "platform", name: "Steinstraße", route_ref: "780 782" } },
  { type: "node", id: 3, lat: 51.2259, lon: 6.7795, tags: { shop: "supermarket", name: "Example Markt" } },
  { type: "node", id: 4, lat: 51.2300, lon: 6.7800, tags: { shop: "supermarket", name: "Far Markt" } },
  { type: "node", id: 5, lat: 51.2250, lon: 6.7780, tags: { amenity: "pharmacy", name: "Example Apotheke" } },
  { type: "way", id: 6, center: { lat: 51.2240, lon: 6.7760 }, tags: { leisure: "park", name: "Hofgarten" } },
  { type: "node", id: 7, lat: 51.2255, lon: 6.7788, tags: { amenity: "bench" } },
  { type: "relation", id: 10, members: [{ type: "node", ref: 1, role: "platform" }], tags: { type: "route", route: "tram", ref: "U79" } },
  { type: "relation", id: 11, members: [{ type: "node", ref: 1, role: "platform" }, { type: "node", ref: 99 }], tags: { type: "route", route: "bus", ref: "721" } }
] };

test("overpassQuery asks for the categories within 1 km, stops within 500 m and their route relations", () => {
  const q = A.overpassQuery(51.2254, 6.7787);
  assert.match(q, /^\[out:json\]\[timeout:25\];/);
  assert.match(q, /nwr\(around:1000,51\.2254,6\.7787\)\[shop=supermarket\]/);
  assert.match(q, /nwr\(around:500,51\.2254,6\.7787\)\[public_transport=platform\]/);
  assert.match(q, /rel\(bn\.p\)\[type=route\];rel\(bw\.p\)\[type=route\]/);
});

test("parseOverpass classifies places, attaches lines to stops and sorts by distance", () => {
  const pois = A.parseOverpass(OVERPASS, P);
  assert.deepEqual(pois.map(p => p.id), ["node/5", "node/3", "way/2", "way/6", "node/1", "node/4"], "the bench is dropped");
  const stop = pois.find(p => p.id === "node/1");
  assert.deepEqual(stop.lines, [{ ref: "721", mode: "bus" }, { ref: "U79", mode: "tram" }]);
  assert.deepEqual(pois.find(p => p.id === "way/2").lines, [{ ref: "780", mode: "" }, { ref: "782", mode: "" }]);
  assert.throws(() => A.parseOverpass({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 3 after 26 seconds." }, P), /HTTP 504/);
  assert.throws(() => A.parseOverpass({}, P), /unexpected/);
});

test("summarise picks the fewest walking minutes per category and falls back to an estimate", () => {
  const pois = A.parseOverpass(OVERPASS, P), cands = A.candidates(pois);
  const walk = { durations: cands.map(p => p.id === "node/1" ? 120 : p.id === "way/2" ? 400 : p.meters * 0.9), distances: cands.map(p => p.meters * 1.2) };
  const items = A.summarise(cands, walk);
  assert.equal(items.transit.name, "Heinrich-Heine-Allee");
  assert.equal(items.transit.minutes, 2);
  assert.equal(items.transit.estimated, false);
  assert.deepEqual(items.transit.lines.map(l => l.ref), ["721", "U79"]);
  assert.equal(items.doctors, null);
  const est = A.summarise(cands, null);
  assert.equal(est.supermarket.estimated, true);
  assert.equal(est.supermarket.minutes, Math.max(1, Math.round(pois.find(p => p.id === "node/3").meters * 1.3 / 80)));
});

test("amenitiesAt posts one Overpass query, asks the foot table once, and caches by rounded position", async () => {
  const calls = [];
  const f = async (url, opts) => {
    calls.push({ url, opts });
    if (url.startsWith("https://overpass-api.de/")) return reply(OVERPASS);
    const n = url.split("?")[0].split(";").length - 1;
    return reply({ code: "Ok", durations: [[0, ...Array(n).fill(300)]], distances: [[0, ...Array(n).fill(400)]] });
  };
  const cache = createAreaCache(path.join(tmp(), "area-cache.json"));
  const deps = { fetchImpl: f, cache, overpass: createSpacer(0), ...noWait };
  const r = await A.amenitiesAt(P, deps);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.match(decodeURIComponent(calls[0].opts.body), /^data=\[out:json\]/);
  assert.match(calls[1].url, /^https:\/\/routing\.openstreetmap\.de\/routed-foot\/table\/v1\/driving\/6\.778700,51\.225400;/);
  assert.equal(r.routed, true);
  assert.equal(r.cached, false);
  assert.equal(r.items.supermarket.minutes, 5);
  // A point ~25 m away (same rounded key) reuses the cached places; only the foot table is asked again.
  const again = await A.amenitiesAt({ lat: 51.2252, lon: 6.7791 }, deps);
  assert.equal(again.cached, true);
  assert.equal(calls.filter(c => c.url.includes("overpass")).length, 1);
  // force skips the cache
  await A.amenitiesAt(P, { ...deps, force: true });
  assert.equal(calls.filter(c => c.url.includes("overpass")).length, 2);
});

test("amenitiesAt retries an overloaded Overpass and estimates when the foot router fails", async () => {
  let n = 0;
  const waits = [];
  const f = async url => {
    if (url.includes("overpass")) { n++; return n === 1 ? reply({}, 502) : reply(OVERPASS); }
    return reply({}, 500);
  };
  const r = await A.amenitiesAt(P, { fetchImpl: f, overpass: createSpacer(0), delays: [], overpassDelays: [30000], sleep: async ms => { waits.push(ms); } });
  assert.equal(n, 2);
  assert.deepEqual(waits, [30000]);
  assert.equal(r.routed, false);
  assert.equal(r.items.pharmacy.estimated, true);
  await assert.rejects(A.amenitiesAt(P, { fetchImpl: async () => reply({}, 504), overpass: createSpacer(0), ...noWait }), /HTTP 504/);
});

test("the area cache expires entries, keeps the newest and survives a broken file", async () => {
  const dir = tmp(), file = path.join(dir, "area-cache.json");
  let t = new Date("2026-10-21T00:00:00Z");
  const c = createAreaCache(file, { now: () => t, max: 2 });
  await c.set(51.2254, 6.7787, [1]);
  assert.deepEqual(c.get(51.22541, 6.77871).value, [1]);
  t = new Date("2026-11-21T00:00:00Z");
  assert.equal(c.get(51.2254, 6.7787), null, "older than 30 days");
  await c.set(52.52, 13.405, [2]); t = new Date("2026-11-22T00:00:00Z"); await c.set(48.137, 11.575, [3]);
  assert.equal(c.size(), 2);
  assert.deepEqual(createAreaCache(file, { now: () => t }).get(48.137, 11.575).value, [3]);
  fs.writeFileSync(file, "{broken");
  assert.equal(createAreaCache(file).size(), 0);
});

test("bad coordinates and a bad OVERPASS_URL are refused before any request", async () => {
  let called = 0;
  const f = async () => { called++; return reply(OVERPASS); };
  await assert.rejects(A.amenitiesAt({ lat: 0, lon: 0 }, { fetchImpl: f, overpass: createSpacer(0), ...noWait }), /bad coordinates/);
  await assert.rejects(A.amenitiesAt({ lat: "51.2; out", lon: 6.7 }, { fetchImpl: f, overpass: createSpacer(0), ...noWait }), /bad coordinates/);
  assert.throws(() => A.overpassQuery(NaN, 6), /bad coordinates/);
  assert.equal(called, 0);
  assert.equal(A.checkOverpassUrl("https://overpass.example.org/api/interpreter"), "https://overpass.example.org/api/interpreter");
  assert.equal(A.checkOverpassUrl(""), A.OVERPASS_URL);
  assert.throws(() => A.checkOverpassUrl("file:///etc/passwd"), /OVERPASS_URL/);
  assert.throws(() => A.checkOverpassUrl("not a url"), /OVERPASS_URL/);
});

test("a 200 answer with a runtime-error remark is an error (retried), not an empty result", async () => {
  let n = 0;
  const remark = { elements: [], remark: "runtime error: Query ran out of memory in \"query\" at line 3." };
  const f = async url => url.includes("overpass") ? (++n, reply(remark)) : reply({}, 500);
  await assert.rejects(A.amenitiesAt(P, { fetchImpl: f, overpass: createSpacer(0), delays: [], overpassDelays: [1], sleep: async () => {} }), /HTTP 504/);
  assert.equal(n, 2);
});

test("an oversized Overpass answer is refused", async () => {
  const f = async () => ({ ok: true, status: 200, headers: { get: k => k === "content-length" ? String(50 * 1024 * 1024) : null }, text: async () => "{}" });
  await assert.rejects(A.amenitiesAt(P, { fetchImpl: f, overpass: createSpacer(0), ...noWait }), /too large/);
});

const okTable = (n, dur = 300) => reply({ code: "Ok", durations: [[0, ...Array(n).fill(dur)]], distances: [[0, ...Array(n).fill(400)]] });

test("places beyond their radius are dropped after re-measuring; ways get 50 m tolerance", async () => {
  const at = (m) => ({ lat: P.lat + m / 111195, lon: P.lon });
  const els = { elements: [
    { type: "node", id: 1, ...at(1040), tags: { shop: "supermarket", name: "Too far node" } },
    { type: "way", id: 2, center: at(1040), tags: { leisure: "park", name: "Big park" } },
    { type: "node", id: 3, ...at(540), tags: { highway: "bus_stop", name: "Far stop" } },
    { type: "node", id: 4, ...at(400), tags: { highway: "bus_stop", name: "Near stop" } }
  ] };
  const r = await A.amenitiesAt(P, { fetchImpl: async u => u.includes("overpass") ? reply(els) : okTable(2), overpass: createSpacer(0), ...noWait });
  assert.equal(r.items.supermarket, null);
  assert.equal(r.items.park.name, "Big park");
  assert.equal(r.items.transit.name, "Near stop");
});

test("the cache keeps the nearest 10 per category", async () => {
  const els = { elements: Array.from({ length: 15 }, (_, i) => ({ type: "node", id: 100 + i, lat: P.lat + (i + 1) * 0.0001, lon: P.lon, tags: { shop: "supermarket", name: "M" + i } })) };
  const cache = createAreaCache(path.join(tmp(), "c.json"));
  await A.amenitiesAt(P, { fetchImpl: async u => u.includes("overpass") ? reply(els) : okTable(3), cache, overpass: createSpacer(0), ...noWait });
  assert.equal(cache.get(P.lat, P.lon).value.length, 10);
});

test("more stop kinds, healthcare=doctor, relation platforms; only public-transport route relations give lines", () => {
  const q = A.overpassQuery(51.2254, 6.7787);
  assert.match(q, /\[highway=bus_stop\]/);
  assert.match(q, /\[railway~"\^\(tram_stop\|station\|halt\)\$"\]/);
  assert.match(q, /rel\(br\.p\)/);
  const pois = A.parseOverpass({ elements: [
    { type: "node", id: 1, lat: 51.2255, lon: 6.7787, tags: { railway: "tram_stop", name: "T" } },
    { type: "node", id: 2, lat: 51.2256, lon: 6.7787, tags: { healthcare: "doctor", name: "Dr" } },
    { type: "relation", id: 3, center: { lat: 51.2257, lon: 6.7787 }, tags: { public_transport: "platform", name: "Rel platform" } },
    { type: "relation", id: 10, members: [{ type: "node", ref: 1 }, { type: "node", ref: 1 }], tags: { type: "route", route: "tram", ref: "U79" } },
    { type: "relation", id: 11, members: [{ type: "node", ref: 1 }], tags: { type: "route", route: "tram", ref: "U79" } },
    { type: "relation", id: 12, members: [{ type: "node", ref: 1 }], tags: { type: "route", route: "hiking", ref: "X1" } }
  ] }, P);
  assert.deepEqual(pois.map(p => p.cat).sort(), ["doctors", "transit", "transit"]);
  assert.deepEqual(pois.find(p => p.id === "node/1").lines, [{ ref: "U79", mode: "tram" }]);
});

test("summarise prefers a routed candidate over an estimated one", () => {
  const c = [{ id: "a", cat: "park", name: "Near", meters: 100 }, { id: "b", cat: "park", name: "Routed", meters: 900 }];
  const r = A.summarise(c, { durations: [NaN, 600], distances: [NaN, 800] });
  assert.equal(r.park.name, "Routed");
  assert.equal(r.park.estimated, false);
});

test("Retry-After longer than the delay is honoured", async () => {
  let n = 0; const waits = [];
  const f = async u => {
    if (!u.includes("overpass")) return okTable(5);
    return ++n === 1 ? { ...reply({}, 429), headers: { get: k => k.toLowerCase() === "retry-after" ? "90" : null } } : reply(OVERPASS);
  };
  await A.amenitiesAt(P, { fetchImpl: f, overpass: createSpacer(0), delays: [], overpassDelays: [30000], sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(waits, [90000]);
});

test("partial foot-router nulls fall back to an estimate per place", async () => {
  const f = async u => u.includes("overpass") ? reply(OVERPASS) : reply({ code: "Ok", durations: [[0, null, 240, null, null, null, null]], distances: [[0, null, 300, null, null, null, null]] });
  const r = await A.amenitiesAt(P, { fetchImpl: f, overpass: createSpacer(0), ...noWait });
  assert.equal(r.routed, true);
  assert.ok(Object.values(r.items).some(i => i && i.estimated === true));
  assert.ok(Object.values(r.items).some(i => i && i.estimated === false));
});

test("malformed cache entries are ignored on load", async () => {
  const file = path.join(tmp(), "c.json");
  fs.writeFileSync(file, JSON.stringify({ entries: { a: null, b: { at: 5, value: [] }, c: { at: "2026-10-21T00:00:00Z", value: "x" }, d: { at: "2026-10-21T00:00:00Z", value: [1] } } }));
  const c = createAreaCache(file, { now: () => new Date("2026-10-22T00:00:00Z") });
  assert.equal(c.size(), 1);
  await c.set(51.2254, 6.7787, [2]);
  assert.equal(c.size(), 2);
});
