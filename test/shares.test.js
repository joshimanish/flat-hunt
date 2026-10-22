const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../lib/shares");

test("tokens are 32 random bytes in base64url and hashed with SHA-256", () => {
  const t = S.newToken();
  assert.match(t, S.TOKEN_RE);
  assert.notEqual(t, S.newToken());
  assert.equal(S.hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("validateShareInput", () => {
  const exists = id => id === "d1" || id === "d2";
  assert.deepEqual(S.validateShareInput({ docIds: ["d1", "summary"] }, exists), { errors: [], value: { docIds: ["d1", "summary"], days: 7 } });
  assert.deepEqual(S.validateShareInput({ docIds: ["d2"], days: 30 }, exists).value, { docIds: ["d2"], days: 30 });
  assert.match(S.validateShareInput({ docIds: [] }, exists).errors[0], /^docIds/);
  assert.match(S.validateShareInput({ docIds: ["d1", "d1"] }, exists).errors[0], /^docIds/);
  assert.deepEqual(S.validateShareInput({ docIds: ["nope"] }, exists).errors, ["docIds: unknown document nope"]);
  for (const days of [0, 31, 1.5, "7"]) assert.match(S.validateShareInput({ docIds: ["d1"], days }, exists).errors[0], /^days/);
  assert.deepEqual(S.validateShareInput({ docIds: ["d1"], token: "x" }, exists).errors, ["token: unknown field"]);
  assert.deepEqual(S.validateShareInput(null, exists).errors, ["share must be an object"]);
});

test("shareSubject prefers the address, then postcode and city, then the title", () => {
  assert.equal(S.shareSubject({ address: "Beispielstraße 1", postcode: "40210", city: "Düsseldorf", title: "2 rooms" }), "Beispielstraße 1, 40210 Düsseldorf");
  assert.equal(S.shareSubject({ postcode: "40210", city: "Düsseldorf", title: "2 rooms" }), "40210 Düsseldorf");
  assert.equal(S.shareSubject({ title: "2 rooms" }), "2 rooms");
});

test("createShare stores only the hash; expiry, revocation and the owner view", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const { share, token } = S.createShare({ listingId: "l1", listing: { address: "Beispielstraße 1", title: "x" }, docIds: ["d1"], days: 7, now });
  assert.equal(share.tokenHash, S.hashToken(token));
  assert.ok(!JSON.stringify(share).includes(token));
  assert.equal(share.expiresAt, "2026-10-27T10:00:00.000Z");
  assert.deepEqual([share.revokedAt, share.opens, share.subject], [null, [], "Beispielstraße 1"]);
  assert.equal(S.isActive(share, new Date("2026-10-27T09:59:59Z")), true);
  assert.equal(S.isActive(share, new Date("2026-10-27T10:00:00Z")), false);
  assert.equal(S.isActive({ ...share, revokedAt: now.toISOString() }, now), false);
  const view = S.shareView(share, now);
  assert.equal(view.tokenHash, undefined);
  assert.equal(view.active, true);
});
