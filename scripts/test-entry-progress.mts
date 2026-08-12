import assert from "node:assert/strict";
import { clearEntrySet, entryFieldKey, entryStorageKey, loadEntrySet, saveEntrySet, toggleEntrySet } from "../src/entryProgress.ts";

// Node has no window: provide an in-memory mock so storage paths run.
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() { return memory.size; },
  },
};

const sig = "abc123";
const keyA = entryFieldKey("属性", "三分球");
const keyB = entryFieldKey("倾向", "切入倾向");

// 1. toggle round-trip
{
  let set = new Set<string>();
  set = toggleEntrySet(set, keyA);
  assert.equal(set.has(keyA), true, "toggle adds");
  set = toggleEntrySet(set, keyA);
  assert.equal(set.has(keyA), false, "toggle removes");
  set = toggleEntrySet(set, keyA);
  set = toggleEntrySet(set, keyB);
  assert.equal(set.size, 2, "independent keys");
  console.log("✅ toggle add/remove round-trip");
}

// 2. save -> load round-trip through storage
{
  const set = new Set([keyA, keyB]);
  saveEntrySet(sig, set);
  const loaded = loadEntrySet(sig);
  assert.equal(loaded.size, 2, "load restores both keys");
  assert.equal(loaded.has(keyA), true, "keyA persisted");
  assert.equal(loaded.has(keyB), true, "keyB persisted");
  console.log("✅ save/load round-trip");
}

// 3. signature isolation: different result, different keys
{
  const other = loadEntrySet("other-sig");
  assert.equal(other.size, 0, "signature isolation");
  assert.notEqual(entryStorageKey(sig), entryStorageKey("other-sig"), "storage keys differ");
  console.log("✅ signature isolation");
}

// 4. clear removes only this signature
{
  saveEntrySet(sig, new Set([keyA]));
  saveEntrySet("other-sig", new Set([keyB]));
  clearEntrySet(sig);
  assert.equal(loadEntrySet(sig).size, 0, "cleared");
  assert.equal(loadEntrySet("other-sig").size, 1, "other untouched");
  console.log("✅ clear is per-signature");
}

// 5. corrupted JSON degrades to empty set
{
  memory.set(entryStorageKey(sig), "{not-json");
  assert.equal(loadEntrySet(sig).size, 0, "corrupt JSON -> empty");
  memory.set(entryStorageKey(sig), JSON.stringify({ wrong: "shape" }));
  assert.equal(loadEntrySet(sig).size, 0, "wrong shape -> empty");
  console.log("✅ corrupted storage degrades safely");
}

// 6. storage blocked (no window.localStorage) degrades to empty set
{
  const originalWindow = (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).window;
  assert.equal(loadEntrySet("blocked-sig").size, 0, "blocked storage -> empty");
  saveEntrySet("blocked-sig", new Set([keyA])); // must not throw
  (globalThis as Record<string, unknown>).window = originalWindow;
  console.log("✅ blocked storage degrades without throwing");
}

console.log("\nALL ENTRY-PROGRESS CHECKS PASSED");
