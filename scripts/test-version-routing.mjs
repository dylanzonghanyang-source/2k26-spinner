import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const appSource = readFileSync(join(root, "src/App.tsx"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 2K26 mode MUST use the 2K26 roster catalog (its own version's data), never
// the 2K27 catalog. 2K27 roster stays available only for the (disabled) 2K27
// entry.
assert(appSource.includes("rosterCatalog: rosterCatalog2k26 as RosterCatalogData"), "2K26 must use its native 2K26 roster catalog (not 2K27)");
assert(
  appSource.includes("const versionData2k26: VersionData =") || appSource.includes("const versionData2k26 ="),
  "2K26 version data must be a named const (lazy-2K27 refactor)",
);
assert(
  !/versionData2k26[\s\S]{0,400}rosterCatalog2k27/.test(appSource),
  "2K26 version data must not reference rosterCatalog2k27 anywhere",
);
// The 2K27 entry (still disabled) may only reference the 2K27 catalog.
assert(/loadVersionData2k27[\s\S]{0,600}rosterCatalog: rosterCatalog2k27 as RosterCatalogData/.test(appSource), "2K27 (disabled) entry keeps the 2K27 roster");
// 2K27 badges/players must be dynamic imports, not static top-level imports.
assert(
  /import\(["']\.\/data\/versions\/2k27-play-now\/badges\.json["'][^)]*\)/.test(appSource),
  "2K27 badge data must be dynamically imported (not in the initial bundle)",
);
assert(
  /import\(["']\.\/data\/versions\/2k27-play-now\/players\.json["'][^)]*\)/.test(appSource),
  "2K27 player data must be dynamically imported (not in the initial bundle)",
);
assert(!/import\s+\w+\s+from\s+["']\.\/data\/versions\/2k27-play-now\/badges\.json["']/.test(appSource), "2K27 badges must not be a static import");
assert(!/import\s+\w+\s+from\s+["']\.\/data\/versions\/2k27-play-now\/players\.json["']/.test(appSource), "2K27 players must not be a static import");
assert(/function getInitialDataVersion\(\): DataVersion\s*\{\s*return "2k26";/.test(appSource), "2K27 must not be restored from persisted browser state while disabled");
assert(/aria-label="2K27 数据（暂未开放）"[\s\S]*?disabled/.test(appSource), "the 2K27 UI entry must remain disabled");
assert(appSource.includes("availablePlayers={allPlayerPool}"), "manual mode must receive the shared latest-roster player pool");
assert(appSource.includes('selectionMode={appMode === "custom" ? "manual" : "random"}'), "custom mode must use manual source selection");

// --- Data-pack self-consistency: 2K26 roster players all have 2K26 detailed
// profiles and badge profiles; heights are sane and wingspan leaks fixed.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const roster26 = require("../src/data/versions/2k26/rosterCatalog.json");
const players26 = require("../src/data/versions/2k26/players.json");
const badges26 = require("../src/data/versions/2k26/badges.json");
const { default: index } = await import("../src/data/rookieCardIndex.min.json", { with: { type: "json" } });

function flattenRoster(roster) {
  const out = {};
  for (const team of roster.teams ?? []) for (const p of team.players ?? []) out[p.id] = p;
  return out;
}
function parseHeightInches(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d+)'(\d+)"$/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

const p26 = flattenRoster(roster26);
assert(roster26.version === "NBA 2K26", "2K26 roster version label");
assert(Object.keys(p26).length === 495, `2K26 roster must have 495 players, got ${Object.keys(p26).length}`);
assert(players26.length === 495, `2K26 detailed players must be 495, got ${players26.length}`);
const playerBySlug = new Map(players26.map((p) => [p.slug, p]));
for (const id of Object.keys(p26)) {
  assert(playerBySlug.has(id), `2K26 roster player ${id} has no 2K26 detailed profile`);
  assert(badges26[id], `2K26 roster player ${id} has no 2K26 badge profile`);
}
const badgeSlugs = Object.keys(badges26);
for (const slug of badgeSlugs) assert(p26[slug], `2K26 badge profile ${slug} not in roster`);

// Height sanity: no value above 7'6" (90in) — wingspan leaks must be gone.
for (const [id, player] of Object.entries(p26)) {
  const h = parseHeightInches(player.height);
  assert(h != null && h >= 60 && h <= 90, `2K26 ${id} height ${player.height} out of sane range`);
}
assert(parseHeightInches(p26["mark-williams"].height) === 85, "mark-williams 7'1\" after wingspan-leak fix");
assert(parseHeightInches(p26["christian-koloko"].height) === 83, "christian-koloko 6'11\" after wingspan-leak fix");
assert(parseHeightInches(p26["danny-wolf"].height) === 83, "danny-wolf 6'11\" after height fix");

// Rookie-card index and 2K26 roster slugs must overlap consistently
// (cards keyed by core name; check a few anchors exist in the index).
const keys = new Set(index.keys ?? []);
for (const anchor of ["mark williams", "christian koloko"]) {
  assert(keys.has(anchor), `rookie card index must contain ${anchor}`);
}

console.log(`version routing OK: 2K26 -> native roster (${Object.keys(p26).length} players, all with detailed+badges), heights sane, 2K27 disabled entry intact`);
