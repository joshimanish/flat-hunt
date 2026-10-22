#!/usr/bin/env node
// scripts/area-smoke.js — live check of every area source for one point. Uses the network; not part of `npm test`.
//   node scripts/area-smoke.js 51.2254 6.7787     (Königsallee, Düsseldorf: NRW noise)
//   node scripts/area-smoke.js 52.5200 13.4050    (Berlin Mitte: Berlin noise)
//   add --json for the full answer
const { computeArea } = require("../lib/area");
const { createSpacer } = require("../lib/area-http");
const { loadCrimeTable } = require("../lib/crime");
const { loadRentGrid } = require("../lib/rent-grid");

const args = process.argv.slice(2), json = args.includes("--json");
const [lat, lon] = args.filter(a => !a.startsWith("--")).map(Number);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) { console.error("usage: node scripts/area-smoke.js <lat> <lon> [--json]"); process.exit(2); }

const summary = {
  kreis: a => `${a.ags} ${a.name}`,
  flood: a => `zones ${a.zones.join(",")} (worst ${a.worst})`,
  noise: a => a.band ? `${a.source} band ${a.band} dB, ${a.dominant} (${a.state})` : `${a.source} below 55 dB (${a.state})`,
  crime: a => `${a.kreis} (${a.kind}) total ${a.hz.total}/100k, ratio ${a.ratio.total}`,
  rent: a => `${a.eurPerSqm} EUR/m2 net cold, existing tenancies (Zensus ${a.year})`,
  amenities: a => `${Object.keys(a.items).length} categories, routing ${a.routing}, ` +
    Object.entries(a.items).map(([k, v]) => `${k} ${v && v.minutes != null ? v.minutes + "min" : "-"}`).join(" ")
};

computeArea({ lat, lon }, {
  fetchImpl: globalThis.fetch, now: () => new Date(), crimeTable: loadCrimeTable(), rentGrid: loadRentGrid(),
  overpass: createSpacer(0), cache: null, overpassUrl: process.env.OVERPASS_URL, delays: [2000], overpassDelays: [30000, 60000]
}).then(area => {
  if (json) console.log(JSON.stringify(area, null, 2));
  console.log(`point ${lat}, ${lon}`);
  for (const k of Object.keys(summary)) {
    const f = area[k];
    const text = f.status === "ok" ? summary[k](f) : f.status === "error" ? f.error : "";
    console.log(`${k.padEnd(10)} ${f.status.padEnd(8)} ${text}`);
  }
  const bad = Object.keys(summary).filter(k => area[k].status === "error");
  if (bad.length) { console.error("errors: " + bad.map(k => `${k} (${area[k].error})`).join(", ")); process.exit(1); }
});
