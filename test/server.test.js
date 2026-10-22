const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { start } = require("./helpers");
const { defaultProfile } = require("../lib/profile");

const json = (h = {}) => ({ ...h, "Content-Type": "application/json" });

test("password protects the API and the page", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(s.base + "/api/listings")).status, 401);
    assert.equal((await fetch(s.base + "/")).status, 401);
    const r = await fetch(s.base + "/api/listings", { headers: s.auth });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.deepEqual((await r.json()).listings, {});
  } finally { await s.close(); }
});

test("a fresh copy starts empty; the seed is applied only with SEED=1", async () => {
  const seedFile = path.join(__dirname, "fixtures", "seed.json");
  const a = await start({ seedFile });
  try { assert.deepEqual((await (await fetch(a.base + "/api/listings", { headers: a.auth })).json()).listings, {}); }
  finally { await a.close(); }
  process.env.SEED = "1";
  const b = await start({ seedFile });
  try { assert.ok((await (await fetch(b.base + "/api/listings", { headers: b.auth })).json()).listings["example-flat"]); }
  finally { await b.close(); delete process.env.SEED; }
});

test("PATCH validates fields and persists", async () => {
  const s = await start();
  try {
    const put = await fetch(s.base + "/api/listings/demo", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Demo", price: 9000 }) });
    assert.equal(put.status, 200);
    assert.equal((await fetch(s.base + "/api/listings/demo", { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ pick: "yes" }) })).status, 400);
    assert.equal((await fetch(s.base + "/api/listings/demo", { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ price: 1 }) })).status, 400);
    assert.equal((await fetch(s.base + "/api/listings/demo", { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ pick: true }) })).status, 200);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"));
    assert.equal(saved.demo.pick, true);
  } finally { await s.close(); }
});

test("bulk writes need the sync key", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(s.base + "/api/listings/x", { method: "PUT", headers: json(s.auth), body: "{}" })).status, 401);
    assert.equal((await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: {}, complete: false }) })).status, 200);
  } finally { await s.close(); }
});

test("/healthz is the only route open without the password", async () => {
  const s = await start();
  try {
    const h = await fetch(s.base + "/healthz");
    assert.equal(h.status, 200);
    assert.equal(await h.text(), "ok");
    assert.equal((await fetch(s.base + "/api/listings")).status, 401);
  } finally { await s.close(); }
});

test("a failing save answers 500 and the server keeps running", async () => {
  const s = await start();
  try {
    fs.rmSync(path.join(s.dir, "listings.json"));
    fs.mkdirSync(path.join(s.dir, "listings.json")); // renaming a file onto a directory fails
    const put = await fetch(s.base + "/api/listings/demo", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Demo" }) });
    assert.equal(put.status, 500);
    assert.deepEqual(await put.json(), { error: "save failed" });
    const meta = await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ lastCheck: "2026-10-18" }) });
    assert.equal(meta.status, 500);
    const sync = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: {}, complete: false }) });
    assert.equal(sync.status, 500);
    assert.equal((await fetch(s.base + "/api/meta", { headers: s.auth })).status, 200);
  } finally { await s.close(); }
});

test("profile: 404 on a fresh copy, validated PUT, round trip", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(s.base + "/api/profile", { headers: s.auth })).status, 404);
    const bad = await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify({ name: "x" }) });
    assert.equal(bad.status, 400);
    assert.ok((await bad.json()).details.length > 0);
    const p = defaultProfile(); p.name = "Our estate hunt";
    assert.equal((await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) })).status, 200);
    assert.equal((await (await fetch(s.base + "/api/profile", { headers: s.auth })).json()).name, "Our estate hunt");
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "profile.json"), "utf8")).name, "Our estate hunt");
    assert.equal((await fetch(s.base + "/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) })).status, 401);
  } finally { await s.close(); }
});

