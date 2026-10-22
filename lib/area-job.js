// lib/area-job.js — background queue: one listing at a time, never in a request. The result is applied only if the
// listing still exists at the same coordinates (a moved listing has been queued again).
function createAreaQueue({ state, persist, compute, gapMs = 0, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const queue = [], forced = new Set();
  let running = null, looping = false, waiters = [];

  async function loop() {
    let first = true;
    while (queue.length) {
      // A short pause between listings keeps the free map services (not Overpass, which has its own spacer) from being hit back to back.
      if (!first && gapMs > 0) await sleep(gapMs);
      first = false;
      if (!queue.length) break;
      const id = queue.shift();
      running = id;
      const force = forced.delete(id), c = state.listings[id];
      if (c && typeof c.lat === "number" && typeof c.lon === "number") {
        const point = { lat: c.lat, lon: c.lon };
        let area = null;
        try { area = await compute(point, { force }); } catch (e) { area = null; }
        const cur = state.listings[id];
        if (area && cur && cur.lat === point.lat && cur.lon === point.lon) {
          const prev = cur.area;
          cur.area = area;
          try { await persist(); }
          catch (e) { if (cur.area === area) { if (prev === undefined) delete cur.area; else cur.area = prev; } }
        }
      }
      running = null;
    }
  }

  const run = () => loop().catch(() => {}).finally(() => { running = null; looping = false; waiters.splice(0).forEach(r => r()); });

  return {
    // force: skip the Overpass cache (on-demand recompute).
    enqueue(id, { force = false } = {}) {
      if (force) forced.add(id);
      if (!queue.includes(id)) queue.push(id);
      if (!looping) { looping = true; Promise.resolve().then(run); }
    },
    drop(id) { const i = queue.indexOf(id); if (i >= 0) queue.splice(i, 1); forced.delete(id); },
    status: () => ({ queued: [...queue], running }),
    // Resolves when the queue is empty (tests; graceful shutdown).
    idle: () => looping ? new Promise(r => waiters.push(r)) : Promise.resolve()
  };
}

// Listings with coordinates whose area is missing or belongs to other coordinates (start-up backfill).
const needsArea = c => typeof c.lat === "number" && typeof c.lon === "number" && (!c.area || c.area.lat !== c.lat || c.area.lon !== c.lon);

module.exports = { createAreaQueue, needsArea };
