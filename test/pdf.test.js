const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts, degrees } = require("pdf-lib");
const P = require("../lib/pdf");
const { defaultApplicant } = require("../lib/applicant");
const { TINY_PNG, TINY_JPEG, pdfPageStreams, hasPdfText } = require("./helpers");

const twoPagePdf = async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); d.addPage([841.89, 595.28]); return Buffer.from(await d.save()); };
const applicant = () => ({ ...defaultApplicant(), name: "Alex Example", email: "alex@example.com", household: { adults: 2, children: 1, pets: "" }, job: { title: "Engineer", employer: "Example GmbH", since: "2022-04", permanent: true }, schufaAvailable: true, about: "We are a quiet family. ".repeat(30) });

test("watermark text in each language with DD.MM.YYYY", () => {
  assert.equal(P.watermarkText("en", "Beispielstraße 1, 40210 Düsseldorf", "2026-10-20T09:00:00.000Z"), "Only for the application for Beispielstraße 1, 40210 Düsseldorf · 20.10.2026");
  assert.equal(P.watermarkText("de", "Beispielstraße 1", "2026-10-20"), "Nur für die Bewerbung um Beispielstraße 1 · 20.10.2026");
  assert.equal(P.watermarkText("pt", "Beispielstraße 1", "2026-10-20"), "Somente para a candidatura ao imóvel Beispielstraße 1 · 20.10.2026");
  assert.equal(P.watermarkText("fr", "X", "2026-10-20"), "Only for the application for X · 20.10.2026");
});

test("winAnsi keeps German and Portuguese letters and replaces the rest", () => {
  assert.equal(P.winAnsi("Düsseldorf ç ã € –"), "Düsseldorf ç ã € –");
  assert.equal(P.winAnsi("Łódź 🏠"), "?ód? ??");
});

test("canReadPdf", async () => {
  assert.equal(await P.canReadPdf(await twoPagePdf()), true);
  assert.equal(await P.canReadPdf(Buffer.from("%PDF-1.7 broken")), false);
});

test("toPdf passes PDFs through and puts an image on one page", async () => {
  const pdf = await twoPagePdf();
  assert.equal(await P.toPdf(pdf, "application/pdf"), pdf);
  for (const [buf, mime] of [[TINY_PNG, "image/png"], [TINY_JPEG, "image/jpeg"]]) {
    const doc = await PDFDocument.load(await P.toPdf(buf, mime));
    assert.equal(doc.getPageCount(), 1, mime);
  }
  const landscape = await PDFDocument.load(await P.toPdf(TINY_PNG, "image/png")); // 4×2 px → landscape page
  assert.ok(landscape.getPage(0).getWidth() > landscape.getPage(0).getHeight());
});

test("watermarkPdf writes the text on every page", async () => {
  const text = P.watermarkText("de", "Beispielstraße 1, 40210 Düsseldorf", "2026-10-20");
  const out = await P.watermarkPdf(await twoPagePdf(), text);
  const pages = await pdfPageStreams(out);
  assert.equal(pages.length, 2);
  for (const s of pages) assert.ok(hasPdfText(s, text), "watermark missing on a page");
});

test("summaryPdf: one page in each language with name, job and income", async () => {
  for (const lang of ["en", "de", "pt"]) {
    const bytes = await P.summaryPdf(applicant(), 3200, lang, new Date("2026-10-20T10:00:00Z"));
    const [page, ...rest] = await pdfPageStreams(bytes);
    assert.equal(rest.length, 0);
    assert.ok(hasPdfText(page, "Alex Example"), lang);
    assert.ok(hasPdfText(page, "Engineer, Example GmbH, " + { en: "since", de: "seit", pt: "desde" }[lang] + " 04/2022"), lang);
  }
  const de = (await pdfPageStreams(await P.summaryPdf(applicant(), 3200, "de", new Date("2026-10-20T10:00:00Z"))))[0];
  assert.ok(hasPdfText(de, "SCHUFA-Auskunft vorhanden: ja"));
  assert.ok(hasPdfText(de, "Erstellt am 20.10.2026"));
  const en = (await pdfPageStreams(await P.summaryPdf(applicant(), 3200, "en")))[0];
  assert.ok(hasPdfText(en, "3,200 per month"));
  const noIncome = (await pdfPageStreams(await P.summaryPdf(applicant(), 0, "en")))[0];
  assert.ok(!hasPdfText(noIncome, "Household net income"));
});

test("summaryPdf copes with emoji and Cyrillic, and keeps line breaks in about", async () => {
  const a = { ...applicant(), name: "Иван Example", about: "Line one 🏠\nLine two\nLine three" };
  const [page, ...rest] = await pdfPageStreams(await P.summaryPdf(a, 0, "en", new Date("2026-10-20T10:00:00Z")));
  assert.equal(rest.length, 0);
  assert.ok(hasPdfText(page, "???? Example"));
  assert.ok(hasPdfText(page, "Line one ?"));
  assert.ok(hasPdfText(page, "Line two"));
  assert.ok(hasPdfText(page, "Line three"));
});

// The text matrices (a b c d e f) of a watermarked page: [diagonal, bottom line].
const matrices = s => [...s.matchAll(/^(\S+) (\S+) (\S+) (\S+) (\S+) (\S+) Tm$/gm)].map(m => m.slice(1).map(Number));
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);

test("watermarkPdf follows an offset MediaBox/CropBox", async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([800, 900]);
  p.setMediaBox(100, 200, 300, 400); // x 100–400, y 200–600
  p.setCropBox(100, 200, 300, 400);
  const out = await P.watermarkPdf(Buffer.from(await d.save()), "Hello");
  const stream = (await pdfPageStreams(out))[0];
  const [diag, line] = matrices(stream);
  near(line[4], 118); near(line[5], 212);
  // The diagonal's centre lies in the middle of the visible page (250, 400), not of a page starting at 0,0.
  const size = Number(stream.match(/ (\d+(?:\.\d+)?) Tf/)[1]);
  const tw = (await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold)).widthOfTextAtSize("Hello", size);
  const cx = diag[4] + (tw / 2) * diag[0] + (size / 3) * diag[2], cy = diag[5] + (tw / 2) * diag[1] + (size / 3) * diag[3];
  near(cx, 250); near(cy, 400);
});

test("watermarkPdf sits upright on a page rotated by 90 degrees", async () => {
  const d = await PDFDocument.create();
  const p = d.addPage([300, 400]);
  p.setRotation(degrees(90)); // viewed as 400 wide, 300 tall
  const out = await P.watermarkPdf(Buffer.from(await d.save()), "Hello");
  const [diag, line] = matrices((await pdfPageStreams(out))[0]);
  // Bottom line: 18 from the visible left edge, 12 from the visible bottom edge = user (300 - 12, 18).
  near(line[4], 288); near(line[5], 18);
  // Its baseline runs along the visible bottom, i.e. along user +y.
  near(line[0], 0); near(line[1], 1);
  // The diagonal rises towards the visible top right: visible angle atan2(300, 400), turned back by the page rotation.
  const visible = Math.atan2(diag[1], diag[0]) * 180 / Math.PI - 90;
  near(visible, Math.atan2(300, 400) * 180 / Math.PI);
});
