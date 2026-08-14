#!/usr/bin/env node
/** Audit Revision #1b — 同 slug 多文件卡 + labelByCard 覆盖行为。 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";

const overrides = new Map();
for (const f of readdirSync(OVERRIDES_DIR)) {
  if (!/^\d{4}-overrides\.json$/.test(f)) continue;
  for (const [slug, v] of Object.entries(JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8")))) overrides.set(slug, v);
}

const cards = [];
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    cards.push({ ...c, year: Number(year), file: `${year}/${f}` });
  }
}

// 同 slug 多文件
const bySlug = new Map();
for (const c of cards) {
  if (!bySlug.has(c.slug)) bySlug.set(c.slug, []);
  bySlug.get(c.slug).push(c);
}
const dupSlug = [...bySlug.entries()].filter(([, l]) => l.length > 1);
console.log("同 slug 多文件组:", dupSlug.length);
for (const [slug, l] of dupSlug) {
  console.log(" ", slug, "->", l.map((c) => `${c.file} source=${c.source} ovr=${c.overall} os=${c.overallSource}`).join(" | "));
}

// 复现原审计 labelByCard 逻辑
const labelByCard = new Map();
for (const c of cards) labelByCard.set(c.slug, classify(c));
function classify(card) {
  const ov = overrides.get(card.slug);
  const estFlag = ov?.estimated === true;
  const estSource = card.overallSource === "model-estimated-gap";
  if (estFlag || estSource) return "ESTIMATED";
  if (typeof card.overall !== "number") return "NO_OVR";
  if (card.source === "db2k-draft-class" && ov?.overall != null && !estFlag) return "OFFICIAL";
  if (card.source === "db2k-gap-historic" && card.overallSource !== "model-estimated-gap") return "OFFICIAL";
  return "AMBIGUOUS";
}
// 原审计 byPos/byBand 循环（对 cards 遍历 + labelByCard 取 label）
const positions = ["PG", "SG", "SF", "PF", "C"];
const byPos = {}, byBand = {};
let officialEntries = 0, officialUnique = 0;
for (const c of cards) {
  const label = labelByCard.get(c.slug);
  if (label !== "OFFICIAL") continue;
  officialEntries++;
  const pos = String(c.position ?? "").split("/")[0];
  if (positions.includes(pos)) byPos[pos] = (byPos[pos] ?? 0) + 1;
  const band = c.overall < 70 ? "<70" : c.overall < 80 ? "70-79" : c.overall < 90 ? "80-89" : "90+";
  byBand[band] = (byBand[band] ?? 0) + 1;
}
officialUnique = [...new Set(cards.filter((c) => labelByCard.get(c.slug) === "OFFICIAL").map((c) => c.slug))].length;
console.log("\n原审计逻辑复现:");
console.log("  OFFICIAL 卡条目数（遍历计数）:", officialEntries);
console.log("  OFFICIAL 唯一 slug 数:", officialUnique);
console.log("  byPos:", JSON.stringify(byPos), "sum:", Object.values(byPos).reduce((a, b) => a + b, 0));
console.log("  byBand:", JSON.stringify(byBand), "sum:", Object.values(byBand).reduce((a, b) => a + b, 0));

// 若 dupSlug 中存在 OFFICIAL 且 label 相同 → 遍历计数 > 唯一数
