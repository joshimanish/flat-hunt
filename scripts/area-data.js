#!/usr/bin/env node
// scripts/area-data.js — builds the static area data in lib/data/ from the official downloads.
//   node scripts/area-data.js pks    [--file KR-F-01-T01-Kreise-Faelle-HZ_xls.xlsx]
//   node scripts/area-data.js zensus [--file Zensus2022_Durchschn_Nettokaltmiete.zip]
// Without --file the official file is downloaded. The converters are exported for the tests.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = path.join(__dirname, "..", "lib", "data");
const UA = "flat-hunt-data/0.1 (+https://github.com/DasMehl/flat-hunt)";
const PKS_URL = "https://www.bka.de/SharedDocs/Downloads/DE/Publikationen/PolizeilicheKriminalstatistik/2025/Kreis/Faelle/KR-F-01-T01-Kreise-Faelle-HZ_xls.xlsx?__blob=publicationFile&v=2";
const ZENSUS_URL = "https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Durchschn_Nettokaltmiete.zip";
const PKS_MAX_BYTES = 100 * 1024, ZENSUS_MAX_BYTES = 1.5 * 1024 * 1024;

// ---------- zip (stored and deflated entries; no zip64, no encryption) ----------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10), entries = new Map();
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error("zip64 is not supported");
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("broken zip directory");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error("broken zip entry " + name);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`zip method ${method} is not supported (${name})`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- xlsx: the first worksheet as rows of strings/numbers ----------
const decodeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()]);
const textOf = xml => decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(""));
const colIndex = ref => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function xlsxRows(buf) {
  const zip = readZip(buf);
  const sheets = [...zip.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
  if (!sheets.length) throw new Error("no worksheet in the xlsx file");
  const shared = zip.has("xl/sharedStrings.xml") ? [...zip.get("xl/sharedStrings.xml")().toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1])) : [];
  const xml = zip.get(sheets[0])().toString("utf8"), rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || "";
      const ref = (/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1], type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      let value = null;
      if (type === "s") value = shared[Number(v)] ?? null;
      else if (type === "inlineStr") value = textOf(inner);
      else if (type === "str") value = v != null ? decodeXml(v) : null;
      else if (v != null) value = Number(v);
      row[ref ? colIndex(ref) : row.length] = value;
    }
    rows.push(Array.from(row, x => x ?? null));
  }
  return rows;
}

// ---------- PKS T01 Kreise → compact JSON ----------
const PKS_KEYS = { total: "------", violent: "892000", street: "899000", burglary: "435*00" };
const norm = v => String(v ?? "").replace(/\s+/g, " ").trim();
const toNum = v => typeof v === "number" ? v : Number(norm(v).replace(/\./g, "").replace(",", "."));

function pksFromRows(rows, { year, generated, minKreise = 390, nationalRange = [3000, 12000] } = {}) {
  const h = rows.findIndex(r => r.some(c => norm(c) === "Schlüssel") && r.some(c => /f(ä|ae)lle/i.test(norm(c))));
  if (h < 0) throw new Error("PKS header row (Schlüssel … Fälle) not found");
  const head = rows[h].map(norm), col = re => head.findIndex(c => re.test(c));
  const c = { key: head.indexOf("Schlüssel"), ags: col(/gemeinde.?schl/i), name: col(/landkreis/i), kind: col(/kreisart/i), cases: col(/f(ä|ae)lle/i), hz: col(/^HZ\b|häufigkeitszahl/i) };
  for (const [k, i] of Object.entries(c)) if (i < 0) throw new Error("PKS column not found: " + k);
  const wanted = Object.fromEntries(Object.entries(PKS_KEYS).map(([k, v]) => [v, k]));
  const kreise = {}, cases = {};
  for (const r of rows.slice(h + 1)) {
    const which = wanted[norm(r[c.key])];
    if (!which) continue;
    const ags = norm(r[c.ags]).padStart(5, "0");
    if (!/^\d{5}$/.test(ags)) continue;
    const k = kreise[ags] || (kreise[ags] = { name: norm(r[c.name]), kind: norm(r[c.kind]) });
    k[which] = toNum(r[c.hz]);
    (cases[ags] || (cases[ags] = {}))[which] = toNum(r[c.cases]);
  }
  const ids = Object.keys(kreise).sort().filter(a => Number.isFinite(kreise[a].total) && kreise[a].total > 0 && Number.isFinite(cases[a].total));
  if (ids.length < minKreise) throw new Error(`only ${ids.length} Kreise found, expected at least ${minKreise}`);
  // Residents per Kreis from the total row (HZ = cases per 100,000 residents); national HZ = Σ cases ÷ Σ residents.
  const pop = Object.fromEntries(ids.map(a => [a, cases[a].total / kreise[a].total * 1e5]));
  const national = {};
  for (const k of Object.keys(PKS_KEYS)) {
    const have = ids.filter(a => Number.isFinite(cases[a][k]));
    national[k] = have.length ? Math.round(have.reduce((s, a) => s + cases[a][k], 0) / have.reduce((s, a) => s + pop[a], 0) * 1e5) : null;
  }
  if (!(national.total >= nationalRange[0] && national.total <= nationalRange[1])) throw new Error("implausible national HZ " + national.total);
  const num = v => Number.isFinite(v) ? Math.round(v) : null;
  return {
    _source: "Bundeskriminalamt, Polizeiliche Kriminalstatistik " + year + ", Tabelle T01 Grundtabelle Kreise (Fälle und Häufigkeitszahlen), " + PKS_URL.replace(/\?.*$/, ""),
    _licence: "Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0), https://www.govdata.de/dl-de/by-2-0",
    _attribution: `Bundeskriminalamt, Polizeiliche Kriminalstatistik ${year}, dl-de/by-2-0`,
    _changes: "Converted by scripts/area-data.js: only the keys ------ (all offences), 892000 (violent crime), 899000 (street crime) and 435*00 (residential burglary); HZ rounded to whole numbers; the national value is the sum of all Kreise's cases divided by their residents.",
    _generated: generated || new Date().toISOString().slice(0, 10),
    year,
    columns: ["name", "kind", "total", "violent", "street", "burglary"],
    national,
    kreise: Object.fromEntries(ids.map(a => { const k = kreise[a]; return [a, [k.name, k.kind, num(k.total), num(k.violent), num(k.street), num(k.burglary)]]; }))
  };
}

