// lib/shares.js — share links: tokens (only their hash is stored), input validation and the public view of a share.
const crypto = require("crypto");

const SUMMARY_ID = "summary";
const DEFAULT_DAYS = 7;

const newToken = () => crypto.randomBytes(32).toString("base64url");
const hashToken = token => crypto.createHash("sha256").update(String(token)).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// { docIds: 1–20 unique ids of existing documents or "summary", days: 1–30 (default 7) }
function validateShareInput(body, docExists) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { errors: ["share must be an object"], value: null };
  const errors = [];
  for (const k of Object.keys(body)) if (!["docIds", "days"].includes(k)) errors.push(`${k}: unknown field`);
  const ids = body.docIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length) errors.push("docIds: list of 1–20 different documents expected");
  else for (const id of ids) if (id !== SUMMARY_ID && (typeof id !== "string" || !docExists(id))) errors.push(`docIds: unknown document ${String(id).slice(0, 40)}`);
  const days = body.days === undefined ? DEFAULT_DAYS : body.days;
  if (!Number.isInteger(days) || days < 1 || days > 30) errors.push("days: whole number 1–30 expected");
  return { errors, value: errors.length ? null : { docIds: ids, days } };
}

// The text a watermark names: the listing's address, else its postcode and city, else its title.
const shareSubject = l => [l.address, [l.postcode, l.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || l.title || "";

function createShare({ listingId, listing, docIds, days, now = new Date() }) {
  const token = newToken();
  const share = {
    id: crypto.randomBytes(8).toString("hex"), listingId, subject: shareSubject(listing), docIds,
    tokenHash: hashToken(token), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86400000).toISOString(), revokedAt: null, opens: []
  };
  return { share, token };
}

const isActive = (share, now = new Date()) => !share.revokedAt && new Date(share.expiresAt) > now;

// What the owner's page sees: everything except the token hash.
const shareView = (share, now = new Date()) => { const { tokenHash, ...rest } = share; return { ...rest, active: isActive(share, now) }; };

module.exports = { SUMMARY_ID, DEFAULT_DAYS, TOKEN_RE, newToken, hashToken, validateShareInput, shareSubject, createShare, isActive, shareView };