test("photos upload to DATA_DIR/img and are served from /img", async () => {
  const s = await start();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
  try {
    assert.equal((await fetch(s.base + "/api/img/a-1.jpg", { method: "PUT", headers: { ...s.auth, "Content-Type": "image/jpeg" }, body: jpeg })).status, 401);
    assert.equal((await fetch(s.base + "/api/img/..%2Fx.jpg", { method: "PUT", headers: { ...s.sync, "Content-Type": "image/jpeg" }, body: jpeg })).status, 400);
    const ok = await fetch(s.base + "/api/img/a-1.jpg", { method: "PUT", headers: { ...s.sync, "Content-Type": "image/jpeg" }, body: jpeg });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).path, "img/a-1.jpg");
    const got = await fetch(s.base + "/img/a-1.jpg", { headers: s.auth });
    assert.equal(got.status, 200);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), jpeg);
  } finally { await s.close(); }
});

const geoFetch = async url => ({ ok: true, status: 200, json: async () => url.includes("nominatim") ? [{ display_name: "45127 Essen", lat: "51.4556", lon: "7.0116" }] : { routes: [{ distance: 36000, duration: 1920 }] } });
const failFetch = async () => { throw new Error("offline"); };
const homeProfile = () => { const p = defaultProfile(); p.places = [{ label: "Büro", address: "Königsallee 1, 40212 Düsseldorf", lat: 51.2254, lon: 6.7787, mode: "car", maxMin: 45, time: "08:00" }]; return p; };
const newFlat = { url: "https://www.immowelt.de/expose/abc123", title: "Bright 2-room flat with balcony", mode: "rent", coldRent: 750, utilities: 180, rooms: 2, size: 58, postcode: "45127", city: "Essen" };

test("manual add geocodes the town and computes the drive", async () => {
  const s = await start({ fetchImpl: geoFetch });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    const r = await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) });
    assert.equal(r.status, 201);
    const { id, listing: car } = await r.json();
    assert.equal(id, "bright-2-room-flat-with-balcony-essen");
    assert.equal(car.commute.length, 1);
    assert.equal(car.commute[0].minutes, 32);
    assert.match(car.commute[0].checkedAt, /^\d{4}-\d\d-\d\dT/);
    assert.match(car.mapsUrl, /origin=.*destination=51\.4556,7\.0116$/);
    assert.equal(car.status, "new");
    const again = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) })).json();
    assert.equal(again.id, id + "-2");
  } finally { await s.close(); }
});

test("manual add still saves when geocoding fails, and validates input", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    const r = await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).listing.commute, undefined);
    const bad = await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify({ ...newFlat, coldRent: "cheap", url: "javascript:alert(1)" }) });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).details.length, 2);
  } finally { await s.close(); }
});

test("geocode endpoint", async () => {
  const s = await start({ fetchImpl: geoFetch });
  try {
    const r = await fetch(s.base + "/api/geocode?q=Essen", { headers: s.auth });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).lat, 51.4556);
  } finally { await s.close(); }
});

test("concurrent manual adds of the same listing get different ids", async () => {
  const slowGeo = async url => { await new Promise(r => setTimeout(r, 50)); return geoFetch(url); };
  const s = await start({ fetchImpl: slowGeo });
  try {
    const post = () => fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) });
    const [a, b] = await Promise.all([post(), post()]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const ida = (await a.json()).id, idb = (await b.json()).id;
    assert.notEqual(ida, idb);
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.ok(cars[ida]);
    assert.ok(cars[idb]);
    assert.equal(Object.keys(cars).length, 2);
  } finally { await s.close(); }
});

test("a failed manual-add save answers 500 and leaves no listing or log entry behind", async () => {
  const s = await start({ fetchImpl: geoFetch });
  try {
    fs.rmSync(path.join(s.dir, "listings.json"));
    fs.mkdirSync(path.join(s.dir, "listings.json")); // renaming a file onto a directory fails
    const r = await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "save failed" });
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.deepEqual(cars, {});
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(meta.log.length, 0);
  } finally { await s.close(); }
});

test("a profile name outside Latin-1 still gives a 401 with a password prompt", async () => {
  const s = await start();
  try {
    const p = defaultProfile(); p.name = "Škoda hunt 🚗";
    assert.equal((await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) })).status, 200);
    const r = await fetch(s.base + "/");
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("www-authenticate"), 'Basic realm="koda hunt"');
  } finally { await s.close(); }
});

