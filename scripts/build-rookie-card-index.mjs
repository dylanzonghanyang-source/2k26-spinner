#!/usr/bin/env node
/**
 * Build src/data/rookieCards/index.min.json — a single compact index of all
 * DB2K-exported rookie cards, keyed by normalized player name for roster
 * matching.
 *
 * Input:  src/data/rookieCards/{year}/*.json   (converter output)
 * Output: src/data/rookieCardIndex.min.json
 *
 * Index shape (columnar to keep the lazy-loaded chunk small):
 *   {
 *     "keys":     [coreName, ...]            // match key (see coreName())
 *     "slugs":    [slug, ...]
 *     "years":    [2018, ...]
 *     "names":    ["Luka Doncic", ...]
 *     "overalls": [82, null, ...]            // UI-confirmed OVR or null
 *     "attrs":    { "fields": [...], "rows": [[v,...], ...] }   // 35 attrs
 *     "tendencies": { "fields": [...], "rows": [[v,...], ...] } // 96 fields
 *     "badges":   [ [["Dimer","Silver"],...], ... ]             // [name, tier]
 *     "potentials": [{ "current": 98, "min": 94, "max": 99 }, ...]
 *   }
 *
 * Run:  node scripts/build-rookie-card-index.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "src", "data", "rookieCards");
const OUT = path.join(ROOT, "src", "data", "rookieCardIndex.min.json");

/** Normalized match key: lowercase, strip punctuation & suffix (Jr/II/III...). */
function coreName(raw) {
  const n = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n;
}

const years = fs.readdirSync(CARDS_DIR)
  .filter((entry) => /^\d{4}$/.test(entry))
  .sort();

// UI-confirmed OVR overrides: data/raw/db2k/{year}-overrides.json (slug -> {overall})
// win over the per-card `overall` field, so user-filled tables flow into the index.
const OVERRIDES_DIR = path.join(ROOT, "data", "raw", "db2k");
function loadOverrides(year) {
  const file = path.join(OVERRIDES_DIR, `${year}-overrides.json`);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const cards = [];
for (const year of years) {
  const dir = path.join(CARDS_DIR, year);
  const overrides = loadOverrides(year);
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "review.json" || file === "capture-manifest.json") continue;
    const card = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const override = overrides[card.slug];
    if (override?.overall != null) card.overall = override.overall;
    cards.push({ ...card, year: Number(year) });
  }
}
cards.sort((a, b) => a.year - b.year || a.slug.localeCompare(b.slug));

// Deduplicate by core name (same player may appear in multiple years — e.g. a
// player drafted in 2018 also present in the 2025 export). Keep the earliest
// year (their actual rookie card).
const seen = new Map();
const unique = [];
for (const card of cards) {
  const key = coreName(card.name);
  if (seen.has(key)) continue;
  seen.set(key, card);
  unique.push(card);
}

// Attribute field universe (union, but normally all 35 from the converter).
const attrFields = [...new Set(unique.flatMap((card) => Object.keys(card.detailed ?? {})))].sort();
const tendFields = [...new Set(unique.flatMap((card) => Object.keys(card.tendencies ?? {})))].sort();
const vitalsFields = [...new Set(unique.flatMap((card) => Object.keys(card.vitals ?? {})))].sort();
const durabilityFields = [...new Set(unique.flatMap((card) => Object.keys(card.durability ?? {})))].sort();
const hotZoneFields = [...new Set(unique.flatMap((card) => Object.keys(card.hotZones ?? {})))].sort();

const index = {
  keys: unique.map((card) => coreName(card.name)),
  slugs: unique.map((card) => card.slug),
  years: unique.map((card) => card.year),
  names: unique.map((card) => card.name),
  overalls: unique.map((card) => card.overall ?? null),
  attrs: {
    fields: attrFields,
    rows: unique.map((card) => attrFields.map((field) => card.detailed?.[field] ?? null)),
  },
  tendencies: {
    fields: tendFields,
    rows: unique.map((card) => tendFields.map((field) => card.tendencies?.[field] ?? null)),
  },
  badges: unique.map((card) => (card.badges ?? []).map((badge) => [badge.name, badge.tier])),
  personalityBadges: unique.map((card) => (card.personalityBadges ?? []).map((badge) => [badge.name, badge.tier])),
  potentials: unique.map((card) => card.potential ?? null),
  vitals: {
    fields: vitalsFields,
    rows: unique.map((card) => vitalsFields.map((field) => card.vitals?.[field] ?? null)),
  },
  durability: {
    fields: durabilityFields,
    rows: unique.map((card) => durabilityFields.map((field) => card.durability?.[field] ?? null)),
  },
  hotZones: {
    fields: hotZoneFields,
    rows: unique.map((card) => hotZoneFields.map((field) => card.hotZones?.[field] ?? null)),
  },
};

fs.writeFileSync(OUT, JSON.stringify(index), "utf8");
const bytes = fs.statSync(OUT).size;
console.log(`rookieCardIndex.min.json: ${unique.length} unique cards (from ${cards.length} raw across ${years.length} years), ${(bytes / 1024).toFixed(1)} KB`);
console.log(`attr fields: ${attrFields.length}, tendency fields: ${tendFields.length}`);
