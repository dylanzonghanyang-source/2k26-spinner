#!/usr/bin/env node
/**
 * Audit Revision #3b — 以 override.source 显式字段为正向 provenance 依据。
 * 关键发现：overrides 有 664 条 source="user-ui-confirmed-2026-08-08"
 * （用户 UI 确认标记），这是比"无 estimated 标记"更强的正向证明。
 *
 * 新分类逻辑：
 *   OFFICIAL  = override.source === "user-ui-confirmed-*"（显式用户确认）
 *   ESTIMATED = overrides[slug].estimated === true 或 overallSource=model-estimated-gap
 *   AMBIGUOUS = 其他有 overall 值但无正向 provenance
 *   NO_OVR    = 无可用 overall
 *
 * 并对比三种读取语义：
 *   (a) 卡文件 raw overall
 *   (b) index 语义（override 覆盖卡 overall，生产实际消费）
 *   (c) override 条目本身
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

// override 条目级统计
const ovStats = { confirmed: 0, estimated: 0, neither: 0, noOverall: 0 };
for (const [slug, v] of overrides) {
  const isConfirmed = typeof v.source === "string" && v.source.startsWith("user-ui-confirmed");
  const isEst = v.estimated === true;
  const hasOv = typeof v.overall === "number";
  if (isConfirmed) ovStats.confirmed++;
  if (isEst) ovStats.estimated++;
  if (!isConfirmed && !isEst && hasOv) ovStats.neither++;
  if (!hasOv) ovStats.noOverall++;
}
console.log("=== override 条目级 ===");
console.log("confirmed(source=user-ui-confirmed):", ovStats.confirmed);
console.log("estimated:true:", ovStats.estimated);
console.log("无 source 无 estimated 但有 OVR:", ovStats.neither);
console.log("无 OVR:", ovStats.noOverall);

// 卡文件加载（按 coreName 首见 = 正式卡）
const cards = [];
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    cards.push({ ...c, year: Number(year) });
  }
}
const byCore = new Map();
for (const c of cards) {
  const k = coreName(c.name);
  if (!byCore.has(k)) byCore.set(k, c);
}
const uniqueCards = [...byCore.values()];

// 语义 (b)：index 覆盖后 overall
function effectiveOverall(card) {
  const ov = overrides.get(card.slug);
  if (ov?.overall != null) return ov.overall;
  return typeof card.overall === "number" ? card.overall : null;
}

// 新分类（基于显式 source 字段 + index 覆盖语义）
function classifyV2(card) {
  const ov = overrides.get(card.slug);
  const isConfirmed = typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed");
  const isEst = ov?.estimated === true || card.overallSource === "model-estimated-gap";
  if (isEst) return "ESTIMATED";
  const ovr = effectiveOverall(card);
  if (ovr == null) return "NO_OVR";
  if (isConfirmed) return "OFFICIAL";
  // 无显式 source 字段但有 OVR：查是否为 gap-historic 且非 model-estimated（补采）
  if (card.source === "db2k-gap-historic" && card.overallSource !== "model-estimated-gap") return "OFFICIAL";
  return "AMBIGUOUS";
}

const counts = { OFFICIAL: 0, ESTIMATED: 0, AMBIGUOUS: 0, NO_OVR: 0 };
const byPos = {};
for (const c of uniqueCards) {
  const label = classifyV2(c);
  counts[label]++;
  if (label === "OFFICIAL") {
    const pos = String(c.position ?? "").split("/")[0];
    if (positions.includes(pos)) byPos[pos] = (byPos[pos] ?? 0) + 1;
  }
}
console.log("\n=== 正式卡（coreName 首见）+ index 覆盖语义 + source 字段分类 ===");
console.log("OFFICIAL:", counts.OFFICIAL, "| ESTIMATED:", counts.ESTIMATED, "| AMBIGUOUS:", counts.AMBIGUOUS, "| NO_OVR:", counts.NO_OVR);
console.log("byPos:", JSON.stringify(byPos), "sum:", Object.values(byPos).reduce((a, b) => a + b, 0));

// AMBIGUOUS 具体是谁
const amb = uniqueCards.filter((c) => classifyV2(c) === "AMBIGUOUS");
console.log("\nAMBIGUOUS 明细:", amb.length);
for (const c of amb) {
  const ov = overrides.get(c.slug);
  console.log(`  ${c.name}@${c.year} slug=${c.slug} cardOVR=${c.overall} effOVR=${effectiveOverall(c)} source=${c.source} ovrSrc=${c.overallSource ?? "none"} override=${JSON.stringify(ov)}`);
}

// 对比：s1 三集合一致性
const s1 = uniqueCards.filter((c) => classifyV2(c) === "OFFICIAL").map((c) => c.slug);
const s2 = uniqueCards.filter((c) => {
  if (classifyV2(c) !== "OFFICIAL") return false;
  return positions.includes(String(c.position ?? "").split("/")[0]);
}).map((c) => c.slug);
const s3 = uniqueCards.filter((c) => classifyV2(c) === "OFFICIAL" && typeof effectiveOverall(c) === "number").map((c) => c.slug);
console.log("\n=== 三集合一致性 ===");
console.log("S1 classification:", s1.length, "| S2 position:", s2.length, "| S3 band:", s3.length);
console.log("S1==S2:", JSON.stringify(s1) === JSON.stringify(s2), "| S1==S3:", JSON.stringify(s1) === JSON.stringify(s3));
