// Criteria check, red flags, estimated ratings and the weighted score.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../public/criteria");
const catalogue = require("../public/redflags.json");
const { defaultProfile } = require("../lib/profile");

const profile = (fn = () => {}) => {
  const p = defaultProfile();
  p.money.netIncome = 3200;
  p.modes = { rent: true, buy: true };
  p.rent = { maxWarm: 1000, maxCold: 800, maxDeposit: 2400, maxTakeover: 1000 };
  p.buy.maxPrice = 300000;
  p.flat = { roomsMin: 2, roomsMax: 3, sizeMin: 50, sizeMax: 90, floorMin: 0, floorMax: 4, needsLift: false, outdoor: "any", kitchen: "any", pets: false, moveInFrom: "2026-11-01", moveInTo: "2027-01-31", wbs: "none" };
  p.places = [
    { label: "Work", address: "Work street 1, Essen", lat: 51.45, lon: 7.01, mode: "transit", maxMin: 40, time: "08:00" },
    { label: "School", address: "School street 1, Essen", lat: 51.44, lon: 7.0, mode: "bike", maxMin: 20, time: "08:00" }
  ];
  fn(p);
  return p;
};
const flat = (extra = {}) => ({ title: "Bright flat", mode: "rent", coldRent: 700, utilities: 200, rooms: 2, size: 60, city: "Essen", ...extra });
const keys = (l, p = profile(), others = []) => C.checkCriteria(l, p, catalogue, others).map(r => r.key);
const fails = (l, key, p, others) => C.checkCriteria(l, p || profile(), catalogue, others || []).filter(r => r.key === key);

test("a listing inside every limit passes", () => {
  assert.deepEqual(keys(flat()), []);
});

test("mode must be enabled in the profile", () => {
  assert.deepEqual(fails(flat(), "mode", profile(p => { p.modes = { rent: false, buy: true }; })), [{ key: "mode", value: "rent" }]);
  assert.deepEqual(fails(flat(), "mode"), []);
});

test("warm and cold rent, deposit and takeover limits", () => {
  assert.deepEqual(fails(flat({ utilities: 400 }), "warm"), [{ key: "warm", value: 1100 }]);
  assert.deepEqual(fails(flat({ warmRent: 1000 }), "warm"), []);
  assert.deepEqual(fails(flat({ coldRent: 850, utilities: 100 }), "cold"), [{ key: "cold", value: 850 }]);
  assert.deepEqual(fails(flat(), "cold", profile(p => { p.rent.maxCold = null; })), []);
  assert.deepEqual(fails(flat({ deposit: 2500 }), "deposit"), [{ key: "deposit", value: 2500 }]);
  assert.deepEqual(fails(flat({ deposit: 2400 }), "deposit"), []);
  assert.deepEqual(fails(flat({ takeover: 1500 }), "takeover"), [{ key: "takeover", value: 1500 }]);
  assert.deepEqual(fails(flat({ takeover: 500 }), "takeover"), []);
});

test("purchase price limit applies to buy listings only", () => {
  const b = { title: "Buy", mode: "buy", price: 320000, rooms: 3, size: 80, city: "Essen" };
  assert.deepEqual(fails(b, "price"), [{ key: "price", value: 320000 }]);
  assert.deepEqual(fails({ ...b, price: 300000 }, "price"), []);
  assert.deepEqual(keys({ ...b, price: 250000 }), []);
});

test("rooms, size and floor ranges", () => {
  assert.deepEqual(fails(flat({ rooms: 1.5 }), "rooms"), [{ key: "rooms", value: 1.5 }]);
  assert.deepEqual(fails(flat({ rooms: 4 }), "rooms"), [{ key: "rooms", value: 4 }]);
  assert.deepEqual(fails(flat({ rooms: 3 }), "rooms"), []);
  assert.deepEqual(fails(flat({ size: 45 }), "size"), [{ key: "size", value: 45 }]);
  assert.deepEqual(fails(flat({ size: 95 }), "size"), [{ key: "size", value: 95 }]);
  assert.deepEqual(fails(flat({ size: 90 }), "size"), []);
  assert.deepEqual(fails(flat({ floor: 5 }), "floor"), [{ key: "floor", value: 5 }]);
  assert.deepEqual(fails(flat({ floor: -1 }), "floor"), [{ key: "floor", value: -1 }]);
  assert.deepEqual(fails(flat({ floor: 4 }), "floor"), []);
});

