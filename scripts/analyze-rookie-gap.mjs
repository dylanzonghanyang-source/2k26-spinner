/**
 * Gap analysis: 2K26 licensed drafted players (whitelist) vs collected rookie cards.
 * Run: node scripts/analyze-rookie-gap.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rawDir = path.join(root, "data/raw/db2k");
const legacy = JSON.parse(readFileSync(path.join(root, "src/data/rookieCardIndex-legacy.min.json"), "utf8"));
const current = JSON.parse(readFileSync(path.join(root, "src/data/rookieCardIndex-current.min.json"), "utf8"));

function coreName(raw) {
  // keep Jr/Sr/II/III suffixes (Ron Harper vs Ron Harper Jr. are distinct)
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// cards by year -> Map<coreName, card>
const cardsByYear = new Map();
for (const [i, y] of legacy.years.entries()) {
  if (!cardsByYear.has(y)) cardsByYear.set(y, new Map());
  cardsByYear.get(y).set(coreName(legacy.names[i]), { year: y, name: legacy.names[i], overall: legacy.overalls[i] ?? null });
}
for (const [i, y] of current.years.entries()) {
  if (!cardsByYear.has(y)) cardsByYear.set(y, new Map());
  cardsByYear.get(y).set(coreName(current.names[i]), { year: y, name: current.names[i], overall: current.overalls[i] ?? null });
}

// whitelists
const years = readdirSync(rawDir)
  .map((f) => f.match(/^(\d{4})-whitelist\.json$/)?.[1])
  .filter(Boolean)
  .map(Number)
  .sort((a, b) => a - b);

console.log("年份 | whitelist(有版权) | 已有卡 | 缺口 | 缺口名单");
console.log("-----|------------------|--------|------|---------");
let totalWl = 0, totalCards = 0, totalMissing = 0;
const allMissing = [];
for (const year of years) {
  const wlRaw = JSON.parse(readFileSync(path.join(rawDir, `${year}-whitelist.json`), "utf8"));
  const wlNames = wlRaw.map(coreName);
  const wlSet = new Set(wlNames);
  const cards = cardsByYear.get(year) ?? new Map();
  const missing = wlNames.filter((name) => !cards.has(name));
  const extra = [...cards.keys()].filter((name) => !wlSet.has(name));
  totalWl += wlNames.length;
  totalCards += cards.size;
  totalMissing += missing.length;
  if (missing.length || extra.length) {
    console.log(`${year} | ${wlNames.length} | ${cards.size} | ${missing.length} | ${missing.join("、")}${extra.length ? `  [多收:${extra.join("、")}]` : ""}`);
    allMissing.push({ year, missing });
  } else {
    console.log(`${year} | ${wlNames.length} | ${cards.size} | 0 | ✅ 全覆盖`);
  }
}
console.log("-----");
console.log(`合计 | ${totalWl} | ${totalCards} | ${totalMissing}`);
console.log("\n=== 缺口球员汇总 ===");
for (const { year, missing } of allMissing) {
  for (const name of missing) console.log(`${year} | ${name}`);
}

// OVR coverage per year (overrides files)
console.log("\n=== OVR 覆盖（user-confirmed） ===");
for (const year of years) {
  const ovrFile = path.join(rawDir, `${year}-overrides.json`);
  const ovrCount = existsSync(ovrFile) ? Object.keys(JSON.parse(readFileSync(ovrFile, "utf8"))).length : 0;
  const cards = cardsByYear.get(year) ?? new Map();
  const withOvr = [...cards.values()].filter((c) => c.overall != null).length;
  console.log(`${year}: 卡 ${cards.size} | 卡内 OVR ${withOvr} | overrides 文件 ${ovrCount}${ovrCount < cards.size ? " ⚠️" : ""}`);
}
