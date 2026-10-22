// Shared set-up for the outreach and reply tests: a vault with an applicant, outreach switched on, a shortlisted listing
// and a clock the test moves.
const { start, TEST_VAULT_KEY } = require("./helpers");
const { defaultProfile } = require("../lib/profile");
const { defaultApplicant } = require("../lib/applicant");

const json = (h = {}) => ({ ...h, "Content-Type": "application/json" });
const keyOnly = { "x-sync-key": "key", "Content-Type": "application/json" };
const flat = { title: "Helle 2-Zimmer-Wohnung", url: "https://www.immowelt.de/expose/example-1", source: "immowelt", mode: "rent", coldRent: 800, utilities: 150, warmRent: 950, rooms: 2, size: 60, address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf", contact: { name: "Example GmbH", type: "company" }, pick: true };

async function outreachApp({ outreach = {}, applicant = true, options = {} } = {}) {
  const clock = { t: new Date("2026-10-22T08:00:00Z").getTime() };
  const s = await start({ vaultKey: TEST_VAULT_KEY, now: () => new Date(clock.t), ...options });
  const call = (method, path, body, headers = json(s.auth)) => fetch(s.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const p = defaultProfile();
  p.money.netIncome = 3200;
  p.outreach = { enabled: true, paused: false, language: "de", minGapMin: 20, dailyCap: 3, ...outreach };
  await call("PUT", "/api/profile", p);
  if (applicant) await call("PUT", "/api/applicant", { ...defaultApplicant(), name: "Alex Example", household: { adults: 2, children: 0, pets: "" }, job: { title: "Engineer", employer: "Example GmbH", since: null, permanent: true } });
  const routine = (method, path, body) => call(method, path, body, keyOnly);
  const addFlat = (id, extra = {}) => routine("PUT", "/api/listings/" + id, { ...flat, ...extra });
  const approve = async (id, lang = "de") => {
    const t = (await (await call("GET", "/api/templates")).json()).templates[id][lang];
    return call("POST", `/api/templates/${id}/${lang}/approve`, { version: t.version });
  };
  const claim = body => routine("POST", "/api/outreach/claims", { via: "immowelt", ...body });
  const advance = min => { clock.t += min * 60000; };
  return { ...s, clock, call, routine, addFlat, approve, claim, advance };
}

module.exports = { outreachApp, json, keyOnly, flat };
