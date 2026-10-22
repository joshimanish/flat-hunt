// lib/area-cache.js — Overpass results cached by rounded position (3 decimals ≈ 100 m) in DATA_DIR/area-cache.json.
const { readJson, writeJsonAtomic } = require("./store");

const DAY = 86400000;
const keyFor = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

function createAreaCache(file, { now = () => new Date(), ttlMs = 30 * DAY, max = 500 } = {}) {
  let entries = {};
  try {
    const raw = (readJson(file, { entries: {} }) || {}).entries;
    for (const [k, e] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
      if (e && typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) && Array.isArray(e.value)) entries[k] = e; // malformed entries are ignored
    }
  } catch (e) { entries = {}; } // a broken cache is dropped, not fatal
  let writing = Promise.resolve();
  return {
    get(lat, lon) {
      const e = entries[keyFor(lat, lon)];
      return e && now().getTime() - Date.parse(e.at) < ttlMs ? e : null;
    },
    // Keeps the newest `max` entries; the write is queued and its failure only costs a later re-query.
    set(lat, lon, value) {
      entries[keyFor(lat, lon)] = { at: now().toISOString(), value };
      const keys = Object.keys(entries);
      if (keys.length > max) keys.sort((a, b) => entries[a].at.localeCompare(entries[b].at)).slice(0, keys.length - max).forEach(k => delete entries[k]);
      writing = writing.catch(() => {}).then(() => writeJsonAtomic(file, { entries }));
      return writing.catch(() => {});
    },
    size: () => Object.keys(entries).length
  };
}

module.exports = { createAreaCache, keyFor };
