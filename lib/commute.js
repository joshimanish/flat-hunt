// lib/commute.js — travel time from a listing to each important place (car, bike, public transport).
const { getJson } = require("./geo");

const TZ = "Europe/Berlin";
const dtf = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });

// Berlin's offset from UTC at an instant, in minutes.
function berlinOffsetMin(date) {
  const part = dtf({ timeZoneName: "shortOffset" }).formatToParts(date).find(p => p.type === "timeZoneName").value; // "GMT+2", "GMT+1"
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(part);
  return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0;
}

// Berlin wall-clock time (y, m, d, hh, mm) to a UTC Date, correct across DST changes.
function berlinToUtc(y, m, d, hh, mm) {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - berlinOffsetMin(new Date(wall)) * 60000;
  utc = wall - berlinOffsetMin(new Date(utc)) * 60000;
  return new Date(utc);
}

// The next Mon–Fri occurrence of HH:MM Berlin time after `now`, as ISO UTC without milliseconds.
function nextWeekdayAt(now, time) {
  const [hh, mm] = time.split(":").map(Number);
  const p = Object.fromEntries(dtf({ year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now).filter(x => x.type !== "literal").map(x => [x.type, +x.value]));
  for (let i = 0; i < 8; i++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const dow = day.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const at = berlinToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm);
    if (at > now) return at.toISOString().replace(".000Z", "Z");
  }
  return null;
}

const ROUTERS = {
  car: "https://router.project-osrm.org/route/v1/driving/",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving/"
};

// Minutes from `from` to `place` by the place's mode, or null when unknown.
async function travelMinutes(from, place, fetchImpl = globalThis.fetch, { now = new Date(), ms = 5000 } = {}) {
  try {
    if (place.mode === "transit") {
      const time = nextWeekdayAt(now, place.time);
      const j = await getJson(fetchImpl, `https://api.transitous.org/api/v1/plan?fromPlace=${from.lat},${from.lon}&toPlace=${place.lat},${place.lon}&time=${time}&arriveBy=true`, ms);
      const secs = ((j && j.itineraries) || []).map(i => i.duration).filter(Number.isFinite);
      return secs.length ? Math.round(Math.min(...secs) / 60) : null;
    }
    const base = ROUTERS[place.mode];
    if (!base) return null;
    const j = await getJson(fetchImpl, `${base}${from.lon},${from.lat};${place.lon},${place.lat}?overview=false`, ms);
    const r = j && j.routes && j.routes[0];
    return r && Number.isFinite(r.duration) ? Math.round(r.duration / 60) : null;
  } catch (e) { return null; }
}

// One entry per place, same order: { minutes, checkedAt } or null. Sequential, with an optional opts.pauseMs between lookups, to stay polite to the free services.
async function commuteFor(point, places, fetchImpl = globalThis.fetch, opts = {}) {
  const out = [];
  for (const place of places || []) {
    if (out.length && opts.pauseMs > 0) await new Promise(r => setTimeout(r, opts.pauseMs));
    const minutes = await travelMinutes(point, place, fetchImpl, opts);
    out.push(minutes == null ? null : { minutes, checkedAt: (opts.now || new Date()).toISOString() });
  }
  return out;
}

module.exports = { travelMinutes, commuteFor, nextWeekdayAt };
