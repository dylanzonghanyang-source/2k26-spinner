#!/usr/bin/env node
/**
 * One-time data fix: apply the HEIGHT_FIXES table to the committed 2K26
 * rosterCatalog (Mark Williams / Christian Koloko / Danny Wolf had their
 * wingspan stored in the height field by the third-party source snapshot).
 *
 * The same table lives in scripts/build-versioned-data.mjs so future
 * regenerations stay consistent. This script only patches the committed
 * output JSON.
 *
 * Run: node scripts/patch-2k26-height-fixes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "src", "data", "versions", "2k26", "rosterCatalog.json");

// Keep in sync with build-versioned-data.mjs HEIGHT_FIXES
const HEIGHT_FIXES = new Map([
  ["mark-williams", { inches: 85, note: "2K26 had wingspan 7'7\" in height; 2K27 says 7'1\"" }],
  ["christian-koloko", { inches: 83, note: "2K26 had wingspan 7'5\" in height; 2K27 says 6'11\"" }],
  ["danny-wolf", { inches: 83, note: "2K26 had 7'2\"; 2K27 says 6'11\"" }],
]);

function formatHeightInches(inches) {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

const roster = JSON.parse(fs.readFileSync(FILE, "utf8"));
let applied = 0;
for (const team of roster.teams ?? []) {
  for (const player of team.players ?? []) {
    const fix = HEIGHT_FIXES.get(player.id);
    if (fix) {
      console.log(`fix: ${player.id} ${player.height} -> ${formatHeightInches(fix.inches)} (${fix.note})`);
      player.height = formatHeightInches(fix.inches);
      applied++;
    }
  }
}
roster.heightAnomalies = roster.heightAnomalies ?? [];
fs.writeFileSync(FILE, JSON.stringify(roster, null, 2) + "\n", "utf8");
console.log(`patched ${applied} players in ${path.relative(ROOT, FILE)}`);
if (applied !== HEIGHT_FIXES.size) process.exitCode = 1;
