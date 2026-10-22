// lib/store.js — JSON and binary files in DATA_DIR, written atomically.
const fs = require("fs");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeFileAtomic(file, data) {
  const tmp = file + "." + process.pid + "." + Date.now() + "." + Math.random().toString(36).slice(2, 8) + ".tmp";
  return fs.promises.writeFile(tmp, data).then(() => fs.promises.rename(tmp, file));
}

const writeJsonAtomic = (file, value) => writeFileAtomic(file, JSON.stringify(value));

module.exports = { readJson, writeJsonAtomic, writeFileAtomic };
