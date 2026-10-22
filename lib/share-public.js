// lib/share-public.js — the only public routes besides /healthz: a share's page and its watermarked documents.
const express = require("express");
const { SUMMARY_ID, TOKEN_RE, hashToken, isActive } = require("./shares");
const { toPdf, watermarkPdf, watermarkText, summaryPdf, fmtDate } = require("./pdf");
const { createRateLimiter } = require("./ratelimit");

const TEXT = {
  en: { title: "Application documents", intro: (n, s) => `${n ? n + " shares" : "Shared"} these documents for the application for ${s}.`, until: d => `This link works until ${d}.`, summary: "Applicant summary", types: { payslip: "Payslip", contract: "Employment contract", schufa: "SCHUFA credit report", id: "ID document", "rent-confirmation": "Rent payment confirmation", "landlord-reference": "Landlord reference", other: "Document" } },
  de: { title: "Bewerbungsunterlagen", intro: (n, s) => `${n ? n + " teilt" : "Geteilt werden"} diese Unterlagen für die Bewerbung um ${s}.`, until: d => `Dieser Link gilt bis ${d}.`, summary: "Selbstauskunft (Kurzfassung)", types: { payslip: "Gehaltsnachweis", contract: "Arbeitsvertrag", schufa: "SCHUFA-Auskunft", id: "Ausweis", "rent-confirmation": "Mietzahlungsbestätigung", "landlord-reference": "Vermieterbescheinigung", other: "Dokument" } },
  pt: { title: "Documentos da candidatura", intro: (n, s) => `${n ? n + " compartilha" : "Compartilhados"} estes documentos para a candidatura ao imóvel ${s}.`, until: d => `Este link vale até ${d}.`, summary: "Resumo do candidato", types: { payslip: "Contracheque", contract: "Contrato de trabalho", schufa: "Relatório SCHUFA", id: "Documento de identidade", "rent-confirmation": "Comprovante de pagamento do aluguel", "landlord-reference": "Referência do locador", other: "Documento" } }
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ctx: { state, vault, persistShares, now, rateLimit }
function publicShares(ctx) {
  const { state, vault } = ctx;
  const router = express.Router();
  const limiter = createRateLimiter({ limit: ctx.rateLimit ?? 30, windowMs: 60000, now: () => ctx.now().getTime() });
  const lang = () => (state.profile && state.profile.outreach && state.profile.outreach.language) || "en";
  // One answer for unknown, expired and revoked links alike.
  const notFound = res => res.status(404).type("text/plain").send("Not found");

  // Every non-PDF answer (page, 404, 429, errors) carries the CSP. PDF responses are exempt on purpose:
  // browser PDF viewers can break under a restrictive CSP.
  const CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  router.use((req, res, next) => {
    res.set("Content-Security-Policy", CSP);
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    if (!limiter.hit(req.ip)) return res.status(429).set("Retry-After", "60").type("text/plain").send("Too many requests");
    next();
  });

  const activeShare = token => {
    if (!vault || !TOKEN_RE.test(token)) return null;
    const h = hashToken(token);
    const s = state.shares.find(x => x.tokenHash === h);
    // Defence in depth: a share whose listing is gone is as dead as a revoked one.
    return s && isActive(s, ctx.now()) && Object.hasOwn(state.listings, s.listingId) ? s : null;
  };
  const available = (s, id) => s.docIds.includes(id) && (id === SUMMARY_ID ? !!vault.applicant : Object.hasOwn(vault.index.docs, id));

  router.get("/:token", (req, res) => {
    const s = activeShare(req.params.token);
    if (!s) return notFound(res);
    const L = TEXT[lang()] || TEXT.en, name = vault.applicant ? vault.applicant.name : "";
    const items = s.docIds.filter(id => available(s, id)).map(id => {
      const d = id === SUMMARY_ID ? null : vault.index.docs[id];
      const label = d ? (L.types[d.type] || L.types.other) + (d.label ? ` (${d.label})` : "") : L.summary;
      return `<li><a href="/s/${esc(req.params.token)}/${esc(id)}">${esc(label)}</a></li>`;
    });
    res.type("html").send(`<!doctype html><html lang="${lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(L.title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1d2125;background:#fff}a{color:#0b57d0}li{margin:8px 0}.muted{color:#5f6368;font-size:14px}</style></head>
<body><h1>${esc(L.title)}</h1><p>${esc(L.intro(name, s.subject))}</p><ul>${items.join("")}</ul><p class="muted">${esc(L.until(fmtDate(s.expiresAt)))}</p></body></html>`);
  });

  // Headers only: no decryption, no watermark, no log entry.
  router.head("/:token/:docId", (req, res) => {
    const s = activeShare(req.params.token), id = req.params.docId;
    if (!s || !available(s, id)) return res.status(404).type("text/plain").end();
    res.removeHeader("Content-Security-Policy");
    res.set("Content-Type", "application/pdf").end();
  });

  router.get("/:token/:docId", async (req, res) => {
    const s = activeShare(req.params.token), id = req.params.docId;
    if (!s || !available(s, id)) return notFound(res);
    let pdf;
    try {
      const base = id === SUMMARY_ID
        ? await summaryPdf(vault.applicant, (state.profile && state.profile.money && state.profile.money.netIncome) || 0, lang(), ctx.now())
        : await toPdf(await vault.readDoc(vault.index.docs[id].file), vault.index.docs[id].mime);
      pdf = await watermarkPdf(base, watermarkText(lang(), s.subject, s.createdAt));
    } catch (e) { return res.status(500).type("text/plain").send("Document unavailable"); }
    s.opens = [...s.opens, { at: ctx.now().toISOString(), docId: id }].slice(-500);
    try { Promise.resolve(ctx.persistShares()).catch(() => {}); } catch (e) { /* best effort */ } // the access log never breaks serving
    res.removeHeader("Content-Security-Policy");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="${id === SUMMARY_ID ? "summary" : String(vault.index.docs[id].type).replace(/[^a-z0-9-]/gi, "") || "document"}.pdf"`);
    res.send(Buffer.from(pdf));
  });

  router.use((req, res) => notFound(res));
  // Malformed percent-encoding and any other error: the same 404 as everything else, never a stack.
  router.use((err, req, res, next) => notFound(res));
  return router;
}

module.exports = { publicShares };
