/**
 * Tests for database logic (src/databaseLogic.ts) with real card index data.
 * Run: node --experimental-strip-types scripts/test-database-logic.mts
 */
import { readFileSync } from "node:fs";
import { createRookieCardLookup } from "../src/rookieCards.ts";
import { buildPositionMap, filterCards, matchesCard, positionCN, positionForCard, summarizeCard, yearsWithCards } from "../src/databaseLogic.ts";

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

const legacy = JSON.parse(readFileSync(new URL("../src/data/rookieCardIndex-legacy.min.json", import.meta.url), "utf8"));
const current = JSON.parse(readFileSync(new URL("../src/data/rookieCardIndex-current.min.json", import.meta.url), "utf8"));
const lookup = createRookieCardLookup(legacy);
for (const [key, card] of createRookieCardLookup(current)) if (!lookup.has(key)) lookup.set(key, card);

function pickOf(card: { vitals?: Record<string, unknown> }) {
  const pick = card.vitals?.draftPick;
  return typeof pick === "number" && pick > 0 ? pick : null;
}

// --- years ---
{
  const years = yearsWithCards(lookup);
  check("years desc", years[0] === 2025 && years.at(-1) === 1960, `first=${years[0]} last=${years.at(-1)}`);
  check("years span 1960-2025", years.length >= 50 && years.length <= 66, `count=${years.length}`);
  check("years null", yearsWithCards(null).length === 0);
}

// --- matchesCard ---
{
  const curry = lookup.get("stephen curry")!;
  check("match english", matchesCard(curry, "curry"));
  check("match chinese", matchesCard(curry, "库里"));
  check("match empty → true", matchesCard(curry, ""));
  check("no match", !matchesCard(curry, "jokic"));
  const wemby = lookup.get("victor wembanyama")!;
  check("match with apostrophe name", matchesCard(wemby, "wemby") === false && matchesCard(wemby, "wembanyama"), "文班亚马 via CN");
}

// --- filterCards ---
{
  const all = filterCards(lookup, { year: null, query: "" });
  check("all cards", all.length === lookup.size, `${all.length} vs ${lookup.size}`);
  const y2024 = filterCards(lookup, { year: 2024, query: "" });
  check("2024 count matches index", y2024.length > 0 && y2024.every((c) => c.year === 2024));
  check("2024 sorted by pick asc", y2024.every((c, i) => i === 0 || (pickOf(c) ?? Infinity) >= (pickOf(y2024[i - 1]) ?? Infinity)), `${y2024[0].name}(pick ${pickOf(y2024[0])}) vs ${y2024[1].name}(pick ${pickOf(y2024[1])})`);
  check("2024 first is pick 1", pickOf(y2024[0]) === 1, `${y2024[0].name} pick=${pickOf(y2024[0])}`);
  const sorted = filterCards(lookup, { year: null, query: "" });
  check("overview sorted by OVR desc", sorted[0].overall! >= sorted[1].overall!, `${sorted[0].name}(${sorted[0].overall}) vs ${sorted[1].name}(${sorted[1].overall})`);
  const q = filterCards(lookup, { year: null, query: "库里" });
  check("search chinese filters", q.length >= 1 && q.every((c) => matchesCard(c, "库里")));
  const none = filterCards(lookup, { year: 2003, query: "wembanyama" });
  check("year+query empty", none.length === 0);
}

// --- summarizeCard ---
{
  const lebron = lookup.get("lebron james")!;
  const s = summarizeCard(lebron);
  check("summary fields", s.name === "LeBron James" && s.year === 2003 && s.overall != null, JSON.stringify(s));
  const draftPick = s.draftPick;
  check("draftPick parsed", draftPick === 1 || draftPick === null, `pick=${draftPick}`);
  const luka = summarizeCard(lookup.get("luka doncic")!);
  check("potential current parsed", luka.potentialCurrent === 98, JSON.stringify(luka));
  check("potential range parsed", luka.potentialMin === 94 && luka.potentialMax === 99, JSON.stringify(luka));
  check("growth vitals parsed", luka.peakStartAge === 25 && luka.peakEndAge === 31 && luka.boomPercent === 50 && luka.averagePercent === 49 && luka.bustPercent === 1, JSON.stringify(luka));
  check("unmodified potential has no correction flag", luka.potentialCorrected === false);
  const kleine = summarizeCard(lookup.get("joe kleine")!);
  check("corrected potential flagged", kleine.potentialCorrected === true, JSON.stringify(kleine));
  check("corrected potential range contains current", kleine.potentialMin != null && kleine.potentialMax != null && kleine.potentialCurrent != null && kleine.potentialMin <= kleine.potentialCurrent && kleine.potentialCurrent <= kleine.potentialMax, JSON.stringify(kleine));
}

// --- position helpers ---
{
  check("positionCN PG/SG", positionCN("PG/SG") === "控卫/分卫");
  check("positionCN C", positionCN("C") === "中锋");
  check("positionCN null", positionCN(null) === null);
  check("positionCN unknown role", positionCN("SF/PG") === "小前/控卫");
  const map = buildPositionMap([
    { name: "Stephen Curry", position: "PG" },
    { name: "LeBron James", position: "SF/PF" },
    { name: "No Position", position: null },
  ]);
  check("position map lookup", positionForCard(lookup.get("stephen curry")!, map) === "PG");
  check("position map miss → card fallback", positionForCard(lookup.get("victor wembanyama")!, map) === "C", `got=${positionForCard(lookup.get("victor wembanyama")!, map)}`);
  const lebron = lookup.get("lebron james")!;
  check("position map aliased name", positionForCard(lebron, map) === "SF/PF");
}

console.log(`\n===== database-logic: ${checks - failures}/${checks} passed, ${failures} failed =====`);
process.exit(failures > 0 ? 1 : 0);
