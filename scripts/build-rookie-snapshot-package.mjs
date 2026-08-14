#!/usr/bin/env node
/**
 * Build the 1960-2025 rookie snapshot package:
 *   - snapshot JSON (full-field cards, from all-cards.min.json)
 *   - index JSON (rookieCardIndex.min.json)
 *   - manifest.json (counts, year coverage, generation metadata)
 *   - README.md (structure + usage)
 * Then compress the whole directory into a zip.
 *
 * Usage: node scripts/build-rookie-snapshot-package.mjs [--out DIR]
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_FILE = path.join(ROOT, "public", "data", "all-cards.min.json");
const INDEX_FILE = path.join(ROOT, "src", "data", "rookieCardIndex.min.json");
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT_DIR = getArg("--out") ?? path.join(ROOT, "data", "snapshots");

const stamp = new Date();
const stampStr = stamp.toISOString().slice(0, 10);
const pkgName = `2kspinner-rookies-1960-2025-${stampStr}`;
const pkgDir = path.join(OUT_DIR, pkgName);

// ---- Load sources ----
const cards = JSON.parse(fs.readFileSync(CARDS_FILE, "utf8"));
const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
if (!Array.isArray(cards) || cards.length === 0) throw new Error("empty cards");
if (index.keys?.length !== cards.length) throw new Error(`index/cards mismatch: ${index.keys?.length} vs ${cards.length}`);

// ---- Manifest stats ----
const years = {};
const sources = {};
const versions = {};
const positions = {};
let withHotZones = 0, withBadges = 0, withTendencies = 0, withDurability = 0, withVitals = 0, withDetailed = 0;
let overallCount = 0, overallSourceCount = {};
for (const c of cards) {
  const y = c.draftYear ?? c.year;
  years[y] = (years[y] ?? 0) + 1;
  sources[c.source ?? "unknown"] = (sources[c.source ?? "unknown"] ?? 0) + 1;
  versions[c.gameVersion ?? "unknown"] = (versions[c.gameVersion ?? "unknown"] ?? 0) + 1;
  if (c.position) positions[c.position] = (positions[c.position] ?? 0) + 1;
  if (c.hotZones && Object.keys(c.hotZones).length) withHotZones++;
  if (c.badges?.length) withBadges++;
  if (c.tendencies && Object.keys(c.tendencies).length) withTendencies++;
  if (c.durability && Object.keys(c.durability).length) withDurability++;
  if (c.vitals && Object.keys(c.vitals).length) withVitals++;
  if (c.detailed && Object.keys(c.detailed).length) withDetailed++;
  if (typeof c.overall === "number") {
    overallCount++;
    overallSourceCount[c.overallSource ?? "unknown"] = (overallSourceCount[c.overallSource ?? "unknown"] ?? 0) + 1;
  }
}
const yearNums = Object.keys(years).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
const missingYears = [];
for (let y = 1960; y <= 2025; y++) if (!years[y]) missingYears.push(y);

const manifest = {
  package: pkgName,
  generatedAt: stamp.toISOString(),
  scope: "1960-2025 rookie cards",
  totalCards: cards.length,
  yearRange: yearNums.length ? [yearNums[0], yearNums[yearNums.length - 1]] : null,
  yearsWithData: Object.keys(years).length,
  missingYears,
  cardsPerYear: Object.fromEntries(Object.entries(years).sort((a, b) => Number(a[0]) - Number(b[0]))),
  sources: sources,
  gameVersions: versions,
  positions: positions,
  fieldCoverage: {
    overall: overallCount,
    overallSourceBreakdown: overallSourceCount,
    vitals: withVitals,
    durability: withDurability,
    hotZones: withHotZones,
    badges: withBadges,
    tendencies: withTendencies,
    detailed: withDetailed,
  },
  indexFields: Object.keys(index),
  indexCardCount: index.keys?.length,
  cardSchema: Object.keys(cards[0]),
};

// ---- Write package ----
fs.mkdirSync(pkgDir, { recursive: true });
fs.writeFileSync(path.join(pkgDir, "rookie-snapshot.json"), JSON.stringify(cards, null, 2), "utf8");
fs.writeFileSync(path.join(pkgDir, "rookie-card-index.json"), JSON.stringify(index, null, 2), "utf8");
fs.writeFileSync(path.join(pkgDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

const readme = `# 2KSpinner Rookie Snapshot 1960-2025

生成时间: ${stamp.toISOString()}
卡片总数: ${cards.length}（覆盖 ${manifest.yearsWithData} 个选秀年份：${manifest.yearRange?.[0]}–${manifest.yearRange?.[1]}）

## 文件说明

| 文件 | 内容 |
|---|---|
| \`rookie-snapshot.json\` | 全量新秀卡快照，每张卡全字段（属性/倾向/徽章/热区/耐久/身体/潜力/来源等） |
| \`rookie-card-index.json\` | 索引（15 组字段：keys/slugs/years/names/positions/overalls/attrs/tendencies/badges/personalityBadges/potentials/dataQualities/vitals/durability/hotZones），数组下标一一对应 |
| \`manifest.json\` | 元数据：各年份卡数、来源分布、字段覆盖率、schema |

## 索引用法

\`rookie-card-index.json\` 中各数组按下标对齐，例如：

\`\`\`js
const idx = JSON.parse(fs.readFileSync("rookie-card-index.json", "utf8"));
// 第 i 张卡的信息：
idx.names[i];      // 英文名
idx.slugs[i];      // 唯一 slug（也用于关联快照中的卡）
idx.years[i];      // 选秀年份
idx.overalls[i];   // 综评
idx.attrs[i];      // 属性数组（35 个字段，与快照卡 detailed 对应）
\`\`\`

用 slug 在快照中取完整卡：\`snapshot.find(c => c.slug === slug)\`。

## 数据来源

- 原始卡源: \`src/data/rookieCards/{year}/*.json\`
- 构建: \`node scripts/build-all-cards.mjs\` + \`node scripts/build-rookie-card-index.mjs\`
- 打包: \`node scripts/build-rookie-snapshot-package.mjs\`

## 注意

- 缺少年份: ${missingYears.join(", ") || "无"}（这些年份无采集数据）
- OVR 部分为模型估算（见 manifest.fieldCoverage.overallSourceBreakdown），非官方实机值
`;
fs.writeFileSync(path.join(pkgDir, "README.md"), readme, "utf8");

// ---- Compress ----
const zipPath = path.join(OUT_DIR, `${pkgName}.zip`);
execFileSync("zip", ["-r", "-q", zipPath, pkgName], { cwd: OUT_DIR });
const zipStat = fs.statSync(zipPath);
console.log(`package: ${pkgDir}`);
console.log(`zip: ${zipPath} (${(zipStat.size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`cards: ${cards.length}, years: ${manifest.yearsWithData}, missing: ${missingYears.join(",") || "none"}`);
