#!/usr/bin/env node
/**
 * Patch rookie draft picks to the official NBA Draft board.
 *
 * This script is idempotent: it loads the checked-in official draft board
 * fixture, normalizes player names, and rewrites rookies/{year}/*.json
 * vitals.draftPick to the official pick when the match is unique.
 *
 * Run: node scripts/patch-draft-picks.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cardsDir = path.join(root, "src/data/rookieCards");
const officialPath = path.join(root, "scripts/official-draft-picks-2019-2024.json");
const officialBoards = JSON.parse(readFileSync(officialPath, "utf8"));

function core(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function variants(name) {
  const c = core(name);
  const base = c.replace(/ (jr|sr|ii|iii)$/, "");
  return new Set([c, base, c.replace(/\s+/g, ""), base.replace(/\s+/g, "")].filter(Boolean));
}

function buildOfficialMap(year) {
  const map = new Map();
  for (const [pick, name] of Object.entries(officialBoards[year] ?? {})) {
    for (const variant of variants(name)) {
      if (!map.has(variant)) map.set(variant, Number(pick));
    }
  }
  return map;
}

let fixed = 0;
const report = [];

for (const year of readdirSync(cardsDir).filter((d) => /^\d{4}$/.test(d)).sort()) {
  if (!officialBoards[year]) continue;
  const officialMap = buildOfficialMap(year);
  for (const file of readdirSync(path.join(cardsDir, year)).filter((f) => f.endsWith(".json"))) {
    const filePath = path.join(cardsDir, year, file);
    const card = JSON.parse(readFileSync(filePath, "utf8"));
    const current = card.vitals?.draftPick;
    if (typeof current !== "number" || current <= 0) continue;
    const hits = [...variants(card.name)].map((variant) => officialMap.get(variant)).filter((value) => typeof value === "number");
    const unique = [...new Set(hits)];
    if (unique.length !== 1) continue;
    const target = unique[0];
    if (target !== current) {
      card.vitals.draftPick = target;
      writeFileSync(filePath, JSON.stringify(card, null, 2), "utf8");
      fixed += 1;
      report.push(`${year} | ${card.name} | ${current} → ${target}`);
    }
  }
}

console.log(`fixed ${fixed} cards`);
if (report.length) console.log(report.join("\n"));
