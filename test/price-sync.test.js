const test = require("node:test");
const assert = require("node:assert/strict");
const { applySeen, headline, modeOf } = require("../lib/price-sync");
const fs = require("node:fs");
const path = require("node:path");
const { start } = require("./helpers");

const D = "2026-10-22";

test("buy: a new price is applied, logged and added to the history; the same price is no change", () => {
  const c = { title: "Example", mode: "buy", price: 300000, priceHistory: [{ date: "2026-10-01", price: 300000 }] };
  assert.deepEqual(applySeen(c, { price: 285000 }, "example", D), { date: D, type: "price", field: "price", id: "example", text: "Example", from: 300000, to: 285000 });
  assert.equal(c.price, 285000);
  assert.deepEqual(c.priceHistory.at(-1), { date: D, price: 285000 });
  assert.equal(applySeen(c, { price: 285000 }, "example", D), null);
  assert.equal(applySeen(c, { warmRent: 900 }, "example", D), null, "rent amounts are ignored on a buy listing");
  assert.equal(c.priceHistory.length, 2);
});

test("rent: warm rent changes are logged as warmRent with the cold rent kept in the history", () => {
  const c = { title: "Example", mode: "rent", coldRent: 800, utilities: 190, warmRent: 990, priceHistory: [] };
  assert.deepEqual(applySeen(c, { warmRent: 1010, coldRent: 820 }, "example", D), { date: D, type: "price", field: "warmRent", id: "example", text: "Example", from: 990, to: 1010 });
  assert.equal(c.coldRent, 820);
  assert.deepEqual(c.priceHistory, [{ date: D, price: 1010, coldRent: 820 }]);
});

test("rent: a cold rent alone derives the warm rent from known utilities", () => {
  const c = { title: "Example", mode: "rent", coldRent: 800, utilities: 190, warmRent: 990 };
  assert.deepEqual(applySeen(c, { coldRent: 760 }, "example", D), { date: D, type: "price", field: "warmRent", id: "example", text: "Example", from: 990, to: 950 });
  assert.equal(c.warmRent, 950);
});

test("rent: an explicit warm rent that stays the same logs a cold-rent change", () => {
  const c = { title: "Example", mode: "rent", coldRent: 800, warmRent: 990 };
  assert.deepEqual(applySeen(c, { coldRent: 780, warmRent: 990 }, "example", D), { date: D, type: "price", field: "coldRent", id: "example", text: "Example", from: 800, to: 780 });
  assert.equal(c.priceHistory.length, 1);
});

test("rent: cold-only listings log coldRent; `price` on a rent listing and bad numbers are ignored", () => {
  const c = { title: "Example", mode: "rent", coldRent: 700 };
  assert.deepEqual(applySeen(c, { coldRent: 720 }, "example", D), { date: D, type: "price", field: "coldRent", id: "example", text: "Example", from: 700, to: 720 });
  for (const s of [{ price: 650 }, { coldRent: -1 }, { coldRent: "720" }, { warmRent: 1e9 }, {}, null]) assert.equal(applySeen(c, s, "example", D), null, JSON.stringify(s));
  assert.equal(c.coldRent, 720);
});

test("modeOf: listings without a mode count as bought only when they carry nothing but a price", () => {
  assert.equal(modeOf({ price: 9000 }), "buy");
  assert.equal(modeOf({ price: 9000, coldRent: 700 }), "rent");
  assert.equal(modeOf({}), "rent");
  assert.equal(headline({ mode: "rent", coldRent: 700, utilities: 100 }), 800);
});

