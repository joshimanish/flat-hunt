// lib/applicant.js — the applicant profile (who is applying): defaults and strict validation.
const { check: { isObj, str, bool, int, nullable, obj } } = require("./profile");

function defaultApplicant() {
  return {
    name: "", email: "", phone: "",
    household: { adults: 1, children: 0, pets: "" },
    job: { title: "", employer: "", since: null, permanent: false },
    schufaAvailable: false, landlordReferenceAvailable: false,
    about: ""
  };
}

const email = (v, p, e) => { if (typeof v !== "string" || (v !== "" && (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))) e.push(`${p}: email address expected`); };
const phone = (v, p, e) => { if (typeof v !== "string" || (v !== "" && (!/^\+?[0-9 ()\/-]{5,30}$/.test(v) || v.replace(/\D/g, "").length < 5))) e.push(`${p}: phone number expected`); };
const month = (v, p, e) => { if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) e.push(`${p}: month YYYY-MM expected`); };

const name = (v, p, e) => {
  if (typeof v !== "string") return e.push(`${p}: text of 1–120 characters expected`);
  const n = v.trim();
  if (!n) e.push(`${p}: must not be blank`);
  else if (n.length > 120) e.push(`${p}: text of 1–120 characters expected`);
};
const CONTROL = /[\u0000-\u001f\u007f]/;
const CONTROL_NO_NL = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const SCHEMA = obj({
  name, email, phone,
  household: obj({ adults: int(1, 10), children: int(0, 10), pets: str(0, 100) }),
  job: obj({ title: str(0, 120), employer: str(0, 120), since: nullable(month), permanent: bool }),
  schufaAvailable: bool, landlordReferenceAvailable: bool,
  about: str(0, 1000)
});

function validateApplicant(input) {
  if (!isObj(input)) return { errors: ["applicant must be an object"], value: null };
  const errors = [];
  SCHEMA(input, "", errors);
  const texts = { name: input.name, email: input.email, phone: input.phone, "household.pets": input.household?.pets, "job.title": input.job?.title, "job.employer": input.job?.employer };
  for (const [k, v] of Object.entries(texts)) if (typeof v === "string" && CONTROL.test(v)) errors.push(`${k}: control characters not allowed`);
  if (typeof input.about === "string" && CONTROL_NO_NL.test(input.about)) errors.push("about: control characters not allowed");
  if (!errors.length && input.job.since && input.job.since > new Date().toISOString().slice(0, 7)) errors.push("job.since: must not be in the future");
  return { errors, value: errors.length ? null : { ...input, name: input.name.trim() } };
}

module.exports = { defaultApplicant, validateApplicant };
