// server.js — Flat Hunt: static page + JSON API. Data lives in DATA_DIR.
const { publicShares } = require("./lib/share-public");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { readJson, writeJsonAtomic } = require("./lib/store");
const { validateProfile, upgradeProfile } = require("./lib/profile");
const { geocode } = require("./lib/geo");
const { commuteFor } = require("./lib/commute");
const { createCommuteJob } = require("./lib/commute-job");
const { validateListingInput, requiredErrors } = require("./lib/listing");
const { warmRent } = require("./public/money");
const { headline, historyEntry, applySeen } = require("./lib/price-sync");
const { parseVaultKey, vaultStatus, openVault } = require("./lib/vault");
const { vaultApi } = require("./lib/vault-api");
const { computeArea } = require("./lib/area");
const { createAreaQueue, needsArea } = require("./lib/area-job");
const { areaApi } = require("./lib/area-api");
const { createAreaCache } = require("./lib/area-cache");
const { createSpacer } = require("./lib/area-http");
const { loadCrimeTable } = require("./lib/crime");
const { loadRentGrid } = require("./lib/rent-grid");
const { OVERPASS_URL } = require("./lib/amenities");
const { accessGate, requireSyncKey } = require("./lib/routine-auth");
const { normaliseOutreach, prune: pruneClaims, expiredLog } = require("./lib/outreach");
const { outreachApi } = require("./lib/outreach-api");
const { repliesApi } = require("./lib/replies-api");
const { createRateLimiter } = require("./lib/ratelimit");
const { recordWrites } = require("./lib/undo");
const CATALOGUE = require("./public/redflags.json");

const STATUSES = ["new", "contacted", "viewing-invited", "viewing-done", "applied", "docs-requested", "accepted", "rejected", "dropped", "gone"];
// Fields the routine may write with the sync key (PUT /api/listings/:id). Owner fields stay page-only.
const LISTING_FIELDS = ["title", "url", "source", "mode", "coldRent", "utilities", "warmRent", "deposit", "takeover", "price", "rooms", "size", "floor", "lift", "outdoor", "kitchen", "petsAllowed", "availableFrom", "wbsRequired", "address", "postcode", "city", "district", "description", "lat", "lon", "mapsUrl", "commute", "commuteStale", "contact", "photos", "rating", "redFlags", "verdict", "pros", "cons", "questions", "i18n", "addedAt", "lastSeenAt", "priceHistory", "gone"];
const LINK_FIELDS = ["url", "mapsUrl"];
// Taken from the routine only when it creates a listing.
const CREATE_ONLY_FIELDS = ["url", "source"];
// Fixed paths below /api/listings/ that must never become a listing id.
const FIXED_LISTING_PATHS = ["recalc-commute"];
const MAX_MESSAGES = 200;
// A message as the page sends it; text up to 10,000 characters.
const validMessage = m => !!m && typeof m === "object" && !Array.isArray(m) && typeof m.text === "string" && m.text.length <= 10000;
// Sent or logged by the routine (lib/outreach-api.js, lib/replies-api.js).
const fromRoutine = m => !!m && typeof m === "object" && ["claimId", "externalId", "intent"].some(k => Object.hasOwn(m, k));
const isHttpUrl = v => typeof v === "string" && /^https?:\/\//i.test(v);
const today = () => new Date().toISOString().slice(0, 10);

