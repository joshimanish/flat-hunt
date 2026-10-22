// lib/area-api.js — password-protected routes: queue state and on-demand recompute of a listing's area facts.
const express = require("express");

function areaApi({ state, queue }) {
  const router = express.Router();

  router.get("/api/area/queue", (req, res) => res.json(queue.status()));

  router.post("/api/listings/:id/area", (req, res) => {
    const c = state.listings[req.params.id];
    if (!c) return res.status(404).json({ error: "unknown listing" });
    if (typeof c.lat !== "number" || typeof c.lon !== "number") return res.status(400).json({ error: "listing has no coordinates" });
    queue.enqueue(req.params.id, { force: true });
    res.status(202).json({ ok: true, ...queue.status() });
  });

  return router;
}

module.exports = { areaApi };
