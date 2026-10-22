const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../lib/profile");
const { defaultProfile, validateProfile } = P;

const bad = (mutate, expected) => {
  const p = defaultProfile(); mutate(p);
  const { errors, value } = validateProfile(p);
  assert.equal(value, null);
  assert.ok(errors.some(e => e.includes(expected)), `expected "${expected}" in ${JSON.stringify(errors)}`);
};
const place = (o = {}) => ({ label: "Work", address: "Somewhere 1", lat: 51.2, lon: 6.8, maxMin: 40, mode: "transit", time: "08:30", ...o });

test("constants", () => {
  assert.deepEqual(P.LANGS, ["en", "de", "pt"]);
  assert.deepEqual(P.PLACE_MODES, ["car", "transit", "bike"]);
  assert.deepEqual(P.OUTDOOR, ["any", "balcony", "garden"]);
  assert.deepEqual(P.KITCHEN, ["any", "required"]);
  assert.deepEqual(P.WBS, ["none", "have", "exclude"]);
  assert.equal(P.STATES.length, 16);
  assert.deepEqual(P.WEIGHT_KEYS, ["price", "size", "commute", "area", "condition", "contact"]);
});

test("default profile is valid and returned fresh", () => {
  const { errors, value } = validateProfile(defaultProfile());
  assert.deepEqual(errors, []);
  assert.equal(value.name, "Flat Hunt");
  assert.notEqual(defaultProfile(), defaultProfile());
  assert.equal(defaultProfile().buy.state, "NW");
});

test("non-object input and missing/unknown fields", () => {
  assert.deepEqual(validateProfile(null).errors, ["profile must be an object"]);
  bad(p => { delete p.rent; }, "rent: missing");
  bad(p => { p.extra = 1; }, "extra: unknown field");
  bad(p => { p.flat.constructor = 1; }, "flat.constructor: unknown field");
  bad(p => { p.version = 2; }, "version");
});

test("enums are rejected when wrong", () => {
  bad(p => { p.languages = ["fr"]; }, "languages[0]");
  bad(p => { p.flat.outdoor = "roof"; }, "flat.outdoor");
  bad(p => { p.flat.kitchen = "yes"; }, "flat.kitchen");
  bad(p => { p.flat.wbs = "maybe"; }, "flat.wbs");
  bad(p => { p.buy.state = "XX"; }, "buy.state");
  bad(p => { p.outreach.language = "fr"; }, "outreach.language");
  bad(p => { p.places = [place({ mode: "boat" })]; }, "places[0].mode");
});

test("modes", () => {
  bad(p => { p.modes = { rent: false, buy: false }; }, "modes: at least one");
  const p = defaultProfile(); p.modes = { rent: false, buy: true };
  assert.deepEqual(validateProfile(p).errors, []);
});

test("ranges", () => {
  bad(p => { p.money.affordShare = 0.19; }, "money.affordShare");
  bad(p => { p.money.affordShare = 0.51; }, "money.affordShare");
  bad(p => { p.money.netIncome = 100001; }, "money.netIncome");
  bad(p => { p.rent.maxWarm = -1; }, "rent.maxWarm");
  bad(p => { p.rent.maxCold = 20001; }, "rent.maxCold");
  bad(p => { p.rent.maxDeposit = 100001; }, "rent.maxDeposit");
  bad(p => { p.buy.maxPrice = 10000001; }, "buy.maxPrice");
  bad(p => { p.buy.apr = 15.1; }, "buy.apr");
  bad(p => { p.buy.years = 4; }, "buy.years");
  bad(p => { p.buy.agentFeePct = 7.15; }, "buy.agentFeePct");
  bad(p => { p.flat.roomsMin = 0.5; }, "flat.roomsMin");
  bad(p => { p.flat.sizeMin = 9; }, "flat.sizeMin");
  bad(p => { p.flat.floorMin = -2; }, "flat.floorMin");
  bad(p => { p.flat.floorMax = 41; }, "flat.floorMax");
  bad(p => { p.flat.roomsMin = "2"; }, "flat.roomsMin");
  const ok = defaultProfile(); ok.flat.roomsMin = 2.5; ok.flat.floorMin = -1; ok.rent.maxCold = 800; ok.buy.agentFeePct = 7.14;
  assert.deepEqual(validateProfile(ok).errors, []);
});

