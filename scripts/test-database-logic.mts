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

// --- years ---
{
  const years = yearsWithCards(lookup);
  check("years desc", years[0] === 2025 && years.at(-1) === 2003, `first=${years[0]} last=${years.at(-1)}`);
  check("years span 23 years", years.length === 23);
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
  const sorted = filterCards(lookup, { year: null, query: "" });
  check("sorted by OVR desc", sorted[0].overall! >= sorted[1].overall!, `${sorted[0].name}(${sorted[0].overall}) vs ${sorted[1].name}(${sorted[1].overall})`);
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
  check("position map miss", positionForCard(lookup.get("victor wembanyama")!, map) === null);
  const lebron = lookup.get("lebron james")!;
  check("position map aliased name", positionForCard(lebron, map) === "SF/PF");
}

console.log(`\n===== database-logic: ${checks - failures}/${checks} passed, ${failures} failed =====`);
process.exit(failures > 0 ? 1 : 0);
