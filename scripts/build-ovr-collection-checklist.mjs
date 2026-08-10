/**
 * Build the official-OVR collection checklist (model-estimated OVR cards).
 * Every listed player needs an in-game OVR; ★ players additionally have 4
 * discriminant attributes (3PT / Speed / Driving Dunk / Block) to verify.
 *
 * Run: node scripts/build-ovr-collection-checklist.mjs
 * Output: data/raw/db2k/ovr-collection-gap-YYYY-MM-DD.csv + .md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cardsDir = path.join(root, "src/data/rookieCards");
const date = new Date().toISOString().slice(0, 10);

const ATTR_KEYS = ["Three-Point Shot", "Speed", "Driving Dunk", "Block"];
const ATTR_CN = { "Three-Point Shot": "三分", Speed: "速度", "Driving Dunk": "扣篮", Block: "盖帽" };

const byYear = new Map();
for (const year of readdirSync(cardsDir).filter((d) => /^\d{4}$/.test(d))) {
  for (const file of readdirSync(path.join(cardsDir, year)).filter((f) => f.endsWith(".json") && !["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f))) {
    const c = JSON.parse(readFileSync(path.join(cardsDir, year, file), "utf8"));
    if (c.overallSource !== "model-estimated-gap") continue;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(c);
  }
}
const years = [...byYear.keys()].sort((a, b) => Number(a) - Number(b));
let total = 0;
for (const list of byYear.values()) total += list.length;

// ★ sample: highest-OVR player per year + 1 known star when OVR >= 85
const csv = ["年份,球员,位置,顺位,模型OVR,官方OVR,三分,速度,扣篮,盖帽,核对"];
const md = [`# 官方 OVR 补采清单（模型估算 · ${date}）`, "",
  `共 **${total}** 名球员（${years.length} 届）OVR 为模型估算，需游戏内确认。`, "",
  "操作：MyNBA → 对应选秀年份 → 球员卡 → 记录 OVR 填入下表。", "",
  "**★ 标记球员额外核对 4 个判别属性**（三分/速度/扣篮/盖帽），游戏内数值与导出一致即为正常，差异请标注。", ""];

for (const year of years) {
  const list = [...byYear.get(year)].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  const sampleCount = Math.min(2, list.length);
  const sampleKeys = new Set(list.slice(0, sampleCount).map((c) => c.name));
  md.push(`## ${year} 届（${list.length} 人）`, "", "| 球员 | 位置 | 顺位 | 模型OVR | 官方OVR | 三分 | 速度 | 扣篮 | 盖帽 | 核对 |", "|------|------|------|---------|---------|------|------|------|------|------|");
  for (const c of list) {
    const isSample = sampleKeys.has(c.name);
    const attrVals = ATTR_KEYS.map((k) => (isSample ? c.detailed[k] ?? "--" : "")).join("|");
    const star = isSample ? "★" : "";
    csv.push(`${year},${c.name},${c.position ?? ""},${c.vitals?.draftPick ?? ""},${c.overall ?? ""},,${attrVals},${star}`);
    md.push(`| ${c.name} ${star} | ${c.position ?? "--"} | ${c.vitals?.draftPick ?? "--"} | ${c.overall} |  | ${attrVals.replace(/\|/g, " | ")} | ${star} |`);
  }
  md.push("");
}

const csvPath = path.join(root, `data/raw/db2k/ovr-collection-gap-${date}.csv`);
const mdPath = path.join(root, `data/raw/db2k/ovr-collection-gap-${date}.md`);
writeFileSync(csvPath, csv.join("\n"), "utf8");
writeFileSync(mdPath, md.join("\n"), "utf8");
console.log(`checklist: ${total} players / ${years.length} years -> ovr-collection-gap-${date}.csv + .md`);