// The table as JSON with the header first and one Kreis per line (readable diffs).
function pksText(t) {
  const { kreise, ...head } = t;
  return JSON.stringify(head, null, 1).slice(0, -2) + ',\n "kreise": {\n' + Object.entries(kreise).map(([a, v]) => `  ${JSON.stringify(a)}: ${JSON.stringify(v)}`).join(",\n") + "\n }\n}\n";
}

// ---------- Zensus 2022 rent, 1 km grid → dense Uint16 grid (cents per m², 0 = no value), gzip ----------
function zensusGridFromCsv(text, { generated } = {}) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(";").map(norm);
  const ix = head.findIndex(h => /^x_mp_1km$/i.test(h)), iy = head.findIndex(h => /^y_mp_1km$/i.test(h)), iv = head.findIndex(h => /miete/i.test(h));
  if (ix < 0 || iy < 0 || iv < 0) throw new Error("Zensus columns x_mp_1km / y_mp_1km / …Miete… not found");
  const cells = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const line of lines.slice(1)) {
    const f = line.split(";");
    const x = Math.floor(Number(f[ix]) / 1000), y = Math.floor(Number(f[iy]) / 1000), v = Number(norm(f[iv]).replace(",", "."));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(v) || v <= 0) continue;
    cells.push([x, y, Math.min(65535, Math.max(1, Math.round(v * 100)))]);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  if (!cells.length) throw new Error("no Zensus cells with a value");
  const width = x1 - x0 + 1, height = y1 - y0 + 1, grid = Buffer.alloc(width * height * 2);
  for (const [x, y, v] of cells) grid.writeUInt16LE(v, ((y - y0) * width + (x - x0)) * 2);
  const meta = {
    _source: "Statistische Ämter des Bundes und der Länder, Zensus 2022, Durchschnittliche Nettokaltmiete je m² (Gitter 1 km), " + ZENSUS_URL,
    _licence: "Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0), https://www.govdata.de/dl-de/by-2-0",
    _attribution: "© Statistische Ämter des Bundes und der Länder, Zensus 2022, dl-de/by-2-0",
    _changes: "Converted by scripts/area-data.js into a dense grid of unsigned 16-bit little-endian values (euro cents per m², 0 = no value or suppressed), row by row from the south-west corner, gzip-compressed.",
    _generated: generated || new Date().toISOString().slice(0, 10),
    year: 2022, refDate: "2022-05-15", crs: "EPSG:3035", cellKm: 1,
    file: "zensus2022-rent-1km.u16.gz", x0, y0, width, height, cells: cells.length
  };
  return { meta, gz: zlib.gzipSync(grid, { level: 9 }) };
}

// ---------- CLI ----------
async function download(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
function write(name, data, max) {
  if (data.length > max) throw new Error(`${name} is ${data.length} bytes, more than the ${max} allowed; not written`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`wrote lib/data/${name} (${(data.length / 1024).toFixed(1)} KB)`);
}

async function main(argv) {
  const [what] = argv, fi = argv.indexOf("--file"), file = fi >= 0 ? argv[fi + 1] : null;
  if (fi >= 0 && (!file || file.startsWith("--"))) { console.error("--file needs a value\nusage: node scripts/area-data.js pks|zensus [--file <downloaded file>]"); process.exit(1); }
  if (what === "pks") {
    const buf = file ? fs.readFileSync(file) : await download(PKS_URL);
    const table = pksFromRows(xlsxRows(buf), { year: 2025 });
    write("pks-2025-kreise.json", Buffer.from(pksText(table)), PKS_MAX_BYTES);
    console.log(`${Object.keys(table.kreise).length} Kreise, national HZ ${table.national.total}`);
  } else if (what === "zensus") {
    const zip = readZip(file ? fs.readFileSync(file) : await download(ZENSUS_URL));
    const name = [...zip.keys()].find(k => /1km.*\.csv$/i.test(k));
    if (!name) throw new Error("no 1 km CSV in the Zensus zip: " + [...zip.keys()].join(", "));
    const { meta, gz } = zensusGridFromCsv(zip.get(name)().toString("latin1"));
    write(meta.file, gz, ZENSUS_MAX_BYTES);
    write("zensus2022-rent-1km.json", Buffer.from(JSON.stringify(meta, null, 2) + "\n"), 4096);
    console.log(`${meta.cells} cells, grid ${meta.width} × ${meta.height}`);
  } else {
    console.error("usage: node scripts/area-data.js pks|zensus [--file <downloaded file>]");
    process.exit(2);
  }
}

module.exports = { readZip, xlsxRows, pksFromRows, pksText, zensusGridFromCsv, PKS_KEYS };

if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
