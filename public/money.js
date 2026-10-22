// public/money.js — affordability, German purchase costs, mortgage annuity, warm rent. Loaded by the page (window.Money) and by the tests.
// Rates in TRANSFER_TAX were checked in June 2026; buyers must verify the current rate for their state.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Money = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TRANSFER_TAX = { BW: 5.0, BY: 3.5, BE: 6.0, BB: 6.5, HB: 5.5, HH: 5.5, HE: 6.0, MV: 6.0, NI: 5.0, NW: 6.5, RP: 5.0, SL: 6.5, SN: 5.5, ST: 5.0, SH: 6.5, TH: 5.0 };
  const TRANSFER_TAX_CHECKED = "2026-06";
  const NOTARY_PCT = 2.0;

  // Monthly payment for a fixed-rate annuity loan. apr in percent per year, years = term.
  function annuity(principal, apr, years) {
    if (principal <= 0) return 0;
    const n = years * 12, r = apr / 1200;
    return r ? principal * r / (1 - Math.pow(1 + r, -n)) : principal / n;
  }

  // Transfer tax, notary and agent fee in whole euros. Unknown state gives 0% transfer tax.
  function purchaseCosts(price, profile) {
    const t = price * (TRANSFER_TAX[profile.buy.state] || 0) / 100;
    const n = price * NOTARY_PCT / 100;
    const a = price * (profile.buy.agentFeePct || 0) / 100;
    return { transferTax: Math.round(t), notary: Math.round(n), agent: Math.round(a), total: Math.round(t + n + a) };
  }

  // Loan = price + purchase costs - equity (never below 0), with its monthly annuity payment.
  function buyMonthly(price, profile) {
    const loan = Math.max(0, price + purchaseCosts(price, profile).total - profile.buy.equity);
    return { loan, monthly: annuity(loan, profile.buy.apr, profile.buy.years) };
  }

  // Share of net income used by a monthly cost, compared with the affordShare limit.
  // fits: within the limit; tight: up to 5 points above it; too-much: beyond that.
  function affordability(monthly, profile) {
    const inc = profile.money.netIncome;
    if (!inc || monthly == null) return { share: null, level: "unknown" };
    const share = monthly / inc, limit = profile.money.affordShare;
    return { share, level: share <= limit ? "fits" : share <= limit + 0.05 ? "tight" : "too-much" };
  }

  // Warm rent: explicit warmRent, else coldRent + utilities, else null.
  function warmRent(listing) {
    if (listing.warmRent != null) return listing.warmRent;
    if (listing.coldRent != null && listing.utilities != null) return listing.coldRent + listing.utilities;
    return null;
  }

  return { TRANSFER_TAX, TRANSFER_TAX_CHECKED, annuity, purchaseCosts, buyMonthly, affordability, warmRent };
});
