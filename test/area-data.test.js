const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const D = require("../scripts/area-data");

// A minimal zip writer for fixtures (CRC left at 0; the reader does not check it).
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of files) {
    const raw = Buffer.from(content), data = deflate ? zlib.deflateRawSync(raw) : raw, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data); centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test("readZip reads stored and deflated entries", () => {
  const zip = D.readZip(makeZip([["a.txt", "hello", false], ["dir/b.csv", "x;y\n1;2\n".repeat(50), true]]));
  assert.deepEqual([...zip.keys()], ["a.txt", "dir/b.csv"]);
  assert.equal(zip.get("a.txt")().toString(), "hello");
  assert.equal(zip.get("dir/b.csv")().toString(), "x;y\n1;2\n".repeat(50));
  assert.throws(() => D.readZip(Buffer.from("not a zip at all, sorry")), /not a zip/);
});

// One sheet: two title rows, the header, then key × Kreis rows (Düsseldorf and Berlin values from the 2025 table, Example-Kreis made up).
const strings = ["Schlüssel", "Straftat", "Gemeinde-schlüssel", "Stadt-/Landkreis", "Kreisart", "Fälle", "HZ", "Straftaten insgesamt", "Düsseldorf", "Kreisfreie Stadt", "Berlin", "Gewaltkriminalität", "Example &amp; Land", "Landkreis", "------", "435*00"];
const si = i => `<c t="s"><v>${i}</v></c>`;
const row = (cells) => `<row>${cells.join("")}</row>`;
const n = v => `<c><v>${v}</v></c>`;
const sheet = `<?xml version="1.0"?><worksheet><sheetData>
${row([`<c r="A1" t="inlineStr"><is><t>PKS 2025 – T01</t></is></c>`])}
${row([si(0), si(1), si(2), si(3), si(4), si(5), si(6), `<c t="inlineStr"><is><t>Versuche</t></is></c>`])}
${row([si(14), si(7), `<c t="str"><v>05111</v></c>`, si(8), si(9), n(80422), n(12999.4), n(1000)])}
${row([si(14), si(7), n(11000), si(10), si(9), n(502742), n(13642.1), n(9000)])}
${row([si(14), si(7), n(99999), si(12), si(13), n(5000), n(5000), n(10)])}
${row([n(892000), si(11), `<c t="str"><v>05111</v></c>`, si(8), si(9), n(3087), n(499), n(0)])}
${row([n(892000), si(11), n(11000), si(10), si(9), n(19800), n(537.3), n(0)])}
${row([si(15), `<c t="inlineStr"><is><t>Wohnungseinbruchdiebstahl</t></is></c>`, `<c t="str"><v>05111</v></c>`, si(8), si(9), n(1540), n(249), n(0)])}
</sheetData></worksheet>`;
const sharedXml = `<sst>${strings.map(s => `<si><t>${s}</t></si>`).join("")}</sst>`;

test("xlsxRows reads shared, inline and numeric cells of the first sheet", () => {
  const rows = D.xlsxRows(makeZip([["xl/sharedStrings.xml", sharedXml, true], ["xl/worksheets/sheet1.xml", sheet, true]]));
  assert.equal(rows[0][0], "PKS 2025 – T01");
  assert.deepEqual(rows[1].slice(0, 7), ["Schlüssel", "Straftat", "Gemeinde-schlüssel", "Stadt-/Landkreis", "Kreisart", "Fälle", "HZ"]);
  assert.deepEqual(rows[2].slice(0, 7), ["------", "Straftaten insgesamt", "05111", "Düsseldorf", "Kreisfreie Stadt", 80422, 12999.4]);
  assert.equal(rows[4][3], "Example & Land");
});

test("pksFromRows keeps four offence keys per Kreis and derives the national rate from cases and residents", () => {
  const rows = D.xlsxRows(makeZip([["xl/sharedStrings.xml", sharedXml, true], ["xl/worksheets/sheet1.xml", sheet, true]]));
  const t = D.pksFromRows(rows, { year: 2025, generated: "2026-10-21", minKreise: 1, nationalRange: [0, Infinity] });
  assert.equal(t.year, 2025);
  assert.match(t._licence, /dl-de\/by-2-0/);
  assert.match(t._attribution, /^Bundeskriminalamt, Polizeiliche Kriminalstatistik 2025/);
  assert.deepEqual(t.columns, ["name", "kind", "total", "violent", "street", "burglary"]);
  assert.deepEqual(t.kreise["05111"], ["Düsseldorf", "Kreisfreie Stadt", 12999, 499, null, 249]);
  assert.deepEqual(t.kreise["11000"], ["Berlin", "Kreisfreie Stadt", 13642, 537, null, null]);
  assert.deepEqual(t.kreise["99999"], ["Example & Land", "Landkreis", 5000, null, null, null]);
  const pop = 80422 / 12999.4 + 502742 / 13642.1 + 5000 / 5000; // in units of 100,000
  assert.equal(t.national.total, Math.round((80422 + 502742 + 5000) / pop));
  assert.equal(t.national.violent, Math.round((3087 + 19800) / (80422 / 12999.4 + 502742 / 13642.1)));
  assert.equal(t.national.street, null, "no street-crime rows in the fixture");
  assert.deepEqual(JSON.parse(D.pksText(t)), t);
  assert.match(D.pksText(t), /^\{\n "_source": "Bundeskriminalamt/);
  assert.throws(() => D.pksFromRows(rows, { year: 2025 }), /only 3 Kreise/);
  assert.throws(() => D.pksFromRows([["x"]], { year: 2025 }), /header row/);
});

test("zensusGridFromCsv builds a dense cent grid from 1 km cell midpoints", () => {
  const csv = "﻿GITTER_ID_1km;x_mp_1km;y_mp_1km;durchschnMieteQM;werterlaeuternde_Zeichen\n" +
    "CRS3035RES1000mN3095000E4105000;4105500;3095500;11,15;\n" +
    "CRS3035RES1000mN3096000E4107000;4107500;3096500;8,21;\n" +
    "CRS3035RES1000mN3096000E4106000;4106500;3096500;–;KLAMMERN\n";
  const { meta, gz } = D.zensusGridFromCsv(csv, { generated: "2026-10-21" });
  assert.deepEqual([meta.x0, meta.y0, meta.width, meta.height, meta.cells], [4105, 3095, 3, 2, 2]);
  assert.equal(meta.refDate, "2022-05-15");
  assert.match(meta._licence, /dl-de\/by-2-0/);
  const grid = zlib.gunzipSync(gz);
  assert.equal(grid.length, 3 * 2 * 2);
  assert.equal(grid.readUInt16LE(0), 1115);
  assert.equal(grid.readUInt16LE((1 * 3 + 2) * 2), 821);
  assert.equal(grid.readUInt16LE((1 * 3 + 1) * 2), 0);
});

test("--file without a value is a usage error with exit code 1", () => {
  const { spawnSync } = require("node:child_process");
  for (const what of ["pks", "zensus"]) {
    const r = spawnSync(process.execPath, [require.resolve("../scripts/area-data"), what, "--file"], { encoding: "utf8" });
    assert.equal(r.status, 1, what);
    assert.match(r.stderr, /usage/);
  }
});
