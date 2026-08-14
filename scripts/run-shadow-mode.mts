#!/usr/bin/env node
/**
 * Stage 6B-D — Shadow Mode：legacyControlOverall vs v3eDisplayOverall 对比。
 *
 * 不改变生成结果：createResult 已计算 v3eDisplayOverall（新增 display 字段），
 * 本脚本批量跑 createResult 并统计 delta = v3e − legacy。
 *
 * 批次：
 *   1. official 664（single-card / 官方卡 + 自身 attrs 构造 locks）
 *   2. rookie snapshot 1374（同卡 multi-slot 构造）
 *   3. 随机 multi-donor synthetic >= 10000（每卡随机 donor 混合）
 *   4. 现有典型/极端 fixtures（Mitchell dunk-only、Wemby、Jokić、全 custom 等）
 *
 * 报告：
 *   - delta distribution
 *   - |delta| = 0/1/2/3+ 占比
 *   - Top absolute delta cases
 *   - position / OVR band
 *   - legacy constraint trigger rate / offset distribution
 *   - V3-E 与 constraint trigger/offset 的相关（仅观察）
 *   - Intangibles 新旧策略 display OVR delta（I3→new policy）
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];

const coreName = (raw) => String(raw ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i")
  .toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const ATTRS = [
  "Three-Point Shot", "Mid-Range Shot", "Free Throw", "Layup", "Close Shot",
  "Draw Foul", "Hands", "Post Fade", "Post Hook", "Post Control",
  "Driving Dunk", "Standing Dunk", "Ball Handle", "Speed with Ball",
  "Pass Accuracy", "Pass IQ", "Pass Vision", "Offensive Rebound",
  "Perimeter Defense", "Interior Defense", "Steal", "Block", "Defensive Rebound",
  "Speed", "Agility", "Vertical", "Stamina", "Hustle", "Strength", "Pass Perception",
  "Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ",
];
const clamp = (v, lo = 25, hi = 99) => Math.max(lo, Math.min(hi, v));

const overrides = new Map();
for (const f of readdirSync(OVERRIDES_DIR)) {
  if (!/^\d{4}-overrides\.json$/.test(f)) continue;
  for (const [slug, v] of Object.entries(JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8")))) overrides.set(slug, v);
}

const cards = [];
const seen = new Set();
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    const key = coreName(c.name);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ ...c, year: Number(c.draftYear ?? 0), file: `${year}/${f}` });
  }
}

// V3-E display 模型（直接加载导出系数，模拟 createResult 的 display 路径）
const model = JSON.parse(readFileSync("src/data/rookieOverallV3E.json", "utf8"));
function v3eDisplay(attrs, int, pos) {
  const p = model.positions.includes(pos) ? pos : "SF";
  const m = model.perPosition[p];
  const x = [...attrs, int];
  return Math.round(Math.min(99, Math.max(40, m.intercept + x.reduce((t, v, j) => t + v * m.w[j], 0))));
}

// Legacy control（与 createResult 相同：rookie 版本 estimator，直接加载模型系数）
const legacyModel = JSON.parse(readFileSync("src/data/rookieOverallModel-rookie.json", "utf8"));
function legacyControl(attrs, int, pos, badges = []) {
  const p = legacyModel.positions[pos] ?? legacyModel.positions.SF;
  let est = p.intercept;
  const attrNames = legacyModel.attributes;
  for (let i = 0; i < attrNames.length; i++) {
    const name = attrNames[i];
    const v = name === "Intangibles" ? int : attrs[ATTRS.indexOf(name)];
    if (typeof v === "number") est += (p.coefficients?.[name] ?? 0) * v;
  }
  // 与 estimateGameOverall 一致：最终 clamp 到 [40, 99]
  return Math.round(Math.min(99, Math.max(40, est)));
}

// 生成批次输入
// 1. official 664：单卡全槽（非 potential）
const batch1 = cards.filter((c) => {
  const ov = overrides.get(c.slug);
  if (ov?.estimated === true || c.overallSource === "model-estimated-gap") return false;
  const eff = ov?.overall != null ? ov.overall : c.overall;
  return typeof eff === "number"
    && typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed")
    && positions.includes(String(c.position ?? "SF").split("/")[0]);
}).map((c) => ({
  kind: "official-single",
  name: c.name, position: String(c.position ?? "SF").split("/")[0],
  attrs: ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99)),
  int: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
  overall: overrides.get(c.slug)?.overall ?? c.overall,
}));

// 2. snapshot 1374：全部卡（含 estimated）
const snapshot = JSON.parse(readFileSync("data/snapshots/2kspinner-rookies-1960-2025-2026-08-13/rookie-snapshot.json", "utf8"));
const batch2 = snapshot.map((c) => ({
  kind: "snapshot",
  name: c.name, position: String(c.position ?? "SF").split("/")[0],
  attrs: ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99)),
  int: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
  overall: typeof c.overall === "number" ? c.overall : null,
}));

// 3. 随机 multi-donor synthetic 10000
const RNG = (seed) => {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
};
const batch3 = [];
for (let i = 0; i < 10000; i++) {
  const rnd = RNG(0xC0FFEE + i);
  const cardA = cards[Math.floor(rnd() * cards.length)];
  const cardB = cards[Math.floor(rnd() * cards.length)];
  const pos = positions[Math.floor(rnd() * 5)];
  const attrs = ATTRS.map((a, idx) => {
    const src = rnd() < 0.5 ? cardA : cardB;
    return clamp(Number(src.detailed?.[a]) || 0, 25, 99);
  });
  batch3.push({
    kind: "synthetic", name: `synth-${i}`, position: pos,
    attrs, int: 50,
    overall: null,
  });
}

// 4. fixtures
const fixtureBodies = {
  "Mitchell dunk-only": { pos: "PG", attrs: ATTRS.map((a) => a === "Driving Dunk" ? 97 : a === "Standing Dunk" ? 50 : 60), int: 60 },
  "Wemby tall": { pos: "C", attrs: ATTRS.map((a) => a === "Block" ? 99 : a === "Three-Point Shot" ? 80 : a === "Standing Dunk" ? 85 : 65), int: 98 },
  "Jokic playmaking C": { pos: "C", attrs: ATTRS.map((a) => a === "Pass Accuracy" ? 95 : a === "Pass IQ" ? 95 : a === "Post Control" ? 88 : 65), int: 80 },
  "All-99": { pos: "SF", attrs: ATTRS.map(() => 99), int: 99 },
  "All-25": { pos: "PG", attrs: ATTRS.map(() => 25), int: 25 },
};
const batch4 = Object.entries(fixtureBodies).map(([name, v]) => ({
  kind: "fixture", name, position: v.pos, attrs: v.attrs, int: v.int, overall: null,
}));

// ── 执行 shadow 计算 ───────────────────────────────────────────
const all = [...batch1, ...batch2, ...batch3, ...batch4];
const rows = [];
for (const s of all) {
  const legacy = legacyControl(s.attrs, s.int, s.position);
  const v3e = v3eDisplay(s.attrs, s.int, s.position);
  rows.push({ ...s, legacy, v3e, delta: v3e - legacy, absDelta: Math.abs(v3e - legacy) });
}

// ── 统计 ───────────────────────────────────────────────────────
const L = [];
const push = (s = "") => L.push(s);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
push("# Stage 6B-D — Shadow Mode：legacy control vs V3-E display");
push("");
push(`日期：2026-08-14 · 批次：official 664 / snapshot ${batch2.length} / synthetic ${batch3.length} / fixtures ${batch4.length} = ${rows.length}`);
push("delta = v3eDisplayOverall − legacyControlOverall（display 与 control 解耦后的差异）");
push("");

// 总体 delta 分布
const byKind = {};
for (const r of rows) (byKind[r.kind] ??= []).push(r);
for (const [kind, arr] of Object.entries(byKind)) {
  const mean = arr.reduce((a, b) => a + b.delta, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b.delta - mean) ** 2, 0) / arr.length);
  const z0 = arr.filter((r) => r.delta === 0).length;
  const z1 = arr.filter((r) => r.absDelta <= 1).length;
  const z2 = arr.filter((r) => r.absDelta <= 2).length;
  const z3 = arr.filter((r) => r.absDelta >= 3).length;
  push(`## ${kind}（n=${arr.length}）`);
  push("");
  push(`| 指标 | 值 |`);
  push("|---|---|");
  push(`| mean delta | ${mean.toFixed(2)} |`);
  push(`| std delta | ${sd.toFixed(2)} |`);
  push(`| min / max | ${Math.min(...arr.map((r) => r.delta))} / ${Math.max(...arr.map((r) => r.delta))} |`);
  push(`| \|delta\|=0 | ${z0} (${pct(z0 / arr.length)}) |`);
  push(`| \|delta\|≤1 | ${z1} (${pct(z1 / arr.length)}) |`);
  push(`| \|delta\|≤2 | ${z2} (${pct(z2 / arr.length)}) |`);
  push(`| \|delta\|≥3 | ${z3} (${pct(z3 / arr.length)}) |`);
  push("");
  // Top absolute delta
  const top = [...arr].sort((a, b) => b.absDelta - a.absDelta).slice(0, 10);
  push(`### Top absolute delta（${kind}）`);
  push("");
  push("| name | position | legacy | v3e | delta | int | overall |");
  push("|---|---|---|---|---|---|---|");
  for (const t of top) push(`| ${t.name} | ${t.position} | ${t.legacy} | ${t.v3e} | ${t.delta >= 0 ? "+" : ""}${t.delta} | ${t.int} | ${t.overall ?? "--"} |`);
  push("");
}

// position / OVR band（official 664 子集）
const off = rows.filter((r) => r.kind === "official-single" && typeof r.overall === "number");
push("## position breakdown（official）");
push("");
push("| position | n | mean delta | |delta|≥2 占比 |");
push("|---|---|---|---|");
for (const p of positions) {
  const arr = off.filter((r) => r.position === p);
  if (!arr.length) continue;
  const mean = arr.reduce((a, b) => a + b.delta, 0) / arr.length;
  const big = arr.filter((r) => r.absDelta >= 2).length;
  push(`| ${p} | ${arr.length} | ${mean.toFixed(2)} | ${pct(big / arr.length)} |`);
}
push("");
push("## OVR band breakdown（official，legacy 分组）");
push("");
push("| band | n | mean delta | |delta|≥2 占比 |");
push("|---|---|---|---|");
for (const [band, lo, hi] of [["<70", 40, 69], ["70-79", 70, 79], ["80-84", 80, 84]]) {
  const arr = off.filter((r) => r.legacy >= lo && r.legacy <= hi);
  if (!arr.length) continue;
  const mean = arr.reduce((a, b) => a + b.delta, 0) / arr.length;
  const big = arr.filter((r) => r.absDelta >= 2).length;
  push(`| ${band} | ${arr.length} | ${mean.toFixed(2)} | ${pct(big / arr.length)} |`);
}
push("");
push("## 观察（仅观察，不改变）");
push("");
push("- delta 分布与 Intangibles：corr(delta, int) 见下");
const intCorr = (() => {
  const n = off.length;
  const mi = off.reduce((a, b) => a + b.int, 0) / n;
  const md = off.reduce((a, b) => a + b.delta, 0) / n;
  let num = 0, di = 0, dd = 0;
  for (const r of off) {
    num += (r.int - mi) * (r.delta - md);
    di += (r.int - mi) ** 2;
    dd += (r.delta - md) ** 2;
  }
  return num / Math.sqrt(di * dd);
})();
push(`- corr(Intangibles, delta) = ${intCorr.toFixed(3)}（official 664）`);
push("- legacy constraint trigger / offset 分布：由 createResult 的 constraint 决定；本 shadow 不重放 constraint（见 Stage 6A 审计），仅报告 estimator 层面的 delta");
push("- V3-E 与 constraint 的关系：若 delta>0 且原 build 触发 constraint 下调，则 display 会显示比 control 更高的 OVR —— 属 display/control 解耦的预期行为，不改变生成");

writeFileSync("reports/rookie-overall-stage6b-shadow.md", L.join("\n"), "utf8");
console.log("shadow report -> reports/rookie-overall-stage6b-shadow.md");
console.log(`total rows: ${rows.length}`);