test("sync with complete: true never marks a manually added listing gone", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id, listing: car } = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) })).json();
    assert.equal(car.source, "manual");
    await fetch(s.base + "/api/listings/routine-car", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Routine car", price: 9000 }) });
    const r = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: {}, complete: true }) });
    assert.equal(r.status, 200);
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.notEqual(cars[id].gone, true);
    assert.equal(cars["routine-car"].gone, true);
  } finally { await s.close(); }
});

test("sync with complete: true marks only open listings gone", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const put = (id, body) => fetch(s.base + "/api/listings/" + id, { method: "PUT", headers: s.sync, body: JSON.stringify({ title: id, price: 900, ...body }) });
    for (const id of ["rejected", "dropped", "accepted", "contacted", "wasgone"]) assert.equal((await put(id, id === "wasgone" ? { gone: true } : {})).status, 200);
    for (const id of ["rejected", "dropped", "accepted", "contacted"]) {
      const r = await fetch(s.base + "/api/listings/" + id, { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ status: id }) });
      assert.equal(r.status, 200, id);
    }
    const r = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: {}, complete: true }) });
    assert.equal(r.status, 200);
    const l = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.equal(l.contacted.gone, true);
    for (const id of ["rejected", "dropped", "accepted"]) assert.notEqual(l[id].gone, true, id);
    assert.equal(l.wasgone.goneAt, undefined);
    assert.deepEqual((await r.json()).changes.map(c => c.id), ["contacted"]);
  } finally { await s.close(); }
});

test("PUT /api/meta accepts only lastCheck", async () => {
  const s = await start();
  try {
    const bad = await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ log: "x" }) });
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { error: "unsupported field" });
    assert.equal((await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ lastCheck: 5 }) })).status, 400);
    assert.equal((await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ lastCheck: "x".repeat(41) }) })).status, 400);
    const ok = await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ lastCheck: "2026-10-18T10:00:00Z" }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).meta.lastCheck, "2026-10-18T10:00:00Z");
    assert.equal((await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ lastCheck: null }) })).status, 200);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.ok(Array.isArray(meta.log));
  } finally { await s.close(); }
});

test("manual add computes warm rent, stores contact, source and the price history", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { listing: l } = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify({ ...newFlat, contactName: "Ms Example", contactType: "agent", lift: true, notes: "Nice" }) })).json();
    assert.equal(l.warmRent, 930);
    assert.equal(l.source, "manual");
    assert.deepEqual(l.contact, { name: "Ms Example", type: "agent" });
    assert.equal(l.contactName, undefined);
    assert.equal(l.lift, true);
    assert.equal(l.notes, "Nice");
    assert.deepEqual(l.priceHistory.map(p => p.price), [930]);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(meta.log[0].type, "new");
    assert.equal(meta.log[0].price, 930);
    const own = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify({ ...newFlat, coldRent: undefined, utilities: undefined, warmRent: 990 }) })).json();
    assert.equal(own.listing.warmRent, 990);
    const buy = await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify({ url: "https://www.kleinanzeigen.de/s-anzeige/1", title: "Flat to buy", mode: "buy", price: 289000, rooms: 3, size: 82, address: "45127 Essen" }) })).json();
    assert.deepEqual(buy.listing.priceHistory.map(p => p.price), [289000]);
    assert.equal(buy.listing.warmRent, undefined);
    const unknown = await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify({ ...newFlat, fuel: "diesel" }) });
    assert.equal(unknown.status, 400);
  } finally { await s.close(); }
});

