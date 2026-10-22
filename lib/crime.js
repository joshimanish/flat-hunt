// lib/crime.js — recorded crime per Kreis (BKA PKS) compared with the national rate. Area level only, never per street.
const fs = require("fs");
const path = require("path");

const DEFAULT_FILE = path.join(__dirname, "data", "pks-2025-kreise.json");

// The table written by scripts/area-data.js; null when the file is missing or unreadable.
let cached = null;
function loadCrimeTable(file = DEFAULT_FILE) {
  if (file === DEFAULT_FILE && cached) return cached;
  try {
    const t = JSON.parse(fs.readFileSync(file, "utf8"));
    if (file === DEFAULT_FILE) cached = t;
    return t;
  } catch (e) { return null; }
}
const reload = () => { cached = null; };

const ratio = (v, nat) => Number.isFinite(v) && nat > 0 ? Math.round(v / nat * 100) / 100 : null;

// kreis = { ags, name } from lib/kreis.js. → the figures for the area cache (without status/fetchedAt).
function crimeFor(kreis, table) {
  if (!table || !table.kreise) throw Object.assign(new Error("crime table missing"), { permanent: true });
  const row = kreis && table.kreise[kreis.ags];
  if (!row) return null;
  const v = Object.fromEntries(table.columns.map((c, i) => [c, row[i]]));
  const hz = { total: v.total, violent: v.violent, street: v.street, burglary: v.burglary };
  return {
    ags: kreis.ags, kreis: v.name, kind: v.kind, year: table.year,
    hz, national: table.national,
    ratio: Object.fromEntries(Object.keys(hz).map(k => [k, ratio(hz[k], table.national[k])]))
  };
}

module.exports = { loadCrimeTable, crimeFor, reload, DEFAULT_FILE };
