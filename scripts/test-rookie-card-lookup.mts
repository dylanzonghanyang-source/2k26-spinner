import assert from "node:assert/strict";
import { corePlayerName, createRookieCardLookup } from "../src/rookieCards.ts";
import index from "../src/data/rookieCardIndex.min.json" with { type: "json" };

// --- corePlayerName normalization ---
assert.equal(corePlayerName("Luka Doncic"), "luka doncic");
assert.equal(corePlayerName("Bronny James Jr."), "bronny james");
assert.equal(corePlayerName("Kevin Knox II"), "kevin knox");
assert.equal(corePlayerName("Robert Williams III"), "robert williams");
assert.equal(corePlayerName("Jae'Sean Tate"), "jae sean tate");
assert.equal(corePlayerName("De'Anthony Melton"), "de anthony melton");
assert.equal(corePlayerName("Mohamed Bamba"), "mohamed bamba");
console.log("corePlayerName OK");

// --- lookup construction ---
const lookup = createRookieCardLookup(index);
assert.equal(lookup.size, index.keys.length);
console.log(`lookup size: ${lookup.size}`);

// --- known cards ---
const luka = lookup.get(corePlayerName("Luka Doncic"));
assert.ok(luka, "Luka card exists");
assert.equal(luka.slug, "luka-doncic");
assert.equal(luka.year, 2018);
assert.equal(luka.overall, 81); // user UI-confirmed 2026-08-08 (overrides file)
assert.equal(luka.detailed["Mid-Range Shot"], 79);
assert.equal(luka.detailed["Three-Point Shot"], 84);
assert.equal(luka.potential?.current, 98);
// Full-record vitals (from the 2k26 球员全部字段 sheet mapping)
assert.equal(luka.vitals?.firstName, "Luka");
assert.equal(luka.vitals?.lastName, "Doncic");
assert.equal(luka.vitals?.jerseyNumber, 77);
assert.equal(luka.vitals?.birthMonth, 2);
assert.equal(luka.vitals?.birthDay, 28);
assert.equal(luka.vitals?.birthYear, 1999);
assert.equal(luka.vitals?.dominantHand, "Right");
assert.equal(luka.vitals?.playType1, "P&R Wing");
assert.equal(luka.vitals?.playForWinner, 100);
assert.equal(luka.vitals?.loyalty, 10);
assert.equal(luka.vitals?.financialSecurity, 11);
assert.equal(luka.durability?.head, 84);
assert.equal(luka.durability?.overall, 87);
assert.equal(luka.hotZones?.threeLeft, "Hot");
assert.equal(luka.hotZones?.midLeft, "Cold");
assert.ok(luka.personalityBadges?.length >= 1, "Luka has personality badges");
assert.ok(luka.tendencies["Shot Mid-Range"] !== undefined);
assert.ok(luka.badges.some((b) => b.name === "Float Game" && b.tier === "Silver"));
console.log("Luka card OK: mid=79, three=84, potential=98, overall=82");

const wemby = lookup.get(corePlayerName("Victor Wembanyama"));
assert.ok(wemby);
assert.equal(wemby.year, 2023);
assert.equal(wemby.detailed["Block"], 90);
assert.equal(wemby.overall, 84); // user UI-confirmed 2026-08-08
console.log("Wemby card OK: block=90, overall=84");

const bronny = lookup.get(corePlayerName("Bronny James Jr."));
assert.ok(bronny, "Bronny matches via core name");
assert.equal(bronny.slug, "bronny-james-jr");
console.log("Bronny card OK (suffix-stripped match)");

const brunson = lookup.get(corePlayerName("Jalen Brunson"));
assert.ok(brunson);
assert.equal(brunson.badges.length, 0, "Brunson has zero badges (user-confirmed)");
console.log("Brunson zero-badge OK");

// --- roster-side matching (players that appear in the 2K27 roster) ---
const rosterNames = [
  "Luka Doncic", "Trae Young", "Shai Gilgeous-Alexander", "Jalen Brunson",
  "Victor Wembanyama", "Bronny James", "Cooper Flagg", "Zaccharie Risacher",
  "Jalen Johnson", "Stephen Curry", "LeBron James", "Zion Williamson",
];
let matched = 0;
for (const name of rosterNames) {
  const card = lookup.get(corePlayerName(name));
  if (card) matched += 1;
  else console.log(`  NO CARD for roster player: ${name}`);
}
assert.equal(matched, rosterNames.length - 2, "Curry/LeBron (pre-2018 draft) expected missing");
console.log(`roster matching: ${matched}/${rosterNames.length} (Curry/LeBron pre-2018, expected no card)`);

console.log("\nALL ROOKIE CARD LOOKUP CHECKS PASSED");
