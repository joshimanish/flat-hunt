// lib/undo.js — targeted undo for a failed save. A request records an object's top-level fields before it changes them;
// afterwards `done()` notes exactly which fields it wrote (added, changed or removed) and returns the undo. The undo puts
// back a field only while it still holds what this request wrote, so writes other requests made meanwhile survive.
// Nested values must be replaced, not changed in place (the comparison is by identity).
function recordWrites(obj) {
  const before = new Map(Object.keys(obj).map(k => [k, obj[k]]));
  return function done() {
    const writes = [];
    for (const k of new Set([...before.keys(), ...Object.keys(obj)])) {
      const had = before.has(k), has = Object.hasOwn(obj, k);
      if (had !== has || (has && before.get(k) !== obj[k])) writes.push([k, had, before.get(k), has, obj[k]]);
    }
    const undo = () => {
      for (const [k, had, old, has, wrote] of writes) {
        if (Object.hasOwn(obj, k) !== has || (has && obj[k] !== wrote)) continue;
        if (had) obj[k] = old; else delete obj[k];
      }
    };
    undo.keys = writes.map(w => w[0]);
    return undo;
  };
}

module.exports = { recordWrites };
