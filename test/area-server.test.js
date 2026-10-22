const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("./helpers");
const { defaultProfile } = require("../lib/profile");
const { areaFetch, AREA_OPTS } = require("./area-fixtures");

const json = h => ({ ...h, "Content-Type": "application/json" });
const flat = { url: "https://www.immowelt.de/expose/example1", title: "Example flat", mode: "rent", coldRent: 900, utilities: 200, rooms: 2, size: 60, address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf" };
const startArea = (extra = {}) => start({ fetchImpl: areaFetch(extra.fetch || {}), areaAuto: true, area: AREA_OPTS(), ...extra.opts });

test("adding a listing queues its area facts in the background and stores them on the listing", async () => {
  const s = await startArea({ fetch: { flood: ["medium", "low"] } });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(defaultProfile()) });
    const r = await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(flat) });
    assert.equal(r.status, 201);
    const { id, listing } = await r.json();
    assert.equal(listing.area, undefined, "the add answers before the area is computed");
    await s.app.locals.areaQueue.idle();
    const area = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings[id].area;
    assert.equal(area.flood.worst, "medium");
    assert.equal(area.crime.ratio.total, 2);
    assert.equal(area.rent.eurPerSqm, 11.15);
    assert.equal(area.amenities.status, "ok");
  } finally { await s.close(); }
});

test("an address change drops the old area and queues a new one; other edits keep it", async () => {
  const s = await startArea();
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(defaultProfile()) });
    const { id } = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(flat) })).json();
    await s.app.locals.areaQueue.idle();
    const before = s.app.locals.state.listings[id].area.computedAt;
    const p = await fetch(s.base + `/api/listings/${id}/listing`, { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ address: "Beispielstraße 2" }) });
    assert.equal(p.status, 200);
    assert.equal((await p.json()).listing.area, undefined);
    await s.app.locals.areaQueue.idle();
    assert.ok(s.app.locals.state.listings[id].area.computedAt >= before);
    // An edit that does not move the listing keeps the area and queues nothing.
    await fetch(s.base + `/api/listings/${id}/listing`, { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ coldRent: 950 }) });
    assert.deepEqual(s.app.locals.areaQueue.status(), { queued: [], running: null });
    assert.ok(s.app.locals.state.listings[id].area);
  } finally { await s.close(); }
});

test("POST /api/listings/:id/area recomputes on demand; 404 unknown, 400 without coordinates; GET queue", async () => {
  const calls = [];
  const s = await start({ fetchImpl: areaFetch({ calls }), area: AREA_OPTS() });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(defaultProfile()) });
    const { id } = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(flat) })).json();
    assert.equal(s.app.locals.state.listings[id].area, undefined, "areaAuto off: nothing queued");
    const r = await fetch(s.base + `/api/listings/${id}/area`, { method: "POST", headers: s.auth });
    assert.equal(r.status, 202);
    assert.equal((await r.json()).ok, true);
    await s.app.locals.areaQueue.idle();
    assert.equal(s.app.locals.state.listings[id].area.kreis.ags, "05111");
    assert.equal(calls.filter(c => c.host === "overpass-api.de").length, 1);
    // on demand skips the Overpass cache
    await fetch(s.base + `/api/listings/${id}/area`, { method: "POST", headers: s.auth });
    await s.app.locals.areaQueue.idle();
    assert.equal(calls.filter(c => c.host === "overpass-api.de").length, 2);
    assert.equal((await fetch(s.base + "/api/listings/nope/area", { method: "POST", headers: s.auth })).status, 404);
    s.app.locals.state.listings.bare = { title: "No coordinates" };
    const bare = await fetch(s.base + "/api/listings/bare/area", { method: "POST", headers: s.auth });
    assert.equal(bare.status, 400);
    assert.deepEqual(await bare.json(), { error: "listing has no coordinates" });
    assert.deepEqual(await (await fetch(s.base + "/api/area/queue", { headers: s.auth })).json(), { queued: [], running: null });
    assert.equal((await fetch(s.base + "/api/area/queue")).status, 401);
    assert.equal((await fetch(s.base + `/api/listings/${id}/area`, { method: "POST" })).status, 401);
  } finally { await s.close(); }
});

test("the routine cannot write area; new coordinates from the routine drop it and queue a recompute", async () => {
  const s = await startArea();
  try {
    const put = body => fetch(s.base + "/api/listings/example-1", { method: "PUT", headers: s.sync, body: JSON.stringify(body) });
    assert.equal((await put({ title: "Example", lat: 51.2254, lon: 6.7787, area: { fake: true } })).status, 200);
    assert.equal(s.app.locals.state.listings["example-1"].area, undefined);
    await s.app.locals.areaQueue.idle();
    assert.equal(s.app.locals.state.listings["example-1"].area.lat, 51.2254);
    await put({ title: "Example, renamed" });
    assert.deepEqual(s.app.locals.areaQueue.status().queued, []);
    await put({ lat: 51.2300, lon: 6.7800 });
    assert.equal(s.app.locals.state.listings["example-1"].area, undefined);
    await s.app.locals.areaQueue.idle();
    assert.equal(s.app.locals.state.listings["example-1"].area.lat, 51.23);
  } finally { await s.close(); }
});

test("start-up backfills listings without area facts", async () => {
  const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flat-hunt-test-"));
  fs.writeFileSync(path.join(dir, "listings.json"), JSON.stringify({ old: { title: "From phase 1", lat: 51.2254, lon: 6.7787 }, nowhere: { title: "No coordinates" } }));
  const s = await startArea({ opts: { dataDir: dir } });
  try {
    await s.app.locals.areaQueue.idle();
    assert.equal(s.app.locals.state.listings.old.area.kreis.ags, "05111");
    assert.equal(s.app.locals.state.listings.nowhere.area, undefined);
    assert.ok(fs.existsSync(path.join(dir, "area-cache.json")));
  } finally { await s.close(); }
});
