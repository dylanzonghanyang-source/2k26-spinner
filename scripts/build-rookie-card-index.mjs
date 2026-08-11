#!/usr/bin/env node
/**
 * Build rookie card indexes from all DB2K-exported cards.
 *
 * Input:  src/data/rookieCards/{year}/*.json   (converter output)
 * Output: rookieCardIndex.min.json (combined compatibility index), plus
 *         rookieCardIndex-legacy.min.json and rookieCardIndex-current.min.json
 *         for the runtime's split lazy chunks.
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
  // keep Jr/Sr/II/III so "Ron Harper" (1986) and "Ron Harper Jr." (2022)
  // are distinct index keys; NFKD accents; delete dots ("R.J." == "RJ")
  const n = String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
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

function buildIndex(cardList) {
  // Attribute field universe (union, but normally all 35 from the converter).
  const attrFields = [...new Set(cardList.flatMap((card) => Object.keys(card.detailed ?? {})))].sort();
  const tendFields = [...new Set(cardList.flatMap((card) => Object.keys(card.tendencies ?? {})))].sort();
  const vitalsFields = [...new Set(cardList.flatMap((card) => Object.keys(card.vitals ?? {})))].sort();
  const durabilityFields = [...new Set(cardList.flatMap((card) => Object.keys(card.durability ?? {})))].sort();
  const hotZoneFields = [...new Set(cardList.flatMap((card) => Object.keys(card.hotZones ?? {})))].sort();

  return {
    keys: cardList.map((card) => coreName(card.name)),
    slugs: cardList.map((card) => card.slug),
    years: cardList.map((card) => card.year),
    names: cardList.map((card) => card.name),
    positions: cardList.map((card) => card.position ?? null),
    overalls: cardList.map((card) => card.overall ?? null),
    attrs: {
      fields: attrFields,
      rows: cardList.map((card) => attrFields.map((field) => card.detailed?.[field] ?? null)),
    },
    tendencies: {
      fields: tendFields,
      rows: cardList.map((card) => tendFields.map((field) => card.tendencies?.[field] ?? null)),
    },
    badges: cardList.map((card) => (card.badges ?? []).map((badge) => [badge.name, badge.tier])),
    personalityBadges: cardList.map((card) => (card.personalityBadges ?? []).map((badge) => [badge.name, badge.tier])),
    potentials: cardList.map((card) => card.potential ?? null),
    dataQualities: cardList.map((card) => card.dataQuality ?? null),
    vitals: {
      fields: vitalsFields,
      rows: cardList.map((card) => vitalsFields.map((field) => card.vitals?.[field] ?? null)),
    },
    durability: {
      fields: durabilityFields,
      rows: cardList.map((card) => durabilityFields.map((field) => card.durability?.[field] ?? null)),
    },
    hotZones: {
      fields: hotZoneFields,
      rows: cardList.map((card) => hotZoneFields.map((field) => card.hotZones?.[field] ?? null)),
    },
  };
}

// Keep the combined index for offline scripts/tests and backwards compatibility.
// Production loading uses the split files below so each lazy chunk stays under
// the repository's 500 kB bundle budget. Legacy cards are split into broad year
// bands because the full pre-2018 index is now larger than the budget.
const index = buildIndex(unique);
const legacy = buildIndex(unique.filter((card) => card.year < 2018));
const legacyPre1990 = buildIndex(unique.filter((card) => card.year < 1990));
const legacy1990To2004 = buildIndex(unique.filter((card) => card.year >= 1990 && card.year <= 2004));
const legacy2005To2017 = buildIndex(unique.filter((card) => card.year >= 2005 && card.year < 2018));
const current = buildIndex(unique.filter((card) => card.year >= 2018));
const OUT_LEGACY = path.join(ROOT, "src", "data", "rookieCardIndex-legacy.min.json");
const OUT_LEGACY_PRE_1990 = path.join(ROOT, "src", "data", "rookieCardIndex-legacy-pre1990.min.json");
const OUT_LEGACY_1990_2004 = path.join(ROOT, "src", "data", "rookieCardIndex-legacy-1990-2004.min.json");
const OUT_LEGACY_2005_2017 = path.join(ROOT, "src", "data", "rookieCardIndex-legacy-2005-2017.min.json");
const OUT_CURRENT = path.join(ROOT, "src", "data", "rookieCardIndex-current.min.json");

fs.writeFileSync(OUT, JSON.stringify(index), "utf8");
fs.writeFileSync(OUT_LEGACY, JSON.stringify(legacy), "utf8");
fs.writeFileSync(OUT_LEGACY_PRE_1990, JSON.stringify(legacyPre1990), "utf8");
fs.writeFileSync(OUT_LEGACY_1990_2004, JSON.stringify(legacy1990To2004), "utf8");
fs.writeFileSync(OUT_LEGACY_2005_2017, JSON.stringify(legacy2005To2017), "utf8");
fs.writeFileSync(OUT_CURRENT, JSON.stringify(current), "utf8");
const bytes = fs.statSync(OUT).size;
const legacyBytes = fs.statSync(OUT_LEGACY).size;
const legacyPre1990Bytes = fs.statSync(OUT_LEGACY_PRE_1990).size;
const legacy1990To2004Bytes = fs.statSync(OUT_LEGACY_1990_2004).size;
const legacy2005To2017Bytes = fs.statSync(OUT_LEGACY_2005_2017).size;
const currentBytes = fs.statSync(OUT_CURRENT).size;
console.log(`rookieCardIndex.min.json: ${unique.length} unique cards (from ${cards.length} raw across ${years.length} years), ${(bytes / 1024).toFixed(1)} KB`);
console.log(`split indexes: legacy=${legacy.keys.length} cards / ${(legacyBytes / 1024).toFixed(1)} KB, current=${current.keys.length} cards / ${(currentBytes / 1024).toFixed(1)} KB`);
console.log(`legacy runtime chunks: pre1990=${legacyPre1990.keys.length} cards / ${(legacyPre1990Bytes / 1024).toFixed(1)} KB, 1990-2004=${legacy1990To2004.keys.length} cards / ${(legacy1990To2004Bytes / 1024).toFixed(1)} KB, 2005-2017=${legacy2005To2017.keys.length} cards / ${(legacy2005To2017Bytes / 1024).toFixed(1)} KB`);
console.log(`attr fields: ${index.attrs.fields.length}, tendency fields: ${index.tendencies.fields.length}`);
