// lib/vault-api.js — password-protected routes for the applicant profile, the document vault, document requests and shares.
const express = require("express");
const { validateApplicant } = require("./applicant");
const { canReadPdf, toPdf, summaryPdf, LANGS } = require("./pdf");
const { MIMES, MAX_BYTES, validateDocMeta, docView, listDocs } = require("./documents");
const { sniffMime } = require("./vault");
const { SUMMARY_ID, validateShareInput, createShare, shareView } = require("./shares");
const { REQUEST_TYPES, addDocRequest } = require("./doc-requests");


const META_MAX = 2048;
// X-Doc-Meta: base64url of the JSON {type, label, date}. Missing header = {}; anything undecodable = null.
function decodeMeta(h) {
  if (h === undefined) return {};
  if (typeof h !== "string" || h.length > META_MAX || !/^[A-Za-z0-9_-]*$/.test(h)) return null;
  try { return JSON.parse(Buffer.from(h, "base64url").toString("utf8")); } catch (e) { return null; }
}

const EXT = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

// ctx: { state, vault (null when VAULT_KEY is not set or does not open the vault), vaultStatus, persist, persistShares, now }
function vaultApi(ctx) {
  const { state, vault } = ctx;
  const router = express.Router();
  const nowIso = () => ctx.now().toISOString();

  router.get("/api/vault/status", (req, res) => res.json({ status: ctx.vaultStatus }));

  const requireVault = (req, res, next) => vault ? next() : res.status(503).json({ error: "vault not configured" });
  router.use(["/api/applicant", "/api/vault", "/api/shares"], requireVault);

  // ---------- applicant ----------
  router.get("/api/applicant", (req, res) => vault.applicant ? res.json({ applicant: vault.applicant }) : res.status(404).json({ error: "no applicant" }));

  router.put("/api/applicant", async (req, res) => {
    const { errors, value } = validateApplicant(req.body);
    if (errors.length) return res.status(400).json({ error: "invalid applicant", details: errors });
    const prev = vault.applicant;
    vault.applicant = value;
    try { await vault.saveApplicant(value); }
    catch (e) { if (vault.applicant === value) vault.applicant = prev; return res.status(500).json({ error: "save failed" }); }
    res.json({ ok: true, applicant: value });
  });

  // ---------- applicant summary ----------
  const summaryLang = q => q === undefined ? (state.profile && state.profile.outreach.language) || "en" : LANGS.includes(q) ? q : null;

  router.get("/api/applicant/summary.pdf", async (req, res) => {
    const lang = summaryLang(req.query.lang);
    if (!lang) return res.status(400).json({ error: "lang: one of en, de, pt expected" });
    if (!vault.applicant) return res.status(404).json({ error: "no applicant" });
    let bytes;
    try { bytes = await summaryPdf(vault.applicant, (state.profile && state.profile.money.netIncome) || 0, lang, ctx.now()); }
    catch (e) { return res.status(500).json({ error: "pdf failed" }); }
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="applicant-summary-${lang}.pdf"`);
    res.send(Buffer.from(bytes));
  });

  // ---------- documents ----------
  const upload = express.raw({ type: MIMES, limit: MAX_BYTES });
  const contentType = req => String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  // The uploaded body, checked: one of the three types, not empty, magic bytes match the declared type, PDFs readable.
  async function fileError(req) {
    if (!Buffer.isBuffer(req.body)) return [415, "pdf, jpeg or png expected"];
    if (!req.body.length) return [400, "file expected"];
    if (sniffMime(req.body) !== contentType(req)) return [400, "file content does not match its type"];
    if (contentType(req) === "application/pdf") {
      if (!(await canReadPdf(req.body))) return [400, "pdf cannot be read (encrypted or damaged)"];
    } else {
      try { await toPdf(req.body, contentType(req)); } catch (e) { return [400, "image cannot be read"]; }
    }
    return null;
  }
  const findDoc = (req, res) => {
    const d = /^[0-9a-f]{16}$/.test(req.params.id) && Object.hasOwn(vault.index.docs, req.params.id) ? vault.index.docs[req.params.id] : null;
    if (!d) res.status(404).json({ error: "unknown document" });
    return d;
  };

  router.get("/api/vault", (req, res) => res.json({ docs: listDocs(vault.index, nowIso().slice(0, 10)) }));

  router.post("/api/vault", upload, async (req, res) => {
    // Metadata travels in the X-Doc-Meta header, never in the URL (access logs record URLs).
    if (Object.keys(req.query).length) return res.status(400).json({ error: "metadata belongs in the X-Doc-Meta header, not the URL" });
    const bad = await fileError(req);
    if (bad) return res.status(bad[0]).json({ error: bad[1] });
    const raw = decodeMeta(req.headers["x-doc-meta"]);
    if (raw === null) return res.status(400).json({ error: "invalid X-Doc-Meta header" });
    const { errors, value: meta } = validateDocMeta(raw);
    if (errors.length) return res.status(400).json({ error: "invalid metadata", details: errors });
    const id = vault.newId(), file = vault.newId();
    const doc = { id, file, ...meta, mime: contentType(req), size: req.body.length, uploadedAt: nowIso(), redactedAt: null };
    try {
      await vault.writeDoc(file, req.body);
      vault.index.docs[id] = doc;
      await vault.saveIndex();
    } catch (e) {
      if (vault.index.docs[id] === doc) delete vault.index.docs[id];
      await vault.removeDoc(file);
      return res.status(500).json({ error: "save failed" });
    }
    res.status(201).json({ ok: true, doc: docView(doc, nowIso().slice(0, 10)) });
  });

  router.get("/api/vault/:id", async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    let buf;
    try { buf = await vault.readDoc(d.file); } catch (e) { return res.status(500).json({ error: "read failed" }); }
    res.set("Content-Type", d.mime);
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", `attachment; filename="${d.type}${d.date ? "-" + d.date : ""}.${EXT[d.mime]}"`);
    res.send(buf);
  });

  router.put("/api/vault/:id", async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    const { errors, value } = validateDocMeta(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: "invalid metadata", details: errors });
    const prev = { ...d };
    Object.assign(d, value);
    try { await vault.saveIndex(); }
    catch (e) { Object.assign(d, prev); return res.status(500).json({ error: "save failed" }); }
    res.json({ ok: true, doc: docView(d, nowIso().slice(0, 10)) });
  });

  router.delete("/api/vault/:id", async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    delete vault.index.docs[d.id];
    try { await vault.saveIndex(); }
    catch (e) { vault.index.docs[d.id] = d; return res.status(500).json({ error: "save failed" }); }
    await vault.removeDoc(d.file);
    res.json({ ok: true });
  });

  // A redacted version replaces the file; type, label and date stay.
  router.post("/api/vault/:id/replace", upload, async (req, res) => {
    const d = findDoc(req, res);
    if (!d) return;
    const bad = await fileError(req);
    if (bad) return res.status(bad[0]).json({ error: bad[1] });
    const prev = { ...d }, file = vault.newId();
    try {
      await vault.writeDoc(file, req.body);
      Object.assign(d, { file, mime: contentType(req), size: req.body.length, redactedAt: nowIso() });
      await vault.saveIndex();
    } catch (e) {
      Object.assign(d, prev);
      await vault.removeDoc(file);
      return res.status(500).json({ error: "save failed" });
    }
    await vault.removeDoc(prev.file);
    res.json({ ok: true, doc: docView(d, nowIso().slice(0, 10)) });
  });


  // ---------- document requests and shares ----------
  const findListing = (req, res) => {
    const l = Object.hasOwn(state.listings, req.params.id) ? state.listings[req.params.id] : null;
    if (!l) res.status(404).json({ error: "unknown listing" });
    return l;
  };

  // The landlord asked for documents: log which, and move the listing to "docs-requested".
  router.post("/api/listings/:id/doc-requests", async (req, res) => {
    const l = findListing(req, res);
    if (!l) return;
    const b = req.body, types = b && b.types;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some(k => k !== "types")) return res.status(400).json({ error: "unsupported field" });
    if (!Array.isArray(types) || !types.length || new Set(types).size !== types.length || types.some(t => !REQUEST_TYPES.includes(t))) return res.status(400).json({ error: `types: list of ${REQUEST_TYPES.join(", ")} expected` });
    const undo = addDocRequest(l, types, nowIso());
    try { await ctx.persist(); }
    catch (e) { undo(); return res.status(500).json({ error: "save failed" }); }
    res.json({ ok: true, listing: l });
  });

  router.post("/api/listings/:id/shares", requireVault, async (req, res) => {
    const l = findListing(req, res);
    if (!l) return;
    const { errors, value } = validateShareInput(req.body, id => Object.hasOwn(vault.index.docs, id));
    if (errors.length) return res.status(400).json({ error: "invalid share", details: errors });
    if (value.docIds.includes(SUMMARY_ID) && !vault.applicant) return res.status(400).json({ error: "invalid share", details: ["docIds: the summary needs the applicant profile first"] });
    const { share, token } = createShare({ listingId: req.params.id, listing: l, docIds: value.docIds, days: value.days, now: ctx.now() });
    state.shares.push(share);
    try { await ctx.persistShares(); }
    catch (e) {
      const at = state.shares.indexOf(share);
      if (at >= 0) state.shares.splice(at, 1);
      return res.status(500).json({ error: "save failed" });
    }
    // The token leaves the server only here, once.
    res.status(201).json({ ok: true, share: shareView(share, ctx.now()), url: "/s/" + token });
  });

  router.get("/api/listings/:id/shares", requireVault, (req, res) => {
    if (!findListing(req, res)) return;
    const now = ctx.now();
    res.json({ shares: state.shares.filter(s => s.listingId === req.params.id).map(s => shareView(s, now)).reverse() });
  });

  router.delete("/api/shares/:shareId", async (req, res) => {
    const s = state.shares.find(x => x.id === req.params.shareId);
    if (!s) return res.status(404).json({ error: "unknown share" });
    if (!s.revokedAt) {
      // Fails closed: if the save fails the share stays revoked in memory.
      s.revokedAt = nowIso();
      try { await ctx.persistShares(); }
      catch (e) { return res.status(500).json({ error: "save failed" }); }
    }
    res.json({ ok: true, share: shareView(s, ctx.now()) });
  });

  return router;
}

module.exports = { vaultApi, REQUEST_TYPES };
