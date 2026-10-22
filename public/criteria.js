// public/criteria.js — criteria check, red flags, estimated rating and score. Loaded by the page (window.Criteria, after money.js) and by the tests.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./money"));
  else root.Criteria = factory(root.Money);
})(typeof self !== "undefined" ? self : this, function (Money) {
  const WEIGHT_KEYS = ["price", "size", "commute", "area", "condition", "contact"];
  const UNDERPRICED_SHARE = 0.6, UNDERPRICED_MIN_OTHERS = 3;
  const known = v => v !== undefined && v !== null && v !== "";

  // Great-circle distance in km.
  function distanceKm(a, b) {
    const rad = d => d * Math.PI / 180, R = 6371;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Price per m²: purchase price when buying, cold rent (else warm rent) when renting.
  function pricePerSqm(l) {
    if (!(l.size > 0)) return null;
    const amount = l.mode === "buy" ? l.price : known(l.coldRent) ? l.coldRent : Money.warmRent(l);
    return known(amount) ? amount / l.size : null;
  }

  const cityKey = l => String(l.city || "").trim().toLowerCase();
  function underpriced(l, others) {
    const own = pricePerSqm(l), city = cityKey(l);
    if (own == null || !city) return false;
    const vals = (others || []).filter(o => o !== l && o.mode === l.mode && cityKey(o) === city).map(pricePerSqm).filter(v => v != null).sort((a, b) => a - b);
    if (vals.length < UNDERPRICED_MIN_OTHERS) return false;
    const mid = vals.length >> 1, median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    return own < UNDERPRICED_SHARE * median;
  }

  // Catalogue entries use the profile's on/off setting, or their default when the profile does not list them; custom entries follow.
  function redFlagHits(l, profile, catalogue, others) {
    const set = (profile && profile.redFlags) || [];
    const text = [l.title, l.notes, l.description].filter(Boolean).join(" | ");
    const active = [];
    for (const def of catalogue || []) {
      const s = set.find(f => f.id === def.id);
      if (s ? s.on : def.default) active.push(def);
    }
    for (const f of set) {
      if (!f.on || !String(f.id).startsWith("custom-")) continue;
      active.push({ id: f.id, test: f.match, label: { en: f.label, de: f.label, pt: f.label }, reason: { en: "", de: "", pt: "" } });
    }
    return active.filter(def => {
      if (def.computed === "underpriced") return underpriced(l, others);
      if (!def.test) return false;
      try { return new RegExp(def.test, "i").test(text); } catch (e) { return false; }
    });
  }

  // Every limit the listing breaks, as { key, value, def? }. Unknown facts pass.
  function checkCriteria(l, profile, catalogue, others) {
    const p = profile, f = p.flat, out = [];
    const fail = (key, value) => out.push({ key, value });
    if (l.mode && !p.modes[l.mode]) fail("mode", l.mode);
    if (l.mode === "rent") {
      const warm = Money.warmRent(l);
      if (warm != null && warm > p.rent.maxWarm) fail("warm", warm);
      if (p.rent.maxCold != null && known(l.coldRent) && l.coldRent > p.rent.maxCold) fail("cold", l.coldRent);
      if (p.rent.maxDeposit != null && known(l.deposit) && l.deposit > p.rent.maxDeposit) fail("deposit", l.deposit);
      if (p.rent.maxTakeover != null && known(l.takeover) && l.takeover > p.rent.maxTakeover) fail("takeover", l.takeover);
    }
    if (l.mode === "buy" && known(l.price) && l.price > p.buy.maxPrice) fail("price", l.price);
    if (known(l.rooms) && (l.rooms < f.roomsMin || (f.roomsMax != null && l.rooms > f.roomsMax))) fail("rooms", l.rooms);
    if (known(l.size) && (l.size < f.sizeMin || (f.sizeMax != null && l.size > f.sizeMax))) fail("size", l.size);
    if (known(l.floor) && ((f.floorMin != null && l.floor < f.floorMin) || (f.floorMax != null && l.floor > f.floorMax))) fail("floor", l.floor);
    // A ground-floor (or lower) flat needs no lift.
    if (f.needsLift && l.lift === false && !(known(l.floor) && l.floor <= 0)) fail("lift", false);
    if (known(l.outdoor) && ((f.outdoor === "balcony" && l.outdoor === "none") || (f.outdoor === "garden" && !["garden", "both"].includes(l.outdoor)))) fail("outdoor", l.outdoor);
    if (f.kitchen === "required" && l.kitchen === false) fail("kitchen", false);
    if (f.pets && l.petsAllowed === false) fail("pets", false);
    if (known(l.availableFrom) && ((f.moveInFrom && l.availableFrom < f.moveInFrom) || (f.moveInTo && l.availableFrom > f.moveInTo))) fail("movein", l.availableFrom);
    if (l.wbsRequired === true && f.wbs !== "have") fail("wbs", true);
    (p.places || []).forEach((place, i) => {
      const c = (l.commute || [])[i];
      if (c && known(c.minutes) && c.minutes > place.maxMin) fail("commute", i);
    });
    const r = p.radius || {};
    if (r.center && r.km && typeof l.lat === "number" && typeof l.lon === "number") {
      const d = distanceKm(r.center, l);
      if (d > r.km) fail("radius", Math.round(d * 10) / 10);
    }
    for (const def of redFlagHits(l, p, catalogue, others)) out.push({ key: "flag", value: def.id, def });
    return out;
  }

  // Price per m² against the other tracked listings of the same mode: same postcode when at least 3 exist, else same city.
  // → { own, median, n, level: "postcode" | "city", diff (share above (+) or below (−) the median) } or null.
  function priceCheck(l, others) {
    const own = pricePerSqm(l);
    if (own == null) return null;
    const pool = (others || []).filter(o => o !== l && (l.id == null || o.id !== l.id) && o.mode === l.mode && !o.gone);
    const median = vals => { const v = vals.sort((a, b) => a - b), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const tries = [["postcode", o => l.postcode && o.postcode === l.postcode], ["city", o => cityKey(l) && cityKey(o) === cityKey(l)]];
    for (const [level, same] of tries) {
      const vals = pool.filter(same).map(pricePerSqm).filter(v => v != null);
      if (vals.length >= UNDERPRICED_MIN_OTHERS) { const med = median(vals); return { own, median: med, n: vals.length, level, diff: Math.round((own / med - 1) * 100) / 100 }; }
    }
    return null;
  }

  // Area rating 0–10 from the area facts (phase 3), shown in the rating tooltip:
  //   everyday = 10 × mean over six groups of walking points (≤ 5 min 1, ≤ 10 min 0.75, ≤ 15 min 0.5, ≤ 20 min 0.25, else or none 0);
  //     groups: transit stop, supermarket, pharmacy, doctor, kindergarten or school, park or playground.
  //   minus flood (HQhäufig 3, HQ100 2, only HQextrem or a mapped area of unstated class 0.5), noise Lden (≥ 70 dB 2, ≥ 65 1.5, ≥ 60 1, ≥ 55 0.5),
  //   crime in the Kreis vs the national rate (≥ 1.5 × 1, ≥ 1.2 × 0.5). Figures with no data or an error count 0.
  //   value = round(everyday − deductions), clamped to 0–10. Null until the amenities are known.
  const AREA_GROUPS = [["transit"], ["supermarket"], ["pharmacy"], ["doctors"], ["kindergarten", "school"], ["park", "playground"]];
  const walkPoints = m => m == null ? 0 : m <= 5 ? 1 : m <= 10 ? 0.75 : m <= 15 ? 0.5 : m <= 20 ? 0.25 : 0;
  const FLOOD_DEDUCT = { high: 3, medium: 2, low: 0.5, unknown: 0.5 }; // unknown = inside a mapped flood area, class not stated: scored like the extreme scenario
  function areaRating(area) {
    const am = area && area.amenities;
    if (!am || am.status !== "ok" || !am.items) return null;
    const groups = AREA_GROUPS.map(cats => {
      const mins = cats.map(c => am.items[c] && am.items[c].minutes).filter(v => typeof v === "number");
      const minutes = mins.length ? Math.min(...mins) : null;
      return { group: cats.join("|"), minutes, points: walkPoints(minutes) };
    });
    const everyday = Math.round(groups.reduce((s, g) => s + g.points, 0) / groups.length * 100) / 10;
    const parts = [{ key: "everyday", value: everyday, groups }];
    const fl = area.flood, no = area.noise, cr = area.crime;
    if (fl && fl.status === "ok" && Object.hasOwn(FLOOD_DEDUCT, fl.worst)) parts.push({ key: "flood", value: -FLOOD_DEDUCT[fl.worst], worst: fl.worst });
    if (no && no.status === "ok" && no.max != null) { const d = no.max >= 70 ? 2 : no.max >= 65 ? 1.5 : no.max >= 60 ? 1 : no.max >= 55 ? 0.5 : 0; if (d) parts.push({ key: "noise", value: -d, max: no.max }); }
    const ratio = cr && cr.status === "ok" && cr.ratio ? cr.ratio.total : null;
    if (ratio != null) { const d = ratio >= 1.5 ? 1 : ratio >= 1.2 ? 0.5 : 0; if (d) parts.push({ key: "crime", value: -d, ratio }); }
    const value = Math.max(0, Math.min(10, Math.round(parts.reduce((s, p) => s + p.value, 0))));
    return { value, parts };
  }

  // Partial rating from listing data only (for listings without an assessment): condition and contact stay unknown;
  // area is estimated once the area facts are computed.
  function estimateRating(l, profile) {
    const p = profile, r = {};
    let amount = null, limit = null;
    if (l.mode === "buy") { amount = l.price; limit = p.buy.maxPrice; }
    else if (l.mode === "rent") {
      const warm = Money.warmRent(l);
      if (warm != null) { amount = warm; limit = p.rent.maxWarm; }
      else if (known(l.coldRent) && p.rent.maxCold != null) { amount = l.coldRent; limit = p.rent.maxCold; }
    }
    if (known(amount) && limit > 0) { const q = amount / limit; r.price = q <= 0.85 ? 9 : q <= 1 ? 7 : 3; }
    if (l.size > 0 && p.flat.sizeMin > 0) { const q = l.size / p.flat.sizeMin; r.size = q >= 1.2 ? 9 : q >= 1 ? 7 : 3; }
    const ratios = (p.places || []).map((place, i) => { const c = (l.commute || [])[i]; return c && known(c.minutes) && place.maxMin > 0 ? c.minutes / place.maxMin : null; }).filter(v => v != null);
    if (ratios.length) { const q = Math.max(...ratios); r.commute = q <= 0.5 ? 10 : q <= 1 ? 8 : q <= 1.5 ? 5 : 2; }
    const area = areaRating(l.area);
    if (area) r.area = area.value;
    return Object.keys(r).length ? r : null;
  }

  // round(Σ rating × weight ÷ Σ weights × 10) over the ratings that exist and have a weight above 0.
  function scoreListing(l, weights) {
    const r = l && l.rating;
    if (!r) return null;
    let sum = 0, w = 0;
    for (const k of WEIGHT_KEYS) {
      const wk = Number((weights || {})[k] || 0);
      if (r[k] == null || !wk) continue;
      sum += Math.max(0, Math.min(10, r[k])) * wk; w += wk;
    }
    return w ? Math.round(sum / w * 10) : null;
  }

  return { WEIGHT_KEYS, distanceKm, pricePerSqm, redFlagHits, checkCriteria, priceCheck, areaRating, estimateRating, scoreListing };
});
