// lib/noise.js — strategic noise maps (EU round 4, 2022), Lden at a point, per federal state. Only NRW and Berlin have
// adapters; elsewhere the answer is "no data". Mapped sources only (major roads, rail, airports, industry).
const { request, withRetry, qs } = require("./area-http");
const { checkCoords } = require("./coords");

// GetFeatureInfo on one pixel in the middle of a 101 × 101 image around the point (WMS 1.3.0: EPSG:4326 axis order lat,lon).
function featureInfoUrl(base, layer, la, lo, infoFormat) {
  const [lat, lon] = checkCoords(la, lo);
  const d = 0.001;
  return base + "?" + qs({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetFeatureInfo", LAYERS: layer, QUERY_LAYERS: layer, STYLES: "", CRS: "EPSG:4326",
    BBOX: [lat - d, lon - d, lat + d, lon + d].map(v => v.toFixed(6)).join(","), WIDTH: 101, HEIGHT: 101, I: 50, J: 50, INFO_FORMAT: infoFormat
  });
}

const unrecognised = () => Object.assign(new Error("unrecognised answer"), { permanent: true });

// NRW (Esri text/xml): PixelValue "70111000" → class lower bound 70 dB; "NoData" or an empty FeatureInfo answer → null.
// Anything that is not a FeatureInfo answer (HTML, ServiceException) throws: it must not read as "no mapped source".
function parseNrw(text) {
  const t = String(text || "");
  if (!/<FIELDS|FeatureInfoResponse/.test(t)) throw unrecognised();
  const m = /Classify\.PixelValue="(\d{2})\d*"/.exec(t);
  const v = m ? Number(m[1]) : null;
  return v != null && v >= 45 ? v : null;
}

// One property value: "ab 75 dB(A)", "> 75", "75", "55 - 59 dB(A)", "55–59", "55 bis 59" → lower bound; else null.
const BAND = /^\s*(?:ab|>=?)?\s*(\d{2})(?:\s*(?:-|–|bis)\s*\d{2})?\s*(?:dB(?:\s*\(A\))?)?\s*$/i;
function bandValue(key, v) {
  if (typeof v === "number" && !/db|den|lärm|laerm/i.test(key)) return null;
  const m = BAND.exec(String(v));
  return m && Number(m[1]) >= 45 ? Number(m[1]) : null;
}

// "bis 55 dB(A)" is Berlin's lowest class (up to 55): a readable answer below the 55 dB threshold, no band.
const BELOW = /^\s*bis\s*\d{2}\s*(?:dB(?:\s*\(A\))?)?\s*$/i;

// Berlin (GeoServer JSON): the highest band over all features; an empty features array → null; a feature without a readable value throws.
function parseBerlin(json) {
  if (!json || !Array.isArray(json.features)) throw unrecognised();
  let max = null;
  for (const f of json.features) {
    const vals = Object.entries((f && f.properties) || {}).map(([k, v]) => bandValue(k, v)).filter(v => v != null);
    const below = Object.values((f && f.properties) || {}).some(v => BELOW.test(String(v)));
    if (!vals.length && !below) throw unrecognised();
    if (vals.length) max = Math.max(max == null ? 0 : max, ...vals);
  }
  return max;
}

// Keyed by the first two digits of the Kreis AGS (= state).
const ADAPTERS = Object.freeze({
  "05": {
    state: "NW", source: "nrw-noise", base: "https://www.wms.nrw.de/umwelt/laerm_stufe4", infoFormat: "text/xml", as: "text", parse: parseNrw,
    uncovered: [], layers: [["road", "STR_DEN"], ["rail", "SCB_DEN"], ["tram", "SCS_DEN"], ["air", "FLG_DEN"], ["industry", "IND_DEN"]]
  },
  "11": {
    state: "BE", source: "berlin-noise", base: "https://gdi.berlin.de/services/wms/ua_stratlaerm_2022", infoFormat: "application/json", as: "json", parse: parseBerlin,
    uncovered: ["rail"], layers: [["road", "bb_strasse_gesamt_den2022"], ["tram", "bc_tram_ubahn_den2022"], ["air", "bd_flug_gesamt_den2022"], ["industry", "be_industrie_den2022"]]
  }
});

const adapterFor = ags => (typeof ags === "string" && ADAPTERS[ags.slice(0, 2)]) || null;
const band = lower => lower == null ? null : lower >= 75 ? "75+" : `${lower}–${lower + 4}`;

// uncovered lists the kinds the map does not contain at all (Berlin: federal railways, mapped by the Eisenbahn-Bundesamt).
// → null when the state has no adapter, else { state, source, uncovered, lden: { road: 70, rail: null, … }, max, band, dominant }.
// Layers are asked one after another; any failed layer fails the whole figure (a partial answer could hide the loudest source).
async function noiseAt(point, ags, fetchImpl, { delays = [2000], sleep, ms = 10000 } = {}) {
  const a = adapterFor(ags);
  if (!a) return null;
  const lden = {};
  for (const [kind, layer] of a.layers) {
    const body = await withRetry(() => request(fetchImpl, featureInfoUrl(a.base, layer, point.lat, point.lon, a.infoFormat), { ms, as: a.as }), { delays, sleep });
    lden[kind] = a.parse(body);
  }
  let max = null, dominant = null;
  for (const [kind, v] of Object.entries(lden)) if (v != null && (max == null || v > max)) { max = v; dominant = kind; }
  return { state: a.state, source: a.source, uncovered: [...a.uncovered], lden, max, band: band(max), dominant };
}

module.exports = { featureInfoUrl, parseNrw, parseBerlin, noiseAt, adapterFor, band, ADAPTERS };
