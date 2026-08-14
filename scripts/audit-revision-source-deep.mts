#!/usr/bin/env node
/**
 * Audit Revision #3c — 深查 override source 字段真实性。
 * 问题：darrel-griffith(1980) 无 source、mike-dunleavy(1976) estimated:true，
 * 但之前统计说有 664 条 user-ui-confirmed。查同 slug 多文件覆盖。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const OVERRIDES_DIR = "data/raw/db2k";
const files = readdirSync(OVERRIDES_DIR).filter((f) => /^\d{4}-overrides\.json$/.test(f)).sort();

// 逐文件统计
const byFile = {};
const slugFiles = new Map(); // slug -> [ {year, value} ]
for (const f of files) {
  const year = f.slice(0, 4);
  const data = JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8"));
  for (const [slug, v] of Object.entries(data)) {
    if (!slugFiles.has(slug)) slugFiles.set(slug, []);
    slugFiles.get(slug).push({ year, value: v });
    const src = typeof v.source === "string" ? v.source : "no-source";
    byFile[`${year}:${src}`] = (byFile[`${year}:${src}`] ?? 0) + 1;
  }
}

// source 字段分布（按条目）
const srcCount = {};
for (const [, list] of slugFiles) {
  for (const { value } of list) {
    const src = typeof value.source === "string" ? value.source : "no-source";
    srcCount[src] = (srcCount[src] ?? 0) + 1;
  }
}
console.log("=== 全部 override 条目（含同 slug 多文件）source 分布 ===");
console.log(JSON.stringify(srcCount, null, 1));

// 同 slug 多文件覆盖（Map 语义 = 后加载覆盖）
const merged = new Map();
for (const f of files) {
  const data = JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8"));
  for (const [slug, v] of Object.entries(data)) merged.set(slug, v);
}
const mergedCount = { confirmed: 0, estimated: 0, noSource: 0 };
for (const [slug, v] of merged) {
  if (typeof v.source === "string" && v.source.startsWith("user-ui-confirmed")) mergedCount.confirmed++;
  else if (v.estimated === true) mergedCount.estimated++;
  else mergedCount.noSource++;
}
console.log("\n=== Map 合并（后写覆盖）后 ===");
console.log(JSON.stringify(mergedCount));

// 同 slug 多文件的冲突条目
console.log("\n=== 同 slug 出现在多个年份文件的 ===");
let conflicts = 0;
for (const [slug, list] of slugFiles) {
  if (list.length > 1) {
    conflicts++;
    console.log(`  ${slug}: ${list.map((x) => `${x.year}=${JSON.stringify(x.value)}`).join(" | ")}`);
  }
}
console.log("冲突组数:", conflicts);

// darrel-griffith / mike-dunleavy 具体
console.log("\ndarrel-griffith 所有条目:", JSON.stringify(slugFiles.get("darrel-griffith")));
console.log("mike-dunleavy 所有条目:", JSON.stringify(slugFiles.get("mike-dunleavy")));
console.log("reggie-williams 所有条目:", JSON.stringify(slugFiles.get("reggie-williams")));

// 每个年份文件里的 confirmed 数
console.log("\n=== 每文件 user-ui-confirmed 数 ===");
for (const f of files) {
  const data = JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8"));
  const n = Object.values(data).filter((v) => typeof v.source === "string" && v.source.startsWith("user-ui-confirmed")).length;
  if (n > 0) console.log(`  ${f}: ${n}`);
}
