// lib/amenities.js — everyday places around a listing from OpenStreetMap (Overpass), walking minutes from the FOSSGIS foot router.
const { request, withRetry, HttpError } = require("./area-http");
const { distanceKm } = require("../public/criteria");
const { checkCoords } = require("./coords");

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const MAX_OVERPASS_BYTES = 8 * 1024 * 1024, MAX_TABLE_BYTES = 1024 * 1024;

// An empty value means the public server; anything else must be an http(s) URL (it may be self-hosted).
function checkOverpassUrl(v) {
  if (v == null || String(v).trim() === "") return DEFAULT_OVERPASS_URL;
  let u;
  try { u = new URL(String(v).trim()); } catch (e) { throw new Error("OVERPASS_URL must be an http(s) URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("OVERPASS_URL must be an http(s) URL");
  return String(v).trim();
}
const OVERPASS_URL = checkOverpassUrl(process.env.OVERPASS_URL); // a bad value stops the server at start-up
const FOOT_TABLE = "https://routing.openstreetmap.de/routed-foot/table/v1/driving/";
const CATEGORIES = ["transit", "supermarket", "pharmacy", "doctors", "kindergarten", "school", "park", "playground"];
const RADIUS_M = 1000, STOP_RADIUS_M = 500, PER_CATEGORY = 3, MAX_LINES = 12;
const DETOUR = 1.3, WALK_M_PER_MIN = 80; // straight line × 1.3 at 4.8 km/h when the foot router does not answer

function overpassQuery(lat0, lon0) {
  const [lat, lon] = checkCoords(lat0, lon0); // numbers only reach the query text
  const at = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:25];
(
  nwr${at(RADIUS_M)}[shop=supermarket];
  nwr${at(RADIUS_M)}[amenity~"^(pharmacy|doctors|kindergarten|school)$"];
  nwr${at(RADIUS_M)}[healthcare=doctor];
  nwr${at(RADIUS_M)}[leisure~"^(park|playground)$"];
)->.poi;
(
  nwr${at(STOP_RADIUS_M)}[public_transport=platform];
  nwr${at(STOP_RADIUS_M)}[highway=bus_stop];
  nwr${at(STOP_RADIUS_M)}[railway~"^(tram_stop|station|halt)$"];
)->.p;
(.poi;.p;);
out center tags;
(rel(bn.p)[type=route];rel(bw.p)[type=route];rel(br.p)[type=route];);
out body;`;
}

const ROUTE_MODES = new Set(["bus", "tram", "subway", "light_rail", "train", "trolleybus", "ferry"]);
const CACHE_PER_CATEGORY = 10;

function category(tags) {
  if (tags.public_transport === "platform" || tags.highway === "bus_stop" || ["tram_stop", "station", "halt"].includes(tags.railway)) return "transit";
  if (tags.healthcare === "doctor") return "doctors";
  if (tags.shop === "supermarket") return "supermarket";
  if (["pharmacy", "doctors", "kindergarten", "school"].includes(tags.amenity)) return tags.amenity;
  if (["park", "playground"].includes(tags.leisure)) return tags.leisure;
  return null;
}
const lineSort = (a, b) => a.ref.localeCompare(b.ref, "de", { numeric: true });

// Overpass JSON → [{ id, cat, name, lat, lon, meters, lines? }] sorted by straight-line distance. A runtime-error remark throws (retryable).
function parseOverpass(json, point) {
  if (!json || !Array.isArray(json.elements)) throw new Error("unexpected Overpass answer");
  if (json.remark && /error|timed out|out of memory|too long/i.test(json.remark)) throw new HttpError(504);
  const linesOf = new Map();
  for (const r of json.elements.filter(e => e.type === "relation" && e.tags && e.tags.ref && ROUTE_MODES.has(e.tags.route))) {
    const line = { ref: String(r.tags.ref).slice(0, 20), mode: String(r.tags.route || "") };
    for (const m of r.members || []) {
      const id = `${m.type}/${m.ref}`;
      if (!linesOf.has(id)) linesOf.set(id, []);
      const list = linesOf.get(id);
      if (!list.some(l => l.ref === line.ref && l.mode === line.mode)) list.push(line);
    }
  }
  const pois = [];
  for (const e of json.elements) {
    if (e.type === "relation" && e.tags && e.tags.type === "route") continue;
    const tags = e.tags || {}, cat = category(tags);
    const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
    if (!cat || typeof lat !== "number" || typeof lon !== "number") continue;
    const id = `${e.type}/${e.id}`, poi = { id, cat, name: String(tags.name || "").slice(0, 120), lat, lon, meters: Math.round(distanceKm(point, { lat, lon }) * 1000) };
    if (cat === "transit") {
      let lines = linesOf.get(id) || [];
      if (!lines.length && tags.route_ref) lines = String(tags.route_ref).split(/[;,\s]+/).filter(Boolean).map(ref => ({ ref, mode: "" }));
      poi.lines = lines.sort(lineSort).slice(0, MAX_LINES);
    }
    pois.push(poi);
  }
  return pois.sort((a, b) => a.meters - b.meters);
}

// The nearest few per category (straight line): the candidates sent to the foot router.
function nearestPerCategory(pois, n) {
  const out = [];
  for (const cat of CATEGORIES) out.push(...pois.filter(p => p.cat === cat).slice(0, n));
  return out;
}

// Search radius of a place, plus 50 m for ways and relations: they are measured to their centre, so a large park
// whose edge is inside the radius would otherwise be dropped.
const withinRadius = p => p.meters <= (p.cat === "transit" ? STOP_RADIUS_M : RADIUS_M) + (p.id.startsWith("node/") ? 0 : 50);

function candidates(pois) {
  const out = [];
  for (const cat of CATEGORIES) out.push(...pois.filter(p => p.cat === cat).slice(0, PER_CATEGORY));
  return out;
}

async function footTable(point, dests, fetchImpl, { ms = 10000, delays = [2000], sleep } = {}) {
  const coords = [point, ...dests].map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const j = await withRetry(() => request(fetchImpl, `${FOOT_TABLE}${coords}?sources=0&annotations=duration,distance`, { ms, maxBytes: MAX_TABLE_BYTES }), { delays, sleep });
  if (!j || j.code !== "Ok" || !Array.isArray(j.durations)) throw new Error("unexpected foot router answer");
  return { durations: j.durations[0].slice(1), distances: Array.isArray(j.distances) ? j.distances[0].slice(1) : [] };
}

// Per category the place with the fewest walking minutes, or null when none is within the search radius.
function summarise(cands, walk) {
  const items = {};
  for (const cat of CATEGORIES) {
    let best = null;
    const better = (c, b) => !b || (c.estimated !== b.estimated ? !c.estimated : c.minutes < b.minutes); // routed beats estimated
    cands.forEach((p, i) => {
      if (p.cat !== cat) return;
      const routed = walk && Number.isFinite(walk.durations[i]);
      const minutes = routed ? Math.max(1, Math.round(walk.durations[i] / 60)) : Math.max(1, Math.round(p.meters * DETOUR / WALK_M_PER_MIN));
      const meters = routed && Number.isFinite(walk.distances[i]) ? Math.round(walk.distances[i]) : Math.round(p.meters * DETOUR);
      const c = { name: p.name, minutes, meters, estimated: !routed, ...(p.lines ? { lines: p.lines } : {}) };
      if (better(c, best)) best = c;
    });
    items[cat] = best;
  }
  return items;
}

// → { items, routed, cached, at } where routed tells whether the walking minutes came from the foot router and at is the cache entry's time (null when fresh).
// deps: { fetchImpl, overpass (spacer from area-http), cache, force, overpassUrl, overpassDelays, delays, sleep }
async function amenitiesAt(point, deps) {
  const { fetchImpl, cache, force, sleep } = deps;
  const [lat, lon] = checkCoords(point.lat, point.lon);
  point = { lat, lon };
  const overpassUrl = deps.overpassUrl ? checkOverpassUrl(deps.overpassUrl) : OVERPASS_URL;
  const hit = !force && cache ? cache.get(point.lat, point.lon) : null;
  let pois = hit && Array.isArray(hit.value) ? hit.value : null, at = pois ? hit.at : null;
  const fromCache = !!pois;
  if (!pois) {
    const body = "data=" + encodeURIComponent(overpassQuery(point.lat, point.lon));
    pois = await deps.overpass(() => withRetry(async () => parseOverpass(await request(fetchImpl, overpassUrl, {
      method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, ms: 60000, maxBytes: MAX_OVERPASS_BYTES
    }), point), { delays: deps.overpassDelays || [30000, 60000, 120000], sleep }));
    pois = nearestPerCategory(pois, CACHE_PER_CATEGORY).map(({ lat, lon, ...p }) => ({ ...p, lat: +lat.toFixed(6), lon: +lon.toFixed(6) }));
    if (cache) await cache.set(point.lat, point.lon, pois);
  }
  // Distances are re-measured from this listing's exact point (the cache entry may come from a neighbour within ~100 m).
  pois = pois.map(p => ({ ...p, meters: Math.round(distanceKm(point, p) * 1000) })).filter(withinRadius).sort((a, b) => a.meters - b.meters);
  const cands = candidates(pois);
  let walk = null;
  if (cands.length) { try { walk = await footTable(point, cands, fetchImpl, { delays: deps.delays, sleep }); } catch (e) { walk = null; } }
  return { items: summarise(cands, walk), routed: !!walk || !cands.length, cached: fromCache, at };
}

module.exports = { overpassQuery, parseOverpass, candidates, footTable, summarise, amenitiesAt, checkOverpassUrl, CATEGORIES, OVERPASS_URL };