test("lift, outdoor, kitchen, pets: a known no fails, unknown passes", () => {
  const p = profile(p => { p.flat.needsLift = true; p.flat.outdoor = "balcony"; p.flat.kitchen = "required"; p.flat.pets = true; });
  assert.deepEqual(keys(flat(), p), []);
  assert.deepEqual(fails(flat({ floor: 3, lift: false }), "lift", p), [{ key: "lift", value: false }]);
  assert.deepEqual(fails(flat({ floor: 0, lift: false }), "lift", p), []);
  assert.deepEqual(fails(flat({ floor: 3, lift: true }), "lift", p), []);
  assert.deepEqual(fails(flat({ outdoor: "none" }), "outdoor", p), [{ key: "outdoor", value: "none" }]);
  assert.deepEqual(fails(flat({ outdoor: "garden" }), "outdoor", p), []);
  const garden = profile(p => { p.flat.outdoor = "garden"; });
  assert.deepEqual(fails(flat({ outdoor: "balcony" }), "outdoor", garden), [{ key: "outdoor", value: "balcony" }]);
  assert.deepEqual(fails(flat({ outdoor: "both" }), "outdoor", garden), []);
  assert.deepEqual(fails(flat({ kitchen: false }), "kitchen", p), [{ key: "kitchen", value: false }]);
  assert.deepEqual(fails(flat({ kitchen: true }), "kitchen", p), []);
  assert.deepEqual(fails(flat({ petsAllowed: false }), "pets", p), [{ key: "pets", value: false }]);
  assert.deepEqual(fails(flat({ petsAllowed: false }), "pets"), []);
});

test("move-in window and WBS rule", () => {
  assert.deepEqual(fails(flat({ availableFrom: "2027-02-15" }), "movein"), [{ key: "movein", value: "2027-02-15" }]);
  assert.deepEqual(fails(flat({ availableFrom: "2026-10-01" }), "movein"), [{ key: "movein", value: "2026-10-01" }]);
  assert.deepEqual(fails(flat({ availableFrom: "2026-12-01" }), "movein"), []);
  assert.deepEqual(fails(flat({ wbsRequired: true }), "wbs"), [{ key: "wbs", value: true }]);
  assert.deepEqual(fails(flat({ wbsRequired: true }), "wbs", profile(p => { p.flat.wbs = "exclude"; })), [{ key: "wbs", value: true }]);
  assert.deepEqual(fails(flat({ wbsRequired: true }), "wbs", profile(p => { p.flat.wbs = "have"; })), []);
  assert.deepEqual(fails(flat({ wbsRequired: false }), "wbs"), []);
});

test("every place's commute limit; an unknown commute passes", () => {
  const now = "2026-10-19T08:00:00Z";
  assert.deepEqual(fails(flat({ commute: [{ minutes: 45, checkedAt: now }, { minutes: 25, checkedAt: now }] }), "commute"), [{ key: "commute", value: 0 }, { key: "commute", value: 1 }]);
  assert.deepEqual(fails(flat({ commute: [{ minutes: 40, checkedAt: now }, null] }), "commute"), []);
  assert.deepEqual(fails(flat(), "commute"), []);
});

test("radius by haversine distance from the centre", () => {
  const p = profile(p => { p.radius = { center: { address: "Centre", lat: 51.4556, lon: 7.0116 }, km: 10 }; });
  // 0.1° of latitude is about 11.1 km
  const far = fails(flat({ lat: 51.5556, lon: 7.0116 }), "radius", p);
  assert.equal(far.length, 1);
  assert.ok(Math.abs(far[0].value - 11.1) < 0.1);
  assert.deepEqual(fails(flat({ lat: 51.5, lon: 7.0116 }), "radius", p), []);
  assert.deepEqual(fails(flat(), "radius", p), []);
  assert.ok(Math.abs(C.distanceKm({ lat: 51.4556, lon: 7.0116 }, { lat: 51.2254, lon: 6.7787 }) - 30.4) < 0.5);
});

const on = ids => profile(p => { p.redFlags = ids.map(id => ({ id, on: true })); });
const flagIds = (l, p, others = []) => C.redFlagHits(l, p, catalogue, others).map(d => d.id);

test("the catalogue has the six entries with en/de/pt texts", () => {
  assert.deepEqual(catalogue.map(d => d.id), ["deposit-before-viewing", "owner-abroad", "underpriced", "odd-payment", "id-before-contact", "viewing-fee"]);
  for (const d of catalogue) {
    assert.equal(typeof d.default, "boolean", d.id);
    for (const l of ["en", "de", "pt"]) { assert.ok(d.label[l], d.id + " label " + l); assert.ok(d.reason[l], d.id + " reason " + l); }
    if (d.id === "underpriced") assert.equal(d.computed, "underpriced"); else new RegExp(d.test, "i");
  }
});