test("PUT /api/listings drops link fields that are not http(s) and fields a flat listing does not have", async () => {
  const s = await start();
  try {
    const body = { title: "Links", url: "javascript:alert(1)", mapsUrl: "https://maps.example/x", fuel: "diesel", km: 5, coldRent: 700, commute: [null], rating: { price: 7 }, redFlags: ["owner-abroad"], contact: { name: "A", type: "private" } };
    assert.equal((await fetch(s.base + "/api/listings/links", { method: "PUT", headers: s.sync, body: JSON.stringify(body) })).status, 200);
    const c = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings.links;
    assert.equal(c.url, undefined);
    assert.equal(c.mapsUrl, "https://maps.example/x");
    assert.equal(c.fuel, undefined);
    assert.equal(c.km, undefined);
    assert.equal(c.coldRent, 700);
    assert.deepEqual(c.commute, [null]);
    assert.deepEqual(c.rating, { price: 7 });
    assert.deepEqual(c.redFlags, ["owner-abroad"]);
    assert.deepEqual(c.contact, { name: "A", type: "private" });
    await fetch(s.base + "/api/listings/links2", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Links 2", url: "http://a.example/1" }) });
    await fetch(s.base + "/api/listings/links2", { method: "PUT", headers: s.sync, body: JSON.stringify({ url: "javascript:x" }) });
    assert.equal((await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings.links2.url, "http://a.example/1");
  } finally { await s.close(); }
});

const { spawnSync } = require("node:child_process");
const runServer = env => spawnSync(process.execPath, [path.join(__dirname, "..", "server.js")], { env: { PATH: process.env.PATH, PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(require("node:os").tmpdir(), "flat-hunt-start-")), ...env }, timeout: 1500, encoding: "utf8" });

test("the server refuses to start without SITE_PASSWORD unless ALLOW_OPEN=1", () => {
  const refused = runServer({});
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /SITE_PASSWORD/);
  const open = runServer({ ALLOW_OPEN: "1" });
  assert.equal(open.status, null); // still running when the timeout kills it
  assert.match(open.stderr, /ALLOW_OPEN/);
  assert.match(open.stdout, /Flat Hunt on/);
});

// ---------- editing and deleting listings ----------
const otherTownFetch = async url => ({ ok: true, status: 200, json: async () => url.includes("nominatim") ? [{ display_name: "50667 Köln", lat: "50.9384", lon: "6.9599" }] : { routes: [{ distance: 41000, duration: 2700 }] } });
const addManual = async s => (await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify(newFlat) })).json());
const editListing = (s, id, body, headers = json(s.auth)) => fetch(s.base + "/api/listings/" + id + "/listing", { method: "PATCH", headers, body: JSON.stringify(body) });
const breakSaves = s => { fs.rmSync(path.join(s.dir, "listings.json")); fs.mkdirSync(path.join(s.dir, "listings.json")); };

test("editing the rent recomputes warm rent, appends to the price history and logs the change", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    const r = await editListing(s, id, { coldRent: 800 });
    assert.equal(r.status, 200);
    const { ok, listing: l } = await r.json();
    assert.equal(ok, true);
    assert.equal(l.coldRent, 800);
    assert.equal(l.warmRent, 980);
    assert.deepEqual(l.priceHistory.map(p => p.price), [930, 980]);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(meta.log[0].type, "price");
    assert.equal(meta.log[0].id, id);
    assert.equal(meta.log[0].from, 930);
    assert.equal(meta.log[0].to, 980);
    const util = (await (await editListing(s, id, { utilities: 200 })).json()).listing;
    assert.equal(util.warmRent, 1000);
    const explicit = (await (await editListing(s, id, { coldRent: 700, warmRent: 950 })).json()).listing;
    assert.equal(explicit.warmRent, 950);
    const same = (await (await editListing(s, id, { notes: "x" })).json()).listing;
    assert.equal(same.priceHistory.length, 4);
    const saved = JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"));
    assert.equal(saved[id].warmRent, 950);
  } finally { await s.close(); }
});

