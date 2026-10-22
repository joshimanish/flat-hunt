// lib/replies-api.js — the routine logs landlord replies (sync key); the owner confirms or declines proposed viewing times
// (password). A documents request only records the request: documents still leave only through a share the owner creates.
const express = require("express");
const { validateReply, isoTime } = require("./replies");
const { addDocRequest } = require("./doc-requests");
const { DECIDED, MAX_MESSAGES, newId, claimKey } = require("./outreach");

// ctx: { state, persist, now, requireKey, limiter }
function repliesApi(ctx) {
  const { state } = ctx;
  const router = express.Router();
  const ownerOnly = (req, res, next) => req.viaSyncKey ? res.status(403).json({ error: "not allowed with the sync key" }) : next();
  const limited = (req, res, next) => ctx.limiter.hit("routine") ? next() : res.status(429).json({ error: "too many requests" });
  const findListing = (req, res) => {
    const l = Object.hasOwn(state.listings, req.params.id) ? state.listings[req.params.id] : null;
    if (!l) res.status(404).json({ error: "unknown listing" });
    return l;
  };
  // Saves listings and meta; on failure runs this request's own undo (never a whole-listing restore: other requests may
  // have written to the listing meanwhile) and answers 500.
  async function save(undo, res) {
    try { await ctx.persist(); return true; }
    catch (e) { undo(); res.status(500).json({ error: "save failed" }); return false; }
  }
  // A viewing-confirmation claim that is open (claimed, or being created) pins the viewing.
  const claimOpen = (listingId, vid) => {
    const key = claimKey(listingId, "viewing-confirmation", vid);
    return state.outreach.claims.some(c => c.key === key && c.status === "claimed");
  };

  router.post("/api/listings/:id/replies", ctx.requireKey, limited, async (req, res) => {
    const l = findListing(req, res);
    if (!l) return;
    const now = ctx.now(), { errors, value: v } = validateReply(req.body, now);
    if (errors.length) return res.status(400).json({ error: "invalid reply", details: errors });
    const msgs = l.messages || [];
    // Logged once: the same portal or email id, or the same text at the same time, is a repeat.
    const noDate = req.body.date === undefined;
    const dup = msgs.find(m => m.dir === "in" && ((v.externalId && m.externalId === v.externalId) || (m.date === v.date && m.text === v.text) || (noDate && m.text === v.text && m.from === v.from && m.via === v.via)));
    if (dup) return res.json({ ok: true, repeated: true });
    if (msgs.length >= MAX_MESSAGES) return res.status(409).json({ error: "too-many-messages", reason: "too-many-messages" });
    const at = now.toISOString(), undos = [];
    const message = { date: v.date, dir: "in", from: v.from, via: v.via, text: v.text, intent: v.intent };
    if (v.externalId) message.externalId = v.externalId;
    const hadMessages = l.messages !== undefined, hadViewings = l.viewings !== undefined;
    l.messages = [...msgs, message];
    undos.push(() => { const rest = (l.messages || []).filter(m => m !== message); if (!rest.length && !hadMessages) delete l.messages; else l.messages = rest; });
    const setStatus = status => {
      const prevStatus = l.status;
      l.status = status;
      undos.push(() => { if (l.status === status) l.status = prevStatus; });
    };
    let viewingId = null;
    if (v.intent === "viewing-invite") {
      viewingId = newId();
      l.viewings = [...(l.viewings || []), { id: viewingId, createdAt: at, proposedTimes: v.proposedTimes, status: "pending", time: null, decidedAt: null, confirmationSentAt: null }].slice(-20);
      const id = viewingId;
      undos.push(() => { const rest = (l.viewings || []).filter(x => x.id !== id); if (!rest.length && !hadViewings) delete l.viewings; else l.viewings = rest; });
      if (!DECIDED.includes(l.status)) setStatus("viewing-invited");
    } else if (v.intent === "documents-request") {
      undos.push(addDocRequest(l, v.docTypes || ["summary"], at));
    } else if (v.intent === "rejection") {
      if (l.status !== "dropped") setStatus("rejected");
      const cancelled = [];
      for (const x of l.viewings || []) if (x.status === "pending" || x.status === "confirmed") { cancelled.push([x, x.status]); x.status = "cancelled"; }
      undos.push(() => { for (const [x, st] of cancelled) if (x.status === "cancelled") x.status = st; });
    }
    // The log names the listing and the intent, never the message text.
    const entry = { date: at.slice(0, 10), type: "reply", id: req.params.id, text: l.title, intent: v.intent };
    state.meta.log.unshift(entry);
    undos.push(() => { const i = state.meta.log.indexOf(entry); if (i >= 0) state.meta.log.splice(i, 1); });
    if (!(await save(() => undos.reverse().forEach(u => u()), res))) return;
    res.status(201).json({ ok: true, repeated: false, status: l.status, viewingId });
  });

  const findViewing = (req, res) => {
    const l = findListing(req, res);
    if (!l) return [];
    const v = (l.viewings || []).find(x => x.id === req.params.vid);
    if (!v) { res.status(404).json({ error: "unknown viewing" }); return []; }
    return [l, v];
  };

  // The owner picks one of the proposed times; the routine may then send the viewing confirmation for it.
  router.post("/api/listings/:id/viewings/:vid/confirm", ownerOnly, async (req, res) => {
    const [l, v] = findViewing(req, res);
    if (!l) return;
    const time = req.body && isoTime(req.body.time);
    if (!time || !v.proposedTimes.includes(time)) return res.status(400).json({ error: "time: one of the proposed times expected" });
    if (v.status === "confirmed" && v.time === time) return res.json({ ok: true, listing: l });
    if (v.status === "confirmed" && claimOpen(req.params.id, v.id)) return res.status(409).json({ error: "claim-open", reason: "claim-open" });
    if (v.status !== "pending") return res.status(409).json({ error: "viewing is not pending" });
    const prev = { status: v.status, time: v.time, decidedAt: v.decidedAt }, at = ctx.now().toISOString();
    Object.assign(v, { status: "confirmed", time, decidedAt: at });
    const undo = () => { if (v.status === "confirmed" && v.time === time && v.decidedAt === at) Object.assign(v, prev); };
    if (!(await save(undo, res))) return;
    res.json({ ok: true, listing: l });
  });

  // Declined: nothing is sent; the owner answers the landlord personally if they want to.
  router.post("/api/listings/:id/viewings/:vid/decline", ownerOnly, async (req, res) => {
    const [l, v] = findViewing(req, res);
    if (!l) return;
    if (claimOpen(req.params.id, v.id)) return res.status(409).json({ error: "claim-open", reason: "claim-open" });
    if (!(v.status === "pending" || (v.status === "confirmed" && !v.confirmationSentAt))) return res.status(409).json({ error: "viewing cannot be declined any more" });
    const prev = { status: v.status, decidedAt: v.decidedAt }, at = ctx.now().toISOString();
    Object.assign(v, { status: "declined", decidedAt: at });
    const undo = () => { if (v.status === "declined" && v.decidedAt === at) Object.assign(v, prev); };
    if (!(await save(undo, res))) return;
    res.json({ ok: true, listing: l });
  });

  return router;
}

module.exports = { repliesApi };
