// lib/ratelimit.js — fixed-window request counter per key (in memory; resets on restart).
const MAX_KEYS = 10000;

// IPv4-mapped IPv6 counts as the IPv4 address; any other IPv6 address counts by its /64 prefix.
function rateKey(key) {
  const k = String(key ?? "").toLowerCase();
  const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d+\.\d+\.\d+\.\d+)$/.exec(k);
  if (mapped) return mapped[1];
  if (!k.includes(":")) return k;
  const [head, tail] = k.split("::");
  const a = head ? head.split(":") : [], b = tail ? tail.split(":") : [];
  const groups = k.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return groups.slice(0, 4).map(g => (g || "0").replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

function createRateLimiter({ limit = 30, windowMs = 60000, now = Date.now, maxKeys = MAX_KEYS } = {}) {
  const hits = new Map(); // insertion order = order of window start, oldest first
  let pruned = -Infinity;
  return {
    // true while the key is within its limit for the current window
    hit(rawKey) {
      const key = rateKey(rawKey), t = now();
      if (t - pruned >= windowMs) {
        pruned = t;
        for (const [k, v] of hits) { if (t - v.start >= windowMs) hits.delete(k); else break; }
      }
      const h = hits.get(key);
      if (!h || t - h.start >= windowMs) {
        hits.delete(key);
        while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        hits.set(key, { start: t, count: 1 });
        return true;
      }
      h.count++;
      return h.count <= limit;
    },
    size: () => hits.size
  };
}

module.exports = { createRateLimiter, rateKey };
