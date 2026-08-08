#!/usr/bin/env node
/**
 * Merge 2K26 in-game badge exports (from Amir0705/NBA-2K26-Tendency-Generator
 * data/2k_exports/*.txt) into src/data/badgeProfiles.2k26.json.
 *
 * Each export is a JSON dump of a player read from the game (categories.Badges:
 * {name: 0-4} where 0=none, 1=Bronze, 2=Silver, 3=Gold, 4=HOF).
 *
 * Existing profiles keep their data; exports ADD missing players and OVERRIDE
 * existing players with the in-game values (more authoritative than scraped).
 *
 * Usage: node scripts/merge-2k-exports.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src", "data");
const OUT = path.join(SRC, "badgeProfiles.2k26.json");
const OVERRIDES_OUT = path.join(SRC, "badgeProfiles.2k26.game-export.json");
const EXPORTS_DIR = process.argv[2] || "/tmp/2k_exports";

const TIER = { 0: null, 1: "Bronze", 2: "Silver", 3: "Gold", 4: "HOF" };

// Badge name -> category for names missing from the existing map.
const EXTRA_CATEGORIES = {
  "Ankle Breaker": "playmaking",
  "High Flying Denier": "athleticism",
  "Off Ball Pest": "defense",
  "On Ball Menace": "defense",
  "Post Up Poet": "inside",
  "Slippery Off Ball": "shooting",
  "Strong Handles": "playmaking",
};

// Non-canonical export spellings -> canonical project names (badgeBundleMap keys).
// Without this normalization real badges silently fail to map to any slot.
const ALIAS_TO_CANONICAL = {
  "Ankle Breaker": "Ankle Assassin",
  "High Flying Denier": "High-Flying Denier",
  "Off Ball Pest": "Off-Ball Pest",
  "On Ball Menace": "On-Ball Menace",
  "Post Up Poet": "Post-Up Poet",
  "Slippery Off Ball": "Slippery Off-Ball",
  "Strong Handles": "Strong Handle",
};

// Non-gameplay/personality badges that must never enter gameplay profiles.
const EXCLUDED_BADGES = new Set(["Marketability", "Work Ethic"]);

// Load existing badgeProfiles + category map
const profiles = JSON.parse(fs.readFileSync(OUT, "utf8"));
const nameCat = new Map();
for (const list of Object.values(profiles)) {
  for (const b of list) nameCat.set(b.name, b.category);
}

function categoryFor(name) {
  return nameCat.get(name) ?? EXTRA_CATEGORIES[name] ?? "general";
}

function slugify(file) {
  const slug = file.replace(/\.txt$/i, "").toLowerCase().replace(/\./g, "").replace(/[\s_]+/g, "-");
  return {
    "cj-mccullum": "cj-mccollum",
    "giannis-antetokumpo": "giannis-antetokounmpo",
    "kyle-fillipowski": "kyle-filipowski",
  }[slug] ?? slug;
}

const files = fs.readdirSync(EXPORTS_DIR).filter((f) => f.toLowerCase().endsWith(".txt"));
const overrides = {};
let added = 0;
let overridden = 0;
const merged = [];

for (const file of files) {
  const slug = slugify(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(EXPORTS_DIR, file), "utf8"));
  } catch {
    console.warn(`skip unparsable ${file}`);
    continue;
  }
  const badges = data?.categories?.Badges;
  if (!badges) continue;

  const list = Object.entries(badges)
    .filter(([, level]) => TIER[level])
    .map(([name, level]) => {
      const canonical = ALIAS_TO_CANONICAL[name] ?? name;
      return { name: canonical, category: categoryFor(canonical), tier: TIER[level] };
    })
    .filter((badge) => !EXCLUDED_BADGES.has(badge.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const existed = slug in profiles;
  if (existed) overridden++;
  else added++;
  profiles[slug] = list;
  overrides[slug] = list;
  merged.push(slug);
}

fs.writeFileSync(OUT, JSON.stringify(profiles, null, 2) + "\n");
fs.writeFileSync(OVERRIDES_OUT, JSON.stringify(Object.fromEntries(Object.entries(overrides).sort()), null, 2) + "\n");

console.log(JSON.stringify({
  exportedFiles: files.length,
  mergedPlayers: merged.length,
  addedNew: added,
  overridden: overridden,
  totalProfiles: Object.keys(profiles).length,
  sample: Object.fromEntries(Object.entries(profiles).filter(([k]) => k.includes("giannis") || k.includes("brunson"))),
}, null, 2));
