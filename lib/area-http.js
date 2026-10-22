// lib/area-http.js — polite HTTP for the area sources: User-Agent, timeout, retries with back-off, minimum spacing.
const { UA } = require("./geo");

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_WAIT_MS = 10 * 60 * 1000;
const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, retryAfterMs) { super("HTTP " + status); this.status = status; this.retryAfterMs = retryAfterMs; }
}

// Retry-After in seconds (the only form the public servers send), as milliseconds; null when absent.
function retryAfterMs(r) {
  const v = r && r.headers && typeof r.headers.get === "function" ? r.headers.get("retry-after") : null;
  return v != null && /^\d+$/.test(String(v).trim()) ? Number(v) * 1000 : null;
}

const permanent = msg => Object.assign(new Error(msg), { permanent: true });
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

// Reads the body as text and stops (cancelling the stream) as soon as it exceeds maxBytes.
async function readCapped(r, maxBytes) {
  const declared = r.headers && typeof r.headers.get === "function" ? Number(r.headers.get("content-length")) : NaN;
  if (declared > maxBytes) { if (r.body && r.body.cancel) r.body.cancel().catch(() => {}); throw permanent("response too large"); }
  if (!r.body || typeof r.body.getReader !== "function") {
    const t = await r.text();
    if (Buffer.byteLength(t) > maxBytes) throw permanent("response too large");
    return t;
  }
  const reader = r.body.getReader(), chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw permanent("response too large"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// One request; as = "json" | "text". Throws HttpError on a non-2xx answer, Error("timeout") after `ms`,
// and a permanent (never retried) error for an oversized body (maxBytes) or a redirect.
async function request(fetchImpl, url, { method = "GET", body, headers = {}, ms = 10000, as = "json", maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetchImpl(url, { method, body, signal: ac.signal, redirect: "error", headers: { ...headers, "User-Agent": UA } });
    if (r.status >= 300 && r.status < 400) throw permanent("redirect refused");
    if (!r.ok) throw new HttpError(r.status, retryAfterMs(r));
    const text = await readCapped(r, maxBytes);
    return as === "text" ? text : JSON.parse(text);
  } catch (e) {
    if (ac.signal.aborted && !(e instanceof HttpError) && !e.permanent) throw new Error("timeout");
    if (e instanceof TypeError && e.cause && /redirect/i.test(String(e.cause.message || e.cause))) throw permanent("redirect refused");
    throw e;
  } finally { clearTimeout(timer); }
}

// Overloaded servers (429/502/503/504), timeouts and network errors are worth another try; 4xx answers and bad data are not.
const isRetryable = e => e instanceof HttpError ? RETRYABLE.has(e.status) : !(e instanceof SyntaxError) && !e.permanent;

// Runs fn, retrying after each delay in turn (a longer Retry-After wins, capped at 10 minutes).
async function withRetry(fn, { delays = [2000], sleep = defaultSleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt >= delays.length || !isRetryable(e)) throw e;
      await sleep(Math.min(MAX_WAIT_MS, Math.max(delays[attempt], e.retryAfterMs || 0)));
    }
  }
}

// Serialises calls and keeps at least minMs between the end of one and the start of the next.
function createSpacer(minMs, { sleep = defaultSleep, clock = Date.now } = {}) {
  let chain = Promise.resolve(), last = -Infinity;
  return fn => {
    const run = chain.then(async () => {
      const wait = last + minMs - clock();
      if (wait > 0) await sleep(wait);
      try { return await fn(); } finally { last = clock(); }
    });
    chain = run.catch(() => {});
    return run;
  };
}

// Query string with %20 for spaces (some OGC servers do not read "+").
const qs = params => Object.entries(params).map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");

// A short, safe error text for the listing's area cache (never a stack).
const errorText = e => e instanceof HttpError ? e.message : e && e.message === "timeout" ? "timeout" : e && e.permanent ? e.message : "request failed";

module.exports = { HttpError, request, withRetry, createSpacer, isRetryable, qs, errorText, RETRYABLE };
