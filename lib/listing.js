// lib/listing.js — validates listing facts as the add/edit dialog sends them.
const MODES = ["rent", "buy"];
const OUTDOOR = ["none", "balcony", "garden", "both"];
const CONTACT_TYPES = ["private", "agent", "company"];

const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isDate = s => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Each check returns an error message or null; values arrive already known to be present and not null.
const text = max => v => typeof v === "string" && v.trim() && v.length <= max ? null : `text of 1–${max} characters expected`;
const num = (min, max) => v => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? null : `number ${min}–${max} expected`;
const int = (min, max) => v => Number.isInteger(v) && v >= min && v <= max ? null : `whole number ${min}–${max} expected`;
const bool = v => typeof v === "boolean" ? null : "true or false expected";
const oneOf = list => v => list.includes(v) ? null : `one of ${list.join(", ")} expected`;

// required: needed on add and never null. Everything else may be left out or set to null (cleared).
const FIELDS = {
  url: { required: true, check: v => typeof v === "string" && /^https:\/\/[^\s]{4,500}$/.test(v) ? null : "https link expected" },
  title: { required: true, check: text(200) },
  mode: { required: true, check: oneOf(MODES) },
  address: { check: text(200) },
  postcode: { check: v => typeof v === "string" && /^\d{5}$/.test(v.trim()) ? null : "five-digit postcode expected" },
  city: { check: text(120) },
  coldRent: { check: num(0, 20000) },
  utilities: { check: num(0, 5000) },
  warmRent: { check: num(0, 25000) },
  price: { check: num(0, 20000000) },
  rooms: { required: true, check: v => typeof v === "number" && v >= 1 && v <= 20 && (v * 2) % 1 === 0 ? null : "number 1–20 in steps of 0.5 expected" },
  size: { required: true, check: num(5, 2000) },
  deposit: { check: num(0, 100000) },
  takeover: { check: num(0, 1000000) },
  floor: { check: int(-1, 100) },
  lift: { check: bool },
  outdoor: { check: oneOf(OUTDOOR) },
  kitchen: { check: bool },
  petsAllowed: { check: bool },
  availableFrom: { check: v => isDate(v) ? null : "date YYYY-MM-DD expected" },
  wbsRequired: { check: bool },
  contactName: { check: text(120) },
  contactType: { check: oneOf(CONTACT_TYPES) },
  notes: { check: v => typeof v === "string" && v.length <= 5000 ? null : "text up to 5000 characters expected" }
};

const present = (o, k) => o[k] !== undefined && o[k] !== null && o[k] !== "";

// Cross-field rules on a whole listing: where it is, and the amount its mode needs.
function requiredErrors(l) {
  const errors = [];
  if (!present(l, "address") && !(present(l, "postcode") && present(l, "city"))) errors.push("address: address, or postcode and city, expected");
  if (l.mode === "rent" && !present(l, "coldRent") && !present(l, "warmRent")) errors.push("coldRent: cold or warm rent expected");
  if (l.mode === "buy" && !present(l, "price")) errors.push("price: purchase price expected");
  return errors;
}

// Add: every required field. Edit (partial): only the fields sent; null clears an optional one. Unknown fields are rejected.
function validateListingInput(body, { partial = false } = {}) {
  if (!isObj(body)) return { errors: ["listing must be an object"], value: null };
  const errors = [], value = {};
  for (const k of Object.keys(body)) if (!Object.hasOwn(FIELDS, k) && body[k] !== undefined) errors.push(`${k}: unknown field`);
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = body[k];
    if (v === undefined) { if (f.required && !partial) errors.push(`${k}: missing`); continue; }
    if (v === null) { if (f.required) errors.push(`${k}: must not be empty`); else value[k] = null; continue; }
    const msg = f.check(v);
    if (msg) errors.push(`${k}: ${msg}`);
    else value[k] = typeof v === "string" && k !== "notes" ? v.trim() : v;
  }
  // A field that already failed its own check is not reported again as missing.
  if (!partial) for (const e of requiredErrors(value)) { const k = e.split(":")[0]; if (!errors.some(x => x.startsWith(k + ":"))) errors.push(e); }
  return { errors, value: errors.length ? null : value };
}

module.exports = { validateListingInput, requiredErrors, LISTING_INPUT_FIELDS: Object.keys(FIELDS), MODES, OUTDOOR, CONTACT_TYPES };
