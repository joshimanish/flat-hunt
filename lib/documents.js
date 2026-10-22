// lib/documents.js — vault document metadata: types, validation and the list the owner sees.
const DOC_TYPES = ["payslip", "contract", "schufa", "id", "rent-confirmation", "landlord-reference", "other"];
const MIMES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;
const PAYSLIP_MAX_MONTHS = 3;

const isDate = s => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const FIELDS = {
  type: v => DOC_TYPES.includes(v) ? null : `one of ${DOC_TYPES.join(", ")} expected`,
  label: v => typeof v === "string" && v.length <= 120 && !/[\x00-\x1f\x7f]/.test(v) ? null : "text up to 120 characters, no control characters, expected",
  date: v => v === null || isDate(v) ? null : "date YYYY-MM-DD expected"
};

// Upload (X-Doc-Meta header, partial: false): type required, label defaults to "", date to null; "" counts as not given.
// Edit (JSON, partial: true): any subset of type, label, date; unknown fields are rejected.
function validateDocMeta(input, { partial = false } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return { errors: ["metadata must be an object"], value: null };
  const errors = [], value = {};
  for (const k of Object.keys(input)) if (!Object.hasOwn(FIELDS, k)) errors.push(`${k}: unknown field`);
  for (const [k, check] of Object.entries(FIELDS)) {
    let v = input[k];
    if (!partial && k === "date" && v === "") v = null;
    if (v === undefined) {
      if (partial) continue;
      if (k === "type") { errors.push("type: missing"); continue; }
      v = k === "label" ? "" : null;
    }
    const msg = check(v);
    if (msg) errors.push(`${k}: ${msg}`); else value[k] = typeof v === "string" ? v.trim() : v;
  }
  if (partial && !errors.length && !Object.keys(value).length) errors.push("nothing to change");
  return { errors, value: errors.length ? null : value };
}

// A payslip dated more than three calendar months before `now` (YYYY-MM-DD) is out of date for most landlords.
function isOutdated(doc, now = new Date().toISOString().slice(0, 10)) {
  if (doc.type !== "payslip" || !doc.date) return false;
  const n = new Date(now + "T00:00:00Z");
  // Same day three months back, clamped to that month's length (31 May -> 28/29 Feb).
  const y = n.getUTCFullYear(), m = n.getUTCMonth() - PAYSLIP_MAX_MONTHS;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const limit = new Date(Date.UTC(y, m, Math.min(n.getUTCDate(), last)));
  return doc.date < limit.toISOString().slice(0, 10);
}

// What the owner's page sees of one document: everything but the internal file name, plus the outdated flag.
const docView = ({ file, ...d }, now) => ({ ...d, outdated: isOutdated(d, now) });
// Newest first.
const listDocs = (index, now) => Object.values(index.docs).map(d => docView(d, now)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

module.exports = { DOC_TYPES, MIMES, MAX_BYTES, validateDocMeta, isOutdated, docView, listDocs };
