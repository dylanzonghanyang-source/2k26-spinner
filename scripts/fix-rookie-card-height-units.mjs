#!/usr/bin/env node
/**
 * One-time data fix: normalize rookie-card heights that were stored as
 * centimeters (2019–2025 DB2K partial snapshots) into inches.
 *
 * Contract: card.height and card.vitals.heightInches must BOTH be inches in
 * [60, 100]. Values in [150, 250] are treated as centimeters and converted.
 * Anything else is reported as an anomaly (never silently rewritten).
 *
 * Run:  node scripts/fix-rookie-card-height-units.mjs [--dry-run]
 * After running, rebuild indexes:
 *   node scripts/build-rookie-card-index.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeHeightInches, isPlausibleHeightInches } from "./lib/height-units.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_ROOT = path.join(ROOT, "src", "data", "rookieCards");
const DRY_RUN = process.argv.includes("--dry-run");

let fixed = 0;
let anomalies = 0;
const anomalyList = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".json")) processCard(full);
  }
}

function processCard(file) {
  const card = JSON.parse(fs.readFileSync(file, "utf8"));
  const top = card.height;
  const vital = card.vitals?.heightInches;
  let changed = false;

  for (const [label, current] of [["card.height", top], ["vitals.heightInches", vital]]) {
    if (current == null) continue;
    const n = Number(current);
    if (!Number.isFinite(n)) continue;
    if (isPlausibleHeightInches(n)) continue; // already inches
    const normalized = normalizeHeightInches(n);
    if (normalized == null) {
      anomalies++;
      anomalyList.push(`${file}: ${label}=${n} out of plausible range, untouched`);
      continue;
    }
    if (label === "card.height") card.height = normalized;
    else card.vitals.heightInches = normalized;
    changed = true;
  }

  if (changed) {
    fixed++;
    if (!DRY_RUN) {
      fs.writeFileSync(file, JSON.stringify(card, null, 2) + "\n", "utf8");
    }
    console.log(`fix: ${path.relative(ROOT, file)} → top=${card.height}, vitals=${card.vitals?.heightInches}`);
  }
}

walk(CARDS_ROOT);
console.log(`\n${DRY_RUN ? "[dry-run] " : ""}fixed cards: ${fixed}`);
console.log(`anomalies: ${anomalies}`);
for (const a of anomalyList) console.log(`  ANOMALY ${a}`);
if (anomalies > 0) process.exitCode = 2;
