#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import { badgeTierCN, badgeTierRank, type BadgeTier } from "../src/badgeTiers.ts";

const tiers: BadgeTier[] = ["Bronze", "Silver", "Gold", "HOF", "Legendary"];
assert.deepEqual(tiers.map((tier) => badgeTierRank[tier]), [1, 2, 3, 4, 5]);
assert.equal(badgeTierCN.Legendary, "传奇");
assert.equal(badgeTierCN.HOF, "名人堂");

console.log("badge tier contract OK");