test("max below min", () => {
  bad(p => { p.flat.roomsMin = 3; p.flat.roomsMax = 2; }, "flat.roomsMax");
  bad(p => { p.flat.sizeMin = 80; p.flat.sizeMax = 60; }, "flat.sizeMax");
  bad(p => { p.flat.floorMin = 3; p.flat.floorMax = 1; }, "flat.floorMax");
  const ok = defaultProfile(); ok.flat.roomsMax = 2; ok.flat.sizeMax = 50; ok.flat.floorMin = 1; ok.flat.floorMax = 1;
  assert.deepEqual(validateProfile(ok).errors, []);
});

test("move-in dates", () => {
  bad(p => { p.flat.moveInFrom = "01.02.2027"; }, "flat.moveInFrom");
  bad(p => { p.flat.moveInTo = "2027-02-30"; }, "flat.moveInTo");
  bad(p => { p.flat.moveInFrom = "2027-03-01"; p.flat.moveInTo = "2027-02-01"; }, "flat.moveInTo");
  const ok = defaultProfile(); ok.flat.moveInFrom = "2028-02-29"; ok.flat.moveInTo = "2028-03-01";
  assert.deepEqual(validateProfile(ok).errors, []);
});

test("places", () => {
  const ok = defaultProfile(); ok.places = [place()];
  assert.deepEqual(validateProfile(ok).errors, []);
  bad(p => { p.places = Array.from({ length: 6 }, () => place()); }, "places");
  bad(p => { p.places = [place({ time: "8:30" })]; }, "places[0].time");
  bad(p => { p.places = [place({ time: "24:00" })]; }, "places[0].time");
  bad(p => { p.places = [place({ maxMin: 4 })]; }, "places[0].maxMin");
  bad(p => { p.places = [place({ maxMin: 181 })]; }, "places[0].maxMin");
  bad(p => { p.places = [place({ lat: 91 })]; }, "places[0].lat");
  bad(p => { p.places = [place({ lon: -181 })]; }, "places[0].lon");
  bad(p => { p.places = [place({ label: "" })]; }, "places[0].label");
  bad(p => { p.places = [place({ address: "x".repeat(201) })]; }, "places[0].address");
});

test("radius", () => {
  const ok = defaultProfile(); ok.radius = { center: { address: "Mitte", lat: 52.5, lon: 13.4 }, km: 25 };
  assert.deepEqual(validateProfile(ok).errors, []);
  bad(p => { p.radius.km = 10; }, "radius");
  bad(p => { p.radius.center = { address: "Mitte", lat: 52.5, lon: 13.4 }; }, "radius");
  bad(p => { p.radius = { center: { address: "Mitte", lat: 52.5, lon: 13.4 }, km: 0 }; }, "radius.km");
  bad(p => { p.radius = { center: { address: "Mitte", lat: 52.5, lon: 13.4 }, km: 101 }; }, "radius.km");
  bad(p => { p.radius = { center: { address: "Mitte", lat: 95, lon: 13.4 }, km: 5 }; }, "radius.center.lat");
  bad(p => { p.radius = { center: { label: "x", address: "Mitte", lat: 5, lon: 13.4 }, km: 5 }; }, "radius.center.label");
});

test("weights", () => {
  bad(p => { for (const k of P.WEIGHT_KEYS) p.weights[k] = 0; }, "weights: at least one");
  bad(p => { p.weights.price = 11; }, "weights.price");
  bad(p => { p.weights.speed = 1; }, "weights.speed: unknown field");
});

test("red flags", () => {
  const ok = defaultProfile();
  ok.redFlags = [{ id: "tauschwohnung", on: true }, { id: "custom-1", on: false, label: "Zwischenmiete", match: "zwischen\\s?miete" }];
  assert.deepEqual(validateProfile(ok).errors, []);
  bad(p => { p.redFlags = [{ id: "Bad_Id", on: true }]; }, "redFlags[0].id");
  bad(p => { p.redFlags = [{ id: "x", on: "yes" }]; }, "redFlags[0].on");
  bad(p => { p.redFlags = [{ id: "custom-1", on: true, match: "abc" }]; }, "redFlags[0].label");
  bad(p => { p.redFlags = [{ id: "custom-1", on: true, label: "L", match: "(" }]; }, "redFlags[0].match");
  bad(p => { p.redFlags = [{ id: "custom-1", on: true, label: "L", match: "a".repeat(201) }]; }, "redFlags[0].match");
  bad(p => { p.redFlags = [{ id: "custom-1", on: true, label: "L" }]; }, "redFlags[0].match");
  bad(p => { p.redFlags = [{ id: "custom-x", on: true, label: "L", match: "a" }]; }, "redFlags[0].id");
  bad(p => { p.redFlags = [{ id: "a", on: true, junk: 1 }]; }, "redFlags[0].junk");
});
