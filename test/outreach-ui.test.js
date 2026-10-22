const test = require("node:test");
const assert = require("node:assert/strict");
const ui = require("../public/outreach-ui.js");
const { TEMPLATE_IDS, TEMPLATE_LANGS } = require("../lib/templates");
const { INTENTS } = require("../lib/replies");

test("ids, languages and intents follow the server; every language has the same strings", () => {
  assert.deepEqual(ui.TEMPLATE_IDS, TEMPLATE_IDS);
  assert.deepEqual(ui.TEMPLATE_LANGS, TEMPLATE_LANGS);
  assert.deepEqual(ui.INTENTS, INTENTS);
  const keys = o => Object.entries(o).flatMap(([k, v]) => v && typeof v === "object" ? keys(v).map(s => k + "." + s) : [k]).sort();
  for (const lang of ["de", "pt"]) assert.deepEqual(keys(ui.L[lang]), keys(ui.L.en), lang);
  for (const lang of ["en", "de", "pt"]) {
    assert.deepEqual(Object.keys(ui.L[lang].names), TEMPLATE_IDS, lang);
    assert.deepEqual(Object.keys(ui.L[lang].intents), INTENTS, lang);
  }
});

test("the header switch shows the state and today's count; nothing when outreach is off", () => {
  const st = { enabled: true, paused: false, today: { used: 3, cap: 10 } };
  assert.deepEqual(ui.switchState(st, "en"), { paused: false, label: "Sending on · 3/10 today", title: ui.L.en.pauseTip });
  assert.equal(ui.switchState({ ...st, paused: true }, "de").label, "Senden pausiert · 3/10 heute");
  assert.equal(ui.switchState({ ...st, enabled: false }, "en"), null);
  assert.equal(ui.switchState(null, "en"), null);
});

test("message tags: template with version and language for outgoing, intent for incoming", () => {
  assert.equal(ui.messageTag({ dir: "out", templateId: "first-contact", templateVersion: 2, lang: "de" }, "en"), "Template: First contact · v2 · DE");
  assert.equal(ui.messageTag({ dir: "in", intent: "viewing-invite" }, "de"), "Besichtigungseinladung");
  assert.equal(ui.messageTag({ dir: "in", text: "by hand" }, "en"), null);
});

test("viewing texts in Berlin time", () => {
  assert.equal(ui.viewingText({ status: "confirmed", time: "2026-10-27T17:00:00.000Z", confirmationSentAt: null }, "en"), "Viewing confirmed: Tue 27 Oct, 18:00 " + ui.L.en.confirmationPending);
  assert.equal(ui.viewingText({ status: "pending", proposedTimes: [] }, "en"), ui.L.en.noTimes);
  assert.equal(ui.viewingText({ status: "cancelled" }, "pt"), ui.L.pt.cancelled);
});

test("viewing proposals are listed newest first", () => {
  const list = [{ id: "a", createdAt: "2026-10-20T10:00:00Z" }, { id: "b", createdAt: "2026-10-22T10:00:00Z" }];
  assert.deepEqual(ui.sortViewings(list).map(v => v.id), ["b", "a"]);
  assert.deepEqual(ui.sortViewings(undefined), []);
  assert.equal(list[0].id, "a");
});

test("viewing request errors: held claim, dead connection, server error, bare status, in all languages", () => {
  for (const lang of ["en", "de", "pt"]) {
    assert.equal(ui.viewingError({ status: 409, json: { error: "claim-open", reason: "claim-open" } }, lang), ui.L[lang].claimOpen);
    assert.equal(ui.viewingError({ status: 0, json: {} }, lang), ui.L[lang].netFail);
  }
  assert.equal(ui.viewingError({ status: 409, json: { error: "viewing is not pending" } }, "en"), "viewing is not pending");
  assert.equal(ui.viewingError({ status: 500, json: {} }, "de"), `${ui.L.de.failed} (500)`);
});

test("update log parts for sent, skipped and reply entries", () => {
  assert.deepEqual(ui.updateParts({ type: "sent", template: "first-contact" }, "de"), { label: ui.L.de.upSent, note: ui.L.de.names["first-contact"] });
  assert.deepEqual(ui.updateParts({ type: "skipped", template: "decline" }, "en"), { label: ui.L.en.upSkipped, note: ui.L.en.names.decline });
  for (const [lang, text] of [["en", "Expired, maybe sent: check"], ["de", "Abgelaufen, evtl. gesendet: prüfen"], ["pt", "Expirado, talvez enviado: verificar"]]) {
    assert.equal(ui.updateParts({ type: "skipped", reason: "expired", template: "decline" }, lang).label, text);
    assert.notEqual(ui.updateParts({ type: "skipped", template: "decline" }, lang).label, text);
  }
  assert.deepEqual(ui.updateParts({ type: "reply", intent: "viewing-invite" }, "en"), { label: "Reply", note: "Viewing invitation" });
  assert.equal(ui.updateParts({ type: "price" }, "en"), null);
});

test("missing or invalid times never throw", () => {
  assert.equal(ui.fmtTime(undefined, "en"), "");
  assert.equal(ui.fmtTime("nonsense", "de"), "");
  assert.equal(ui.fmtTime(null, "pt"), "");
  assert.equal(ui.viewingText({ status: "confirmed" }, "en"), ui.L.en.confirmed("").trim() + " " + ui.L.en.confirmationPending);
  assert.equal(ui.viewingText({ status: "confirmed", time: "x", confirmationSentAt: "y" }, "en"), ui.L.en.confirmed("").trim() + " " + ui.L.en.confirmationPending);
  assert.equal(ui.viewingText({ status: "pending" }, "en"), ui.L.en.noTimes);
  assert.equal(ui.viewingText({ status: "weird" }, "de"), ui.L.de.cancelled);
});

test("badge path: pending with usable times only, tolerant of missing fields", () => {
  assert.equal(ui.hasPendingProposal({ viewings: [{ status: "pending", proposedTimes: ["2026-10-27T18:00:00+01:00"] }] }), true);
  assert.equal(ui.hasPendingProposal({ viewings: [{ status: "pending" }, { status: "pending", proposedTimes: [] }, { status: "confirmed", proposedTimes: ["x"] }] }), false);
  assert.equal(ui.hasPendingProposal({}), false);
  assert.deepEqual(ui.timesOf({}), []);
});

test("message tag without a template version leaves the version out", () => {
  assert.equal(ui.messageTag({ dir: "out", templateId: "decline", lang: "en" }, "en"), "Template: Not interested anymore · EN");
});
