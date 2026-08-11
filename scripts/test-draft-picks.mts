import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cardsRoot = path.join(root, "src/data/rookieCards");
const officialBoards = JSON.parse(readFileSync(path.join(root, "scripts/official-draft-picks-2019-2024.json"), "utf8")) as Record<string, Record<string, string>>;

function core(name: string) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function variants(name: string) {
  const c = core(name);
  const base = c.replace(/ (jr|sr|ii|iii)$/, "");
  return new Set([c, base, c.replace(/\s+/g, ""), base.replace(/\s+/g, "")].filter(Boolean));
}

function buildOfficialMap(year: string) {
  const map = new Map<string, number>();
  for (const [pick, name] of Object.entries(officialBoards[year] ?? {})) {
    for (const variant of variants(name)) {
      if (!map.has(variant)) map.set(variant, Number(pick));
    }
  }
  return map;
}

let checked = 0;

for (const year of Object.keys(officialBoards).sort()) {
  const officialMap = buildOfficialMap(year);
  for (const file of readdirSync(path.join(cardsRoot, year)).filter((entry) => entry.endsWith(".json"))) {
    const card = JSON.parse(readFileSync(path.join(cardsRoot, year, file), "utf8"));
    const current = card.vitals?.draftPick;
    if (typeof current !== "number" || current <= 0) continue;
    const hits = [...variants(card.name)].map((variant) => officialMap.get(variant)).filter((value): value is number => typeof value === "number");
    const unique = [...new Set(hits)];
    if (unique.length !== 1) continue;
    checked += 1;
    assert.equal(current, unique[0], `${year}/${file} draftPick mismatch for ${card.name}`);
  }
}

assert.ok(checked >= 250, `expected broad official draft-pick coverage, got ${checked}`);
console.log(`draft pick checks OK: ${checked} cards`);
