// lib/flood.js — mapped river/coastal flood hazard at a point, from the BfG INSPIRE "Natural Risk Zones" service.
const { request, withRetry, qs } = require("./area-http");
const { checkCoords } = require("./coords");

const NZ = "https://geoportal.bafg.de/arcgis1/rest/services/INSPIRE/NZ/MapServer/identify";
// Worst first: high = frequent flood (HQhäufig), medium = 100-year flood (HQ100), low = extreme flood (HQextrem).
const LEVELS = ["high", "medium", "low", "unknown"];

function floodUrl(la, lo) {
  const [lat, lon] = checkCoords(la, lo);
  return NZ + "?" + qs({
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", sr: 4326, layers: "all:1", tolerance: 0,
    mapExtent: `${lon},${lat},${(lon + 0.001).toFixed(6)},${(lat + 0.001).toFixed(6)}`, imageDisplay: "100,100,96", returnGeometry: "false", f: "json"
  });
}

const level = v => { const s = String(v || "").toLowerCase(); return s === "high" ? "high" : s === "medium" ? "medium" : /low|extrem/.test(s) ? "low" : "unknown"; };

// → { zones: subset of high, medium, low, unknown (worst first; unknown = inside a mapped area, class not stated) }. An ArcGIS error object throws.
function parseFlood(json) {
  if (!json || json.error || !Array.isArray(json.results)) throw new Error("unexpected flood answer");
  const found = new Set();
  for (const r of json.results) {
    const a = (r && r.attributes) || {};
    if (a.NaturalHazardCategory && !/flood/i.test(a.NaturalHazardCategory)) continue;
    const l = level(a.LikelihoodOfOccurrence);
    found.add(l);
  }
  return { zones: LEVELS.filter(l => found.has(l)) };
}

async function floodAt(point, fetchImpl, { delays = [2000], sleep, ms = 15000 } = {}) {
  return parseFlood(await withRetry(() => request(fetchImpl, floodUrl(point.lat, point.lon), { ms }), { delays, sleep }));
}

module.exports = { floodUrl, parseFlood, floodAt, LEVELS };
