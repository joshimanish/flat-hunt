// Listing input validation (manual add and edit).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateListingInput } = require("../lib/listing");

const rent = { url: "https://www.immowelt.de/expose/abc123", title: "Bright 2-room flat with balcony", mode: "rent", coldRent: 750, utilities: 180, rooms: 2, size: 58, postcode: "45127", city: "Essen" };
const buy = { url: "https://www.kleinanzeigen.de/s-anzeige/123", title: "3-room flat to buy", mode: "buy", price: 289000, rooms: 3, size: 82, address: "Musterweg 3, 45127 Essen" };

test("a complete rent and buy listing pass and come back trimmed", () => {
  const r = validateListingInput({ ...rent, title: "  Bright 2-room flat with balcony ", city: " Essen " });
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.title, "Bright 2-room flat with balcony");
  assert.equal(r.value.city, "Essen");
  assert.deepEqual(validateListingInput(buy).errors, []);
  assert.deepEqual(validateListingInput({ ...rent, coldRent: undefined, utilities: undefined, warmRent: 950 }).errors, []);
});

test("add requires url (https), title, mode, a place, rooms and size", () => {
  const { errors, value } = validateListingInput({});
  assert.equal(value, null);
  for (const k of ["url", "title", "mode", "address", "rooms", "size"]) assert.ok(errors.some(e => e.startsWith(k + ":")), k);
  assert.ok(validateListingInput({ ...rent, url: "http://insecure.example/x" }).errors.some(e => e.startsWith("url:")));
  assert.ok(validateListingInput({ ...rent, url: "javascript:alert(1)" }).errors.some(e => e.startsWith("url:")));
  assert.ok(validateListingInput({ ...rent, mode: "lease" }).errors.some(e => e.startsWith("mode:")));
});

test("address alone, or postcode with city, locates the listing", () => {
  assert.deepEqual(validateListingInput({ ...rent, postcode: undefined, city: undefined, address: "45127 Essen" }).errors, []);
  assert.ok(validateListingInput({ ...rent, city: undefined }).errors.some(e => e.startsWith("address:")));
  assert.ok(validateListingInput({ ...rent, postcode: undefined }).errors.some(e => e.startsWith("address:")));
  assert.ok(validateListingInput({ ...rent, postcode: "4512" }).errors.some(e => e.startsWith("postcode:")));
});

test("rent needs cold or warm rent, buy needs a price", () => {
  assert.ok(validateListingInput({ ...rent, coldRent: undefined }).errors.some(e => e.startsWith("coldRent:")));
  assert.ok(validateListingInput({ ...buy, price: undefined }).errors.some(e => e.startsWith("price:")));
  assert.ok(validateListingInput({ ...rent, coldRent: -5 }).errors.some(e => e.startsWith("coldRent:")));
});

test("optional fields are checked by type and range", () => {
  const ok = { ...rent, deposit: 2250, takeover: 0, floor: 3, lift: true, outdoor: "balcony", kitchen: true, petsAllowed: false, availableFrom: "2026-12-01", wbsRequired: false, contactName: "Ms Example", contactType: "agent", notes: "Viewing on Friday" };
  assert.deepEqual(validateListingInput(ok).errors, []);
  const bad = validateListingInput({ ...rent, floor: 2.5, lift: "yes", outdoor: "roof", kitchen: 1, petsAllowed: "no", availableFrom: "2026-02-30", wbsRequired: "yes", contactType: "friend", notes: 5, rooms: 2.3, size: 0 });
  for (const k of ["floor", "lift", "outdoor", "kitchen", "petsAllowed", "availableFrom", "wbsRequired", "contactType", "notes", "rooms", "size"]) assert.ok(bad.errors.some(e => e.startsWith(k + ":")), k);
});

test("unknown fields are rejected on add and edit", () => {
  assert.ok(validateListingInput({ ...rent, fuel: "diesel" }).errors.some(e => e.startsWith("fuel:")));
  assert.ok(validateListingInput({ status: "accepted" }, { partial: true }).errors.some(e => e.startsWith("status:")));
});

test("partial edit checks only the fields present and allows clearing optional ones", () => {
  assert.deepEqual(validateListingInput({ coldRent: 800 }, { partial: true }).errors, []);
  assert.deepEqual(validateListingInput({ floor: null, notes: null, utilities: null }, { partial: true }).errors, []);
  const bad = validateListingInput({ title: "", url: "http://x.example/1", rooms: null }, { partial: true });
  assert.equal(bad.errors.length, 3);
  assert.equal(validateListingInput(null, { partial: true }).value, null);
});
