import assert from "node:assert/strict";
import { corePlayerName, createRookieCardLookup, loadRookieCards, lookupRookieCard } from "../src/rookieCards.ts";
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

// Case-insensitive alias matching: formatPlayerName() title-cases "R.J. Barrett"
// into "Rj Barrett" (period is not a splitter), which must still hit the alias
// table key "RJ Barrett".
const rj = lookupRookieCard(lookup, "Rj Barrett");
assert.ok(rj, "Rj Barrett (title-cased, lowercase j) matches via case-insensitive alias");
assert.equal(rj.slug, "r-j-barrett");
const rjCaps = lookupRookieCard(lookup, "RJ Barrett");
assert.equal(rjCaps?.slug, "r-j-barrett", "RJ Barrett (canonical alias key) still matches");
console.log("RJ Barrett case-insensitive alias OK (Rj/RJ/R.J. -> r-j-barrett)");

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

// 2003 draft class (collected 2026-08-08 from 2003_draft_class.json)
const lebron = lookup.get(corePlayerName("LeBron James"));
assert.ok(lebron, "LeBron card exists after 2003 collection");
assert.equal(lebron.year, 2003);
assert.equal(lebron.overall, 84); // user UI-confirmed
assert.equal(lebron.vitals?.draftPick, 1);
assert.equal(lebron.vitals?.jerseyNumber, 23);
assert.equal(lebron.vitals?.birthYear, 1984);
assert.equal(lebron.durability?.overall, 99);
console.log("LeBron 2003 card OK: pick=1, jersey=23, overall=84");

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
// Legacy 2003–2017 source-pool cards were added from the merged read-only export;
// Curry now has a 2009 card instead of being the expected missing case.
assert.equal(matched, rosterNames.length, "all sampled roster players should have rookie cards");
console.log(`roster matching: ${matched}/${rosterNames.length}`);

// Spot-check newly converted legacy cards. Cards whose OVR the user confirmed
// (2026-08-08 merge) must expose it; cards not yet confirmed stay null.
const legacyExpectations: [string, number, number | null][] = [
  ["Stephen Curry", 2009, 82],
  ["Nikola Jokic", 2014, 80],
  ["Jayson Tatum", 2017, 78],
  ["Dwight Howard", 2004, 79],
  ["Timofey Mozgov", 2008, 70],
  ["John Wall", 2010, 80],
  ["Seth Curry", 2013, 74],
  ["Brandon Roy", 2006, 76],
  ["Ivica Zubac", 2016, 69],
  ["Isaiah Hartenstein", 2017, 73],
];
for (const [name, year, expectedOverall] of legacyExpectations) {
  const card = lookup.get(corePlayerName(name));
  assert.ok(card, `${name} card exists`);
  assert.equal(card.year, year);
  assert.equal(card.overall, expectedOverall);
}
console.log("legacy spot checks OK: Curry 2009, Jokic 2014, Tatum 2017, Dwight 2004, Mozgov 2008, Wall 2010, Seth Curry 2013, Roy 2006, Zubac 2016, Hartenstein 2017");

// --- runtime split-index loader ---
const splitLookup = await loadRookieCards();
assert.equal(splitLookup.size, lookup.size, "split loader preserves combined lookup size");
for (const key of lookup.keys()) {
  assert.ok(splitLookup.has(key), `split loader contains ${key}`);
}
assert.equal(splitLookup.get(corePlayerName("LeBron James"))?.year, 2003);
assert.equal(splitLookup.get(corePlayerName("Luka Doncic"))?.year, 2018);
console.log(`split loader OK: ${splitLookup.size} cards across legacy/current chunks`);

console.log("\nALL ROOKIE CARD LOOKUP CHECKS PASSED");
