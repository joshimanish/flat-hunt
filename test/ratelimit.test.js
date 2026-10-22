const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../lib/ratelimit");

test("rate limiter: 30 per window per key, then a fresh window", () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 30, windowMs: 60000, now: () => t });
  for (let i = 0; i < 30; i++) assert.equal(rl.hit("a"), true);
  assert.equal(rl.hit("a"), false);
  assert.equal(rl.hit("b"), true);
  t = 60000;
  assert.equal(rl.hit("a"), true);
});

test("rate limiter: tracked keys are capped and many keys stay fast", () => {
  const rl = createRateLimiter({ limit: 30, windowMs: 60000, now: () => 0 });
  const t0 = Date.now();
  for (let i = 0; i < 20000; i++) rl.hit("10.0." + (i >> 8) + "." + (i & 255) + "-" + i);
  assert.ok(rl.size() <= 10000, String(rl.size()));
  assert.ok(Date.now() - t0 < 500);
});

test("rate limiter: IPv6 by /64, IPv4-mapped as IPv4", () => {
  const rl = createRateLimiter({ limit: 2, windowMs: 60000, now: () => 0 });
  assert.equal(rl.hit("2001:db8:1:2::1"), true);
  assert.equal(rl.hit("2001:db8:1:2:ffff:1:2:3"), true);
  assert.equal(rl.hit("2001:0db8:1:2::9"), false);
  assert.equal(rl.hit("2001:db8:1:3::1"), true);
  assert.equal(rl.hit("1.2.3.4"), true);
  assert.equal(rl.hit("::ffff:1.2.3.4"), true);
  assert.equal(rl.hit("::ffff:1.2.3.4"), false);
});
