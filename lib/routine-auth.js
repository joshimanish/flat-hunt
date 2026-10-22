// lib/routine-auth.js — who may call what. The owner signs in with the site password; the routine sends only the sync key
// (x-sync-key) and reaches only the routes below. A request that carries a sync key is never treated as the owner, so the
// routine cannot edit templates or approvals, confirm viewings, open the vault or create share links, even if it knows the password.
const crypto = require("crypto");

const ROUTINE_ROUTES = [
  ["GET", /^\/api\/profile$/],
  ["GET", /^\/api\/listings$/],
  ["GET", /^\/api\/meta$/],
  ["GET", /^\/api\/outreach\/status$/],
  ["GET", /^\/redflags\.json$/],
  ["PUT", /^\/api\/listings\/[^/]+$/],
  ["PUT", /^\/api\/img\/[^/]+$/],
  ["PUT", /^\/api\/meta$/],
  ["POST", /^\/api\/sync$/],
  ["POST", /^\/api\/outreach\/claims$/],
  ["POST", /^\/api\/outreach\/claims\/[^/]+\/(sent|release)$/],
  ["POST", /^\/api\/listings\/[^/]+\/replies$/]
];

const isRoutineRoute = (method, path) => ROUTINE_ROUTES.some(([m, re]) => m === method && re.test(path));

// Compares SHA-256 digests, which always have the same length, so the time taken reveals neither the content nor the length.
const digest = v => crypto.createHash("sha256").update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// Replaces the phase-1 password check; registered before the body parsers. realm() names the password prompt.
function accessGate({ password, syncKey, realm = () => "Flat Hunt" }) {
  return (req, res, next) => {
    const key = req.headers["x-sync-key"];
    if (key !== undefined) {
      if (!syncKey) return res.status(503).json({ error: "SYNC_KEY not configured" });
      if (!safeEqual(key, syncKey)) return res.status(401).json({ error: "bad sync key" });
      if (!isRoutineRoute(req.method, req.path)) return res.status(403).json({ error: "not allowed with the sync key" });
      req.viaSyncKey = true;
      return next();
    }
    if (!password) return next();
    const [scheme, b64] = (req.headers.authorization || "").split(" ");
    const pass = scheme === "Basic" && b64 ? Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") : "";
    if (safeEqual(pass, password)) return next();
    // Header values must be Latin-1; keep printable ASCII only so any profile name is safe.
    const name = String(realm() || "").replace(/[^\x20-\x7e]/g, "").replace(/"/g, "").trim() || "Flat Hunt";
    res.set("WWW-Authenticate", `Basic realm="${name}"`);
    res.status(401).send("Password required");
  };
}

// For the routine's write routes: the sync key must be present (the gate has already checked its value).
function requireSyncKey(syncKey) {
  return (req, res, next) => {
    if (!syncKey) return res.status(503).json({ error: "SYNC_KEY not configured" });
    if (!req.viaSyncKey) return res.status(401).json({ error: "bad sync key" });
    next();
  };
}

module.exports = { ROUTINE_ROUTES, isRoutineRoute, accessGate, requireSyncKey, safeEqual };
