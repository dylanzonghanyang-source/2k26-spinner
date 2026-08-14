#!/usr/bin/env node
/**
 * Audit Revision #1c — 精确 set diff（权威语义：build-rookie-card-index 的
 * coreName 首见 = 正式 rookie 卡，与 V3 训练脚本一致）。
 * 对比三个集合：
 *   S1 = OFFICIAL classification（正式卡身份）
 *   S2 = OFFICIAL position aggregation
 *   S3 = OFFICIAL OVR-band aggregation
 *   S4 = V3 训练 samples（train-rookie-overall-v3.mts 实际加载）
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

// 按 coreName 首见（最早年份）选正式卡 —— 与 build-rookie-card-index 一致
const cards = [];
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    cards.push({ ...c, year: Number(year), file: `${year}/${f}` });
  }
}
const byCore = new Map();
for (const c of cards) {
  const k = coreName(c.name);
  if (!byCore.has(k)) byCore.set(k, c); // 首见 = 最早年份
}
const uniqueCards = [...byCore.values()];

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

// S1: OFFICIAL classification
const S1 = uniqueCards.filter((c) => classify(c) === "OFFICIAL").map((c) => c.slug);
// S2: position aggregation（OFFICIAL + position 可解析）
const S2 = uniqueCards.filter((c) => {
  if (classify(c) !== "OFFICIAL") return false;
  return positions.includes(String(c.position ?? "").split("/")[0]);
}).map((c) => c.slug);
// S3: OVR band aggregation
const S3 = uniqueCards.filter((c) => classify(c) === "OFFICIAL" && typeof c.overall === "number").map((c) => c.slug);
// S4: V3 训练样本（复现 train-rookie-overall-v3.mts 逻辑）
const S4 = [];
const seen = new Set();
for (const c of uniqueCards) {
  const k = coreName(c.name);
  if (seen.has(k)) continue;
  seen.add(k);
  const ov = overrides.get(c.slug);
  if (ov?.estimated === true || c.overallSource === "model-estimated-gap") continue;
  if (typeof c.overall !== "number") continue;
  const official = (c.source === "db2k-draft-class" && ov?.overall != null)
    || (c.source === "db2k-gap-historic" && c.overallSource !== "model-estimated-gap");
  if (!official) continue;
  const pos = String(c.position ?? "SF").split("/")[0];
  if (!positions.includes(pos)) continue;
  const attrs = ["Three-Point Shot", "Mid-Range Shot", "Free Throw", "Layup", "Close Shot",
    "Draw Foul", "Hands", "Post Fade", "Post Hook", "Post Control",
    "Driving Dunk", "Standing Dunk", "Ball Handle", "Speed with Ball",
    "Pass Accuracy", "Pass IQ", "Pass Vision", "Offensive Rebound",
    "Perimeter Defense", "Interior Defense", "Steal", "Block", "Defensive Rebound",
    "Speed", "Agility", "Vertical", "Stamina", "Hustle", "Strength", "Pass Perception",
    "Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ",
  ].map((a) => Number(c.detailed?.[a]) || 0);
  if (attrs.some((v) => v === 0)) continue;
  S4.push(c.slug);
}

const setOf = (arr) => new Set(arr);
const diff = (a, b, labelA, labelB) => {
  const onlyA = a.filter((x) => !setOf(b).has(x));
  const onlyB = b.filter((x) => !setOf(a).has(x));
  return { onlyA, onlyB };
};

console.log("S1 classification OFFICIAL:", S1.length);
console.log("S2 position agg:", S2.length);
console.log("S3 band agg:", S3.length);
console.log("S4 V3 training samples:", S4.length);

for (const [na, nb, A, B] of [
  ["S1", "S2", S1, S2],
  ["S1", "S3", S1, S3],
  ["S1", "S4", S1, S4],
  ["S2", "S4", S2, S4],
]) {
  const { onlyA, onlyB } = diff(A, B, na, nb);
  console.log(`\n[${na} vs ${nb}]`);
  console.log(`  only in ${na}: ${onlyA.length}`, onlyA.slice(0, 8).map((s) => {
    const c = uniqueCards.find((x) => x.slug === s);
    return `${s}@${c?.year}(ovr=${c?.overall},pos=${c?.position},src=${c?.source})`;
  }).join(" | "));
  console.log(`  only in ${nb}: ${onlyB.length}`, onlyB.slice(0, 8).map((s) => {
    const c = uniqueCards.find((x) => x.slug === s);
    return `${s}@${c?.year}(ovr=${c?.overall},pos=${c?.position},src=${c?.source})`;
  }).join(" | "));
}
