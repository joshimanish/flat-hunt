// lib/profile.js — the flat search profile: defaults and strict validation.
const LANGS = ["en", "de", "pt"];
// Message templates exist in German and English (lib/templates.js).
const OUTREACH_LANGS = ["de", "en"];
const OUTREACH_DEFAULTS = { enabled: false, paused: false, language: "de", minGapMin: 20, dailyCap: 10 };
const PLACE_MODES = ["car", "transit", "bike"];
const OUTDOOR = ["any", "balcony", "garden"];
const KITCHEN = ["any", "required"];
const WBS = ["none", "have", "exclude"];
const STATES = ["BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH"];
const WEIGHT_KEYS = ["price", "size", "commute", "area", "condition", "contact"];

function defaultProfile() {
  return {
    version: 1, name: "Flat Hunt", languages: ["en", "de", "pt"],
    modes: { rent: true, buy: false },
    money: { netIncome: 0, affordShare: 0.33 },
    rent: { maxWarm: 1200, maxCold: null, maxDeposit: null, maxTakeover: null },
    buy: { maxPrice: 350000, equity: 70000, apr: 3.8, years: 25, state: "NW", agentFeePct: 3.57 },
    flat: { roomsMin: 2, roomsMax: null, sizeMin: 50, sizeMax: null, floorMin: null, floorMax: null, needsLift: false, outdoor: "any", kitchen: "any", pets: false, moveInFrom: null, moveInTo: null, wbs: "none" },
    places: [], radius: { center: null, km: null },
    redFlags: [],
    weights: { price: 2, size: 1.5, commute: 2, area: 1, condition: 1, contact: 1 },
    outreach: { ...OUTREACH_DEFAULTS }
  };
}

// Validators push "path: message" into errs.
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (min, max) => (v, p, e) => { if (typeof v !== "string" || v.length < min || v.length > max) e.push(`${p}: text of ${min}–${max} characters expected`); };
const bool = (v, p, e) => { if (typeof v !== "boolean") e.push(`${p}: true or false expected`); };
const num = (min, max) => (v, p, e) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) e.push(`${p}: number ${min}–${max} expected`); };
const int = (min, max) => (v, p, e) => { if (!Number.isInteger(v) || v < min || v > max) e.push(`${p}: whole number ${min}–${max} expected`); };
const oneOf = list => (v, p, e) => { if (!list.includes(v)) e.push(`${p}: one of ${list.join(", ")} expected`); };
const nullable = f => (v, p, e) => { if (v !== null) f(v, p, e); };
const arr = (f, min, max, unique) => (v, p, e) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) return e.push(`${p}: list of ${min}–${max} items expected`);
  v.forEach((x, i) => f(x, `${p}[${i}]`, e));
  if (unique && new Set(v).size !== v.length) e.push(`${p}: duplicate items`);
};
const obj = shape => (v, p, e) => {
  if (!isObj(v)) return e.push(`${p}: object expected`);
  for (const k of Object.keys(v)) if (!Object.hasOwn(shape, k)) e.push(`${p ? p + "." : ""}${k}: unknown field`);
  for (const [k, f] of Object.entries(shape)) {
    const path = p ? `${p}.${k}` : k;
    if (!(k in v)) e.push(`${path}: missing`); else f(v[k], path, e);
  }
};
const parseDate = s => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? d : null;
};
const date = (v, p, e) => { if (!parseDate(v)) e.push(`${p}: date YYYY-MM-DD expected`); };
const time = (v, p, e) => { if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) e.push(`${p}: time HH:MM expected`); };
const halfStep = (min, max) => (v, p, e) => { if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (v * 2) % 1 !== 0) e.push(`${p}: number ${min}–${max} in steps of 0.5 expected`); };
const geo = withLabel => obj({
  ...(withLabel ? { label: str(1, 200) } : {}),
  address: str(1, 200), lat: num(-90, 90), lon: num(-180, 180)
});
const placeShape = obj({
  label: str(1, 200), address: str(1, 200), lat: num(-90, 90), lon: num(-180, 180),
  maxMin: int(5, 180), mode: oneOf(PLACE_MODES), time
});

