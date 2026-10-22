// lib/price-sync.js — the amount a listing is tracked by, its price-history entries and the routine's sync of seen amounts.
const { warmRent } = require("../public/money");

// Purchase price when buying, warm (else cold) rent when renting.
const headline = l => l.mode === "buy" ? l.price ?? null : warmRent(l) ?? l.coldRent ?? null;
// A price-history entry; rent entries also keep the cold rent.
const historyEntry = (l, date) => l.mode === "rent" && l.coldRent != null ? { date, price: headline(l), coldRent: l.coldRent } : { date, price: headline(l) };
// Listings the routine stored without a mode count as bought when they only carry a price.
const modeOf = l => l.mode === "rent" || l.mode === "buy" ? l.mode : l.price != null && l.coldRent == null && l.warmRent == null ? "buy" : "rent";
const amount = (v, max) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : null;

// Applies one entry of POST /api/sync's `seen` ({price} when buying, {warmRent, coldRent} when renting; other keys are
// ignored) to the listing and returns the log entry for the change, or null. Rent: a new cold rent with known utilities
// and no warm rent in `seen` derives the warm rent; the headline (warm, else cold) is logged when it changes, otherwise
// a cold-rent change. One price-history entry per change.
function applySeen(c, s, id, date) {
  if (!s || typeof s !== "object") return null;
  if (modeOf(c) === "buy") {
    const price = amount(s.price, 20000000);
    if (price == null || price === c.price) return null;
    const from = c.price ?? null;
    c.price = price;
    c.priceHistory = [...(c.priceHistory || []), historyEntry({ ...c, mode: "buy" }, date)];
    return { date, type: "price", field: "price", id, text: c.title, from, to: price };
  }
  const warm = amount(s.warmRent, 25000), cold = amount(s.coldRent, 20000);
  const rent = { ...c, mode: "rent" };
  const before = headline(rent), coldBefore = c.coldRent ?? null, hadWarm = c.warmRent != null;
  if (cold != null && cold !== c.coldRent) {
    c.coldRent = cold;
    if (warm == null && c.utilities != null) c.warmRent = Math.round((cold + c.utilities) * 100) / 100;
  }
  if (warm != null) c.warmRent = warm;
  const now = { ...c, mode: "rent" }, after = headline(now);
  let entry = null;
  if (!hadWarm && c.warmRent != null && coldBefore != null) {
    // The warm rent appeared: the headline basis changed from cold to warm, the rent only if the cold rent did.
    if (c.coldRent !== coldBefore) entry = { date, type: "price", field: "coldRent", id, text: c.title, from: coldBefore, to: c.coldRent };
  } else if (after != null && after !== before) entry = { date, type: "price", field: c.warmRent != null ? "warmRent" : "coldRent", id, text: c.title, from: before, to: after };
  else if (c.coldRent != null && coldBefore != null && c.coldRent !== coldBefore) entry = { date, type: "price", field: "coldRent", id, text: c.title, from: coldBefore, to: c.coldRent };
  if (entry) c.priceHistory = [...(c.priceHistory || []), historyEntry(now, date)];
  return entry;
}

module.exports = { headline, historyEntry, modeOf, applySeen };