test("clearing utilities recomputes warm rent; a cold-rent change is tracked even with an explicit warm rent", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    const cleared = (await (await editListing(s, id, { utilities: null })).json()).listing;
    assert.equal(cleared.utilities, undefined);
    assert.equal(cleared.warmRent, undefined);
    const explicit = (await (await editListing(s, id, { utilities: null, warmRent: 990 })).json()).listing;
    assert.equal(explicit.warmRent, 990);
    const before = explicit.priceHistory.length;
    const cold = (await (await editListing(s, id, { coldRent: 790, warmRent: 990 })).json()).listing;
    assert.equal(cold.coldRent, 790);
    assert.equal(cold.warmRent, 990);
    assert.equal(cold.priceHistory.length, before + 1);
    assert.equal(cold.priceHistory.at(-1).coldRent, 790);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.deepEqual([meta.log[0].type, meta.log[0].field, meta.log[0].from, meta.log[0].to], ["price", "coldRent", 750, 790]);
    // A warm rent that was not derived from cold rent and utilities survives clearing the cold rent.
    assert.equal((await editListing(s, id, { coldRent: null })).status, 200);
    const warmOnly = (await (await editListing(s, id, { coldRent: null, warmRent: 990 })).json()).listing;
    assert.equal(warmOnly.coldRent, undefined);
    assert.equal(warmOnly.warmRent, 990);
  } finally { await s.close(); }
});

test("editing a buy listing's price logs it; switching mode needs the other mode's amount", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    assert.equal((await editListing(s, id, { mode: "buy" })).status, 400);
    const l = (await (await editListing(s, id, { mode: "buy", price: 250000 })).json()).listing;
    assert.equal(l.mode, "buy");
    assert.deepEqual(l.priceHistory.map(p => p.price), [930, 250000]);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.deepEqual([meta.log[0].from, meta.log[0].to], [930, 250000]);
  } finally { await s.close(); }
});

test("editing title, facts, contact and clearing optional fields", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    const { listing: l } = await (await editListing(s, id, { title: "Renamed flat", rooms: 2.5, floor: 2, contactName: "Mr Example", contactType: "private", notes: "call" })).json();
    assert.equal(l.title, "Renamed flat");
    assert.equal(l.rooms, 2.5);
    assert.equal(l.floor, 2);
    assert.deepEqual(l.contact, { name: "Mr Example", type: "private" });
    const cleared = (await (await editListing(s, id, { floor: null, contactName: null })).json()).listing;
    assert.equal(cleared.floor, undefined);
    assert.deepEqual(cleared.contact, { type: "private" });
  } finally { await s.close(); }
});

test("editing the address re-geocodes and recomputes the commute", async () => {
  let impl = geoFetch;
  const s = await start({ fetchImpl: (...a) => impl(...a) });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    const { id, listing: before } = await addManual(s);
    assert.equal(before.commute[0].minutes, 32);
    await fetch(s.base + "/api/listings/" + id, { method: "PUT", headers: s.sync, body: JSON.stringify({ commuteStale: true }) });
    impl = otherTownFetch;
    const { listing: l } = await (await editListing(s, id, { postcode: "50667", city: "Köln" })).json();
    assert.equal(l.city, "Köln");
    assert.equal(l.postcode, "50667");
    assert.equal(l.lat, 50.9384);
    assert.equal(l.lon, 6.9599);
    assert.equal(l.commute[0].minutes, 45);
    assert.equal(l.commuteStale, undefined);
    assert.match(l.mapsUrl, /destination=50\.9384,6\.9599$/);
  } finally { await s.close(); }
});

test("editing the address when geocoding fails keeps the address and clears the old location", async () => {
  let impl = geoFetch;
  const s = await start({ fetchImpl: (...a) => impl(...a) });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    const { id } = await addManual(s);
    impl = failFetch;
    const r = await editListing(s, id, { address: "Nowhere 1" });
    assert.equal(r.status, 200);
    const { listing: l } = await r.json();
    assert.equal(l.address, "Nowhere 1");
    for (const k of ["lat", "lon", "commute", "mapsUrl"]) assert.equal(l[k], undefined, k);
  } finally { await s.close(); }
});

