#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectTendenciesByBundle,
  createTendencyLoader,
  createTendencyLookup,
  type TendencyTable,
} from "../src/tendencies.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const table = JSON.parse(
  fs.readFileSync(path.join(root, "src", "data", "tendencyProfiles.min.json"), "utf8"),
) as TendencyTable;
const lookup = createTendencyLookup(table);

assert.equal(lookup.get("stephen-curry", "Shot Three"), 56);
assert.equal(lookup.get("giannis-antetokounmpo", "Driving Layup"), 26);
assert.equal(lookup.get("luka-doncic", "Driving Behind the Back"), undefined, "invalid source value 440 must remain absent");
assert.equal(lookup.get("missing-player", "Shot Three"), undefined);
assert.equal(lookup.get("stephen-curry", "missing-field"), undefined);
assert.equal(lookup.countFor("stephen-curry"), 96);
assert.equal(lookup.countFor("missing-player"), 0);

const inherited = collectTendenciesByBundle({
  sources: [
    { bundleId: "three", playerSlug: "stephen-curry" },
    { bundleId: "face", playerSlug: "giannis-antetokounmpo" },
    { bundleId: "custom", playerSlug: undefined },
  ],
  fieldToBundle: {
    "Shot Three": "three",
    "Driving Layup": "face",
    "Block Shot": "block",
  },
  lookup,
});
assert.deepEqual(inherited, {
  "Shot Three": 56,
  "Driving Layup": 26,
});

let importCalls = 0;
const loadLookup = createTendencyLoader(async () => {
  importCalls += 1;
  return { default: table };
});
const [firstLookup, secondLookup] = await Promise.all([loadLookup(), loadLookup()]);
assert.equal(importCalls, 1, "concurrent callers must share one table import");
assert.strictEqual(firstLookup, secondLookup, "loader must cache the decoded lookup");
assert.equal(firstLookup.get("stephen-curry", "Shot Three"), 56);

console.log("tendency lookup OK");
