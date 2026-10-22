const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultProfile } = require("../lib/profile");
const browser = require("../public/setup.js");

test("the wizard starts from the same default profile as the server", () => {
  assert.deepEqual(browser.defaultProfile(), defaultProfile());
});