test("each text red flag matches typical wording in title, notes or description", () => {
  const p = on(catalogue.map(d => d.id));
  const cases = {
    "deposit-before-viewing": ["Bitte die Kaution vor der Besichtigung überweisen.", "Please pay the deposit before the viewing.", "Bitte überweisen Sie die Kaution vor der Besichtigung", "Reservierungsgebühr von 200 € vor dem Besichtigungstermin", "Vor der Besichtigung bitte 300 € Anzahlung überweisen."],
    "owner-abroad": ["Ich wohne zurzeit im Ausland, die Schlüssel schicke ich per Post.", "I am abroad, keys will be sent by courier."],
    "odd-payment": ["Zahlung per Western Union", "Payment in Bitcoin or gift cards only", "MoneyGram transfer", "Bitte bezahlen Sie mit Amazon-Gutscheinen", "Zahlung per Steam-Karte"],
    "id-before-contact": ["Vor dem ersten Kontakt bitte eine Kopie Ihres Personalausweises senden.", "Send a copy of your passport before we talk.", "Senden Sie mir zuerst eine Kopie Ihres Personalausweises, dann schicke ich die Adresse", "Ausweiskopie bitte vor der Besichtigung schicken"],
    "viewing-fee": ["Besichtigung nur gegen Gebühr", "There is a viewing fee of 50 EUR."]
  };
  for (const [id, texts] of Object.entries(cases)) {
    for (const t of texts) {
      assert.ok(flagIds(flat({ notes: t }), p).includes(id), `${id}: ${t}`);
      assert.ok(flagIds(flat({ description: t }), p).includes(id), `${id} (description): ${t}`);
    }
  }
  assert.ok(flagIds(flat({ title: "Viewing fee required" }), p).includes("viewing-fee"));
  assert.deepEqual(flagIds(flat({ notes: "Lovely flat near the park, viewing on Saturday, deposit three cold rents." }), p), []);
});

test("normal listing wording triggers no red flag", () => {
  const p = on(catalogue.map(d => d.id));
  const benign = [
    "Kaution: 3 Monatsmieten",
    "Besichtigung nach Vereinbarung",
    "Bitte Ausweis, Schufa und Gehaltsnachweise vorlegen",
    "Die Kaution ist vor Schlüsselübergabe zu zahlen",
    "Kaution 2.100 EUR, Bezug vorbehaltlich Besichtigung",
    "Vor der Besichtigung bitte die Anzahl der Personen angeben",
    "500 € Umzugsgutschein für Neumieter",
    "Ausweis ist bei der Besichtigung vorzuzeigen",
    "Bitte Einkommen (Zahlungseingänge) der letzten drei Monate nachweisen",
    "Einbauküche vorhanden, Vorstellung der Mieter beim Termin"
  ];
  for (const t of benign) assert.deepEqual(flagIds(flat({ notes: t }), p), [], t);
});

test("flags that are off, or missing from the profile with default off, do not hit; defaults apply when missing", () => {
  const t = flat({ notes: "Zahlung per Western Union" });
  assert.deepEqual(flagIds(t, profile(p => { p.redFlags = [{ id: "odd-payment", on: false }]; })), []);
  const def = catalogue.find(d => d.id === "odd-payment").default;
  assert.equal(flagIds(t, profile(p => { p.redFlags = []; })).includes("odd-payment"), def);
});

test("the computed underpriced flag compares price per m² with the city median", () => {
  const p = on(["underpriced"]);
  const others = [600, 650, 700].map(c => flat({ coldRent: c, size: 60 }));
  // median 650/60 = 10.83 €/m²; 60 % is 6.50 €/m²
  assert.deepEqual(flagIds(flat({ coldRent: 360, size: 60 }), p, others), ["underpriced"]);
  assert.deepEqual(flagIds(flat({ coldRent: 400, size: 60 }), p, others), []);
  assert.deepEqual(flagIds(flat({ coldRent: 360, size: 60 }), p, others.slice(0, 2)), []);
  assert.deepEqual(flagIds(flat({ coldRent: 360, size: 60, city: "Bochum" }), p, others), []);
  const buys = [3000, 3200, 3400].map(v => ({ mode: "buy", price: v * 80, size: 80, city: "Essen" }));
  assert.deepEqual(flagIds({ mode: "buy", price: 1500 * 80, size: 80, city: "essen " }, p, buys), ["underpriced"]);
  assert.deepEqual(flagIds({ mode: "buy", price: 1500 * 80, size: 80, city: "Essen" }, p, others), []);
  const self = flat({ coldRent: 360, size: 60 });
  assert.deepEqual(flagIds(self, p, [...others.slice(0, 2), self]), []);
  const hit = C.checkCriteria(flat({ coldRent: 360, size: 60 }), p, catalogue, others).filter(r => r.key === "flag");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].value, "underpriced");
  assert.equal(hit[0].def.id, "underpriced");
});