const redFlag = (v, p, e) => {
  if (!isObj(v)) return e.push(`${p}: object expected`);
  for (const k of Object.keys(v)) if (!["id", "on", "label", "match"].includes(k)) e.push(`${p}.${k}: unknown field`);
  const custom = typeof v.id === "string" && v.id.startsWith("custom-");
  if (typeof v.id !== "string" || !(custom ? /^custom-\d{1,9}$/ : /^[a-z0-9-]{1,40}$/).test(v.id)) e.push(`${p}.id: ${custom ? "custom-<n>" : "lowercase id"} expected`);
  bool(v.on, `${p}.on`, e);
  if (custom) {
    str(1, 80)(v.label, `${p}.label`, e);
    if (typeof v.match !== "string" || !v.match || v.match.length > 200) e.push(`${p}.match: pattern expected`);
    else { try { new RegExp(v.match, "i"); } catch (err) { e.push(`${p}.match: invalid pattern`); } }
  }
};

const SCHEMA = obj({
  version: (v, p, e) => { if (v !== 1) e.push(`${p}: 1 expected`); },
  name: str(1, 80),
  languages: arr(oneOf(LANGS), 1, 3, true),
  modes: obj({ rent: bool, buy: bool }),
  money: obj({ netIncome: num(0, 100000), affordShare: num(0.2, 0.5) }),
  rent: obj({ maxWarm: num(0, 20000), maxCold: nullable(num(0, 20000)), maxDeposit: nullable(num(0, 100000)), maxTakeover: nullable(num(0, 100000)) }),
  buy: obj({ maxPrice: num(0, 10000000), equity: num(0, 10000000), apr: num(0, 15), years: int(5, 40), state: oneOf(STATES), agentFeePct: num(0, 7.14) }),
  flat: obj({
    roomsMin: halfStep(1, 10), roomsMax: nullable(halfStep(1, 10)),
    sizeMin: num(10, 500), sizeMax: nullable(num(10, 500)),
    floorMin: nullable(int(-1, 40)), floorMax: nullable(int(-1, 40)),
    needsLift: bool, outdoor: oneOf(OUTDOOR), kitchen: oneOf(KITCHEN), pets: bool,
    moveInFrom: nullable(date), moveInTo: nullable(date), wbs: oneOf(WBS)
  }),
  places: arr(placeShape, 0, 5),
  radius: obj({ center: nullable(geo(false)), km: nullable(num(1, 100)) }),
  redFlags: arr(redFlag, 0, 100),
  weights: obj(Object.fromEntries(WEIGHT_KEYS.map(k => [k, num(0, 10)]))),
  outreach: obj({ enabled: bool, paused: bool, language: oneOf(OUTREACH_LANGS), minGapMin: int(5, 1440), dailyCap: int(1, 50) })
});

function validateProfile(input) {
  if (!isObj(input)) return { errors: ["profile must be an object"], value: null };
  const errors = [];
  SCHEMA(input, "", errors);
  if (!errors.length) {
    const f = input.flat;
    if (!input.modes.rent && !input.modes.buy) errors.push("modes: at least one of rent or buy");
    if ((input.radius.center === null) !== (input.radius.km === null)) errors.push("radius: set both center and km, or neither");
    if (f.roomsMax !== null && f.roomsMax < f.roomsMin) errors.push("flat.roomsMax: must not be below roomsMin");
    if (f.sizeMax !== null && f.sizeMax < f.sizeMin) errors.push("flat.sizeMax: must not be below sizeMin");
    if (f.floorMin !== null && f.floorMax !== null && f.floorMax < f.floorMin) errors.push("flat.floorMax: must not be below floorMin");
    if (f.moveInFrom && f.moveInTo && parseDate(f.moveInTo) < parseDate(f.moveInFrom)) errors.push("flat.moveInTo: must not be before moveInFrom");
    if (!WEIGHT_KEYS.some(k => input.weights[k] > 0)) errors.push("weights: at least one weight must be above 0");
  }
  return { errors, value: errors.length ? null : input };
}

// Profiles saved before phase 4 get the new outreach fields (switched off when missing); Portuguese messages fall back to German.
function upgradeProfile(p) {
  if (!isObj(p)) return p;
  const o = { ...OUTREACH_DEFAULTS, ...(isObj(p.outreach) ? p.outreach : {}) };
  if (!OUTREACH_LANGS.includes(o.language)) o.language = "de";
  return { ...p, outreach: o };
}

module.exports = { defaultProfile, validateProfile, upgradeProfile, OUTREACH_LANGS, OUTREACH_DEFAULTS, LANGS, PLACE_MODES, OUTDOOR, KITCHEN, WBS, STATES, WEIGHT_KEYS, check: { isObj, str, bool, int, nullable, obj } };
