/**
 * Tests for rookie card browser logic (src/rookieCardBrowser.ts).
 * Run: node --experimental-strip-types scripts/test-rookie-card-browser.mts
 */
import { createRookieCardLookup, type RookieCard, type RookieCardLookup } from "../src/rookieCards.ts";
import { cardsByYear, slotAttrsForCard, slotValueForCard, yearsInLookup } from "../src/rookieCardBrowser.ts";
import { bundles } from "../src/createResult.ts";

let failures = 0;
let checks = 0;
function check(label: string, condition: boolean, detail = "") {
  checks++;
  if (!condition) {
    failures++;
    console.log(`❌ FAIL: ${label} ${detail}`);
  } else {
    console.log(`✅ pass: ${label}`);
  }
}

function mkCard(year: number, name: string, overall: number | null, detailed: Record<string, number>, potential: RookieCard["potential"] = null): RookieCard {
  return {
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    year,
    name,
    position: null,
    overall,
    detailed,
    tendencies: {},
    badges: [],
    personalityBadges: [],
    potential,
    dataQuality: null,
    vitals: {},
    durability: {},
    hotZones: {},
  };
}

// build a lookup from columnar index shape
function buildLookup(cards: RookieCard[]): RookieCardLookup {
  const index: any = {
    keys: [], slugs: [], years: [], names: [], overalls: [],
    attrs: { fields: ["Three-Point Shot", "Mid-Range Shot"], rows: [] },
    potentials: [],
  };
  for (const card of cards) {
    const key = card.name.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    index.keys.push(key);
    index.slugs.push(card.slug);
    index.years.push(card.year);
    index.names.push(card.name);
    index.overalls.push(card.overall);
    index.attrs.rows.push([card.detailed["Three-Point Shot"] ?? null, card.detailed["Mid-Range Shot"] ?? null]);
    index.potentials.push(card.potential);
  }
  return createRookieCardLookup(index);
}

const cards = [
  mkCard(2025, "Cooper Flagg", 82, { "Three-Point Shot": 78, "Mid-Range Shot": 75 }, { current: 96, min: 92, max: 99 }),
  mkCard(2025, "Ace Bailey", 80, { "Three-Point Shot": 72 }),
  mkCard(2024, "Zaccharie Risacher", 76, { "Three-Point Shot": 70, "Mid-Range Shot": 68 }),
  mkCard(2024, "No OVR Guy", null, { "Three-Point Shot": 60 }),
];
const lookup = buildLookup(cards);

// --- yearsInLookup ---
{
  const years = yearsInLookup(lookup);
  check("years desc order", JSON.stringify(years) === JSON.stringify([2025, 2024]), JSON.stringify(years));
  check("years null lookup", yearsInLookup(null).length === 0);
}

// --- cardsByYear ---
{
  const y25 = cardsByYear(lookup, 2025);
  check("2025 has 2 cards", y25.length === 2);
  check("2025 sorted by OVR desc", y25[0].name === "Cooper Flagg" && y25[1].name === "Ace Bailey", y25.map((c) => c.name).join(","));
  const y24 = cardsByYear(lookup, 2024);
  check("2024 null-OVR sorts last", y24.length === 2 && y24[1].name === "No OVR Guy", JSON.stringify(y24.map((c) => c.name)));
  check("unknown year empty", cardsByYear(lookup, 1999).length === 0);
  check("null lookup", cardsByYear(null, 2025).length === 0);
}

// --- slotValueForCard ---
{
  const three = bundles.find((b) => b.id === "three")!;
  const flagg = cards[0];
  check("three slot = 3PT value", slotValueForCard(flagg, three) === 78);
  const mid = bundles.find((b) => b.id === "mid")!;
  check("mid slot = avg of present attrs", slotValueForCard(flagg, mid) === 75, String(slotValueForCard(flagg, mid)));
  const noVal = mkCard(2025, "No Data", 70, {});
  check("no values → null", slotValueForCard(noVal, three) === null);
  const partial = cards[1]; // Ace Bailey: only 3PT=72
  check("mid slot with one missing attr averages present values", slotValueForCard(partial, mid) === null, String(slotValueForCard(partial, mid)));
  const potential = bundles.find((b) => b.id === "potential")!;
  check("potential slot = card potential current", slotValueForCard(flagg, potential) === 96, String(slotValueForCard(flagg, potential)));
}

// --- slotAttrsForCard ---
{
  const mid = bundles.find((b) => b.id === "mid")!;
  const attrs = slotAttrsForCard(cards[0], mid);
  check("slotAttrs lists both attrs", attrs.length === 2);
  check("slotAttrs values", attrs[0].attr === "Mid-Range Shot" && attrs[0].value === 75 && attrs[1].attr === "Free Throw" && attrs[1].value === null, JSON.stringify(attrs));
}

console.log(`\n===== rookie-card-browser: ${checks - failures}/${checks} passed, ${failures} failed =====`);
process.exit(failures > 0 ? 1 : 0);
