const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultApplicant } = require("../lib/applicant");
const { DOC_TYPES } = require("../lib/documents");
const browser = require("../public/vault-ui.js");

test("the applicant form starts from the same defaults as the server", () => {
  assert.deepEqual(browser.defaultApplicant(), defaultApplicant());
});

test("document types follow the server order and are named in every language", () => {
  assert.deepEqual(browser.TYPES, DOC_TYPES);
  for (const lang of ["en", "de", "pt"]) for (const t of DOC_TYPES) assert.ok(browser.L[lang].types[t], `${lang} ${t}`);
});

test("every language has the same strings", () => {
  const keys = Object.keys(browser.L.en).sort();
  for (const lang of ["de", "pt"]) assert.deepEqual(Object.keys(browser.L[lang]).sort(), keys, lang);
});

test("payslip reminder: unredacted payslips in the selection that were not confirmed before", () => {
  const docs = [
    { id: "a", type: "payslip", redactedAt: null },
    { id: "b", type: "payslip", redactedAt: "2026-10-20T10:00:00.000Z" },
    { id: "c", type: "schufa", redactedAt: null },
    { id: "d", type: "payslip", redactedAt: null }
  ];
  assert.deepEqual(browser.pendingPayslips(docs, ["a", "b", "c", "summary"], []).map(d => d.id), ["a"]);
  assert.deepEqual(browser.pendingPayslips(docs, ["a", "d"], ["a"]).map(d => d.id), ["d"]);
  assert.deepEqual(browser.pendingPayslips(docs, ["b", "c"], []), []);
});

test("the checklist pre-ticks the types of the newest request", () => {
  const docs = [{ id: "a", type: "payslip" }, { id: "b", type: "schufa" }, { id: "c", type: "id" }];
  const requests = [{ at: "2026-10-19T08:00:00.000Z", types: ["id"] }, { at: "2026-10-20T08:00:00.000Z", types: ["payslip", "schufa", "summary"] }];
  assert.deepEqual(browser.preticked(docs, requests, true), ["a", "b", "summary"]);
  assert.deepEqual(browser.preticked(docs, requests, false), ["a", "b"]);
  assert.deepEqual(browser.preticked(docs, undefined, true), []);
});
