// lib/templates.js — message templates for landlords: ids, placeholders, default texts, validation and filling.
// The routine only ever receives a filled text of an approved template (lib/outreach-api.js), never the applicant profile.
const { shareSubject } = require("./shares");

const TEMPLATE_IDS = ["first-contact", "viewing-confirmation", "documents-follow", "decline"];
const TEMPLATE_LANGS = ["de", "en"];
const COMMON = ["greeting", "name", "household", "job", "income", "moveIn", "listingTitle", "address"];
const PLACEHOLDERS = {
  "first-contact": COMMON,
  "viewing-confirmation": [...COMMON, "viewingTime"],
  "documents-follow": COMMON,
  decline: COMMON
};
const MIN_BODY = 20, MAX_BODY = 2000;
const TOKEN = /\{([A-Za-z]+)\}/g;
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f]/;

const DEFAULT_TEXTS = {
  "first-contact": {
    de: "{greeting},\n\nwir interessieren uns sehr für Ihre Wohnung „{listingTitle}“ ({address}). Kurz zu uns: {household}, {job}, Haushaltsnettoeinkommen {income} im Monat. Einziehen könnten wir {moveIn}.\n\nWir würden die Wohnung gern besichtigen. Eine Bewerbermappe schicken wir Ihnen auf Wunsch.\n\nViele Grüße\n{name}",
    en: "{greeting},\n\nwe are very interested in your flat “{listingTitle}” ({address}). About us: {household}, {job}, household net income {income} a month. We could move in {moveIn}.\n\nWe would love to view the flat. We are happy to send our application documents on request.\n\nKind regards\n{name}"
  },
  "viewing-confirmation": {
    de: "{greeting},\n\nvielen Dank für die Einladung. Gern bestätigen wir die Besichtigung von „{listingTitle}“ am {viewingTime}.\n\nViele Grüße\n{name}",
    en: "{greeting},\n\nthank you for the invitation. We are happy to confirm the viewing of “{listingTitle}” on {viewingTime}.\n\nKind regards\n{name}"
  },
  "documents-follow": {
    de: "{greeting},\n\nvielen Dank für Ihre Nachricht zu „{listingTitle}“. Die gewünschten Unterlagen schicken wir Ihnen in Kürze als Link.\n\nViele Grüße\n{name}",
    en: "{greeting},\n\nthank you for your message about “{listingTitle}”. We will send you the documents you asked for shortly, as a link.\n\nKind regards\n{name}"
  },
  decline: {
    de: "{greeting},\n\nvielen Dank für Ihre Zeit. Wir haben uns inzwischen anders entschieden und ziehen unsere Anfrage für „{listingTitle}“ zurück.\n\nViele Grüße\n{name}",
    en: "{greeting},\n\nthank you for your time. We have since decided otherwise and withdraw our enquiry about “{listingTitle}”.\n\nKind regards\n{name}"
  }
};

// Every template in both languages, version 1, not approved.
function defaultTemplates(now = new Date()) {
  const at = now.toISOString();
  return Object.fromEntries(TEMPLATE_IDS.map(id => [id, Object.fromEntries(TEMPLATE_LANGS.map(lang => [lang, { body: DEFAULT_TEXTS[id][lang], version: 1, updatedAt: at, approvedAt: null }]))]));
}

// Problems with a template text: length, control characters, unknown placeholders, stray braces.
function bodyErrors(id, body) {
  if (typeof body !== "string") return ["body: text expected"];
  const errors = [];
  if (body.trim().length < MIN_BODY || body.length > MAX_BODY) errors.push(`body: text of ${MIN_BODY}–${MAX_BODY} characters expected`);
  if (CONTROL.test(body)) errors.push("body: control characters not allowed");
  const allowed = PLACEHOLDERS[id] || [];
  const unknown = [...new Set([...body.matchAll(TOKEN)].map(m => m[1]).filter(n => !allowed.includes(n)))];
  if (unknown.length) errors.push(`body: unknown placeholder ${unknown.map(n => "{" + n + "}").join(", ")}; allowed: ${allowed.map(n => "{" + n + "}").join(", ")}`);
  if (/[{}]/.test(body.replace(TOKEN, ""))) errors.push("body: braces are only allowed around a placeholder, e.g. {name}");
  return errors;
}

