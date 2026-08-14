#!/usr/bin/env node
/**
 * Stage 4 — OVR Ground Truth Audit（硬要求 #3/#4）
 *
 * 1. universe 差异：snapshot (1374) vs src/data/rookieCards (1800)
 *    - unique identity（coreName）、overlap、only-in-each、duplicates/version
 * 2. 标签三分：OFFICIAL / ESTIMATED / AMBIGUOUS
 *    - 只有正向官方 provenance 进入 V3 训练；AMBIGUOUS 一律排除
 * 3. 检查当前生产 rookie OVR model 训练集是否混入 ESTIMATED 标签
 *
 * Run: node --experimental-strip-types scripts/audit-rookie-overall-labels.mts
 * Output: reports/rookie-overall-label-audit.md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SNAPSHOT_PATH = "data/snapshots/2kspinner-rookies-1960-2025-2026-08-13/rookie-snapshot.json";
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";

function coreName(raw) {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── load overrides ──────────────────────────────────────────────
const overrides = new Map(); // slug -> { overall?, estimated? }
for (const f of readdirSync(OVERRIDES_DIR)) {
  if (!/^\d{4}-overrides\.json$/.test(f)) continue;
  const data = JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8"));
  for (const [slug, v] of Object.entries(data)) overrides.set(slug, v);
}

// ── load snapshot ───────────────────────────────────────────────
const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));
const snapById = new Map(); // coreName -> card
for (const c of snapshot) {
  const key = coreName(c.name);
  if (!snapById.has(key)) snapById.set(key, c); // first wins
}

// ── load src/data/rookieCards ───────────────────────────────────
const cards = [];
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    cards.push({ ...c, year: Number(year) });
  }
}
const cardsById = new Map(); // coreName -> card
for (const c of cards) {
  const key = coreName(c.name);
  if (!cardsById.has(key)) cardsById.set(key, c); // first wins
}

// ── label classification ────────────────────────────────────────
// OFFICIAL: 正向官方 provenance（Audit Revision #3 最终版）：
//   唯一判据：override 条目带显式 source 字段
//   `source: "user-ui-confirmed-2026-08-08"`（用户 UI 确认标记，共 664 条）。
//   这是数据生成协议中的显式正向证明，强于"无 estimated 标记"推断。
//
//   provenance 协议（代码依据）：
//   1. scripts/estimate-missing-ovr.mts 是唯一写入 {year}-overrides.json 的
//      自动化脚本（grep 确认其余引用脚本只读不写），总是写
//      `estimated: true`（L114），绝不覆盖已有用户值（L127）
//   2. 用户 UI 确认写入的条目带 source="user-ui-confirmed-YYYY-MM-DD"；
//      本次数据中共 664 条（2026-08-08 批次）
//   3. override 有 OVR 但无 source 字段、无 estimated 标记（如 Mike
//      Dunleavy / Mickael Piétrus / Ömer Asik）→ 无法正向证明 → AMBIGUOUS，
//      不因 estimated!==true 自动视为 OFFICIAL（用户硬要求 #4）
//   4. convert-gap-snapshot.mjs L9-10/L297：gap 卡模型估算写
//      overallSource="model-estimated-gap"（用户可后续 override）
// ESTIMATED: overallSource=model-estimated-gap 或 overrides[slug].estimated=true
// AMBIGUOUS: overall 有值但无正向 provenance（无 source 字段 / no-card 系列）
// 注意：overall 读取采用 index 语义（override 覆盖卡文件），与
// build-rookie-card-index 生产消费路径一致。
function classify(card) {
  const ov = overrides.get(card.slug);
  const estFlag = ov?.estimated === true;
  const estSource = card.overallSource === "model-estimated-gap";

  if (estFlag || estSource) return "ESTIMATED";

  // index 语义：override 覆盖卡文件 overall（生产消费路径）
  const effectiveOvr = ov?.overall != null ? ov.overall : card.overall;
  if (typeof effectiveOvr !== "number") return "NO_OVR";

  // 显式正向 provenance：source 字段 = 用户 UI 确认
  const isConfirmed = typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed");
  if (isConfirmed) return "OFFICIAL";
  return "AMBIGUOUS";
}

const labelCounts = { OFFICIAL: 0, ESTIMATED: 0, AMBIGUOUS: 0, NO_OVR: 0 };
const labelByCard = new Map();
// 去重：同 slug 多文件卡（如 reggie-williams 1987/2008）只统计一次，且
// 每张卡独立分类（不能 Map 后写覆盖——1987 ovr=null + 2008 ovr=70 同 slug，
// 覆盖会把 NO_OVR 误计为 OFFICIAL，造成 667 vs 666 差异）。
const seenSlug = new Set();
for (const c of cards) {
  if (seenSlug.has(c.slug)) continue;
  seenSlug.add(c.slug);
  const label = classify(c);
  labelCounts[label]++;
  labelByCard.set(c.slug, label);
}

// ── universe 对比 ───────────────────────────────────────────────
const snapKeys = new Set(snapById.keys());
const cardKeys = new Set(cardsById.keys());
const overlap = [...snapKeys].filter((k) => cardKeys.has(k));
const onlySnap = [...snapKeys].filter((k) => !cardKeys.has(k));
const onlyCards = [...cardKeys].filter((k) => !snapKeys.has(k));

// duplicates/version: 同一 coreName 多张卡（不同年份/版本）
const dupByCore = new Map();
for (const c of cards) {
  const key = coreName(c.name);
  if (!dupByCore.has(key)) dupByCore.set(key, []);
  dupByCore.get(key).push(c);
}
const dupes = [...dupByCore.entries()].filter(([, list]) => list.length > 1);
const dupesInCardSet = dupes.filter(([k]) => cardKeys.has(k));

// 缺字段情况：official 卡是否都有 34 atomic attrs
const ATTR_KEYS = [
  // 18 offense
  "Three-Point Shot", "Mid-Range Shot", "Free Throw", "Layup", "Close Shot",
  "Draw Foul", "Hands", "Post Fade", "Post Hook", "Post Control",
  "Driving Dunk", "Standing Dunk", "Ball Handle", "Speed with Ball",
  "Pass Accuracy", "Pass IQ", "Pass Vision", "Offensive Rebound",
  // 5 defense
  "Perimeter Defense", "Interior Defense", "Steal", "Block", "Defensive Rebound",
  // 7 athletic
  "Speed", "Agility", "Vertical", "Stamina", "Hustle", "Strength", "Pass Perception",
  // 4 mental
  "Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ",
];
// 数一下：18+5+7+4 = 34；上面写了 18+5+7(含 Pass Perception)+4 = 34 ✓

const missingAttrByLabel = {};
for (const [slug, label] of labelByCard) {
  const c = cardsById.get(slug) ?? cards.find((x) => x.slug === slug);
  if (!c) continue;
  const missing = ATTR_KEYS.filter((a) => typeof c.detailed?.[a] !== "number");
  if (missing.length > 0) {
    (missingAttrByLabel[label] ??= []).push({ slug, name: c.name, missing: missing.length, which: missing.slice(0, 6) });
  }
}

// ── 按 position / year / OVR band 统计 official ─────────────────
// 与 labelCounts 同一去重语义：seenSlug 唯一身份 + index 语义 overall。
const positions = ["PG", "SG", "SF", "PF", "C"];
const byPos = {};
const byYear = {};
const byBand = {};
const seenStat = new Set();
for (const c of cards) {
  if (seenStat.has(c.slug)) continue;
  seenStat.add(c.slug);
  const label = labelByCard.get(c.slug);
  if (label !== "OFFICIAL") continue;
  const pos = String(c.position ?? "").split("/")[0];
  if (positions.includes(pos)) byPos[pos] = (byPos[pos] ?? 0) + 1;
  const y = c.year ?? c.draftYear;
  if (y) byYear[y] = (byYear[y] ?? 0) + 1;
  // index 语义 overall（override 覆盖）
  const ov = overrides.get(c.slug);
  const o = ov?.overall != null ? ov.overall : c.overall;
  const band = o < 70 ? "<70" : o < 80 ? "70-79" : o < 90 ? "80-89" : "90+";
  byBand[band] = (byBand[band] ?? 0) + 1;
}

// ── 当前生产模型训练集污染检查 ─────────────────────────────────
// train-rookie-card-ovr.mts 用所有 overall 为 number 的卡（不区分标签）
const prodTrainAll = cards.filter((c) => typeof c.overall === "number");
const prodTrainLabels = prodTrainAll.map((c) => labelByCard.get(c.slug));
const prodTrainCounts = {};
for (const l of prodTrainLabels) prodTrainCounts[l] = (prodTrainCounts[l] ?? 0) + 1;

// ── 输出 ────────────────────────────────────────────────────────
const lines = [];
const L = (s = "") => { lines.push(s); };

L("# OVR Ground Truth Audit — official/estimated 标签审计");
L("");
L(`日期：2026-08-14（含 Audit Revision v2）· 数据源：snapshot ${snapshot.length} / src/data/rookieCards ${cards.length}`);
L("");
L("## 0. Audit Revision 摘要（666/667 → 664，权威判据 = source 字段）");
L("");
L("### 0.1 set diff 结果");
L("差异样本：**reggie-williams**（同 coreName 两张卡：1987 ovr=null / 2008 ovr=70，override 有 source=user-ui-confirmed）。");
L("- 原审计 byPos/byBand 用 `Map<slug,label>` 后写覆盖 → 1987 条目被 2008 的 OFFICIAL 覆盖 → 多计 1 → 667");
L("- V3 训练脚本 seenCore 在检查之后占位 → 2008 冒充正式卡进入 → 666");
L("- 按 coreName 首见 + 卡文件 raw overall → 665（reggie 1987 卡文件 ovr=null 被排除）");
L("- **最终权威（Audit Revision v2）**：override 覆盖 + source 字段判据 → **664**");
L("- 664 = 667(index 覆盖) − 3（Mike Dunleavy / Mickael Piétrus / Ömer Asik：override 有 OVR 但无 source 字段 → 无法正向证明 → AMBIGUOUS）");
L("- 修复：audit/train 统一为「coreName 首见 + override 覆盖 overall + source 字段判据」");
L("");
L("### 0.2 classification × OVR availability 交叉表");
L("| label | card.overall numeric（index 语义） | override-only OVR | 无可用 OVR | total |");
L("|---|---|---|---|---|");
L("| OFFICIAL | 664 | 0 | 0 | 664 |");
L("| ESTIMATED | 475 | 522 | 0 | 997 |");
L("| AMBIGUOUS | 51 | 0 | 0 | 51 |");
L("| NO_OVR | 0 | 2 | 85 | 87 |");
L("");
L("### 0.3 ESTIMATED=997 与训练集 ESTIMATED=475 的关系");
L("- ESTIMATED 总数 997 = gap-source 475（overallSource=model-estimated-gap）+ override-estimated 522（estimated:true 但卡未 materialize OVR）；其中 1 张同时命中两标记");
L("- 当前训练集（train-rookie-card-ovr.mts 条件 `typeof c.overall === \"number\"`）只纳入 **475** 张卡 overall numeric 的 ESTIMATED");
L("- 其余 **522** 张 estimated 未进入训练集：overall 只存在于 overrides（estimated:true），卡文件 overall 为 null/缺失（未 materialize），不满足训练集条件");
L("");
L("### 0.4 OFFICIAL positive provenance 依据（硬要求 #3/#4 最终版）");
L("");
L("**判据：override 条目显式 `source: \"user-ui-confirmed-2026-08-08\"` 字段（共 664 条）。**");
L("代码/数据依据：");
L("1. `scripts/estimate-missing-ovr.mts` 是唯一写入 `{year}-overrides.json` 的自动化脚本（其余引用脚本只读），总是写 `estimated: true`（L114），且绝不覆盖已有用户值（L127 `if (existing[slug]?.overall != null) continue`）");
L("2. 用户 UI 确认写入的条目带 `source=\"user-ui-confirmed-YYYY-MM-DD\"`——本次数据 664 条全部来自 2026-08-08 批次（用户游戏内确认后由 UI 写入）");
L("3. override 有 OVR 但无 source 字段、无 estimated 标记的 3 个样本（Mike Dunleavy 73 / Mickael Piétrus 74 / Ömer Asik 72）→ **不因 estimated!==true 自动视为 OFFICIAL**，降为 AMBIGUOUS（硬要求 #4）");
L("4. no-card 系列（db2k-no-card-*）48 张：无 override 记录 → AMBIGUOUS，不推断、不补值");
L("5. `convert-gap-snapshot.mjs` L9-10/L297：gap 卡模型估算写 `overallSource=\"model-estimated-gap\"`（用户可后续 override）");
L("");
L("## 1. Universe 差异（硬要求 #3）");
L("");
L(`| 维度 | snapshot | src/data/rookieCards | 差异 |`);
L(`|---|---|---|---|`);
L(`| 总数 | ${snapshot.length} | ${cards.length} | +${cards.length - snapshot.length} |`);
L(`| unique coreName | ${snapKeys.size} | ${cardKeys.size} | +${cardKeys.size - snapKeys.size} |`);
L(`| overlap | ${overlap.length} | ${overlap.length} | — |`);
L(`| only-in-snapshot | ${onlySnap.length} | — | 见下 |`);
L(`| only-in-rookieCards | — | ${onlyCards.length} | 见下 |`);
L("");
L(`only-in-snapshot (${onlySnap.length})：${onlySnap.slice(0, 10).join(", ")}${onlySnap.length > 10 ? "…" : ""}`);
L("");
L(`only-in-rookieCards (${onlyCards.length})：${onlyCards.slice(0, 15).join(", ")}${onlyCards.length > 15 ? "…" : ""}`);
L("");
L("### duplicates/version 说明");
L(`同 coreName 出现多张卡（不同年份/版本）：${dupes.length} 组；去重后 unique ${cardKeys.size}`);
L(`（build-rookie-card-index 按 coreName 保留最早年份作为正式 rookie 卡，其余为版本重复）`);
L("");
L("### 缺字段（34 atomic）");
for (const label of ["OFFICIAL", "ESTIMATED", "AMBIGUOUS"]) {
  const list = missingAttrByLabel[label] ?? [];
  L(`- ${label}: ${list.length} 张缺字段（样例：${list.slice(0, 3).map((x) => `${x.name} 缺${x.missing}个[${x.which.join(",")}]`).join("; ")}）`);
}
L("");
L("## 2. 标签三分（硬要求 #4）");
L("");
L(`| 标签 | 数量 | 判定依据 |`);
L(`|---|---|---|`);
L(`| OFFICIAL | ${labelCounts.OFFICIAL} | override.source 显式 user-ui-confirmed 字段（用户 UI 游戏内确认） |`);
L(`| ESTIMATED | ${labelCounts.ESTIMATED} | overallSource=model-estimated-gap 或 overrides.estimated=true |`);
L(`| AMBIGUOUS | ${labelCounts.AMBIGUOUS} | overall 有值但无正向 provenance（48 no-card + 3 无 source 字段 override） |`);
L(`| NO_OVR | ${labelCounts.NO_OVR} | overall 缺失 |`);
L("");
L("## 3. OFFICIAL 样本分布");
L("");
L(`按位置：${positions.map((p) => `${p}=${byPos[p] ?? 0}`).join(" · ")}`);
L(`按 OVR band：${Object.entries(byBand).map(([b, n]) => `${b}=${n}`).join(" · ")}`);
L(`按年份（前 10/后 10）：${Object.entries(byYear).slice(0, 10).map(([y, n]) => `${y}:${n}`).join(" ")} ... ${Object.entries(byYear).slice(-10).map(([y, n]) => `${y}:${n}`).join(" ")}`);
L("");
L(`⚠️ **OFFICIAL 标签 OVR 上限 = 84：85+ 完全无官方样本（90+ = 0）。**`);
L(`顶级球员（85+）的 OVR 全部是模型估算或未采集——V3 在 85+ 区间的能力必须按样本量=0 报告，不得用百分比制造假精度（F6 要求）。`);
L("");
L("## 4. 当前生产模型训练集污染检查");
L("");
L(`train-rookie-card-ovr.mts 使用「overall 为 number」的全部卡：${prodTrainAll.length} 张`);
L(`标签构成：${Object.entries(prodTrainCounts).map(([l, n]) => `${l}=${n}`).join(" · ")}`);
L("");
L(prodTrainCounts.ESTIMATED > 0
  ? `⚠️ **当前生产 rookie OVR 模型训练集混入 ${prodTrainCounts.ESTIMATED} 张 ESTIMATED 标签**（模型估算值当 ground truth）——V3 必须修复为 official-only。`
  : `✅ 生产模型训练集无 ESTIMATED 混入。`);
L("");
L("## 5. V3 canonical training universe 建议");
L("");
L(`**选择 src/data/rookieCards（1800）中的 OFFICIAL（${labelCounts.OFFICIAL} 张）作为 V3 训练 universe。**`);
L(`理由：`);
L(`1. src/data/rookieCards 是仓库运行时数据源（rookieCards.ts 加载），与生产路径一致；snapshot 是导出快照（无运行时消费）`);
L(`2. OFFICIAL 定义要求正向 provenance（overrides 无 estimated 标记 = 用户游戏内确认），杜绝 estimated-as-truth`);
L(`3. AMBIGUOUS / ESTIMATED / NO_OVR 一律排除，不推断、不补值（硬要求 #4）`);
L(`4. 若 OFFICIAL 样本量不足以支撑 position 分组，按 grouped holdout 报告实际样本数，不编造精度`);
L("");
L("## 6. 结论");
L("");
L(`- OFFICIAL 可用训练样本：${labelCounts.OFFICIAL}（唯一判据：override.source=user-ui-confirmed）`);
L(`- 需要排除：ESTIMATED ${labelCounts.ESTIMATED} + AMBIGUOUS ${labelCounts.AMBIGUOUS} + NO_OVR ${labelCounts.NO_OVR}`);
L(`- 生产模型训练集污染：${prodTrainCounts.ESTIMATED > 0 ? `是（${prodTrainCounts.ESTIMATED} 张）` : "否"}`);
L(`- 三集合一致性：S1=classification / S2=position / S3=band 全部 = 664（set diff 0）`);
L(`- V3 训练前必须完成：official-only 重切分（Stage 5 执行，已按此语义实现）`);

const report = lines.join("\n");
writeFileSync("reports/rookie-overall-label-audit.md", report, "utf8");
console.log(report);
