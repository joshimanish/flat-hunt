// Stubbed area services for tests: one fetch that answers by host, plus a small crime table and rent grid. No network.
const { toLaea, createRentGrid } = require("../lib/rent-grid");

const reply = (body, status = 200) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => typeof body === "string" ? body : JSON.stringify(body) });

const KREISE = {
  "05111": { ags: "05111", gen: "Düsseldorf", bez: "Kreisfreie Stadt" },
  "09162": { ags: "09162", gen: "München", bez: "Kreisfreie Stadt" }
};
const OVERPASS = { elements: [
  { type: "node", id: 1, lat: 51.2262, lon: 6.7790, tags: { public_transport: "platform", name: "Steinstraße", route_ref: "780" } },
  { type: "node", id: 3, lat: 51.2259, lon: 6.7795, tags: { shop: "supermarket", name: "Example Markt" } },
  { type: "node", id: 5, lat: 51.2250, lon: 6.7780, tags: { amenity: "pharmacy", name: "Example Apotheke" } }
] };

// opts: { kreis: "05111" | "09162" | null, flood: ["high", …], fail: Set of hosts that answer 503, calls: [] }
function areaFetch(opts = {}) {
  const calls = opts.calls || [];
  const f = async (url, init = {}) => {
    const host = new URL(url).host;
    calls.push({ host, url, init });
    if (opts.fail && opts.fail.has(host)) return reply({}, 503);
    if (host === "nominatim.openstreetmap.org") return reply([{ display_name: "Beispielstraße 1, 40210 Düsseldorf", lat: "51.2254", lon: "6.7787" }]);
    if (host === "router.project-osrm.org") return reply({ routes: [{ distance: 1000, duration: 600 }] });
    if (host === "sgx.geodatenzentrum.de") { const k = KREISE[opts.kreis === undefined ? "05111" : opts.kreis]; return reply({ features: k ? [{ properties: k }] : [] }); }
    if (host === "geoportal.bafg.de") return reply({ results: (opts.flood || []).map(l => ({ layerName: "NZ.HazardArea", attributes: { LikelihoodOfOccurrence: l === "low" ? "low/extrem" : l, NaturalHazardCategory: "flood" } })) });
    if (host === "www.wms.nrw.de") return reply(url.includes("STR_DEN") ? '<FIELDS Classify.PixelValue="70111000"/>' : '<FIELDS Classify.PixelValue="NoData"/>');
    if (host === "overpass-api.de") return reply(OVERPASS);
    if (host === "routing.openstreetmap.de") { const n = url.split("?")[0].split(";").length - 1; return reply({ code: "Ok", durations: [[0, ...Array(n).fill(240)]], distances: [[0, ...Array(n).fill(300)]] }); }
    return reply({}, 404);
  };
  f.calls = calls;
  return f;
}

const CRIME_TABLE = { year: 2025, columns: ["name", "kind", "total", "violent", "street", "burglary"], national: { total: 6485, violent: 250, street: 1500, burglary: 95 },
  kreise: { "05111": ["Düsseldorf", "Kreisfreie Stadt", 12999, 499, 3106, 249] } };

// A 3 × 3 km grid around Beispielstraße 1, 40210 Düsseldorf (51.2254, 6.7787) with €11.15/m² in the middle cell.
function rentGrid() {
  const { x, y } = toLaea(51.2254, 6.7787);
  const meta = { x0: Math.floor(x / 1000) - 1, y0: Math.floor(y / 1000) - 1, width: 3, height: 3, refDate: "2022-05-15" };
  const data = Buffer.alloc(18); data.writeUInt16LE(1115, 8);
  return createRentGrid(meta, data);
}

const AREA_OPTS = () => ({ crimeTable: CRIME_TABLE, rentGrid: rentGrid(), delays: [], overpassDelays: [], overpassSpacingMs: 0, sleep: async () => {} });

module.exports = { areaFetch, reply, CRIME_TABLE, rentGrid, AREA_OPTS };