test("listing edits reject unknown fields, invalid values, unknown listings and missing passwords", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    const unknown = await editListing(s, id, { status: "accepted" });
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).error, "invalid listing");
    const bad = await editListing(s, id, { coldRent: "cheap", url: "http://insecure.example/x", floor: 1.5, lift: "yes", outdoor: "roof" });
    assert.equal(bad.status, 400);
    const j = await bad.json();
    assert.equal(j.error, "invalid listing");
    assert.equal(j.details.length, 5);
    assert.equal((await editListing(s, "no-such-flat", { coldRent: 1000 })).status, 404);
    assert.equal((await editListing(s, id, { coldRent: 1000 }, { "Content-Type": "application/json" })).status, 401);
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.equal(cars[id].coldRent, 750);
  } finally { await s.close(); }
});

test("a failed listing save answers 500 and restores the listing", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    breakSaves(s);
    const r = await editListing(s, id, { coldRent: 900, title: "Changed" });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "save failed" });
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.equal(cars[id].coldRent, 750);
    assert.equal(cars[id].warmRent, 930);
    assert.equal(cars[id].title, newFlat.title);
    assert.equal(cars[id].priceHistory.length, 1);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(meta.log.filter(e => e.type === "price").length, 0);
  } finally { await s.close(); }
});

test("DELETE removes the listing, its log entries and its photos", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    await fetch(s.base + "/api/listings/golf", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Golf", price: 9000 }) });
    await fetch(s.base + "/api/listings/golf-2", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Golf 2", price: 9500 }) });
    await editListing(s, "golf", { price: 8800, mode: "buy" });
    const img = path.join(s.dir, "img");
    for (const f of ["golf-1.jpg", "golf-2.jpg", "golf-2-1.jpg", "polo-1.jpg"]) fs.writeFileSync(path.join(img, f), "x");
    assert.equal((await fetch(s.base + "/api/listings/golf", { method: "DELETE", headers: { "Content-Type": "application/json" } })).status, 401);
    const r = await fetch(s.base + "/api/listings/golf", { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.equal(cars.golf, undefined);
    assert.ok(cars["golf-2"]);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(meta.log.filter(e => e.id === "golf").length, 0);
    assert.equal(meta.log.filter(e => e.id === "golf-2").length, 1);
    assert.deepEqual(fs.readdirSync(img).sort(), ["golf-2-1.jpg", "polo-1.jpg"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8")).golf, undefined);
    assert.equal((await fetch(s.base + "/api/listings/golf", { method: "DELETE", headers: s.auth })).status, 404);
  } finally { await s.close(); }
});

test("a failed delete answers 500 and restores the listing and its log entries", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    fs.writeFileSync(path.join(s.dir, "img", id + "-1.jpg"), "x");
    breakSaves(s);
    const r = await fetch(s.base + "/api/listings/" + id, { method: "DELETE", headers: s.auth });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "save failed" });
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.ok(cars[id]);
    const meta = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(meta.log.filter(e => e.id === id).length, 1);
    assert.ok(fs.existsSync(path.join(s.dir, "img", id + "-1.jpg")));
  } finally { await s.close(); }
});

test("without places a new listing gets an empty commute and no route link", async () => {
  const s = await start({ fetchImpl: geoFetch });
  try {
    const { listing: car } = await addManual(s);
    assert.deepEqual(car.commute, []);
    assert.equal(car.mapsUrl, undefined);
    assert.equal(car.lat, 51.4556);
  } finally { await s.close(); }
});

test("a transit place is looked up with its own time and a failed lookup is null", async () => {
  const seen = [];
  const f = async url => { seen.push(url); return url.includes("nominatim") ? geoFetch(url) : { ok: false, status: 500, json: async () => ({}) }; };
  const s = await start({ fetchImpl: f });
  try {
    const p = homeProfile(); p.places[0].mode = "transit"; p.places[0].time = "07:30";
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) });
    const { listing: car } = await addManual(s);
    assert.deepEqual(car.commute, [null]);
    assert.ok(seen.some(u => u.startsWith("https://api.transitous.org/api/v1/plan?fromPlace=51.4556,7.0116&toPlace=51.2254,6.7787&time=") && u.endsWith("&arriveBy=true")));
  } finally { await s.close(); }
});

