// lib/replies.js — validation of a landlord reply the routine logs: who, where, the text and the routine's reading of it.
const { REQUEST_TYPES } = require("./doc-requests");

const INTENTS = ["viewing-invite", "documents-request", "rejection", "question", "other"];
const IN_VIAS = ["immowelt", "kleinanzeigen", "wg-gesucht", "email", "phone", "other"];
const MAX_TEXT = 5000, MAX_TIMES = 5;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EXTERNAL_ID = /^[A-Za-z0-9._:@<>+=\/-]{1,200}$/;
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const FIELDS = ["date", "from", "via", "text", "intent", "externalId", "proposedTimes", "docTypes"];

// An ISO date-time with an offset, as a UTC ISO string, or null. Impossible dates (Feb 30, 24:00) are refused.
function isoTime(v) {
  if (typeof v !== "string" || !ISO.test(v)) return null;
  const [y, mo, d, h, mi] = v.match(/\d+/g).map(Number);
  const off = /[+-](\d{2}):(\d{2})$/.exec(v);
  if (h > 23 || mi > 59 || (off && (+off[1] > 23 || +off[2] > 59))) return null;
  const sec = /T\d{2}:\d{2}:(\d{2})/.exec(v);
  if (sec && +sec[1] > 59) return null;
  const c = new Date(Date.UTC(y, mo - 1, d));
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d) return null;
  return Number.isNaN(Date.parse(v)) ? null : new Date(v).toISOString();
}

function validateReply(body, now = new Date()) {
  if (!isObj(body)) return { errors: ["reply must be an object"], value: null };
  const errors = [], t = now.getTime();
  for (const k of Object.keys(body)) if (!FIELDS.includes(k)) errors.push(`${k}: unknown field`);
  const text = typeof body.text === "string" ? body.text.replace(/\r\n?/g, "\n") : null;
  if (text === null || !text.trim() || text.length > MAX_TEXT) errors.push(`text: text of 1–${MAX_TEXT} characters expected`);
  else if (CONTROL.test(text)) errors.push("text: control characters not allowed");
  const from = body.from === undefined ? "" : body.from;
  if (typeof from !== "string" || from.length > 120 || CONTROL.test(from) || /[\r\n\t]/.test(from)) errors.push("from: single line of up to 120 characters expected");
  if (!IN_VIAS.includes(body.via)) errors.push(`via: one of ${IN_VIAS.join(", ")} expected`);
  if (!INTENTS.includes(body.intent)) errors.push(`intent: one of ${INTENTS.join(", ")} expected`);
  let date = now.toISOString();
  if (body.date !== undefined) {
    date = isoTime(body.date);
    if (!date || Date.parse(date) > t + 10 * 60000 || Date.parse(date) < t - 365 * 86400000) errors.push("date: ISO date-time with offset, not in the future and at most a year back, expected");
  }
  if (body.externalId !== undefined && (typeof body.externalId !== "string" || !EXTERNAL_ID.test(body.externalId))) errors.push("externalId: up to 200 letters, digits and ._:@<>+=/- expected");
  let proposedTimes = [];
  if (body.proposedTimes !== undefined) {
    if (body.intent !== "viewing-invite") errors.push("proposedTimes: only with intent viewing-invite");
    else if (!Array.isArray(body.proposedTimes) || body.proposedTimes.length > MAX_TIMES) errors.push(`proposedTimes: list of up to ${MAX_TIMES} date-times expected`);
    else {
      proposedTimes = body.proposedTimes.map(isoTime);
      if (proposedTimes.some(x => !x || Date.parse(x) < t - 86400000 || Date.parse(x) > t + 180 * 86400000)) errors.push("proposedTimes: ISO date-times with offset within the next 180 days expected");
      proposedTimes = [...new Set(proposedTimes)].sort();
    }
  }
  let docTypes = null;
  if (body.docTypes !== undefined) {
    if (body.intent !== "documents-request") errors.push("docTypes: only with intent documents-request");
    else if (!Array.isArray(body.docTypes) || !body.docTypes.length || new Set(body.docTypes).size !== body.docTypes.length || body.docTypes.some(x => !REQUEST_TYPES.includes(x))) errors.push(`docTypes: list of ${REQUEST_TYPES.join(", ")} expected`);
    else docTypes = body.docTypes;
  }
  if (errors.length) return { errors, value: null };
  return { errors, value: { date, from: from.trim(), via: body.via, text, intent: body.intent, externalId: body.externalId, proposedTimes, docTypes } };
}

module.exports = { INTENTS, IN_VIAS, MAX_TEXT, validateReply, isoTime };
