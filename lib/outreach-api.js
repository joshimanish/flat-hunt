// lib/outreach-api.js — templates and approvals (owner), the pause switch (owner), the outreach status (owner and routine)
// and the routine's send slots: claim → send on the portal → report "sent" (or "release" when nothing went out).
const express = require("express");
const { TEMPLATE_IDS, TEMPLATE_LANGS, PLACEHOLDERS, bodyErrors, fillValues, render, isoDay } = require("./templates");
const { VIAS, newId, claimKey, usedToday, nextSlotAt, ineligible, prune, expiredLog, hasMessage, RETRY_LIMIT } = require("./outreach");

const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/, CLAIM_RE = /^[0-9a-f]{16}$/;
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const today = now => now.toISOString().slice(0, 10);

// ctx: { state, vault, persist, persistOutreach, saveProfile, now, catalogue, requireKey, limiter }
function outreachApi(ctx) {
  const { state } = ctx;
  const inFlight = new Set(); // claim ids whose first save has not finished; memory only
  const router = express.Router();
  const ownerOnly = (req, res, next) => req.viaSyncKey ? res.status(403).json({ error: "not allowed with the sync key" }) : next();
  const limited = (req, res, next) => ctx.limiter.hit("routine") ? next() : res.status(429).json({ error: "too many requests" });
  const applicant = () => (ctx.vault && ctx.vault.applicant) || null;
  const outreach = () => state.profile && state.profile.outreach;
  const busy = res => res.status(409).json({ error: "busy", reason: "busy" });
  // Holds a claim id in `inFlight` while one request is changing it; any other request for the id is told to wait.
  const holding = async (id, fn) => { inFlight.add(id); try { return await fn(); } finally { inFlight.delete(id); } };
  // Prunes the claim list; each claim that just expired gets a line in the update log, saved in the background (the
  // next meta save writes it too, should this one fail).
  const pruneClaims = (claims, now) => {
    const expired = [], out = prune(claims, now, inFlight, expired, state.listings);
    if (expired.length) { state.meta.log.unshift(...expiredLog(expired, state.listings, now)); ctx.persist().catch(() => {}); }
    return out;
  };
  const saveOutreach = async (undo, res) => {
    try { await ctx.persistOutreach(); return true; }
    catch (e) { undo(); res.status(500).json({ error: "save failed" }); return false; }
  };
  const findTemplate = (req, res) => {
    const { id, lang } = req.params;
    if (!TEMPLATE_IDS.includes(id) || !TEMPLATE_LANGS.includes(lang)) { res.status(404).json({ error: "unknown template" }); return null; }
    return state.outreach.templates[id][lang];
  };

  // ---------- templates (owner) ----------
  router.get("/api/templates", ownerOnly, (req, res) => res.json({ templates: state.outreach.templates, placeholders: PLACEHOLDERS, ids: TEMPLATE_IDS, langs: TEMPLATE_LANGS }));

  // Editing makes a new version and withdraws the approval.
  router.put("/api/templates/:id/:lang", ownerOnly, async (req, res) => {
    const t = findTemplate(req, res);
    if (!t) return;
    if (!isObj(req.body) || Object.keys(req.body).some(k => k !== "body")) return res.status(400).json({ error: "unsupported field" });
    const errors = bodyErrors(req.params.id, req.body.body);
    if (errors.length) return res.status(400).json({ error: "invalid template", details: errors });
    if (req.body.body === t.body) return res.json({ ok: true, template: t, changed: false });
    const prev = { ...t };
    Object.assign(t, { body: req.body.body, version: t.version + 1, updatedAt: ctx.now().toISOString(), approvedAt: null });
    const wrote = t.version;
    // Undo only while nothing newer has been written on top of this edit. An approval that was in flight meanwhile may
    // have failed too, so the restored version comes back unapproved rather than guessing.
    if (!(await saveOutreach(() => { if (t.version === wrote) Object.assign(t, prev, { approvedAt: null }); }, res))) return;
    res.json({ ok: true, template: t, changed: true });
  });

  // Approves exactly the version the owner saw; a newer version needs its own approval.
  router.post("/api/templates/:id/:lang/approve", ownerOnly, async (req, res) => {
    const t = findTemplate(req, res);
    if (!t) return;
    if (!isObj(req.body) || !Number.isInteger(req.body.version)) return res.status(400).json({ error: "version expected" });
    if (req.body.version !== t.version) return res.status(409).json({ error: "version-changed", version: t.version });
    const prev = t.approvedAt, ver = t.version, wrote = ctx.now().toISOString();
    t.approvedAt = wrote;
    if (!(await saveOutreach(() => { if (t.version === ver && t.approvedAt === wrote) t.approvedAt = prev; }, res))) return;
    res.json({ ok: true, template: t });
  });

  router.delete("/api/templates/:id/:lang/approve", ownerOnly, async (req, res) => {
    const t = findTemplate(req, res);
    if (!t) return;
    const prev = t.approvedAt, ver = t.version;
    t.approvedAt = null;
    if (!(await saveOutreach(() => { if (t.version === ver && t.approvedAt === null) t.approvedAt = prev; }, res))) return;
    res.json({ ok: true, template: t });
  });

  // The text as a landlord would get it: the real applicant profile and either a tracked listing or an example one.
  router.post("/api/templates/preview", ownerOnly, (req, res) => {
    const b = req.body;
    if (!isObj(b) || !TEMPLATE_IDS.includes(b.id) || !TEMPLATE_LANGS.includes(b.lang)) return res.status(400).json({ error: "id and lang expected" });
    const errors = bodyErrors(b.id, b.body);
    if (errors.length) return res.status(400).json({ error: "invalid template", details: errors });
    const own = typeof b.listingId === "string" && Object.hasOwn(state.listings, b.listingId) ? state.listings[b.listingId] : null;
    const listing = own || { title: b.lang === "de" ? "Helle 2-Zimmer-Wohnung" : "Bright two-room flat", address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf", contact: { name: "Example GmbH", type: "company" } };
    const now = ctx.now(), viewingTime = new Date(Math.ceil(now.getTime() / 3600000) * 3600000 + 3 * 86400000).toISOString();
    const { text, missing } = render(b.body, fillValues({ applicant: applicant(), profile: state.profile, listing, viewingTime, lang: b.lang, now }));
    res.json({ text, missing, example: !own });
  });

  // ---------- pause switch (owner) ----------
  router.put("/api/outreach/pause", ownerOnly, async (req, res) => {
    if (!state.profile) return res.status(404).json({ error: "no profile" });
    if (!isObj(req.body) || Object.keys(req.body).some(k => k !== "paused") || typeof req.body.paused !== "boolean") return res.status(400).json({ error: "paused: true or false expected" });
    const prev = state.profile, next = { ...prev, outreach: { ...prev.outreach, paused: req.body.paused } };
    state.profile = next;
    try { await ctx.saveProfile(next); }
    catch (e) { if (state.profile === next) state.profile = prev; return res.status(500).json({ error: "save failed" }); }
    res.json({ ok: true, paused: next.outreach.paused });
  });

  // ---------- status (owner and routine) ----------
  router.get("/api/outreach/status", (req, res) => {
    const o = outreach();
    if (!o) return res.status(404).json({ error: "no profile" });
    const now = ctx.now();
    const pruned = pruneClaims(state.outreach.claims, now);
    const changed = pruned.length !== state.outreach.claims.length || pruned.some((c, i) => c !== state.outreach.claims[i]);
    state.outreach.claims = pruned;
    if (changed) ctx.persistOutreach().catch(() => {}); // expired claims leave the file; never blocks or fails this answer
    const claims = state.outreach.claims;
    const approved = Object.fromEntries(TEMPLATE_IDS.map(id => [id, Object.fromEntries(TEMPLATE_LANGS.map(l => [l, !!state.outreach.templates[id][l].approvedAt]))]));
    res.json({ enabled: o.enabled, paused: o.paused, language: o.language, minGapMin: o.minGapMin, dailyCap: o.dailyCap, today: { used: usedToday(claims, now), cap: o.dailyCap }, nextAt: nextSlotAt(claims, o.minGapMin, now), approved });
  });

  // ---------- send slots (routine) ----------
  // Everything from the pause check to the reservation runs without awaiting, so two claims cannot both pass the cap,
  // the spacing or "once per listing". A repeated claim for the same listing and template returns the reserved slot.
  router.post("/api/outreach/claims", ctx.requireKey, limited, async (req, res) => {
    const b = req.body;
    if (!isObj(b) || Object.keys(b).some(k => !["listingId", "templateId", "via", "viewingId", "lang"].includes(k))) return res.status(400).json({ error: "unsupported field" });
    if (typeof b.listingId !== "string" || !ID_RE.test(b.listingId)) return res.status(400).json({ error: "listingId expected" });
    if (!TEMPLATE_IDS.includes(b.templateId)) return res.status(400).json({ error: `templateId: one of ${TEMPLATE_IDS.join(", ")} expected` });
    if (!VIAS.includes(b.via)) return res.status(400).json({ error: `via: one of ${VIAS.join(", ")} expected` });
    if (b.lang !== undefined && !TEMPLATE_LANGS.includes(b.lang)) return res.status(400).json({ error: "lang: de or en expected" });
    if ((b.templateId === "viewing-confirmation") !== (typeof b.viewingId === "string" && CLAIM_RE.test(b.viewingId))) return res.status(400).json({ error: "viewingId: needed for viewing-confirmation only" });
    const l = Object.hasOwn(state.listings, b.listingId) ? state.listings[b.listingId] : null;
    if (!l) return res.status(404).json({ error: "unknown listing" });
    const o = outreach();
    const refuse = (reason, extra = {}) => res.status(409).json({ error: reason, reason, ...extra });
    if (!o || !o.enabled) return refuse("disabled");
    if (o.paused) return refuse("paused");
    const now = ctx.now();
    const pruned = pruneClaims(state.outreach.claims, now);
    if (pruned.length !== state.outreach.claims.length || pruned.some((c, i) => c !== state.outreach.claims[i])) ctx.persistOutreach().catch(() => {}); // like the status route
    state.outreach.claims = pruned;
    const claims = state.outreach.claims;
    const key = claimKey(b.listingId, b.templateId, b.viewingId);
    const existing = claims.find(c => c.key === key && c.status !== "released");
    if (existing && existing.status === "sent") return refuse("already-sent", { claimId: existing.id });
    if (existing && existing.status === "skipped") return refuse("already-contacted", { claimId: existing.id, ...(existing.reason === "expired" ? { expired: true } : {}) });
    const lang = b.lang || o.language, t = state.outreach.templates[b.templateId][lang];
    const viewing = b.viewingId ? (l.viewings || []).find(v => v.id === b.viewingId) : null;
    // Approval and eligibility, for a new claim and for a repeat alike.
    const blocked = () => {
      if (!t.approvedAt || (existing && existing.version !== t.version)) return ["not-approved", { templateId: b.templateId, lang }];
      const why = ineligible({ templateId: b.templateId, listing: l, viewing, profile: state.profile, catalogue: ctx.catalogue, others: Object.values(state.listings) });
      return why ? [why.reason, why.failed ? { failed: why.failed } : {}] : null;
    };
    if (existing) {
      if (inFlight.has(existing.id)) return busy(res);
      if (existing.lang !== lang || existing.via !== b.via) return refuse("claim-mismatch", { claimId: existing.id });
      if (hasMessage(l, existing.id)) {
        // "sent" reached the listing but not the ledger: finish that step instead of handing out the text again.
        const prevClaim = { ...existing };
        Object.assign(existing, { status: "sent", sentAt: (l.messages.find(m => m.claimId === existing.id) || {}).date || now.toISOString() });
        delete existing.text;
        if (!(await holding(existing.id, () => saveOutreach(() => Object.assign(existing, prevClaim), res)))) return;
        return refuse("already-sent", { claimId: existing.id });
      }
      const why = blocked();
      if (why) {
        const prevClaim = { ...existing };
        Object.assign(existing, { status: "released", releasedAt: now.toISOString(), releaseReason: "stale" });
        delete existing.text;
        if (!(await holding(existing.id, () => saveOutreach(() => Object.assign(existing, prevClaim), res)))) return;
        return refuse(why[0], why[1]);
      }
      return res.json({ ok: true, repeated: true, claim: claimView(existing), text: existing.text });
    }
    const why = blocked();
    if (why) return refuse(why[0], why[1]);
    // Claim and release in a loop must not get round the cap and the gap.
    if (claims.filter(c => c.key === key && isoDay(new Date(c.claimedAt)) === isoDay(now)).length >= RETRY_LIMIT) return refuse("retry-limit");
    const used = usedToday(claims, now);
    if (used >= o.dailyCap) return refuse("daily-cap", { used, cap: o.dailyCap });
    const retryAt = nextSlotAt(claims, o.minGapMin, now);
    if (retryAt) return refuse("too-soon", { retryAt });
    const { text, missing } = render(t.body, fillValues({ applicant: applicant(), profile: state.profile, listing: l, viewingTime: viewing && viewing.time, lang, now }));
    if (missing.length) return refuse("missing-values", { missing });
    const claim = { id: newId(), key, listingId: b.listingId, templateId: b.templateId, lang, version: t.version, viewingId: b.viewingId || null, via: b.via, claimedAt: now.toISOString(), status: "claimed", sentAt: null, releasedAt: null, text };
    const before = state.outreach.claims;
    state.outreach.claims = [...pruneClaims(before, now), claim];
    inFlight.add(claim.id);
    let saved;
    try { saved = await saveOutreach(() => { state.outreach.claims = before; }, res); }
    finally { inFlight.delete(claim.id); }
    if (!saved) return;
    res.status(201).json({ ok: true, repeated: false, claim: claimView(claim), text });
  });

  const findClaim = (req, res) => {
    const c = CLAIM_RE.test(req.params.claimId) ? state.outreach.claims.find(x => x.id === req.params.claimId) : null;
    if (!c) res.status(404).json({ error: "unknown claim" });
    return c;
  };

  // The routine sent the text: log it on the listing (once, even when retried) and close the slot.
  router.post("/api/outreach/claims/:claimId/sent", ctx.requireKey, limited, async (req, res) => {
    const c = findClaim(req, res);
    if (!c) return;
    if (inFlight.has(c.id)) return busy(res);
    return holding(c.id, () => markSent(c, res));
  });
  const markSent = async (c, res) => {
    if (c.status === "released" || c.status === "skipped") return res.status(409).json({ error: c.status, reason: c.status });
    if (c.status === "sent") return res.json({ ok: true, repeated: true });
    const l = Object.hasOwn(state.listings, c.listingId) ? state.listings[c.listingId] : null;
    const now = ctx.now(), at = now.toISOString();
    if (l && !(l.messages || []).some(m => m.claimId === c.id)) {
      const entry = { date: today(now), type: "sent", id: c.listingId, text: l.title, template: c.templateId };
      const message = { date: at, dir: "out", from: "", via: c.via, text: c.text, lang: c.lang, templateId: c.templateId, templateVersion: c.version, claimId: c.id };
      l.messages = [...(l.messages || []), message];
      const prevStatus = l.status;
      let setStatus = null;
      if (c.templateId === "first-contact" && l.status === "new") { l.status = setStatus = "contacted"; }
      const v = c.viewingId && (l.viewings || []).find(x => x.id === c.viewingId);
      const prevSentAt = v ? v.confirmationSentAt : null;
      if (v) v.confirmationSentAt = at;
      state.meta.log.unshift(entry);
      try { await ctx.persist(); }
      catch (e) {
        // Only this request's own changes, and only where they are still what it wrote.
        l.messages = (l.messages || []).filter(m => m !== message);
        if (setStatus && l.status === setStatus) l.status = prevStatus;
        if (v && v.confirmationSentAt === at) v.confirmationSentAt = prevSentAt;
        const i = state.meta.log.indexOf(entry); if (i >= 0) state.meta.log.splice(i, 1);
        return res.status(500).json({ error: "save failed" });
      }
    }
    const prevClaim = { ...c };
    Object.assign(c, { status: "sent", sentAt: at });
    delete c.text;
    if (!(await saveOutreach(() => Object.assign(c, prevClaim), res))) return;
    res.json({ ok: true, repeated: false });
  };

  // Nothing went out. "not-sent" (default; portal error before sending) frees the slot again; "already-contacted" (the
  // duplicate check found an earlier conversation) closes it for good without counting against the cap or the gap.
  router.post("/api/outreach/claims/:claimId/release", ctx.requireKey, limited, async (req, res) => {
    const c = findClaim(req, res);
    if (!c) return;
    if (inFlight.has(c.id)) return busy(res);
    return holding(c.id, () => release(c, req, res));
  });
  const release = async (c, req, res) => {
    const reason = isObj(req.body) && req.body.reason !== undefined ? req.body.reason : "not-sent";
    if (!["not-sent", "already-contacted"].includes(reason)) return res.status(400).json({ error: "reason: not-sent or already-contacted expected" });
    if (c.status === "sent") return res.status(409).json({ error: "already-sent", reason: "already-sent" });
    if (c.status !== "claimed") return res.json({ ok: true, repeated: true });
    const prevClaim = { ...c }, now = ctx.now();
    Object.assign(c, { status: reason === "already-contacted" ? "skipped" : "released", releasedAt: now.toISOString() });
    delete c.text;
    let entry = null;
    if (reason === "already-contacted") {
      const l = Object.hasOwn(state.listings, c.listingId) ? state.listings[c.listingId] : null;
      entry = { date: today(now), type: "skipped", id: c.listingId, text: l ? l.title : c.listingId, template: c.templateId };
      state.meta.log.unshift(entry);
    }
    const undo = () => { Object.assign(c, prevClaim); const i = entry ? state.meta.log.indexOf(entry) : -1; if (i >= 0) state.meta.log.splice(i, 1); };
    if (!(await saveOutreach(undo, res))) return;
    if (entry) { try { await ctx.persist(); } catch (e) { /* the claim is closed; only the log line is missing */ } }
    res.json({ ok: true, repeated: false, status: c.status });
  };

  return router;
}

const claimView = ({ text, key, ...c }) => c;

module.exports = { outreachApi };