test("custom red flags use their own pattern and label", () => {
  const p = profile(p => { p.redFlags = [{ id: "custom-1", on: true, label: "Basement flat", match: "souterrain|basement" }]; });
  const hits = C.redFlagHits(flat({ title: "Cosy Souterrain flat" }), p, catalogue, []);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "custom-1");
  assert.equal(hits[0].label.de, "Basement flat");
  assert.deepEqual(flagIds(flat(), p), []);
  const off = profile(p => { p.redFlags = [{ id: "custom-1", on: false, label: "Basement flat", match: "basement" }]; });
  assert.deepEqual(flagIds(flat({ title: "basement" }), off), []);
});

test("pricePerSqm uses the price for buying and the cold (else warm) rent for renting", () => {
  assert.equal(C.pricePerSqm({ mode: "buy", price: 240000, size: 80 }), 3000);
  assert.equal(C.pricePerSqm(flat({ coldRent: 600, size: 60 })), 10);
  assert.equal(C.pricePerSqm({ mode: "rent", warmRent: 900, size: 60 }), 15);
  assert.equal(C.pricePerSqm({ mode: "rent", coldRent: 600 }), null);
});

test("estimate bands for price, size and commute; unknown parts are omitted", () => {
  const p = profile();
  // rent: warm rent vs maxWarm 1000
  assert.equal(C.estimateRating(flat({ coldRent: 650 }), p).price, 9); // 850 = 85 %
  assert.equal(C.estimateRating(flat({ coldRent: 800 }), p).price, 7); // 1000 = 100 %
  assert.equal(C.estimateRating(flat({ coldRent: 801 }), p).price, 3);
  // buy: price vs maxPrice 300000
  assert.equal(C.estimateRating({ mode: "buy", price: 255000, size: 60 }, p).price, 9);
  assert.equal(C.estimateRating({ mode: "buy", price: 300000, size: 60 }, p).price, 7);
  assert.equal(C.estimateRating({ mode: "buy", price: 300001, size: 60 }, p).price, 3);
  // size vs sizeMin 50
  assert.equal(C.estimateRating(flat({ size: 60 }), p).size, 9);
  assert.equal(C.estimateRating(flat({ size: 50 }), p).size, 7);
  assert.equal(C.estimateRating(flat({ size: 49 }), p).size, 3);
  // commute: worst place ratio (limits 40 and 20)
  const r = m => C.estimateRating(flat({ commute: m.map(x => x == null ? null : { minutes: x, checkedAt: "2026-10-19T08:00:00Z" }) }), p).commute;
  assert.equal(r([20, 10]), 10);
  assert.equal(r([40, 10]), 8);
  assert.equal(r([20, 30]), 5);
  assert.equal(r([61, 10]), 2);
  assert.equal(r([null, 10]), 10);
  assert.equal(r([null, null]), undefined);
  assert.equal(C.estimateRating(flat(), p).commute, undefined);
  const est = C.estimateRating(flat(), p);
  for (const k of ["area", "condition", "contact"]) assert.equal(est[k], undefined, k);
  assert.equal(C.estimateRating({ mode: "rent" }, p), null);
});

test("score = round(Σ rating × weight ÷ Σ weights × 10), skipping missing ratings and zero weights", () => {
  const w = { price: 2, size: 1.5, commute: 2, area: 1, condition: 1, contact: 1 };
  assert.equal(C.scoreListing({ rating: { price: 8, size: 6, commute: 7, area: 5, condition: 9, contact: 4 } }, w), Math.round((16 + 9 + 14 + 5 + 9 + 4) / 8.5 * 10));
  assert.equal(C.scoreListing({ rating: { price: 9, size: 7 } }, w), Math.round((18 + 10.5) / 3.5 * 10));
  assert.equal(C.scoreListing({ rating: { price: 9, size: 7 } }, { ...w, size: 0 }), 90);
  assert.equal(C.scoreListing({ rating: { price: 14 } }, w), 100);
  assert.equal(C.scoreListing({}, w), null);
  assert.equal(C.scoreListing({ rating: { area: 5 } }, { ...w, area: 0 }), null);
});
