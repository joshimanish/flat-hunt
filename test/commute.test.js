const { test } = require("node:test");
const assert = require("node:assert/strict");
const { travelMinutes, commuteFor, nextWeekdayAt } = require("../lib/commute");

const from = { lat: 51.4556, lon: 7.0116 };
const place = (mode, extra = {}) => ({ label: "Work", address: "x", lat: 51.2254, lon: 6.7787, mode, maxMin: 45, time: "08:00", ...extra });
const NOW = new Date("2026-10-24T08:00:00Z"); // Saturday
const recorder = body => { const urls = []; const f = async url => { urls.push(url); return { ok: true, status: 200, json: async () => body }; }; f.urls = urls; return f; };

test("car asks OSRM from listing to place and rounds minutes", async () => {
  const f = recorder({ routes: [{ duration: 1830 }] });
  assert.equal(await travelMinutes(from, place("car"), f, { now: NOW }), 31);
  assert.ok(f.urls[0].startsWith("https://router.project-osrm.org/route/v1/driving/7.0116,51.4556;6.7787,51.2254"), f.urls[0]);
});

test("bike uses the OSM bike router", async () => {
  const f = recorder({ routes: [{ duration: 3000 }] });
  assert.equal(await travelMinutes(from, place("bike"), f, { now: NOW }), 50);
  assert.ok(f.urls[0].startsWith("https://routing.openstreetmap.de/routed-bike/route/v1/driving/7.0116,51.4556;6.7787,51.2254"), f.urls[0]);
});

test("transit arrives by the place time on the next weekday and takes the fastest itinerary", async () => {
  const f = recorder({ itineraries: [{ duration: 3600 }, { duration: 2700 }, { duration: 3000 }] });
  assert.equal(await travelMinutes(from, place("transit"), f, { now: NOW }), 45);
  assert.equal(f.urls[0], "https://api.transitous.org/api/v1/plan?fromPlace=51.4556,7.0116&toPlace=51.2254,6.7787&time=2026-10-26T07:00:00Z&arriveBy=true");
});

test("next weekday handles the end of summer time and weekdays in summer", () => {
  assert.equal(nextWeekdayAt(new Date("2026-10-24T10:00:00+02:00"), "08:00"), "2026-10-26T07:00:00Z");
  assert.equal(nextWeekdayAt(new Date("2026-07-01T09:00:00+02:00"), "08:00"), "2026-07-02T06:00:00Z");
  assert.equal(nextWeekdayAt(new Date("2026-07-01T06:00:00+02:00"), "08:00"), "2026-07-01T06:00:00Z");
  assert.equal(nextWeekdayAt(new Date("2026-07-03T09:00:00+02:00"), "08:00"), "2026-07-06T06:00:00Z");
});

test("failures and empty results give null", async () => {
  const bad = async () => { throw new Error("offline"); };
  assert.equal(await travelMinutes(from, place("car"), bad, { now: NOW }), null);
  assert.equal(await travelMinutes(from, place("car"), recorder({ routes: [] }), { now: NOW }), null);
  assert.equal(await travelMinutes(from, place("transit"), recorder({ itineraries: [] }), { now: NOW }), null);
  assert.equal(await travelMinutes(from, place("bike"), async () => ({ ok: false, status: 500, json: async () => ({}) }), { now: NOW }), null);
});

test("a slow service times out to null", async () => {
  const slow = (url, opts) => new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal(await travelMinutes(from, place("car"), slow, { now: NOW, ms: 20 }), null);
});

test("commuteFor returns one entry per place in order, null where unknown", async () => {
  const f = async url => url.includes("transitous") ? { ok: true, json: async () => ({ itineraries: [] }) } : { ok: true, json: async () => ({ routes: [{ duration: 600 }] }) };
  const r = await commuteFor(from, [place("car"), place("transit"), place("bike")], f, { now: NOW });
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { minutes: 10, checkedAt: NOW.toISOString() });
  assert.equal(r[1], null);
  assert.equal(r[2].minutes, 10);
  assert.deepEqual(await commuteFor(from, [], f, { now: NOW }), []);
});
