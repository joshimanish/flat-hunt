// lib/area.js — computes the area facts for one point. Every figure carries its status, source, area level and fetch time.
const { errorText } = require("./area-http");
const { lookupKreis } = require("./kreis");
const { crimeFor } = require("./crime");
const { floodAt } = require("./flood");
const { noiseAt } = require("./noise");
const { amenitiesAt } = require("./amenities");

// status: "ok" (value found), "no-data" (the source has nothing for this point — never read as "no risk"), "error" (lookup failed).
async function figure(source, level, now, fn) {
  const base = { source, level };
  try {
    const value = await fn();
    return value ? { status: "ok", ...base, fetchedAt: now().toISOString(), ...value } : { status: "no-data", ...base, fetchedAt: now().toISOString() };
  } catch (e) {
    return { status: "error", ...base, fetchedAt: now().toISOString(), error: errorText(e) };
  }
}
const permanent = msg => Object.assign(new Error(msg), { permanent: true });

// deps: { fetchImpl, now, crimeTable, rentGrid, overpass, cache, force, overpassUrl, delays, overpassDelays, sleep }
async function computeArea(point, deps) {
  const { fetchImpl, now } = deps, opts = { delays: deps.delays, sleep: deps.sleep };
  const area = { lat: point.lat, lon: point.lon };

  area.kreis = await figure("bkg-vg250", "point", now, () => lookupKreis(point, fetchImpl, opts));
  const kreis = area.kreis.status === "ok" ? { ags: area.kreis.ags, name: area.kreis.name } : null;
  const needKreis = () => { if (area.kreis.status === "error") throw permanent("Kreis unknown"); };

  area.flood = await figure("bfg-nz", "point", now, async () => {
    const { zones } = await floodAt(point, fetchImpl, opts);
    return zones.length ? { zones, worst: zones[0], dataYear: 2019 } : null;
  });

  area.noise = await figure(null, "point", now, async () => {
    needKreis();
    const n = kreis ? await noiseAt(point, kreis.ags, fetchImpl, opts) : null;
    return n ? { ...n, dataYear: 2022 } : null;
  });

  area.crime = await figure("bka-pks", "kreis", now, () => {
    needKreis();
    return kreis ? crimeFor(kreis, deps.crimeTable) : null;
  });

  area.rent = await figure("zensus-rent", "cell-1km", now, () => {
    if (!deps.rentGrid) throw permanent("rent grid missing");
    const r = deps.rentGrid.at(point.lat, point.lon);
    return r ? { ...r, year: 2022, refDate: deps.rentGrid.meta.refDate } : null;
  });

  area.amenities = await figure("osm", "walk", now, async () => {
    const r = await amenitiesAt(point, deps);
    return { items: r.items, routing: r.routed ? "osm-foot" : "estimate", cached: r.cached, ...(r.at ? { fetchedAt: r.at } : {}) };
  });

  area.computedAt = now().toISOString();
  return area;
}

module.exports = { computeArea, figure };
