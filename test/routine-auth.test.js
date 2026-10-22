const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("./helpers");
const { isRoutineRoute } = require("../lib/routine-auth");
const { defaultProfile } = require("../lib/profile");

const json = (h = {}) => ({ ...h, "Content-Type": "application/json" });
const keyOnly = { "x-sync-key": "key", "Content-Type": "application/json" };

test("isRoutineRoute lists the routine's routes and nothing else", () => {
  for (const [m, p] of [["GET", "/api/profile"], ["GET", "/api/listings"], ["GET", "/api/meta"], ["GET", "/api/outreach/status"], ["GET", "/redflags.json"], ["PUT", "/api/listings/example-1"], ["PUT", "/api/img/example-1-1.jpg"], ["PUT", "/api/meta"], ["POST", "/api/sync"], ["POST", "/api/outreach/claims"], ["POST", "/api/outreach/claims/0123456789abcdef/sent"], ["POST", "/api/outreach/claims/0123456789abcdef/release"], ["POST", "/api/listings/example-1/replies"]]) assert.ok(isRoutineRoute(m, p), `${m} ${p}`);
  for (const [m, p] of [["PUT", "/api/profile"], ["PATCH", "/api/listings/example-1"], ["DELETE", "/api/listings/example-1"], ["POST", "/api/listings"], ["POST", "/api/listings/recalc-commute"], ["GET", "/api/templates"], ["PUT", "/api/templates/first-contact/de"], ["POST", "/api/templates/first-contact/de/approve"], ["PUT", "/api/outreach/pause"], ["POST", "/api/listings/example-1/viewings/abc/confirm"], ["POST", "/api/listings/example-1/shares"], ["POST", "/api/listings/example-1/doc-requests"], ["GET", "/api/vault"], ["GET", "/api/applicant"], ["GET", "/api/listings/example-1/replies/x"], ["GET", "/"], ["GET", "/index.html"], ["GET", "/img/example-1-1.jpg"]]) assert.ok(!isRoutineRoute(m, p), `${m} ${p}`);
});

test("the sync key alone opens the routine's routes", async () => {
  const s = await start();
  try {
    await fetch(s.base + "/api/profile", { method: "PUT", headers: json(s.auth), body: JSON.stringify(defaultProfile()) });
    assert.equal((await fetch(s.base + "/api/profile", { headers: keyOnly })).status, 200);
    assert.equal((await fetch(s.base + "/api/listings/example-1", { method: "PUT", headers: keyOnly, body: JSON.stringify({ title: "Example" }) })).status, 200);
    assert.equal((await fetch(s.base + "/api/listings", { headers: keyOnly })).status, 200);
    assert.equal((await fetch(s.base + "/api/sync", { method: "POST", headers: keyOnly, body: JSON.stringify({ seen: {} }) })).status, 200);
    const flags = await fetch(s.base + "/redflags.json", { headers: keyOnly });
    assert.equal(flags.status, 200);
    assert.ok(Array.isArray(await flags.json()));
    assert.equal((await fetch(s.base + "/", { headers: keyOnly })).status, 403);
  } finally { await s.close(); }
});

test("a request with a sync key is never the owner: owner routes answer 403, even with the password", async () => {
  const s = await start();
  try {
    await fetch(s.base + "/api/listings/example-1", { method: "PUT", headers: s.sync, body: JSON.stringify({ title: "Example" }) });
    const tries = [
      ["PUT", "/api/profile", defaultProfile()], ["PATCH", "/api/listings/example-1", { status: "accepted" }], ["DELETE", "/api/listings/example-1"],
      ["GET", "/api/vault/status"], ["POST", "/api/listings/example-1/doc-requests", { types: ["summary"] }], ["POST", "/api/listings/recalc-commute"]
    ];
    for (const headers of [keyOnly, s.sync]) for (const [method, path, body] of tries) {
      const r = await fetch(s.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.deepEqual(await r.json(), { error: "not allowed with the sync key" });
    }
    assert.equal(s.app.locals.state.listings["example-1"].status, "new");
  } finally { await s.close(); }
});

test("a wrong sync key is 401 even with the right password; no SYNC_KEY configured is 503", async () => {
  const s = await start();
  try {
    const r = await fetch(s.base + "/api/listings", { headers: { ...s.auth, "x-sync-key": "nope" } });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: "bad sync key" });
    // The password alone still reaches the owner routes but not the routine's write routes.
    assert.equal((await fetch(s.base + "/api/listings", { headers: s.auth })).status, 200);
    assert.equal((await fetch(s.base + "/api/sync", { method: "POST", headers: json(s.auth), body: "{}" })).status, 401);
  } finally { await s.close(); }
  const n = await start({ syncKey: "" });
  try {
    assert.equal((await fetch(n.base + "/api/listings", { headers: keyOnly })).status, 503);
    assert.equal((await fetch(n.base + "/api/sync", { method: "POST", headers: json(n.auth), body: "{}" })).status, 503);
  } finally { await n.close(); }
});
