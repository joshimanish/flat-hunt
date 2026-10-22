// lib/commute-job.js — recomputes every listing's commute in the background, one listing at a time, never inside a request.
// A result is applied only if the listing still sits at the same coordinates and the places did not change meanwhile;
// a change of places during a run starts one more run afterwards.
function createCommuteJob({ state, persist, commuteFor, fetchImpl, pauseMs = 1000, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => new Date() }) {
  let status = { running: false, total: 0, done: 0, updated: 0, startedAt: null, finishedAt: null, error: null };
  let again = false, waiters = [];
  const placesNow = () => (state.profile && state.profile.places) || [];
  const mapsUrl = (places, c) => "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(places[0].address) + `&destination=${c.lat},${c.lon}`;

  async function runOnce() {
    const places = placesNow(), key = JSON.stringify(places), ids = Object.keys(state.listings);
    status = { running: true, total: ids.length, done: 0, updated: 0, startedAt: now().toISOString(), finishedAt: null, error: null };
    let first = true;
    for (const id of ids) {
      if (JSON.stringify(placesNow()) !== key) { again = true; return; }
      const c = state.listings[id];
      if (c && typeof c.lat === "number" && typeof c.lon === "number") {
        if (places.length) { if (!first) await sleep(pauseMs); first = false; }
        const point = { lat: c.lat, lon: c.lon };
        const commute = await commuteFor(point, places, fetchImpl(), { pauseMs });
        const cur = state.listings[id];
        if (JSON.stringify(placesNow()) !== key) { again = true; return; }
        if (cur && cur.lat === point.lat && cur.lon === point.lon) {
          const prev = { commute: cur.commute, stale: cur.commuteStale, maps: cur.mapsUrl };
          cur.commute = commute;
          if (places.length) cur.mapsUrl = mapsUrl(places, cur);
          delete cur.commuteStale;
          try { await persist(); status.updated++; }
          catch (e) {
            cur.commute = prev.commute;
            if (prev.maps === undefined) delete cur.mapsUrl; else cur.mapsUrl = prev.maps;
            if (prev.stale !== undefined) cur.commuteStale = prev.stale;
            status.error = "save failed";
            return;
          }
        }
      }
      status.done++;
    }
    // Listings without coordinates: no times, and nothing stale any more. Not when the places changed meanwhile: the next
    // run does it with the new ones.
    if (JSON.stringify(placesNow()) !== key) { again = true; return; }
    const touched = [];
    for (const c of Object.values(state.listings)) {
      if (typeof c.lat === "number" && typeof c.lon === "number") continue;
      if (c.commute === undefined && c.commuteStale === undefined) continue;
      touched.push([c, c.commute, c.commuteStale]);
      if (c.commute !== undefined) c.commute = places.map(() => null);
      delete c.commuteStale;
    }
    if (touched.length) {
      try { await persist(); }
      catch (e) {
        for (const [c, commute, stale] of touched) { c.commute = commute; if (stale !== undefined) c.commuteStale = stale; }
        status.error = "save failed";
      }
    }
  }

  async function loop() {
    do { again = false; await runOnce(); } while (again && !status.error);
  }

  return {
    // Starts a run, or asks for one more after the current run; answers the status either way.
    start() {
      if (status.running) { again = true; return this.status(); }
      status = { ...status, running: true };
      Promise.resolve().then(loop).catch(() => { status.error = "failed"; }).finally(() => {
        status = { ...status, running: false, finishedAt: now().toISOString() };
        waiters.splice(0).forEach(r => r());
      });
      return this.status();
    },
    status: () => ({ ...status, again }),
    idle: () => status.running ? new Promise(r => waiters.push(r)) : Promise.resolve()
  };
}

module.exports = { createCommuteJob };
