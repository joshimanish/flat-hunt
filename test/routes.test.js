// Walks every route the app registers with no credentials, the password, the sync key, both, and a wrong key with the
// password, and checks the two roles: the sync key reaches only the allow-list, the routine's write routes need the key,
// and only /healthz and /s/* are public.
const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("./helpers");
const { isRoutineRoute } = require("../lib/routine-auth");
const { defaultProfile } = require("../lib/profile");

// [method, path] for every route, routers included; a router mounted below a path (only /s) gets its prefix.
function collect(stack, prefix = "", out = []) {
  for (const l of stack) {
    if (l.route) for (const m of Object.keys(l.route.methods)) for (const p of [].concat(l.route.path)) out.push([m.toUpperCase(), prefix + p]);
    else if (l.name === "router" && l.handle.stack) collect(l.handle.stack, l.regexp.fast_slash ? prefix : prefix + "/s", out);
  }
  return out;
}
const fill = p => p.replace(/:id\b/g, "example-1").replace(/:claimId|:vid/g, "0123456789abcdef").replace(/:lang/g, "de").replace(/:name/g, "x.jpg").replace(/:[a-zA-Z]+/g, "x");

test("every route: public only /healthz and /s/*, the sync key only on the allow-list, routine writes need the key", async () => {
  const s = await start({ fetchImpl: async () => { throw new Error("no network in tests"); } });
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: { ...s.auth, "Content-Type": "application/json" }, body: JSON.stringify(defaultProfile()) });
    await fetch(s.base + "/api/listings/example-1", { method: "PUT", headers: { "x-sync-key": "key", "Content-Type": "application/json" }, body: JSON.stringify({ title: "Example", mode: "rent", warmRent: 900 }) });
    const routes = collect(s.app._router.stack);
    assert.ok(routes.length > 40, "routes found");
    assert.ok(routes.some(([m, p]) => m === "GET" && p === "/api/commute/status"));
    assert.ok(routes.some(([m, p]) => p.startsWith("/s/")), "share routes carry their /s prefix");
    const pw = s.auth.Authorization;
    const combos = { none: {}, pw: { Authorization: pw }, key: { "x-sync-key": "key" }, both: { Authorization: pw, "x-sync-key": "key" }, badkey: { Authorization: pw, "x-sync-key": "nope" } };
    const problems = [];
    for (const [m, p] of routes) {
      const url = fill(p), allow = isRoutineRoute(m, url), pub = p === "/healthz" || p.startsWith("/s/");
      const isWrite = allow && m !== "GET" && m !== "HEAD";
      for (const [n, h] of Object.entries(combos)) {
        // Deleting the listing with a working credential would change the routes walked after it.
        if (m === "DELETE" && p === "/api/listings/:id" && (n === "pw")) continue;
        const r = await fetch(s.base + url, { method: m, headers: { ...h, "Content-Type": "application/json" }, body: ["GET", "HEAD"].includes(m) ? undefined : "{}" });
        const got = r.status;
        if (n === "none" && !pub && got !== 401) problems.push(`${m} ${p} without credentials: ${got}`);
        if (n === "none" && pub && got === 401) problems.push(`${m} ${p} is public but asked for the password`);
        if ((n === "key" || n === "both") && !pub && !allow && got !== 403) problems.push(`${m} ${p} with the sync key (${n}): ${got}`);
        if ((n === "key" || n === "both") && allow && [401, 403].includes(got)) problems.push(`${m} ${p} allow-listed but refused (${n}): ${got}`);
        if (n === "pw" && isWrite && got !== 401) problems.push(`${m} ${p} routine write with the password only: ${got}`);
        if (n === "badkey" && !pub && got !== 401) problems.push(`${m} ${p} wrong key with the password: ${got}`);
      }
    }
    assert.deepEqual(problems, []);
  } finally { await s.close(); }
});

test("GET /api/commute/status is owner-only: 403 with the sync key", async () => {
  const s = await start();
  try {
    assert.equal((await fetch(s.base + "/api/commute/status", { headers: { "x-sync-key": "key" } })).status, 403);
    assert.equal((await fetch(s.base + "/api/commute/status", { headers: s.auth })).status, 200);
  } finally { await s.close(); }
});

test("a request without access never has its body read", async () => {
  const s = await start();
  try {
    // Broken JSON: a parser in front of the gate would answer 400 "invalid json"; the gate answers first.
    const bad = "{not json";
    assert.equal((await fetch(s.base + "/api/listings", { method: "POST", headers: { "Content-Type": "application/json" }, body: bad })).status, 401);
    assert.equal((await fetch(s.base + "/api/templates/preview", { method: "POST", headers: { "Content-Type": "application/json", "x-sync-key": "key" }, body: bad })).status, 403);
    assert.equal((await fetch(s.base + "/api/sync", { method: "POST", headers: { "Content-Type": "application/json", "x-sync-key": "nope" }, body: bad })).status, 401);
    // Too large for the 64 KB limit, still refused by the gate first.
    const big = JSON.stringify({ body: "x".repeat(100 * 1024) });
    assert.equal((await fetch(s.base + "/api/templates/first-contact/de", { method: "PUT", headers: { "Content-Type": "application/json" }, body: big })).status, 401);
    // With access, the parsers still work.
    assert.equal((await fetch(s.base + "/api/listings", { method: "POST", headers: { ...s.auth, "Content-Type": "application/json" }, body: bad })).status, 400);
  } finally { await s.close(); }
});