test("POST /api/sync is mode-aware: rent listings follow warm and cold rent, buy listings the price", async () => {
  const s = await start();
  try {
    const put = (id, body) => fetch(s.base + "/api/listings/" + id, { method: "PUT", headers: s.sync, body: JSON.stringify(body) });
    await put("rent-1", { title: "Rent", mode: "rent", coldRent: 800, utilities: 190, warmRent: 990, priceHistory: [{ date: "2026-10-01", price: 990, coldRent: 800 }] });
    await put("buy-1", { title: "Buy", mode: "buy", price: 300000, priceHistory: [{ date: "2026-10-01", price: 300000 }] });
    const r = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: { "rent-1": { warmRent: 950, coldRent: 760 }, "buy-1": { price: 290000 } } }) });
    assert.equal(r.status, 200);
    const { changes } = await r.json();
    assert.deepEqual(changes.map(c => [c.id, c.field, c.from, c.to]), [["rent-1", "warmRent", 990, 950], ["buy-1", "price", 300000, 290000]]);
    const l = s.app.locals.state.listings;
    assert.equal(l["rent-1"].warmRent, 950);
    assert.equal(l["rent-1"].price, undefined, "a rent listing never gets a price");
    assert.deepEqual(l["rent-1"].priceHistory.at(-1), { date: changes[0].date, price: 950, coldRent: 760 });
    assert.equal(l["buy-1"].price, 290000);
    const log = (await (await fetch(s.base + "/api/meta", { headers: s.auth })).json()).log;
    assert.deepEqual(log.filter(e => e.type === "price").map(e => e.field), ["warmRent", "price"]);
  } finally { await s.close(); }
});

test("rent: a warm rent appearing on a cold-only listing is no price change when the cold rent stays", () => {
  const c = { title: "Example", mode: "rent", coldRent: 800 };
  assert.equal(applySeen(c, { warmRent: 990, coldRent: 800 }, "example", D), null);
  assert.equal(c.warmRent, 990);
  assert.equal(c.priceHistory, undefined);
});

test("rent: a warm rent appearing together with a new cold rent logs the cold rent change", () => {
  const c = { title: "Example", mode: "rent", coldRent: 800 };
  assert.deepEqual(applySeen(c, { warmRent: 990, coldRent: 780 }, "example", D), { date: D, type: "price", field: "coldRent", id: "example", text: "Example", from: 800, to: 780 });
  assert.equal(c.warmRent, 990);
  assert.deepEqual(c.priceHistory, [{ date: D, price: 990, coldRent: 780 }]);
});

test("rent: a derived warm rent is rounded to cents", () => {
  const c = { title: "Example", mode: "rent", coldRent: 800, utilities: 190.1, warmRent: 990.1 };
  applySeen(c, { coldRent: 760.2 }, "example", D);
  assert.equal(c.warmRent, 950.3);
});

test("applySeen ignores garbage entries", () => {
  const c = { title: "Example", mode: "rent", coldRent: 700 };
  for (const s of [true, "x", 5, undefined]) assert.equal(applySeen(c, s, "example", D), null);
});

test("sync: a garbage seen entry clears gone without a price change; a failed save rolls a rent listing back", async () => {
  const s = await start();
  try {
    const put = (id, body) => fetch(s.base + "/api/listings/" + id, { method: "PUT", headers: s.sync, body: JSON.stringify(body) });
    await put("g-1", { title: "G", mode: "rent", coldRent: 700, warmRent: 800 });
    s.app.locals.state.listings["g-1"].gone = true;
    const r = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: { "g-1": true } }) });
    assert.deepEqual((await r.json()).changes.map(c => c.type), ["back"]);
    assert.equal(s.app.locals.state.listings["g-1"].warmRent, 800);
  } finally { await s.close(); }
});

test("sync: a failed save rolls back cold rent, warm rent and price history of a rent listing", async () => {
  const s = await start();
  try {
    await fetch(s.base + "/api/listings/r-1", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "R", mode: "rent", coldRent: 800, utilities: 190, warmRent: 990, priceHistory: [{ date: "2026-10-01", price: 990, coldRent: 800 }] }) });
    const before = structuredClone(s.app.locals.state.listings["r-1"]);
    fs.rmSync(path.join(s.dir, "listings.json")); fs.mkdirSync(path.join(s.dir, "listings.json"));
    const r = await fetch(s.base + "/api/sync", { method: "POST", headers: s.sync, body: JSON.stringify({ seen: { "r-1": { warmRent: 950, coldRent: 760 } } }) });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: "save failed" });
    assert.deepEqual(s.app.locals.state.listings["r-1"], before);
  } finally { await s.close(); }
});
