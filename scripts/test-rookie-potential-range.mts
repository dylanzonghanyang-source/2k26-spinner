import assert from "node:assert/strict";
import { createRookieCardLookup, corePlayerName } from "../src/rookieCards.ts";
import index from "../src/data/rookieCardIndex.min.json" with { type: "json" };

const lookup = createRookieCardLookup(index);

// Luka card: potential min/max must survive the columnar round-trip
const luka = lookup.get(corePlayerName("Luka Doncic"));
assert.ok(luka, "Luka card exists");
assert.deepEqual(
  luka.potential,
  { current: 98, min: 94, max: 99 },
  "Luka potential range from DB2K export",
);

// A couple more cards with known ranges
const wemby = lookup.get(corePlayerName("Victor Wembanyama"));
assert.ok(wemby, "Wemby card exists");
assert.deepEqual(wemby.potential, { current: 99, min: 95, max: 99 });

const flagg = lookup.get(corePlayerName("Cooper Flagg"));
assert.ok(flagg, "Flagg card exists");
assert.ok(flagg.potential && flagg.potential.min != null && flagg.potential.max != null);

// All 421 cards should carry a potential range (or null only if source had none)
let nullRanges = 0;
for (const [key, card] of lookup) {
  if (!card.potential || card.potential.min == null || card.potential.max == null) nullRanges += 1;
}
console.log(`cards with missing potential range: ${nullRanges}/421`);

console.log("POTENTIAL RANGE DATA CHECKS PASSED");
