import assert from "node:assert/strict";
import { createRookieCardLookup, corePlayerName } from "../src/rookieCards.ts";
import index from "../src/data/rookieCardIndex.min.json" with { type: "json" };

const lookup = createRookieCardLookup(index);

// Known card ranges must survive the columnar round-trip.
const luka = lookup.get(corePlayerName("Luka Doncic"));
assert.ok(luka, "Luka card exists");
assert.deepEqual(
  luka.potential,
  { current: 98, min: 94, max: 99 },
  "Luka potential range from DB2K export",
);

const wemby = lookup.get(corePlayerName("Victor Wembanyama"));
assert.ok(wemby, "Wemby card exists");
assert.deepEqual(wemby.potential, { current: 99, min: 95, max: 99 });

const flagg = lookup.get(corePlayerName("Cooper Flagg"));
assert.ok(flagg, "Flagg card exists");
assert.ok(flagg.potential && flagg.potential.min != null && flagg.potential.max != null);

let missingRanges = 0;
let checkedRanges = 0;
for (const [key, card] of lookup) {
  const range = card.potential;
  if (!range || range.current == null || range.min == null || range.max == null) {
    missingRanges += 1;
    continue;
  }
  checkedRanges += 1;
  assert.ok(range.min <= range.max, `${key}: potential min must be <= max (${range.min}-${range.max})`);
  assert.ok(
    range.current >= range.min && range.current <= range.max,
    `${key}: potential current ${range.current} must be within ${range.min}-${range.max}`,
  );
}

assert.equal(missingRanges, 0, "all indexed rookie cards should carry a complete potential range");
console.log(`potential ranges OK: ${checkedRanges}/${lookup.size} cards, missing=${missingRanges}`);
console.log("POTENTIAL RANGE DATA CHECKS PASSED");
