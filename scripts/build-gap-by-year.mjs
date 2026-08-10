/**
 * Regenerate gap checklist grouped by draft year.
 * Uses: data/raw/db2k/gap-collection-*.csv (players) + gap-draft-years.json (year annotations)
 * Output: data/raw/db2k/gap-by-year-YYYY-MM-DD.csv + .md
 * Run: node scripts/build-gap-by-year.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const rawDir = path.join(root, "data/raw/db2k");
const csvName = readdirSync(rawDir).filter((f) => /^gap-collection-\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort().at(-1);
if (!csvName) throw new Error("gap-collection CSV not found");
const lines = readFileSync(path.join(rawDir, csvName), "utf8").trim().split("\n").slice(1);
const yearsMap = JSON.parse(readFileSync(path.join(rawDir, "gap-draft-years.json"), "utf8")).players;

const players = lines.map((line) => {
  const [name, position, overall, teams, category] = line.split(",");
  return { name, position, overall: Number(overall), teams, category };
});

// match + annotate
const unannotated = [];
for (const p of players) {
  const year = yearsMap[p.name];
  if (year === undefined) { unannotated.push(p.name); p.year = "?"; }
  else p.year = year;
}
console.log(`未标注年份: ${unannotated.length} 人`, unannotated.slice(0, 10).join("、"));

// group
const groups = new Map();
for (const p of players) {
  const key = typeof p.year === "number" && p.year < 1960 ? "1960前(2K26不可采集)" : String(p.year);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p);
}
const order = (a, b) => {
  const rank = (k) => (k === "1960前(2K26不可采集)" ? -1 : k === "nocopyright" ? 0 : /^\d+$/.test(k) ? Number(k) : 9999);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 9999 && a < b) return -1;
  return a < b ? -1 : 1;
};
const sortedKeys = [...groups.keys()].sort(order);
const date = new Date().toISOString().slice(0, 10);

// CSV (one row per player, year first)
const csvRows = ["选秀年份,球员,位置,OVR,来源队"];
for (const key of sortedKeys) {
  for (const p of groups.get(key).sort((x, y) => y.overall - x.overall)) {
    csvRows.push(`${key},${p.name},${p.position},${p.overall},${p.teams}`);
  }
}
writeFileSync(path.join(rawDir, `gap-by-year-${date}.csv`), csvRows.join("\n"), "utf8");

// MD
const md = [`# 缺口球员采集清单（按选秀年份 · ${date}）`, ""];
for (const key of sortedKeys) {
  const members = groups.get(key).sort((x, y) => y.overall - x.overall);
  md.push(`## ${key}（${members.length} 人）`, "");
  md.push("| 球员 | 位置 | OVR | 来源队 |", "|------|------|-----|--------|");
  for (const p of members) md.push(`| ${p.name} | ${p.position} | ${p.overall} | ${p.teams} |`);
  md.push("");
}
writeFileSync(path.join(rawDir, `gap-by-year-${date}.md`), md.join("\n"), "utf8");

console.log(`按年份分组完成：${sortedKeys.length} 组`);
for (const key of sortedKeys) console.log(`  ${key}: ${groups.get(key).length} 人`);
