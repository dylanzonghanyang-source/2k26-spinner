#!/usr/bin/env node
/**
 * Audit Revision #1 — OFFICIAL set diff。
 * 找出 666 (classification) vs 667 (position/band aggregation) 差异样本。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];

const coreName = (raw) => String(raw ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i")
  .toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

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
    cards.push({ ...c, year: Number(year) });
  }
}

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

// Set A: classification OFFICIAL（全部卡条目，不去重）
const setA = cards.filter((c) => classify(c) === "OFFICIAL");
// Set B: position aggregation（审计脚本 byPos 逻辑：OFFICIAL + position 可解析）
const setB = cards.filter((c) => classify(c) === "OFFICIAL" && positions.includes(String(c.position ?? "").split("/")[0]));
// Set C: OVR band aggregation（byBand 逻辑）
const setC = cards.filter((c) => classify(c) === "OFFICIAL" && typeof c.overall === "number");

console.log("Set A (classification OFFICIAL):", setA.length);
console.log("Set B (position agg):", setB.length);
console.log("Set C (band agg):", setC.length);

// A vs B diff
const key = (c) => `${c.slug}@${c.year}`;
const keyA = new Set(setA.map(key));
const keyB = new Set(setB.map(key));
const keyC = new Set(setC.map(key));
const inA_notB = setA.filter((c) => !keyB.has(key(c)));
const inB_notA = setB.filter((c) => !keyA.has(key(c)));
const inA_notC = setA.filter((c) => !keyC.has(key(c)));
const inC_notA = setC.filter((c) => !keyA.has(key(c)));
console.log("\nA not in B:", inA_notB.length, inA_notB.map((c) => `${c.name}(${c.slug}@${c.year},pos=${c.position},ovr=${c.overall})`));
console.log("B not in A:", inB_notA.length, inB_notA.map((c) => `${c.name}(${c.slug}@${c.year},pos=${c.position},ovr=${c.overall})`));
console.log("A not in C:", inA_notC.length, inA_notC.map((c) => `${c.name}(${c.slug}@${c.year},pos=${c.position},ovr=${c.overall})`));
console.log("C not in A:", inC_notA.length, inC_notA.map((c) => `${c.name}(${c.slug}@${c.year},pos=${c.position},ovr=${c.overall})`));

// 重复 coreName 检查（同人多张卡都 OFFICIAL）
const byCore = new Map();
for (const c of setA) {
  const k = coreName(c.name);
  if (!byCore.has(k)) byCore.set(k, []);
  byCore.get(k).push(c);
}
const dupes = [...byCore.entries()].filter(([, l]) => l.length > 1);
console.log("\n重复 coreName（多张 OFFICIAL 卡）:", dupes.length);
for (const [k, l] of dupes) console.log(" ", k, "->", l.map((c) => `${c.slug}@${c.year} pos=${c.position} ovr=${c.overall}`).join(" | "));
