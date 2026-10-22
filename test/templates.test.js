const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../lib/templates");
const { upgradeProfile, validateProfile, defaultProfile } = require("../lib/profile");

const NOW = new Date("2026-10-22T10:00:00Z");
const applicant = { name: "Alex Example", household: { adults: 2, children: 1, pets: "" }, job: { title: "Engineer", employer: "Example GmbH", since: null, permanent: true } };
const profile = { money: { netIncome: 3200 }, flat: { moveInFrom: "2026-12-01" } };
const listing = { title: "Helle 2-Zimmer-Wohnung", address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf", contact: { name: "Example GmbH", type: "company" } };

test("every default template is valid in German and English and uses only its placeholders", () => {
  const all = T.defaultTemplates(NOW);
  assert.deepEqual(Object.keys(all), T.TEMPLATE_IDS);
  for (const id of T.TEMPLATE_IDS) for (const lang of T.TEMPLATE_LANGS) {
    const t = all[id][lang];
    assert.deepEqual(T.bodyErrors(id, t.body), [], `${id} ${lang}`);
    assert.equal(t.version, 1);
    assert.equal(t.approvedAt, null);
    assert.equal(t.updatedAt, NOW.toISOString());
  }
  assert.ok(T.placeholdersIn(all["viewing-confirmation"].de.body).includes("viewingTime"));
});

test("unknown placeholders, stray braces, control characters and bad lengths are rejected", () => {
  const e = T.bodyErrors("first-contact", "Guten Tag {name}, am {viewingTime} passt es. {iban} und }");
  assert.equal(e.length, 2);
  assert.match(e[0], /unknown placeholder \{viewingTime\}, \{iban\}; allowed: \{greeting\}/);
  assert.match(e[1], /braces are only allowed around a placeholder/);
  assert.deepEqual(T.bodyErrors("viewing-confirmation", "Bis {viewingTime}, viele Grüße {name}"), []);
  assert.match(T.bodyErrors("decline", "zu kurz")[0], /20–2000/);
  assert.match(T.bodyErrors("decline", "x".repeat(2001))[0], /20–2000/);
  assert.match(T.bodyErrors("decline", "Guten Tag,\u0007 wir sagen ab. {name}")[0], /control characters/);
  assert.deepEqual(T.bodyErrors("decline", 42), ["body: text expected"]);
});

test("German values: household, job, income, move-in, address and a Berlin-time viewing", () => {
  const v = T.fillValues({ applicant, profile, listing, viewingTime: "2026-10-27T17:00:00Z", lang: "de", now: NOW });
  assert.deepEqual(v, {
    greeting: "Guten Tag", name: "Alex Example", household: "2 Erwachsene und 1 Kind", job: "Engineer bei Example GmbH, unbefristet",
    income: "3.200 €", moveIn: "ab dem 01.12.2026", listingTitle: "Helle 2-Zimmer-Wohnung", address: "Beispielstraße 1, 40210 Düsseldorf",
    viewingTime: "Dienstag, 27.10.2026, 18:00 Uhr"
  });
});

test("English values; a private landlord is greeted by name; a past move-in date reads as any time", () => {
  const v = T.fillValues({ applicant: { ...applicant, household: { adults: 1, children: 0 }, job: { title: "", employer: "Example GmbH", permanent: false } }, profile: { money: { netIncome: 3200 }, flat: { moveInFrom: "2026-01-01" } }, listing: { ...listing, contact: { name: "Alex Example", type: "private" } }, viewingTime: "2026-10-27T17:00:00Z", lang: "en", now: NOW });
  assert.equal(v.greeting, "Hello Alex Example");
  assert.equal(v.household, "1 adult");
  assert.equal(v.job, "employed at Example GmbH");
  assert.equal(v.income, "€3,200");
  assert.equal(v.moveIn, "at any time");
  assert.equal(v.viewingTime, "Tuesday 27 October 2026, 18:00");
});

test("render fills known values and lists the missing ones", () => {
  const v = T.fillValues({ applicant: null, profile: { money: { netIncome: 0 }, flat: { moveInFrom: null } }, listing, lang: "de", now: NOW });
  const { text, missing } = T.render(T.DEFAULT_TEXTS["first-contact"].de, v);
  assert.deepEqual(missing.sort(), ["household", "income", "job", "name"]);
  assert.match(text, /„Helle 2-Zimmer-Wohnung“ \(Beispielstraße 1, 40210 Düsseldorf\)/);
  assert.match(text, /\{income\}/);
  const full = T.render(T.DEFAULT_TEXTS["first-contact"].en, T.fillValues({ applicant, profile, listing, lang: "en", now: NOW }));
  assert.deepEqual(full.missing, []);
  assert.match(full.text, /^Hello,\n\nwe are very interested in your flat “Helle 2-Zimmer-Wohnung”/);
  assert.match(full.text, /We could move in from 1 December 2026\./);
});

test("profiles from before phase 4 get the outreach defaults; Portuguese falls back to German; limits are validated", () => {
  const old = defaultProfile(); old.outreach = { enabled: true, paused: false, language: "pt" };
  const up = upgradeProfile(old);
  assert.deepEqual(up.outreach, { enabled: true, paused: false, language: "de", minGapMin: 20, dailyCap: 10 });
  assert.deepEqual(validateProfile(up).errors, []);
  assert.equal(upgradeProfile(null), null);
  for (const [k, v] of [["minGapMin", 4], ["minGapMin", 1441], ["dailyCap", 0], ["dailyCap", 51], ["dailyCap", 2.5], ["language", "pt"]]) {
    const p = defaultProfile(); p.outreach[k] = v;
    assert.ok(validateProfile(p).errors.some(e => e.startsWith("outreach." + k)), `${k}=${v}`);
  }
});
