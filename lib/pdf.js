// lib/pdf.js — PDFs for sharing: images to PDF, the diagonal watermark and the applicant summary (pdf-lib, standard fonts).
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

const A4 = [595.28, 841.89];
const LANGS = ["en", "de", "pt"];

// Standard fonts only cover WinAnsi; anything else becomes "?" instead of failing the whole PDF.
const winAnsi = s => String(s ?? "").replace(/[^\x20-\x7e\xa0-\xff€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, "?");
const fmtDate = iso => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}.${m}.${y}`; };

const WATERMARK = {
  en: (s, d) => `Only for the application for ${s} · ${d}`,
  de: (s, d) => `Nur für die Bewerbung um ${s} · ${d}`,
  pt: (s, d) => `Somente para a candidatura ao imóvel ${s} · ${d}`
};
const watermarkText = (lang, subject, isoDate) => (WATERMARK[lang] || WATERMARK.en)(subject, fmtDate(isoDate));

// True when pdf-lib can open the file (not encrypted, not broken).
async function canReadPdf(buf) {
  try { return (await PDFDocument.load(new Uint8Array(buf))).getPageCount() > 0; } catch (e) { return false; }
}

// PDFs pass through; a JPEG or PNG becomes one A4 page with the image scaled to fit inside 36 pt margins.
async function toPdf(buf, mime) {
  if (mime === "application/pdf") return buf;
  const doc = await PDFDocument.create();
  // A copy, because pdf-lib reads the image through a DataView that ignores a Node Buffer's byteOffset.
  const bytes = new Uint8Array(buf);
  const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const landscape = img.width > img.height;
  const [w, h] = landscape ? [A4[1], A4[0]] : A4;
  const scale = Math.min((w - 72) / img.width, (h - 72) / img.height);
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  return doc.save();
}

// The text across every page, diagonal and semi-transparent, plus a small line at the bottom edge.
async function watermarkPdf(bytes, text) {
  const doc = await PDFDocument.load(new Uint8Array(bytes));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = winAnsi(text);
  for (const page of doc.getPages()) {
    // The visible page: CropBox (falls back to MediaBox), turned by /Rotate. Content is drawn in an unrotated frame
    // whose axes are rotated back so that it reads upright in the viewing orientation.
    const { x: bx, y: by, width: bw, height: bh } = page.getCropBox();
    const rot = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360;
    const w = rot % 180 ? bh : bw, h = rot % 180 ? bw : bh; // visible width and height
    // Visible-frame point (px, py) -> user space.
    const toUser = (px, py) => rot === 0 ? [bx + px, by + py] : rot === 90 ? [bx + bw - py, by + px] : rot === 180 ? [bx + bw - px, by + bh - py] : [bx + py, by + bh - px];
    const diag = Math.hypot(w, h), angle = Math.atan2(h, w);
    const size = Math.max(8, Math.min(40, (diag * 0.85) / font.widthOfTextAtSize(t, 1)));
    const tw = font.widthOfTextAtSize(t, size);
    // Start so that the text's centre sits on the page centre.
    const [x, y] = toUser(w / 2 - (tw / 2) * Math.cos(angle) + (size / 3) * Math.sin(angle), h / 2 - (tw / 2) * Math.sin(angle) - (size / 3) * Math.cos(angle));
    page.drawText(t, { x, y, size, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.28, rotate: degrees(angle * 180 / Math.PI + rot) });
    const [lx, ly] = toUser(18, 12);
    page.drawText(t, { x: lx, y: ly, size: 8, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.6, rotate: degrees(rot) });
  }
  return doc.save();
}

const SUMMARY = {
  en: { title: "Applicant summary", contact: "Contact", household: "Household", adults: "Adults", children: "Children", pets: "Pets", none: "none", job: "Job", since: "since", permanent: "permanent contract", fixedTerm: "fixed-term contract", income: "Household net income", perMonth: "per month", schufa: "SCHUFA credit report available", reference: "Reference from the current landlord available", yes: "yes", no: "no", about: "About us", made: "Created on" },
  de: { title: "Selbstauskunft (Kurzfassung)", contact: "Kontakt", household: "Haushalt", adults: "Erwachsene", children: "Kinder", pets: "Haustiere", none: "keine", job: "Beruf", since: "seit", permanent: "unbefristet", fixedTerm: "befristet", income: "Haushaltsnettoeinkommen", perMonth: "pro Monat", schufa: "SCHUFA-Auskunft vorhanden", reference: "Vermieterbescheinigung vorhanden", yes: "ja", no: "nein", about: "Über uns", made: "Erstellt am" },
  pt: { title: "Resumo do candidato", contact: "Contato", household: "Moradores", adults: "Adultos", children: "Crianças", pets: "Animais", none: "nenhum", job: "Trabalho", since: "desde", permanent: "contrato por prazo indeterminado", fixedTerm: "contrato temporário", income: "Renda líquida do domicílio", perMonth: "por mês", schufa: "Relatório SCHUFA disponível", reference: "Referência do locador atual disponível", yes: "sim", no: "não", about: "Sobre nós", made: "Criado em" }
};
const LOCALE = { en: "en-GB", de: "de-DE", pt: "pt-BR" };

// One A4 page: name, contact, household, job, income, SCHUFA/reference and the "about" text, wrapped.
async function summaryPdf(applicant, netIncome, lang = "en", now = new Date()) {
  const L = SUMMARY[lang] || SUMMARY.en, a = applicant;
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(`${L.title} · ${a.name}`));
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const left = 56, right = A4[0] - 56;
  let y = A4[1] - 72;
  const line = (text, { f = font, size = 11, gap = 6 } = {}) => { page.drawText(winAnsi(text), { x: left, y, size, font: f, color: rgb(0.1, 0.1, 0.1) }); y -= size + gap; };
  // Line breaks in the text are kept; long lines wrap at the margin.
  const wrap = (text, size = 11) => {
    for (const para of winAnsi(text).split("\n")) {
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = cur ? cur + " " + word : word;
        if (font.widthOfTextAtSize(next, size) > right - left && cur) { line(cur, { size, gap: 4 }); cur = word; } else cur = next;
      }
      if (cur) line(cur, { size, gap: 4 }); else y -= size + 4;
    }
  };
  const field = (label, value) => line(`${label}: ${value}`);
  line(L.title, { f: bold, size: 20, gap: 14 });
  line(a.name, { f: bold, size: 15, gap: 12 });
  const contact = [a.email, a.phone].filter(Boolean).join(" · ");
  if (contact) field(L.contact, contact);
  y -= 6; line(L.household, { f: bold, size: 12 });
  field(L.adults, a.household.adults); field(L.children, a.household.children); field(L.pets, a.household.pets || L.none);
  if (a.job.title || a.job.employer) {
    y -= 6; line(L.job, { f: bold, size: 12 });
    line([a.job.title, a.job.employer].filter(Boolean).join(", ") + (a.job.since ? `, ${L.since} ${a.job.since.slice(5)}/${a.job.since.slice(0, 4)}` : ""));
    line(a.job.permanent ? L.permanent : L.fixedTerm);
  }
  if (netIncome > 0) { y -= 6; field(L.income, new Intl.NumberFormat(LOCALE[lang] || "en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(netIncome) + " " + L.perMonth); }
  y -= 6; field(L.schufa, a.schufaAvailable ? L.yes : L.no); field(L.reference, a.landlordReferenceAvailable ? L.yes : L.no);
  if (a.about) { y -= 6; line(L.about, { f: bold, size: 12 }); wrap(a.about); }
  page.drawText(winAnsi(`${L.made} ${fmtDate(now.toISOString())}`), { x: left, y: 40, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
  return doc.save();
}

module.exports = { LANGS, watermarkText, canReadPdf, toPdf, watermarkPdf, summaryPdf, winAnsi, fmtDate };