function createApp(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, "data");
  const pauseMs = options.pauseMs ?? 1000;
  const sleep = ms => ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve();
  const password = options.password ?? process.env.SITE_PASSWORD ?? "";
  const syncKey = options.syncKey ?? process.env.SYNC_KEY ?? "";
  const seedFile = options.seedFile || path.join(__dirname, "seed.json");
  const files = { listings: path.join(dataDir, "listings.json"), meta: path.join(dataDir, "meta.json"), profile: path.join(dataDir, "profile.json"), shares: path.join(dataDir, "shares.json"), outreach: path.join(dataDir, "outreach.json") };
  fs.mkdirSync(path.join(dataDir, "img"), { recursive: true });
  const now = options.now || (() => new Date());
  // The vault opens only with the right key; otherwise its routes answer 503 (the start-up check refuses to run in that case).
  const vaultText = options.vaultKey ?? process.env.VAULT_KEY ?? "";
  const vaultKey = vaultText ? parseVaultKey(vaultText) : null;
  const vStatus = vaultStatus(dataDir, vaultKey);
  const vault = vaultKey && (vStatus === "ok" || vStatus === "empty") ? openVault(dataDir, vaultKey) : null;

  const state = {
    listings: readJson(files.listings, null),
    meta: readJson(files.meta, { lastCheck: null, log: [] }),
    profile: upgradeProfile(readJson(files.profile, null)),
    shares: (readJson(files.shares, { shares: [] }).shares) || [],
    outreach: normaliseOutreach(readJson(files.outreach, null), now())
  };
  // Claims nobody reported on for a day are closed on start-up, too (as sent when the message reached the listing).
  const loadedClaims = state.outreach.claims, expiredClaims = [], prunedClaims = pruneClaims(loadedClaims, now(), new Set(), expiredClaims, state.listings || {});
  const claimsChanged = prunedClaims.length !== loadedClaims.length || prunedClaims.some((c, i) => c !== loadedClaims[i]);
  state.outreach.claims = prunedClaims;
  // Written through a temp file and a rename, outreach.json first: a crash between the two writes can lose the update-log
  // line, but never writes it twice (the claim is already closed on the next start).
  const writeFileAtomicSync = (file, data) => {
    const tmp = file + ".tmp";
    try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
    catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* nothing was left behind */ } throw e; }
  };
  if (!fs.existsSync(files.outreach) || claimsChanged) writeFileAtomicSync(files.outreach, JSON.stringify(state.outreach));
  if (expiredClaims.length) { state.meta.log = [...expiredLog(expiredClaims, state.listings || {}, now()), ...(state.meta.log || [])].slice(0, 200); writeFileAtomicSync(files.meta, JSON.stringify(state.meta)); }
  if (!state.listings) {
    state.listings = {};
    if (process.env.SEED === "1") {
      const seed = readJson(seedFile, { listings: {} });
      state.listings = seed.listings || {};
      state.meta.lastCheck = seed.snapshotAt || null;
    }
    writeFileAtomicSync(files.listings, JSON.stringify(state.listings));
  }

  let writing = Promise.resolve();
  const persist = () => (writing = writing.catch(() => {}).then(() => Promise.all([writeJsonAtomic(files.listings, state.listings), writeJsonAtomic(files.meta, state.meta)])));

  // Area facts: computed in the background (lib/area-job.js), one listing at a time, at most one Overpass query at a time.
  const areaAuto = options.areaAuto ?? true;
  const ao = options.area || {};
  let crimeTable, rentGrid;
  const areaDeps = {
    now, delays: ao.delays, overpassDelays: ao.overpassDelays, sleep: ao.sleep,
    overpassUrl: ao.overpassUrl || process.env.OVERPASS_URL || OVERPASS_URL,
    overpass: createSpacer(ao.overpassSpacingMs ?? 10000, ao.sleep ? { sleep: ao.sleep } : {}),
    cache: createAreaCache(path.join(dataDir, "area-cache.json"), { now })
  };
  const areaQueue = createAreaQueue({
    state, persist: () => persist(), gapMs: ao.gapMs ?? (ao.sleep ? 0 : 1500), sleep: ao.sleep,
    compute: (point, { force }) => {
      if (crimeTable === undefined) crimeTable = ao.crimeTable !== undefined ? ao.crimeTable : loadCrimeTable();
      if (rentGrid === undefined) rentGrid = ao.rentGrid !== undefined ? ao.rentGrid : loadRentGrid();
      return computeArea(point, { ...areaDeps, fetchImpl: app.locals.fetchImpl, crimeTable, rentGrid, force });
    }
  });

  let writingShares = Promise.resolve();
  const persistShares = () => (writingShares = writingShares.catch(() => {}).then(() => writeJsonAtomic(files.shares, { shares: state.shares })));

  // PUT /api/profile and the pause switch share one write chain, so the file ends with the profile set last.
  let writingProfile = Promise.resolve();
  // Writes the profile as it is when its turn comes, so a queued older save never lands on top of a newer one.
  const saveProfile = () => (writingProfile = writingProfile.catch(() => {}).then(() => writeJsonAtomic(files.profile, state.profile)));

  let writingOutreach = Promise.resolve();
  const persistOutreach = () => (writingOutreach = writingOutreach.catch(() => {}).then(() => writeJsonAtomic(files.outreach, state.outreach)));

  const commuteJob = createCommuteJob({ state, persist: () => persist(), commuteFor, fetchImpl: () => app.locals.fetchImpl, pauseMs, sleep, now });

  const app = express();
  app.locals.state = state;
  app.locals.commuteJob = commuteJob;
  app.locals.files = files;
  app.locals.persist = persist;
  app.locals.persistOutreach = persistOutreach;
  app.locals.fetchImpl = options.fetchImpl || globalThis.fetch;
  app.locals.vault = vault;
  app.locals.areaQueue = areaQueue;
  app.disable("x-powered-by");
  // Behind one reverse proxy (Railway), req.ip is the visitor's address; needed for the share-link rate limit.
  if (options.trustProxy ?? process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff"); res.set("X-Frame-Options", "DENY"); res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    next();
  });
  // Before body parsing, so a body sent to /s can never produce a different answer than the uniform 404.
  // Share links and /healthz are public; everything registered after the access gate is not.
  app.use("/s", publicShares({ state, vault, persistShares, now, rateLimit: options.shareRateLimit }));
  app.get("/healthz", (req, res) => res.type("text").send("ok"));

  // The owner signs in with the password; the routine sends only the sync key and reaches only its own routes (lib/routine-auth.js).
  // Before the body parsers, so the body of a request without access is never read.
  app.use(accessGate({ password, syncKey, realm: () => state.profile && state.profile.name }));
  // Templates, send slots, replies, owner messages and viewing decisions carry small JSON bodies only.
  app.use(["/api/templates", "/api/outreach", "/api/listings/:id/replies", "/api/listings/:id/messages", "/api/listings/:id/viewings"], express.json({ limit: "64kb" }));
  app.use(express.json({ limit: "4mb" }));
  const requireKey = requireSyncKey(syncKey);
  app.locals.requireKey = requireKey;
  app.use(vaultApi({ state, vault, vaultStatus: vault ? "ready" : vStatus === "empty" ? "off" : vStatus, persist, persistShares, now }));
  app.use(areaApi({ state, queue: areaQueue }));
  // Claims, "sent" reports and replies from the routine share one limit (default 60 a minute).
  const routineLimiter = createRateLimiter({ limit: 60, windowMs: 60000, ...(options.routineRateLimit || {}) });
  app.use(outreachApi({ state, vault, persist, persistOutreach, saveProfile, now, catalogue: CATALOGUE, requireKey, limiter: routineLimiter }));
  app.use(repliesApi({ state, persist, now, requireKey, limiter: routineLimiter }));

  app.get("/api/listings", (req, res) => res.json({ listings: state.listings, updatedAt: new Date().toISOString() }));

  // Registered before every /api/listings/:id route so it is never read as an id (PUT refuses it as an id, too). Runs in
  // the background (lib/commute-job.js).
  app.post("/api/listings/recalc-commute", (req, res) => res.status(202).json({ ok: true, ...commuteJob.start() }));
  app.get("/api/commute/status", (req, res) => res.json(commuteJob.status()));

  app.get("/api/meta", (req, res) => res.json(state.meta));

  app.get("/api/profile", (req, res) => state.profile ? res.json(state.profile) : res.status(404).json({ error: "no profile" }));

  app.put("/api/profile", async (req, res) => {
    const { errors, value } = validateProfile(req.body);
    if (errors.length) return res.status(400).json({ error: "invalid profile", details: errors });
    const prev = state.profile, flagged = [];
    const placesChanged = JSON.stringify((prev && prev.places) || []) !== JSON.stringify(value.places);
    if (placesChanged) for (const c of Object.values(state.listings)) if (!c.commuteStale) { c.commuteStale = true; flagged.push(c); }
    // The pause switch has its own route; a saved profile never flips it.
    if (prev && prev.outreach && value.outreach) value.outreach.paused = prev.outreach.paused;
    state.profile = value;
    // The listings are saved first: a profile on disk never points to places whose listings were not flagged.
    try {
      if (flagged.length) await persist();
      await saveProfile();
      res.json({ ok: true, profile: value });
    } catch (e) {
      // Only while nothing newer (a pause, another save) replaced this profile.
      if (state.profile === value) state.profile = prev;
      for (const c of flagged) if (c.commuteStale === true) delete c.commuteStale;
      res.status(500).json({ error: "save failed" });
    }
  });

  // Coordinates, commute to each of the profile's places and a route link for an address; fields stay absent when lookup fails.
  async function locate(query) {
    const out = {};
    try {
      const where = await geocode(query, app.locals.fetchImpl);
      if (where) {
        out.lat = where.lat; out.lon = where.lon;
        const places = (state.profile && state.profile.places) || [];
        out.commute = await commuteFor(where, places, app.locals.fetchImpl);
        if (places.length) out.mapsUrl = "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(places[0].address) + `&destination=${where.lat},${where.lon}`;
      }
    } catch (e) { /* commute stays empty */ }
    return out;
  }

  // Geocoding query from the address fields: "street, postcode city", any part may be missing.
  const placeQuery = l => [l.address, [l.postcode, l.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  // Copies validated input onto a listing; null clears a field. Contact name and type live in listing.contact.
  function applyInput(l, v) {
    for (const [k, x] of Object.entries(v)) {
      if (k === "contactName" || k === "contactType") {
        const c = { ...(l.contact || {}) }, key = k === "contactName" ? "name" : "type";
        if (x === null) delete c[key]; else c[key] = x;
        if (Object.keys(c).length) l.contact = c; else delete l.contact;
      } else if (x === null) delete l[k];
      else l[k] = x;
    }
  }

  // An edit plus its derived warm rent: with cold rent and utilities both known, warm = cold + utilities. Otherwise the
  // warm rent stays, unless it was itself derived from the old cold rent and utilities. A warm rent in the edit wins.
  function applyEdit(l, v) {
    const oldWarm = l.warmRent, oldSum = l.coldRent != null && l.utilities != null ? l.coldRent + l.utilities : null;
    applyInput(l, v);
    if (("coldRent" in v || "utilities" in v) && !("warmRent" in v)) {
      if (l.coldRent != null && l.utilities != null) l.warmRent = l.coldRent + l.utilities;
      else if (oldWarm != null && oldWarm === oldSum) delete l.warmRent;
    }
  }

  const slug = s => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

  app.get("/api/geocode", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q || q.length > 200) return res.status(400).json({ error: "query expected" });
    try { const g = await geocode(q, app.locals.fetchImpl); g ? res.json(g) : res.status(404).json({ error: "not found" }); }
    catch (e) { res.status(502).json({ error: "geocoding failed" }); }
  });

  app.post("/api/listings", async (req, res) => {
    const { errors, value: v } = validateListingInput(req.body);
    if (errors.length) return res.status(400).json({ error: "invalid listing", details: errors });

    const d = today();
    const listing = { photos: [], source: "manual", status: "new", pick: false, notes: "", nextStep: "", messages: [], addedAt: d, lastSeenAt: d };
    applyInput(listing, v);
    if (listing.mode === "rent" && listing.warmRent == null && warmRent(listing) != null) listing.warmRent = warmRent(listing);
    listing.priceHistory = [historyEntry(listing, d)];
    Object.assign(listing, await locate(placeQuery(listing)));
    // Id is chosen and stored synchronously, after the last await, so concurrent adds cannot share one.
    let id = slug(listing.title + " " + (listing.city || listing.address || "")) || "listing";
    if (state.listings[id]) { let i = 2; while (state.listings[`${id}-${i}`]) i++; id = `${id}-${i}`; }
    state.listings[id] = listing;
    const entry = { date: d, type: "new", id, text: listing.title, price: headline(listing) };
    state.meta.log.unshift(entry);
    try { await persist(); }
    catch (e) {
      delete state.listings[id];
      const at = state.meta.log.indexOf(entry);
      if (at >= 0) state.meta.log.splice(at, 1);
      return res.status(500).json({ error: "save failed" });
    }
    if (areaAuto && typeof listing.lat === "number") areaQueue.enqueue(id);
    res.status(201).json({ ok: true, id, listing });
  });

  app.put("/api/img/:name", requireKey, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "5mb" }), async (req, res) => {
    const name = req.params.name;
    if (!/^[a-z0-9][a-z0-9-]{0,80}\.(jpg|png|webp)$/.test(name)) return res.status(400).json({ error: "invalid name" });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: "image body expected" });
    const file = path.join(dataDir, "img", name);
    const tmp = file + ".tmp";
    try { await fs.promises.writeFile(tmp, req.body); await fs.promises.rename(tmp, file); res.json({ ok: true, path: "img/" + name }); }
    catch (e) { res.status(500).json({ error: "save failed" }); }
  });

  app.patch("/api/listings/:id", async (req, res) => {
    const c = state.listings[req.params.id];
    if (!c) return res.status(404).json({ error: "unknown listing" });
    const p = req.body;
    if (!p || typeof p !== "object" || Array.isArray(p)) return res.status(400).json({ error: "invalid update" });
    const allowed = ["status", "nextStep", "notes", "pick", "messages"];
    if (Object.keys(p).some(k => !allowed.includes(k))) return res.status(400).json({ error: "unsupported field" });
    if ("status" in p && !STATUSES.includes(p.status)) return res.status(400).json({ error: "invalid status" });
    if (["nextStep", "notes"].some(k => k in p && (typeof p[k] !== "string" || p[k].length > 10000))) return res.status(400).json({ error: "invalid text" });
    if ("pick" in p && typeof p.pick !== "boolean") return res.status(400).json({ error: "invalid pick" });
    if ("messages" in p && (!Array.isArray(p.messages) || p.messages.length > MAX_MESSAGES || p.messages.some(m => !validMessage(m)))) return res.status(400).json({ error: "invalid messages" });
    const next = { ...p };
    // Messages the routine sent or logged stay, whatever list a (possibly stale) page sends: the ledger and the reply
    // check rely on them. The owner's own messages are replaced by the list.
    if ("messages" in p) {
      next.messages = [...(c.messages || []).filter(fromRoutine), ...p.messages.filter(m => !fromRoutine(m))];
      if (next.messages.length > MAX_MESSAGES) return res.status(400).json({ error: "invalid messages" });
    }
    const done = recordWrites(c);
    Object.assign(c, next);
    const undo = done();
    try { await persist(); } catch (e) {
      // Restore only the fields this request changed, and only while they still hold what it wrote.
      undo();
      return res.status(500).json({ error: "save failed" });
    }
    res.json({ ok: true, listing: c });
  });

  // The owner logs one message (a call, an e-mail, a letter). Appended, so messages written meanwhile are never lost.
  app.post("/api/listings/:id/messages", async (req, res) => {
    const c = Object.hasOwn(state.listings, req.params.id) ? state.listings[req.params.id] : null;
    if (!c) return res.status(404).json({ error: "unknown listing" });
    const m = req.body;
    if (!validMessage(m) || fromRoutine(m)) return res.status(400).json({ error: "invalid messages" });
    if ((c.messages || []).length >= MAX_MESSAGES) return res.status(400).json({ error: "invalid messages" });
    const message = { ...m }, had = Object.hasOwn(c, "messages");
    c.messages = [...(c.messages || []), message];
    try { await persist(); } catch (e) {
      const rest = (c.messages || []).filter(x => x !== message);
      if (!rest.length && !had) delete c.messages; else c.messages = rest;
      return res.status(500).json({ error: "save failed" });
    }
    res.status(201).json({ ok: true, listing: c });
  });

  // Fields that describe where the listing is; a new address makes all of them stale.
  const PLACE_FIELDS = ["lat", "lon", "commute", "commuteStale", "mapsUrl", "area"];
  const ADDRESS_FIELDS = ["address", "postcode", "city"];

  app.patch("/api/listings/:id/listing", async (req, res) => {
    const id = req.params.id;
    if (!state.listings[id]) return res.status(404).json({ error: "unknown listing" });
    const { errors, value: v } = validateListingInput(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: "invalid listing", details: errors });
    const merged = { ...state.listings[id] };
    applyEdit(merged, v);
    const amountTouched = ["mode", "coldRent", "utilities", "warmRent", "price", ...ADDRESS_FIELDS].some(k => k in v);
    const mergedErrors = amountTouched ? requiredErrors(merged) : [];
    if (mergedErrors.length) return res.status(400).json({ error: "invalid listing", details: mergedErrors });
    const moved = ADDRESS_FIELDS.some(k => k in v && v[k] !== state.listings[id][k]);
    const place = moved ? await locate(placeQuery(merged)) : null;
    // Everything below runs without awaiting, so a concurrent delete or edit cannot interleave.
    const c = state.listings[id];
    if (!c) return res.status(404).json({ error: "unknown listing" });
    const done = recordWrites(c), prevWarm = c.warmRent, d = today(), before = headline(c);
    const coldBefore = c.mode === "rent" ? c.coldRent ?? null : null;
    applyEdit(c, v);
    const after = headline(c), coldAfter = c.mode === "rent" ? c.coldRent ?? null : null;
    // The headline (price, else warm rent, else cold rent) is logged when it changes; otherwise a cold-rent change.
    const field = c.mode === "buy" ? "price" : c.warmRent != null ? "warmRent" : "coldRent";
    // A derived warm rent that disappears (utilities cleared) changes the basis, not the price.
    const warmDropped = before != null && c.mode === "rent" && prevWarm != null && c.warmRent == null;
    let entry = null;
    if (after != null && after !== before && !warmDropped) entry = { date: d, type: "price", field, id, text: c.title, from: before, to: after };
    else if (coldAfter != null && coldBefore != null && coldAfter !== coldBefore) entry = { date: d, type: "price", field: "coldRent", id, text: c.title, from: coldBefore, to: coldAfter };
    if (entry) {
      c.priceHistory = [...(c.priceHistory || []), historyEntry(c, d)];
      state.meta.log.unshift(entry);
    }
    if (place) {
      for (const k of PLACE_FIELDS) delete c[k];
      Object.assign(c, place);
    }
    const undo = done();
    try { await persist(); }
    catch (e) {
      // Only the fields this edit wrote, and only while they still hold what it wrote.
      undo();
      const at = entry ? state.meta.log.indexOf(entry) : -1;
      if (at >= 0) state.meta.log.splice(at, 1);
      return res.status(500).json({ error: "save failed" });
    }
    if (place && areaAuto && typeof c.lat === "number") areaQueue.enqueue(id);
    res.json({ ok: true, listing: c });
  });

  app.delete("/api/listings/:id", async (req, res) => {
    const id = req.params.id, c = state.listings[id];
    if (!c) return res.status(404).json({ error: "unknown listing" });
    const log = state.meta.log;
    delete state.listings[id];
    state.meta.log = log.filter(e => e.id !== id);
    // Its share links stop working with it.
    const revoked = state.shares.filter(s => s.listingId === id && !s.revokedAt);
    const at = now().toISOString();
    for (const s of revoked) s.revokedAt = at;
    const restoreListing = () => {
      if (!state.listings[id]) state.listings[id] = c;
      if (state.meta.log.every(e => e.id !== id)) state.meta.log = [...state.meta.log, ...log.filter(e => e.id === id)].sort((a, b) => log.indexOf(a) - log.indexOf(b));
    };
    // Shares first: if only the listing write fails afterwards, the links stay revoked (fail closed).
    if (revoked.length) {
      try { await persistShares(); }
      catch (e) {
        for (const s of revoked) if (s.revokedAt === at) s.revokedAt = null;
        restoreListing();
        return res.status(500).json({ error: "save failed" });
      }
    }
    try { await persist(); }
    catch (e) { restoreListing(); return res.status(500).json({ error: "save failed" }); }
    areaQueue.drop(id);
    // Photos are named <id>-N; skip files of another listing whose id itself starts with "<id>-".
    const img = path.join(dataDir, "img"), others = Object.keys(state.listings).filter(o => o.startsWith(id + "-"));
    try {
      for (const f of await fs.promises.readdir(img)) {
        if (!f.startsWith(id + "-") || others.some(o => f.startsWith(o + "-"))) continue;
        await fs.promises.unlink(path.join(img, f)).catch(() => {});
      }
    } catch (e) { /* photos stay behind; the listing is gone */ }
    res.json({ ok: true });
  });

  app.put("/api/listings/:id", requireKey, async (req, res) => {
    const id = req.params.id, incoming = req.body || {};
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || FIXED_LISTING_PATHS.includes(id)) return res.status(400).json({ error: "invalid id" });
    const prev = Object.hasOwn(state.listings, id) ? state.listings[id] : null;
    // Where a listing lives (url, source) is set once, when it is created: the routine cannot move a listing to another
    // portal, so the ImmoScout block holds for listings the owner added.
    const fields = prev ? LISTING_FIELDS.filter(k => !CREATE_ONLY_FIELDS.includes(k)) : LISTING_FIELDS;
    const listing = Object.fromEntries(Object.entries(incoming).filter(([k, v]) => fields.includes(k) && (!LINK_FIELDS.includes(k) || isHttpUrl(v))));
    // New coordinates make the area facts stale; the server recomputes them (the routine cannot write `area`).
    const moved = !!prev && ["lat", "lon"].some(k => k in listing && listing[k] !== prev[k]);
    let undo = null, written = prev;
    if (prev) {
      // Changed in place, so requests holding this listing (a "sent" report, a reply) keep writing to the live object.
      const done = recordWrites(prev);
      Object.assign(prev, listing);
      if (moved) delete prev.area;
      undo = done();
    } else {
      written = state.listings[id] = { status: "new", pick: false, notes: "", nextStep: "", messages: [], addedAt: today(), ...listing };
      if (typeof incoming.pick === "boolean") written.pick = incoming.pick;
    }
    const entry = prev ? null : { date: today(), type: "new", id, text: written.title, price: headline(written) };
    if (entry) state.meta.log.unshift(entry);
    try { await persist(); } catch (e) {
      // Only this request's own writes: the fields it changed, or the listing it created while it is still that object.
      if (undo) undo(); else if (state.listings[id] === written) delete state.listings[id];
      const at = entry ? state.meta.log.indexOf(entry) : -1;
      if (at >= 0) state.meta.log.splice(at, 1);
      return res.status(500).json({ error: "save failed" });
    }
    if (areaAuto && (moved || !prev) && needsArea(written)) areaQueue.enqueue(id);
    res.json({ ok: true, created: !prev });
  });

  app.put("/api/meta", requireKey, async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some(k => k !== "lastCheck")) return res.status(400).json({ error: "unsupported field" });
    const prevCheck = state.meta.lastCheck;
    if ("lastCheck" in b) {
      if (b.lastCheck !== null && (typeof b.lastCheck !== "string" || b.lastCheck.length > 40)) return res.status(400).json({ error: "invalid lastCheck" });
      state.meta.lastCheck = b.lastCheck;
    }
    try { await persist(); } catch (e) {
      if (state.meta.lastCheck === b.lastCheck) state.meta.lastCheck = prevCheck;
      return res.status(500).json({ error: "save failed" });
    }
    res.json({ ok: true, meta: state.meta });
  });

  app.post("/api/sync", requireKey, async (req, res) => {
    const seen = (req.body && req.body.seen) || {}, d = today(), changes = [];
    const undos = [], prevCheck = state.meta.lastCheck, prevLog = state.meta.log;
    for (const [id, c] of Object.entries(state.listings)) {
      const s = seen[id], done = recordWrites(c);
      if (s) {
        c.lastSeenAt = d;
        if (c.gone) { c.gone = false; changes.push({ date: d, type: "back", id, text: c.title }); }
        const change = applySeen(c, s, id, d);
        if (change) changes.push(change);
      } else if (req.body.complete && c.source !== "manual" && !c.gone && !["rejected", "dropped", "accepted", "gone"].includes(c.status)) {
        c.gone = true; c.goneAt = d; changes.push({ date: d, type: "gone", id, text: c.title });
      }
      const undo = done();
      if (undo.keys.length) undos.push(undo);
    }
    const checkedAt = state.meta.lastCheck = req.body.checkedAt || new Date().toISOString();
    state.meta.log = [...changes, ...state.meta.log].slice(0, 200);
    try { await persist(); } catch (e) {
      // Per listing only the fields this sync wrote (lastSeenAt, gone, amounts, price history), while they still hold its values.
      for (const undo of undos) undo();
      // Only this sync's own changes: log lines that others added meanwhile (an expired claim, a reply) stay.
      if (state.meta.lastCheck === checkedAt) state.meta.lastCheck = prevCheck;
      const kept = state.meta.log.filter(e => !changes.includes(e));
      state.meta.log = [...kept, ...prevLog.filter(e => !kept.includes(e))];
      return res.status(500).json({ error: "save failed" });
    }
    res.json({ ok: true, changes });
  });

  app.use("/img", express.static(path.join(dataDir, "img"), { maxAge: "1d" }));
  app.use(express.static(path.join(__dirname, "public"), { index: "index.html", setHeaders: (res, p) => res.set("Cache-Control", /\.(html|json|js)$/.test(p) ? "no-cache" : "public, max-age=86400") }));
  // Body-parser errors as JSON: too large -> 413, broken JSON -> 400.
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "file too large" });
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid json" });
    next(err);
  });
  // Last resort: never reveal a stack or a path.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (req.path.startsWith("/api/")) return res.status(status).json({ error: status === 500 ? "server error" : "bad request" });
    res.status(status).type("text/plain").send(status === 500 ? "Server error" : "Bad request");
  });
  // Start-up backfill: listings from before phase 3, or whose coordinates changed while the server was down.
  if (areaAuto) for (const [id, c] of Object.entries(state.listings)) if (needsArea(c)) areaQueue.enqueue(id);
  return app;
}

