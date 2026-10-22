// lib/rent-grid.js — Zensus 2022 average net cold rent of the 1 km grid cell around a point (EPSG:3035 LAEA grid).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { inGermany } = require("./coords");

const DATA_DIR = path.join(__dirname, "data");
const META_FILE = path.join(DATA_DIR, "zensus2022-rent-1km.json");

// ETRS89 / LAEA Europe (EPSG:3035), GRS80 ellipsoid; formulas from EPSG Guidance Note 7-2 (method 9820).
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), E = Math.sqrt(E2);
const LAT0 = 52 * Math.PI / 180, LON0 = 10 * Math.PI / 180, FE = 4321000, FN = 3210000;
const q = phi => { const s = Math.sin(phi); return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s))); };
const QP = q(Math.PI / 2), RQ = A * Math.sqrt(QP / 2), BETA0 = Math.asin(q(LAT0) / QP);
const D = A * (Math.cos(LAT0) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2)) / (RQ * Math.cos(BETA0));

function toLaea(lat, lon) {
  const phi = lat * Math.PI / 180, dl = lon * Math.PI / 180 - LON0;
  const beta = Math.asin(q(phi) / QP);
  const B = RQ * Math.sqrt(2 / (1 + Math.sin(BETA0) * Math.sin(beta) + Math.cos(BETA0) * Math.cos(beta) * Math.cos(dl)));
  return {
    x: FE + B * D * Math.cos(beta) * Math.sin(dl),
    y: FN + (B / D) * (Math.cos(BETA0) * Math.sin(beta) - Math.sin(BETA0) * Math.cos(beta) * Math.cos(dl))
  };
}

// meta from zensus2022-rent-1km.json, data = the unzipped Uint16LE grid. at(lat, lon) → { cell, eurPerSqm } or null.
function createRentGrid(meta, data) {
  if (data.length !== meta.width * meta.height * 2) throw new Error("rent grid size does not match its metadata");
  return {
    meta,
    at(lat, lon) {
      if (!inGermany(lat, lon)) return null;
      const { x, y } = toLaea(lat, lon), cx = Math.floor(x / 1000), cy = Math.floor(y / 1000);
      const col = cx - meta.x0, row = cy - meta.y0;
      if (col < 0 || row < 0 || col >= meta.width || row >= meta.height) return null;
      const cents = data.readUInt16LE((row * meta.width + col) * 2);
      return cents ? { cell: `CRS3035RES1000mN${cy * 1000}E${cx * 1000}`, eurPerSqm: cents / 100 } : null;
    }
  };
}

// The shipped grid; null when the files are missing (the rent figure then reports an error).
let cached = null;
function loadRentGrid(metaFile = META_FILE) {
  if (metaFile === META_FILE && cached) return cached;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    const g = createRentGrid(meta, zlib.gunzipSync(fs.readFileSync(path.join(path.dirname(metaFile), meta.file))));
    if (metaFile === META_FILE) cached = g;
    return g;
  } catch (e) { return null; }
}

const reload = () => { cached = null; };

module.exports = { toLaea, createRentGrid, loadRentGrid, reload, META_FILE };