test("changing the places marks every listing stale, other profile edits do not", async () => {
  const s = await start({ fetchImpl: geoFetch });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    const { id } = await addManual(s);
    const list = async () => (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings[id];
    const p = homeProfile(); p.name = "Renamed";
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) });
    assert.equal((await list()).commuteStale, undefined);
    p.places[0].maxMin = 30;
    assert.equal((await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) })).status, 200);
    assert.equal((await list()).commuteStale, true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(s.dir, "listings.json"), "utf8"));
    assert.equal(onDisk[id].commuteStale, true);
  } finally { await s.close(); }
});

test("recalc-commute is password only, runs in the background and clears the stale flag", async () => {
  const s = await start({ fetchImpl: geoFetch, pauseMs: 0 });
  try {
    const { id } = await addManual(s);
    assert.equal((await fetch(s.base + "/api/listings/recalc-commute", { method: "POST" })).status, 401);
    const p = homeProfile();
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) });
    const r = await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: s.auth });
    assert.equal(r.status, 202);
    const started = await r.json();
    assert.equal(started.ok, true);
    assert.equal(started.running, true);
    await s.app.locals.commuteJob.idle();
    const st = await (await fetch(s.base + "/api/commute/status", { headers: s.auth })).json();
    assert.equal(st.running, false);
    assert.equal(st.updated, 1);
    assert.equal(st.error, null);
    const car = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings[id];
    assert.equal(car.commuteStale, undefined);
    assert.equal(car.commute.length, 1);
    assert.equal(car.commute[0].minutes, 32);
    // the sync key alone does not open it
    assert.equal((await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: { "x-sync-key": "key" } })).status, 403);
    assert.equal((await fetch(s.base + "/api/commute/status")).status, 401);
  } finally { await s.close(); }
});

test("recalc-commute skips listings without coordinates and reports a failed save in its status", async () => {
  const s = await start({ fetchImpl: geoFetch, pauseMs: 0 });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    const { id } = await addManual(s);
    await fetch(s.base + "/api/listings/nolocation", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "No coords" }) });
    await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: s.auth });
    await s.app.locals.commuteJob.idle();
    assert.equal(s.app.locals.commuteJob.status().updated, 1);
    const p = homeProfile(); p.places[0].maxMin = 20;
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(p) });
    fs.rmSync(path.join(s.dir, "listings.json"));
    fs.mkdirSync(path.join(s.dir, "listings.json"));
    assert.equal((await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: s.auth })).status, 202);
    await s.app.locals.commuteJob.idle();
    assert.equal(s.app.locals.commuteJob.status().error, "save failed");
    const cars = (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings;
    assert.equal(cars[id].commuteStale, true);
  } finally { await s.close(); }
});

test("a second recalc during a run is answered with the running status and runs once more afterwards", async () => {
  let calls = 0;
  const slowFetch = async (url, opts) => { if (String(url).includes("router.project-osrm.org")) { calls++; await new Promise(r => setTimeout(r, 20)); } return geoFetch(url, opts); };
  const s = await start({ fetchImpl: slowFetch, pauseMs: 0 });
  try {
    await addManual(s);
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    calls = 0;
    await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: s.auth });
    const second = await (await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: s.auth })).json();
    assert.equal(second.running, true);
    assert.equal(second.again, true);
    await s.app.locals.commuteJob.idle();
    assert.equal(calls, 2);
    assert.equal(s.app.locals.commuteJob.status().again, false);
  } finally { await s.close(); }
});

// ---------- warm rent derivation, rollback ----------
const fixedFetch = geoFetch;
const getListing = async (s, id) => (await (await fetch(s.base + "/api/listings", { headers: s.auth })).json()).listings[id];
const addWarmOnly = async s => (await (await fetch(s.base + "/api/listings", { method: "POST", headers: json(s.auth), body: JSON.stringify({ ...newFlat, coldRent: undefined, utilities: undefined, warmRent: 990 }) })).json()).id;
const logOf = async s => (await (await fetch(s.base + "/api/meta", { headers: s.auth })).json()).log;

