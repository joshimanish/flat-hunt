const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../public/criteria");

const item = minutes => ({ name: "x", minutes, meters: minutes * 80, estimated: false });
const amenities = (m = {}) => ({ status: "ok", items: { transit: item(3), supermarket: item(4), pharmacy: item(5), doctors: item(9), kindergarten: item(14), school: item(25), park: null, playground: item(18), ...m } });

test("everyday points per group: ≤ 5 min 1, ≤ 10 0.75, ≤ 15 0.5, ≤ 20 0.25, else 0; best of kindergarten/school and park/playground", () => {
  const r = C.areaRating({ amenities: amenities() });
  // transit 1, supermarket 1, pharmacy 1, doctor 0.75, kindergarten 0.5 (school 25 min ignored), playground 0.25 → 4.5 / 6 × 10 = 7.5
  assert.equal(r.parts[0].value, 7.5);
  assert.deepEqual(r.parts[0].groups.map(g => g.points), [1, 1, 1, 0.75, 0.5, 0.25]);
  assert.equal(r.value, 8);
  const none = C.areaRating({ amenities: { status: "ok", items: { transit: null } } });
  assert.equal(none.value, 0);
});

test("flood, noise and crime deduct; no-data and errors deduct nothing", () => {
  const all = { amenities: amenities({ doctors: item(5), kindergarten: item(5), playground: item(5) }) }; // everyday 10
  assert.equal(C.areaRating(all).value, 10);
  const r = C.areaRating({ ...all, flood: { status: "ok", worst: "low" }, noise: { status: "ok", max: 70 }, crime: { status: "ok", ratio: { total: 2 } } });
  assert.deepEqual(r.parts.map(p => [p.key, p.value]), [["everyday", 10], ["flood", -0.5], ["noise", -2], ["crime", -1]]);
  assert.equal(r.value, 7, "10 − 3.5 = 6.5 rounds to 7");
  assert.equal(C.areaRating({ ...all, flood: { status: "ok", worst: "high" }, noise: { status: "ok", max: 75 } }).value, 5);
  assert.equal(C.areaRating({ ...all, flood: { status: "ok", worst: "medium" }, noise: { status: "ok", max: 55 }, crime: { status: "ok", ratio: { total: 1.2 } } }).value, 7);
  assert.equal(C.areaRating({ ...all, noise: { status: "ok", max: null }, crime: { status: "ok", ratio: { total: 1.19 } } }).value, 10);
  assert.equal(C.areaRating({ ...all, flood: { status: "no-data" }, noise: { status: "error" }, crime: { status: "no-data" } }).value, 10);
  assert.equal(C.areaRating({ amenities: amenities({ transit: null, supermarket: null, pharmacy: null, doctors: null, kindergarten: null, playground: null }), flood: { status: "ok", worst: "high" } }).value, 0, "clamped at 0");
});

test("no area rating until the amenities are known; the estimate includes it", () => {
  assert.equal(C.areaRating(undefined), null);
  assert.equal(C.areaRating({ amenities: { status: "error" } }), null);
  const p = { modes: { rent: true, buy: false }, rent: { maxWarm: 1000, maxCold: null }, buy: { maxPrice: 300000 }, flat: { sizeMin: 50 }, places: [] };
  const l = { mode: "rent", coldRent: 600, utilities: 150, size: 60, area: { amenities: amenities() } };
  assert.equal(C.estimateRating(l, p).area, 8);
  assert.equal(C.estimateRating({ mode: "rent", area: { amenities: amenities() } }, p).area, 8);
});

test("priceCheck compares price per m² with the same postcode first, else the same city, from 3 other listings", () => {
  const mk = (id, coldRent, postcode, city = "Düsseldorf", extra = {}) => ({ id, mode: "rent", coldRent, size: 50, postcode, city, ...extra });
  const l = mk("me", 750, "40210");
  const others = [l, mk("a", 500, "40210"), mk("b", 600, "40210"), mk("c", 700, "40211"), mk("d", 800, "40212"), mk("e", 400, "40210", "Düsseldorf", { gone: true }), mk("f", 500, "40210", "Düsseldorf", { mode: "buy", price: 1 })];
  const city = C.priceCheck(l, others);
  assert.deepEqual(city, { own: 15, median: 13, n: 4, level: "city", diff: 0.15 });
  const pc = C.priceCheck(l, [...others, mk("g", 550, "40210")]);
  assert.deepEqual([pc.level, pc.n, pc.median], ["postcode", 3, 11]);
  assert.equal(C.priceCheck(l, [l, mk("a", 500, "40210")]), null);
  assert.equal(C.priceCheck({ mode: "rent", coldRent: 700 }, others), null);
});

test("flood zone of unstated class counts like the extreme scenario; prototype keys are ignored", () => {
  const all = { amenities: amenities({ doctors: item(5), kindergarten: item(5), playground: item(5) }) };
  const r = C.areaRating({ ...all, flood: { status: "ok", worst: "unknown" } });
  assert.deepEqual(r.parts.filter(p => p.key === "flood"), [{ key: "flood", value: -0.5, worst: "unknown" }]);
  assert.equal(r.value, 10, "10 − 0.5 = 9.5 rounds to 10");
  assert.equal(C.areaRating({ ...all, flood: { status: "ok", worst: "constructor" } }).parts.length, 1);
});

test("priceCheck without ids excludes the listing itself by identity only", () => {
  const mk = (coldRent, postcode) => ({ mode: "rent", coldRent, size: 50, postcode, city: "Düsseldorf" });
  const l = mk(750, "40210"), others = [l, mk(500, "40210"), mk(600, "40210"), mk(700, "40210")];
  const r = C.priceCheck(l, others);
  assert.deepEqual([r.level, r.n, r.median], ["postcode", 3, 12]);
});

test("estimated walking minutes score like routed ones (estimates already include a detour factor)", () => {
  const est = m => ({ ...item(m), estimated: true });
  const a = C.areaRating({ amenities: amenities({ transit: est(3), supermarket: est(12) }) });
  const b = C.areaRating({ amenities: amenities({ transit: item(3), supermarket: item(12) }) });
  assert.deepEqual(a.parts[0], b.parts[0]);
});
