const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../public/area-ui.js");

test("every language has the same area strings", () => {
  const keys = o => Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" ? keys(v).map(s => k + "." + s) : [k]).sort();
  for (const lang of ["de", "pt"]) assert.deepEqual(keys(ui.L[lang]), keys(ui.L.en), lang);
});

const area = {
  computedAt: "2026-10-20T10:00:00.000Z",
  amenities: { status: "ok", items: { transit: { name: "Königsallee", minutes: 3 }, supermarket: { minutes: 4 }, pharmacy: { minutes: 5 }, doctors: { minutes: 5 }, school: { minutes: 2 }, park: { minutes: 4 } } },
  flood: { status: "ok", zones: ["low"], worst: "low" },
  noise: { status: "no-data" },
  crime: { status: "error", error: "Kreis unknown" }
};

test("rating tooltip: formula, this listing's numbers and the figures not counted", () => {
  const tip = ui.ratingTip({ area }, "en");
  assert.match(tip, /^Area estimate: /);
  assert.match(tip, /\nArea ≈ 10 = everyday places 10 − flood 0\.5\n/);
  assert.match(tip, /Not counted \(no data or could not be fetched\): noise, crime\.$/);
  assert.match(ui.ratingTip({ area }, "de"), /Umgebung ≈ 10 = Alltagsorte 10 − Hochwasser 0,5/);
  assert.equal(ui.ratingTip({}, "pt"), ui.L.pt.tip.unrated);
});

test("noise bands and signed percentages", () => {
  assert.equal(ui.bandOf(65), "65–69");
  assert.equal(ui.bandOf(75), "75+");
  assert.equal(ui.signed("en", 0.08), "+8");
  assert.equal(ui.signed("de", -0.12), "−12");
  assert.equal(ui.signed("en", 0), "0");
});

test("rating tooltip says when walking minutes are straight-line estimates", () => {
  const est = { ...area, amenities: { status: "ok", items: { transit: { minutes: 3, estimated: true }, supermarket: { minutes: 4, estimated: false } } } };
  for (const lang of ["en", "de", "pt"]) {
    assert.ok(ui.ratingTip({ area: est }, lang).includes(ui.L[lang].tip.estimated), lang);
    assert.ok(!ui.ratingTip({ area }, lang).includes(ui.L[lang].tip.estimated), lang);
  }
});

test("noiseNone does not claim railways when the source does not cover them; uncovered text and EBA link exist", () => {
  for (const lang of ["en", "de", "pt"]) {
    const T = ui.L[lang];
    assert.notEqual(T.noiseNone(false), T.noiseNone(true), lang);
    assert.ok(T.noiseUncovered.length > 20 && /^https:\/\//.test(T.ebaUrl), lang);
    assert.ok(!/rail|Schienen|ferrov/i.test(T.noiseNone(true)), lang);
    assert.ok(/rail|Schienen|ferrov/i.test(T.noiseNone(false)), lang);
  }
});

test("noise badge tooltip has no leading separator when the source entry is missing", () => {
  assert.equal(ui.noiseBadgeTitle(undefined, 2022, y => `data ${y}`), "data 2022");
  assert.equal(ui.noiseBadgeTitle("Name", 2022, y => `data ${y}`), "Name · data 2022");
});

test("the uncovered-rail note and EBA link appear for Berlin figures with and without a band, never for NRW", () => {
  for (const lang of ["en", "de", "pt"]) {
    for (const f of [{ status: "ok", uncovered: ["rail"], max: null }, { status: "ok", uncovered: ["rail"], max: 70, band: "70–74" }]) {
      const n = ui.noiseUncoveredNote(f, lang);
      assert.equal(n.text, ui.L[lang].noiseUncovered);
      assert.match(n.href, /^https:\/\//);
      assert.equal(n.linkText, ui.L[lang].ebaLink);
    }
    assert.equal(ui.noiseUncoveredNote({ status: "ok", uncovered: [], max: 70 }, lang), null);
    assert.equal(ui.noiseUncoveredNote({ status: "ok", max: null }, lang), null);
  }
});

test("noiseBlock renders the note through the helper in both branches", () => {
  const src = require("node:fs").readFileSync(require.resolve("../public/area-ui.js"), "utf8");
  const body = src.slice(src.indexOf("function noiseBlock"), src.indexOf("// ---------- card badges"));
  assert.match(body, /noiseUncoveredNote\(f, lang\)/);
  assert.ok(body.indexOf("noiseUncoveredNote") > body.indexOf("T.noiseNone") && body.indexOf("noiseUncoveredNote") > body.indexOf("T.noiseMax"), "after both branches");
});