module.exports = { createApp, LISTING_FIELDS, STATUSES };

if (require.main === module) {
  if (!process.env.SITE_PASSWORD) {
    if (process.env.ALLOW_OPEN !== "1") {
      console.error("SITE_PASSWORD is not set. Set it, or set ALLOW_OPEN=1 to run without a password (local use only).");
      process.exit(1);
    }
    if (process.env.VAULT_KEY) { console.error("The document vault needs SITE_PASSWORD. Set it; ALLOW_OPEN=1 cannot be combined with VAULT_KEY."); process.exit(1); }
    console.warn("Warning: ALLOW_OPEN=1 and no SITE_PASSWORD: anyone who can reach this server can see and edit the hunt. The document vault is disabled.");
  }
  let vaultKey = null;
  try { vaultKey = process.env.VAULT_KEY ? parseVaultKey(process.env.VAULT_KEY) : null; }
  catch (e) { console.error(e.message); process.exit(1); }
  const vs = vaultStatus(process.env.DATA_DIR || path.join(__dirname, "data"), vaultKey);
  if (vs === "missing-key") { console.error("The document vault (DATA_DIR/vault) holds data but VAULT_KEY is not set. Set the VAULT_KEY it was created with; without it the documents cannot be read."); process.exit(1); }
  if (vs === "unreadable") { console.error("The document vault (DATA_DIR/vault) cannot be read (I/O or permission error). Check the folder's permissions."); process.exit(1); }
  if (vs === "wrong-key") { console.error("VAULT_KEY does not open the document vault (DATA_DIR/vault). Set the VAULT_KEY it was created with."); process.exit(1); }
  if (!vaultKey) console.warn("VAULT_KEY is not set: the applicant profile, documents and share links are off.");
  const port = process.env.PORT || 3000;
  const app = createApp();
  const profile = app.locals.state.profile;
  app.listen(port, () => console.log(`Flat Hunt on :${port}${profile ? ` (${profile.name})` : ""}`));
}
