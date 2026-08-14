#!/usr/bin/env node
/**
 * Audit Revision #2 — classification × OVR availability 交叉表。
 *
 * 回答：ESTIMATED=999 与当前训练集 ESTIMATED=476 的关系。
 * 维度：
 *   - rookieCard.overall numeric（卡文件里 overall 有值）
 *   - override 中有 OVR 但 card 未 materialize（override 有值但无对应卡/卡 overall 未写入）
 *   - 无可用 OVR
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";

const overrides = new Map(); // slug -> { overall?, estimated? }
for (const f of readdirSync(OVERRIDES_DIR)) {
  if (!/^\d{4}-overrides\.json$/.test(f)) continue;
  for (const [slug, v] of Object.entries(JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8")))) overrides.set(slug, v);
}

const cards = [];
const cardBySlug = new Map();
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    cards.push({ ...c, year: Number(year) });
    if (!cardBySlug.has(c.slug)) cardBySlug.set(c.slug, c);
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

// ── 交叉表 ─────────────────────────────────────────────────────
// 行: classification；列: OVR availability
const rows = {};
for (const c of cards) {
  if (!rows[c.slug]) {
    const label = classify(c);
    rows[c.slug] = {
      slug: c.slug,
      name: c.name,
      label,
      cardOverallNumeric: typeof c.overall === "number",
      cardOverallSource: c.overallSource ?? null,
      overrideExists: overrides.has(c.slug),
      overrideOverall: typeof overrides.get(c.slug)?.overall === "number",
      overrideEstimated: overrides.get(c.slug)?.estimated === true,
    };
  }
}
const unique = Object.values(rows);
const table = {
  OFFICIAL: { cardNumeric: 0, overrideOnly: 0, none: 0 },
  ESTIMATED: { cardNumeric: 0, overrideOnly: 0, none: 0 },
  AMBIGUOUS: { cardNumeric: 0, overrideOnly: 0, none: 0 },
  NO_OVR: { cardNumeric: 0, overrideOnly: 0, none: 0 },
};
for (const r of unique) {
  const col = r.cardOverallNumeric ? "cardNumeric" : r.overrideOverall ? "overrideOnly" : "none";
  table[r.label][col]++;
}
console.log("=== classification × OVR availability（唯一 slug）===");
console.log("| label | card.overall numeric | override-only OVR | 无可用 OVR | total |");
for (const [label, cols] of Object.entries(table)) {
  console.log(`| ${label} | ${cols.cardNumeric} | ${cols.overrideOnly} | ${cols.none} | ${cols.cardNumeric + cols.overrideOnly + cols.none} |`);
}

// ── ESTIMATED 构成细化 ─────────────────────────────────────────
const est = unique.filter((r) => r.label === "ESTIMATED");
const estDetail = { gapSource: 0, overrideEstimated: 0, both: 0, gapOnly: 0, overrideOnly: 0 };
const estBySource = {};
for (const r of est) {
  const hasGap = r.cardOverallSource === "model-estimated-gap";
  const hasOvEst = r.overrideEstimated;
  if (hasGap && hasOvEst) estDetail.both++;
  else if (hasGap) estDetail.gapOnly++;
  else if (hasOvEst) estDetail.overrideOnly++;
  if (hasGap) estDetail.gapSource++;
  if (hasOvEst) estDetail.overrideEstimated++;
  const src = r.overrideOnly ? "override-est" : hasGap ? "gap-source" : "other";
  estBySource[src] = (estBySource[src] ?? 0) + 1;
}
console.log("\n=== ESTIMATED 构成 ===");
console.log("gap-source (overallSource=model-estimated-gap):", estDetail.gapSource);
console.log("override estimated=true:", estDetail.overrideEstimated);
console.log("  both:", estDetail.both, "| gap only:", estDetail.gapOnly, "| override only:", estDetail.overrideOnly);
console.log("by 来源:", JSON.stringify(estBySource));

// ── 为何训练集只有 476 张 ESTIMATED ────────────────────────────
// train-rookie-card-ovr.mts 条件: typeof c.overall === "number" 且 position 可解析
// → 需要卡文件里 overall 是 number
const trainSet = cards.filter((c) => typeof c.overall === "number");
const trainSlugs = new Set(trainSet.map((c) => c.slug));
const estInTrain = est.filter((r) => trainSlugs.has(r.slug));
const estNotInTrain = est.filter((r) => !trainSlugs.has(r.slug));
console.log("\n=== ESTIMATED vs 训练集 (overall numeric 卡) ===");
console.log("ESTIMATED 总数:", est.length);
console.log("进入训练集（卡 overall numeric）:", estInTrain.length);
console.log("未进入训练集:", estNotInTrain.length);
const notInTrainDetail = { overrideOnly: 0, cardNoOvr: 0, noPosition: 0 };
for (const r of estNotInTrain) {
  if (r.overrideOnly) notInTrainDetail.overrideOnly++;
  else if (!r.cardOverallNumeric) notInTrainDetail.cardNoOvr++;
  else notInTrainDetail.noPosition++;
}
console.log("未进入原因: override-only（卡未 materialize OVR）:", notInTrainDetail.overrideOnly,
  "| 卡无 numeric overall:", notInTrainDetail.cardNoOvr,
  "| 其他(position 等):", notInTrainDetail.noPosition);
console.log("样例 override-only（前 5）:", estNotInTrain.filter((r) => r.overrideOnly).slice(0, 5).map((r) => `${r.slug}(${r.overrideOverall})`).join(", "));
console.log("样例 card-no-ovr（前 5）:", estNotInTrain.filter((r) => !r.cardOverallNumeric && !r.overrideOnly).slice(0, 5).map((r) => `${r.slug}`).join(", "));
