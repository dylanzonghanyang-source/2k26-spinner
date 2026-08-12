#!/usr/bin/env node
/**
 * Build all-cards.min.json — full-field dump of every unique rookie card.
 *
 * Input:  src/data/rookieCards/{year}/*.json  (same sources as build-rookie-card-index.mjs)
 * Output: public/data/all-cards.min.json      (array of full card objects, year attached)
 *
 * Purpose: a zero-maintenance "API" for scripts/tools/AI agents. Fetch once,
 * filter locally — no backend process needed:
 *   curl -s https://2kspinner.com/data/all-cards.min.json \
 *     | jq '.[] | select(.name | test("Wembanyama"))'
 *
 * Dedup + OVR override rules MUST stay identical to build-rookie-card-index.mjs:
 *   - same coreName() normalization
 *   - earliest year wins when a player appears in multiple years
 *   - data/raw/db2k/{year}-overrides.json (slug -> {overall}) wins over card.overall
 *
 * Run:  node scripts/build-all-cards.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "src", "data", "rookieCards");
const OUT = path.join(ROOT, "public", "data", "all-cards.min.json");

/** Normalized match key — MUST stay in sync with build-rookie-card-index.mjs. */
function coreName(raw) {
  // keep Jr/Sr/II/III so "Ron Harper" (1986) and "Ron Harper Jr." (2022)
  // are distinct keys; NFKD accents; delete dots ("R.J." == "RJ")
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
// win over the per-card `overall` field, mirroring build-rookie-card-index.mjs.
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

// Deduplicate by core name — keep the earliest year (their actual rookie card),
// identical to build-rookie-card-index.mjs.
const seen = new Map();
const unique = [];
for (const card of cards) {
  const key = coreName(card.name);
  if (seen.has(key)) continue;
  seen.set(key, card);
  unique.push(card);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(unique), "utf8");

const bytes = fs.statSync(OUT).size;
console.log(
  `all-cards.min.json: ${unique.length} unique cards (from ${cards.length} raw across ${years.length} years), ${(bytes / 1024).toFixed(1)} KB`,
);
