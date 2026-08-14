#!/usr/bin/env node
/**
 * Review Patch #1 — identity universe 统一。
 * 回答：
 *   A. unique slug vs unique coreName 的区别（1800 文件 → slug? → coreName?）
 *   B. 交叉表合计 1799 vs canonical coreName 1797 的差
 *   C. NO_OVR 87 vs 85 的不一致
 *   D. ESTIMATED 集合算术：gap-source / override-estimated / intersection / union
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";

const coreName = (raw) => String(raw ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i")
  .toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const overrides = new Map();
for (const f of readdirSync(OVERRIDES_DIR)) {
  if (!/^\d{4}-overrides\.json$/.test(f)) continue;
  for (const [slug, v] of Object.entries(JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8")))) overrides.set(slug, v);
}

const files = [];
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    files.push({ ...c, year: Number(year), file: `${year}/${f}` });
  }
}
console.log("A. 文件条目总数:", files.length);

// unique slug
const bySlug = new Map();
for (const c of files) {
  if (!bySlug.has(c.slug)) bySlug.set(c.slug, []);
  bySlug.get(c.slug).push(c);
}
console.log("unique slug:", bySlug.size);
const multiSlug = [...bySlug.entries()].filter(([, l]) => l.length > 1);
console.log("  同 slug 多文件组:", multiSlug.length);
for (const [slug, l] of multiSlug) console.log("   ", slug, "->", l.map((c) => `${c.file}(ovr=${c.overall},src=${c.source})`).join(" | "));

// unique coreName
const byCore = new Map();
for (const c of files) {
  const k = coreName(c.name);
  if (!byCore.has(k)) byCore.set(k, []);
  byCore.get(k).push(c);
}
console.log("unique coreName:", byCore.size);
const multiCore = [...byCore.entries()].filter(([, l]) => l.length > 1);
console.log("  同 coreName 多文件组:", multiCore.length);
for (const [k, l] of multiCore) console.log("   ", k, "->", l.map((c) => `${c.file}(slug=${c.slug},ovr=${c.overall})`).join(" | "));

// 同 slug 不同 coreName 的组（slug 变体）
const slugCore = new Map();
for (const c of files) {
  const k = coreName(c.name);
  if (!slugCore.has(c.slug)) slugCore.set(c.slug, new Set());
  slugCore.get(c.slug).add(k);
}
const slugMultiCore = [...slugCore.entries()].filter(([, s]) => s.size > 1);
console.log("  同 slug 对应多个 coreName（slug 变体）:", slugMultiCore.length);
for (const [slug, s] of slugMultiCore.slice(0, 10)) console.log("   ", slug, "->", [...s].join(" | "));

// B. 交叉表合计 vs coreName
// canonical coreName 首见（最早年份）集合
const canonical = new Map();
for (const c of files) {
  const k = coreName(c.name);
  if (!canonical.has(k)) canonical.set(k, c);
}
console.log("\nB. canonical coreName（首见）:", canonical.size);

// C. NO_OVR 87 vs 85
// 87 = 之前按"全部文件条目 + 覆盖后"统计；85 = canonical 首见统计
function classify(card) {
  const ov = overrides.get(card.slug);
  const estFlag = ov?.estimated === true;
  const estSource = card.overallSource === "model-estimated-gap";
  if (estFlag || estSource) return "ESTIMATED";
  const effectiveOvr = ov?.overall != null ? ov.overall : card.overall;
  if (typeof effectiveOvr !== "number") return "NO_OVR";
  const isConfirmed = typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed");
  if (isConfirmed) return "OFFICIAL";
  return "AMBIGUOUS";
}
// 文件条目级
const entryCounts = {};
for (const c of files) entryCounts[classify(c)] = (entryCounts[classify(c)] ?? 0) + 1;
// canonical 级
const canonCounts = {};
for (const c of canonical.values()) canonCounts[classify(c)] = (canonCounts[classify(c)] ?? 0) + 1;
console.log("\nC. 文件条目级分类:", JSON.stringify(entryCounts), "sum:", Object.values(entryCounts).reduce((a, b) => a + b, 0));
console.log("   canonical 级分类:", JSON.stringify(canonCounts), "sum:", Object.values(canonCounts).reduce((a, b) => a + b, 0));

// 找出 canonical 中被条目级多算/少算的 NO_OVR 样本
const canonNoOvr = [...canonical.values()].filter((c) => classify(c) === "NO_OVR");
const entryNoOvr = files.filter((c) => classify(c) === "NO_OVR");
console.log("   canonical NO_OVR:", canonNoOvr.length, "| 条目级 NO_OVR:", entryNoOvr.length);
const entryNoOvrSlugs = new Set(entryNoOvr.map((c) => c.slug));
const canonNoOvrSlugs = new Set(canonNoOvr.map((c) => c.slug));
const onlyEntry = [...entryNoOvrSlugs].filter((s) => !canonNoOvrSlugs.has(s));
const onlyCanon = [...canonNoOvrSlugs].filter((s) => !entryNoOvrSlugs.has(s));
console.log("   条目级有 canonical 无（被 coreName 合并掉）:", onlyEntry.length, onlyEntry.slice(0, 10));
console.log("   canonical 有条目级无:", onlyCanon.length, onlyCanon.slice(0, 10));

// D. ESTIMATED 集合算术
const estAll = files.filter((c) => classify(c) === "ESTIMATED");
const estSlugs = new Set(estAll.map((c) => c.slug));
const gapSet = new Set(files.filter((c) => c.overallSource === "model-estimated-gap").map((c) => c.slug));
const ovEstSet = new Set();
for (const [slug, v] of overrides) if (v.estimated === true) ovEstSet.add(slug);
const inter = [...gapSet].filter((s) => ovEstSet.has(s));
console.log("\nD. ESTIMATED 集合算术（slug 级）:");
console.log("   gap-source set:", gapSet.size);
console.log("   override-estimated set:", ovEstSet.size);
console.log("   intersection:", inter.length, inter.slice(0, 10));
console.log("   union:", new Set([...gapSet, ...ovEstSet]).size);
console.log("   gap-only:", [...gapSet].filter((s) => !ovEstSet.has(s)).length);
console.log("   override-only:", [...ovEstSet].filter((s) => !gapSet.has(s)).length);
// 分类 ESTIMATED slug 与 union 的关系
console.log("   classify-ESTIMATED slug（文件级）:", estSlugs.size);
const unionSlugs = new Set([...gapSet, ...ovEstSet]);
const notEst = [...unionSlugs].filter((s) => !estSlugs.has(s));
console.log("   union 中不在 classify-ESTIMATED:", notEst.length, notEst.slice(0, 10));
// canonical（首见文件）级 ESTIMATED 与 slug 级对比
const canonEstSlugs = [...canonical.values()].filter((c) => classify(c) === "ESTIMATED").map((c) => c.slug);
console.log("   canonical ESTIMATED slug:", canonEstSlugs.length);
const canonMissing = [...estSlugs].filter((s) => !canonEstSlugs.includes(s));
const canonExtra = [...canonEstSlugs].filter((s) => !estSlugs.has(s));
console.log("   slug 级有 canonical 无:", canonMissing.length, canonMissing.slice(0, 10));
console.log("   canonical 有 slug 级无:", canonExtra.length, canonExtra.slice(0, 10));

function console_() {}
