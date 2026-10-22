// Money module tests. German transfer-tax rates were checked in June 2026 (TRANSFER_TAX_CHECKED);
// buyers must verify the current rate for their state before relying on the numbers.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../public/money");

test("annuity: standard monthly rate and zero-interest case", () => {
  assert.ok(Math.abs(M.annuity(200000, 3.6, 25) - 1012.01) <= 0.005);
  assert.equal(M.annuity(1200, 0, 1), 100);
  assert.equal(M.annuity(0, 3.6, 25), 0);
});

test("purchaseCosts: NW transfer tax, notary and agent fee", () => {
  assert.deepEqual(M.purchaseCosts(300000, { buy: { state: "NW", agentFeePct: 3.57 } }),
    { transferTax: 19500, notary: 6000, agent: 10710, total: 36210 });
});

test("buyMonthly: loan includes purchase costs minus equity", () => {
  const r = M.buyMonthly(300000, { buy: { state: "BY", agentFeePct: 0, equity: 60000, apr: 3.6, years: 25 } });
  assert.equal(r.loan, 256500);
  assert.ok(Math.abs(r.monthly - M.annuity(256500, 3.6, 25)) <= 0.005);
});

test("affordability: fits, tight, too-much and unknown", () => {
  const p = { money: { netIncome: 3000, affordShare: 0.33 } };
  const a = M.affordability(1000, p);
  assert.ok(Math.abs(a.share - 1000 / 3000) < 1e-9);
  assert.equal(a.level, "tight");
  assert.equal(M.affordability(900, p).level, "fits");
  assert.equal(M.affordability(1200, p).level, "too-much");
  assert.equal(M.affordability(1000, { money: { netIncome: 0, affordShare: 0.33 } }).level, "unknown");
});

test("warmRent: warm value, cold plus utilities, or null", () => {
  assert.equal(M.warmRent({ warmRent: 950 }), 950);
  assert.equal(M.warmRent({ coldRent: 800, utilities: 180 }), 980);
  assert.equal(M.warmRent({ coldRent: 800 }), null);
});

test("TRANSFER_TAX covers all 16 states and carries the check date", () => {
  assert.equal(Object.keys(M.TRANSFER_TAX).length, 16);
  assert.equal(M.TRANSFER_TAX.BY, 3.5);
  assert.equal(M.TRANSFER_TAX_CHECKED, "2026-06");
});