const placeholdersIn = body => [...new Set([...String(body).matchAll(TOKEN)].map(m => m[1]))];

// ---------- values ----------
const TZ = "Europe/Berlin";
const isoDay = d => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const parts = (d, locale, opts) => Object.fromEntries(new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).formatToParts(d).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
const fmtDay = (ymd, lang) => {
  const d = new Date(ymd + "T12:00:00Z");
  if (lang === "de") { const p = parts(d, "de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }); return `${p.day}.${p.month}.${p.year}`; }
  const p = parts(d, "en-GB", { day: "numeric", month: "long", year: "numeric" }); return `${p.day} ${p.month} ${p.year}`;
};
// "Dienstag, 27.10.2026, 18:00 Uhr" / "Tuesday 27 October 2026, 18:00" in Berlin time.
function fmtViewing(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const o = { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  if (lang === "de") { const p = parts(d, "de-DE", o); return `${p.weekday}, ${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute} Uhr`; }
  const p = parts(d, "en-GB", { ...o, day: "numeric", month: "long" }); return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}
const money = (n, lang) => lang === "de" ? `${Math.round(n).toLocaleString("de-DE")} €` : `€${Math.round(n).toLocaleString("en-GB")}`;

function household(h, lang) {
  if (!h || !(h.adults >= 1)) return null;
  const de = lang === "de";
  const a = de ? `${h.adults} ${h.adults === 1 ? "Erwachsener" : "Erwachsene"}` : `${h.adults} ${h.adults === 1 ? "adult" : "adults"}`;
  if (!h.children) return a;
  const c = de ? `${h.children} ${h.children === 1 ? "Kind" : "Kinder"}` : `${h.children} ${h.children === 1 ? "child" : "children"}`;
  return `${a} ${de ? "und" : "and"} ${c}`;
}

function job(j, lang) {
  if (!j) return null;
  const de = lang === "de", title = (j.title || "").trim(), employer = (j.employer || "").trim();
  let s = title && employer ? `${title} ${de ? "bei" : "at"} ${employer}` : title || (employer ? (de ? `angestellt bei ${employer}` : `employed at ${employer}`) : "");
  if (!s) return null;
  if (j.permanent) s += de ? ", unbefristet" : ", permanent contract";
  return s;
}

// Placeholder values for one message; null = not known (the message is then not sent).
function fillValues({ applicant, profile, listing, viewingTime, lang, now = new Date() }) {
  const a = applicant || {}, l = listing || {}, de = lang === "de";
  const contact = l.contact && l.contact.type === "private" && l.contact.name ? l.contact.name : "";
  const from = profile && profile.flat && profile.flat.moveInFrom;
  const income = profile && profile.money && profile.money.netIncome;
  return {
    greeting: (de ? "Guten Tag" : "Hello") + (contact ? " " + contact : ""),
    name: a.name ? a.name.trim() || null : null,
    household: household(a.household, lang),
    job: job(a.job, lang),
    income: income > 0 ? money(income, lang) : null,
    moveIn: from && from > isoDay(now) ? `${de ? "ab dem" : "from"} ${fmtDay(from, lang)}` : de ? "jederzeit" : "at any time",
    listingTitle: l.title || null,
    address: shareSubject(l) || null,
    viewingTime: viewingTime ? fmtViewing(viewingTime, lang) : null
  };
}

// Fills the placeholders; an unknown value stays as {name} and is listed in `missing`.
function render(body, values) {
  const missing = new Set();
  const text = String(body).replace(TOKEN, (m, n) => {
    const v = values[n];
    if (v == null || v === "") { missing.add(n); return m; }
    return v;
  });
  return { text, missing: [...missing] };
}

module.exports = { TEMPLATE_IDS, TEMPLATE_LANGS, PLACEHOLDERS, MAX_BODY, DEFAULT_TEXTS, defaultTemplates, bodyErrors, placeholdersIn, fillValues, render, fmtViewing, isoDay };