test("adding a cold rent to a warm-only listing keeps the warm rent and logs no price drop", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const id = await addWarmOnly(s);
    const l = (await (await editListing(s, id, { coldRent: 800 })).json()).listing;
    assert.equal(l.coldRent, 800);
    assert.equal(l.warmRent, 990);
    assert.equal(l.priceHistory.length, 1);
    assert.deepEqual((await logOf(s)).filter(e => e.type === "price"), []);
  } finally { await s.close(); }
});

test("cold rent plus utilities derives the warm rent, clearing utilities on a derived warm rent removes it silently", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const id = await addWarmOnly(s);
    const l = (await (await editListing(s, id, { coldRent: 800, utilities: 200 })).json()).listing;
    assert.equal(l.warmRent, 1000);
    assert.deepEqual(l.priceHistory.map(p => p.price), [990, 1000]);
    const logLen = (await logOf(s)).length;
    const cleared = (await (await editListing(s, id, { utilities: null })).json()).listing;
    assert.equal(cleared.warmRent, undefined);
    assert.equal(cleared.coldRent, 800);
    assert.equal(cleared.priceHistory.length, 2);
    assert.equal((await logOf(s)).length, logLen);
  } finally { await s.close(); }
});

test("clearing utilities removes the derived warm rent without logging a price change", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s); // cold 750 + utilities 180 = 930
    const log0 = (await logOf(s)).length;
    const l = (await (await editListing(s, id, { utilities: null })).json()).listing;
    assert.equal(l.warmRent, undefined);
    assert.equal(l.priceHistory.length, 1);
    assert.equal((await logOf(s)).length, log0);
  } finally { await s.close(); }
});

test("a failed save restores owner fields, sync changes, the sync key write and meta", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    const { id } = await addManual(s);
    const p0 = await getListing(s, id);
    breakSaves(s);
    const patch = await fetch(s.base + "/api/listings/" + id, { method: "PATCH", headers: json(s.auth), body: JSON.stringify({ notes: "changed", pick: true }) });
    assert.equal(patch.status, 500);
    assert.deepEqual(await patch.json(), { error: "save failed" });
    const put = await fetch(s.base + "/api/listings/" + id, { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Other" }) });
    assert.equal(put.status, 500);
    const meta = await fetch(s.base + "/api/meta", { method: "PUT", headers: s.sync, body: JSON.stringify({ lastCheck: "2026-01-01" }) });
    assert.equal(meta.status, 500);
    const sync = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: {}, complete: true, checkedAt: "x" }) });
    assert.equal(sync.status, 500);
    assert.deepEqual(await sync.json(), { error: "save failed" });
    const newOne = await fetch(s.base + "/api/listings/brand-new", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "New" }) });
    assert.equal(newOne.status, 500);
    assert.deepEqual(await getListing(s, id), p0);
    assert.equal(await getListing(s, "brand-new"), undefined);
    const m = await (await fetch(s.base + "/api/meta", { headers: s.auth })).json();
    assert.equal(m.lastCheck, null);
    assert.equal(m.log.some(e => e.id === "brand-new"), false);
  } finally { await s.close(); }
});

test("a failed save restores price changes and gone flags from a sync", async () => {
  const s = await start({ fetchImpl: failFetch });
  try {
    await fetch(s.base + "/api/listings/scraped", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Scraped", mode: "buy", price: 300000 }) });
    const p0 = await getListing(s, "scraped");
    breakSaves(s);
    const r = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: { scraped: { price: 250000 } } }) });
    assert.equal(r.status, 500);
    assert.deepEqual(await getListing(s, "scraped"), p0);
  } finally { await s.close(); }
});

test("recalc-commute also refreshes the maps link", async () => {
  const s = await start({ fetchImpl: geoFetch, pauseMs: 0 });
  try {
    const { id } = await addManual(s);
    assert.equal((await getListing(s, id)).mapsUrl, undefined);
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(homeProfile()) });
    await fetch(s.base + "/api/listings/recalc-commute", { method: "POST", headers: s.auth });
    await s.app.locals.commuteJob.idle();
    assert.match((await getListing(s, id)).mapsUrl, /origin=K%C3%B6nigsallee.*destination=51\.4556,7\.0116$/);
  } finally { await s.close(); }
});
