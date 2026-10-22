// lib/coords.js — one guard for every coordinate that reaches a URL, a filter or a grid lookup.
const inGermany = (lat, lon) => typeof lat === "number" && typeof lon === "number" && Number.isFinite(lat) && Number.isFinite(lon) && lat >= 47 && lat <= 56 && lon >= 5 && lon <= 16;

// Returns [lat, lon] as numbers, or throws a permanent "bad coordinates".
function checkCoords(lat, lon) {
  const la = typeof lat === "string" && lat.trim() !== "" ? Number(lat) : lat, lo = typeof lon === "string" && lon.trim() !== "" ? Number(lon) : lon;
  if (!inGermany(la, lo)) throw Object.assign(new Error("bad coordinates"), { permanent: true });
  return [la, lo];
}

module.exports = { checkCoords, inGermany };
