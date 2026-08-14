#!/usr/bin/env node
/**
 * Review Patch — Synthetic Stress Suite（V3-B）。
 * 手工构造正常/极端合成人，检查：
 *  1. 连续性（小步变化不跳变）
 *  2. 单调性（单项属性 +1 预测不降）
 *  3. position 行为（同属性不同位置差异合理）
 *  4. 高能力区域外推（85+ 预测行为）
 * 说明：synthetic feature-space OOD 与「官方 85+ 无标签」是两个不同问题——
 * 前者测模型在特征空间边界的行为，后者是标签覆盖缺失。
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

// 训练样本（V3-B 官方 664）
const samples = [];
const seen = new Set();
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    const key = coreName(c.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const ov = overrides.get(c.slug);
    if (ov?.estimated === true || c.overallSource === "model-estimated-gap") continue;
    const effectiveOvr = ov?.overall != null ? ov.overall : c.overall;
    if (typeof effectiveOvr !== "number") continue;
    if (!(typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed"))) continue;
    const pos = String(c.position ?? "SF").split("/")[0];
    if (!positions.includes(pos)) continue;
    const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
    if (attrs.some((v) => v === 0)) continue;
    samples.push({ id: c.slug, name: c.name, position: pos, year: Number(year), overall: effectiveOvr, attrs, intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99) });
  }
}

// 训练 V3-B 全量
const RIDGE = 100;
function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];
    const d = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= d;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const f = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}
function fitRidge(data, lambda, featureDim) {
  const p = featureDim;
  const xtx = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const xty = Array(p + 1).fill(0);
  for (const s of data) {
    const row = [1, ...s.features];
    for (let i = 0; i <= p; i += 1) {
      xty[i] += row[i] * s.overall;
      for (let j = 0; j <= p; j += 1) xtx[i][j] += row[i] * row[j];
    }
  }
  for (let i = 1; i <= p; i += 1) xtx[i][i] += lambda;
  const coef = solve(xtx, xty);
  if (!coef) return null;
  return { intercept: coef[0], w: coef.slice(1) };
}
const withIntangibles = (s) => [...s.attrs, s.intangibles];
const interactionFeatures = (s, baseFn) => {
  const base = baseFn(s);
  const feats = [...base];
  for (const p of positions) feats.push(p === s.position ? 1 : 0);
  for (const p of positions) for (const v of base) feats.push(p === s.position ? v : 0);
  return feats;
};
const dim = 35 + 5 + 5 * 35;
const model = fitRidge(samples.map((s) => ({ ...s, features: interactionFeatures(s, withIntangibles) })), RIDGE, dim);
if (!model) { console.error("singular"); process.exit(1); }

function predict(attrs, intangibles, position) {
  const fake = { attrs, intangibles, position };
  const f = interactionFeatures(fake, withIntangibles);
  const raw = model.intercept + f.reduce((t, v, i) => t + v * model.w[i], 0);
  return { raw, rounded: Math.round(clamp(raw, 40, 99)) };
}

// ── 1. 基准合成人 ──────────────────────────────────────────────
const BASE = Object.fromEntries(ATTRS.map((a) => [a, 70]));
const L = [];
const push = (s = "") => L.push(s);
push("# Synthetic Stress Suite — V3-B");
push("");
push("## 1. 基线合成人（全属性 70，Intangibles 50）");
push("");
const baseP = predict(ATTRS.map((a) => BASE[a]), 50, "SF");
push(`全 70 / Int 50 / SF：raw=${baseP.raw.toFixed(3)} → **${baseP.rounded}**`);
push("");

// ── 2. 连续性 ──────────────────────────────────────────────────
push("## 2. 连续性（Speed 70→99 每 5 步，SF）");
push("");
push("| Speed | raw | rounded |");
push("|---|---|---|");
for (let v = 70; v <= 99; v += 5) {
  const attrs = ATTRS.map((a) => (a === "Speed" ? v : 70));
  const p = predict(attrs, 50, "SF");
  push(`| ${v} | ${p.raw.toFixed(3)} | ${p.rounded} |`);
}
push("");

// ── 3. 单调性：每属性 +1 检查 ─────────────────────────────────
push("## 3. 单调性（全 70 基线，每属性 +1 → 预测不降）");
push("");
const monoFail = [];
for (let i = 0; i < ATTRS.length; i += 1) {
  const up = ATTRS.map((a, j) => (j === i ? 71 : 70));
  const base = predict(ATTRS.map(() => 70), 50, "SF");
  const bumped = predict(up, 50, "SF");
  if (bumped.raw < base.raw - 1e-9) monoFail.push(`${ATTRS[i]}: ${base.raw.toFixed(3)}→${bumped.raw.toFixed(3)}`);
}
push(`属性 +1 导致预测下降的属性：${monoFail.length}${monoFail.length ? `（${monoFail.join("; ")}）` : "（无）"}`);
push("");
// 但注意 effective coefficient 为负的属性（在训练分布内可能被其他属性补偿）
push("注：这是单个属性 +1 的局部检查；31 个负 effective 系数来自 position-interaction 分解，见 ablation §5b。");
push("");

// ── 4. position 行为 ───────────────────────────────────────────
push("## 4. position 行为（同属性 3 组）");
push("");
push("| profile | PG | SG | SF | PF | C |");
push("|---|---|---|---|---|---|");
const profs = [
  ["控卫型（BH/SWB/PA 90）", { "Ball Handle": 90, "Speed with Ball": 90, "Pass Accuracy": 90 }],
  ["中锋型（Block/OREB/Post 90）", { Block: 90, "Offensive Rebound": 90, "Post Control": 90, "Post Fade": 90, "Post Hook": 90 }],
  ["全能 80", Object.fromEntries(ATTRS.map((a) => [a, 80]))],
];
for (const [name, over] of profs) {
  const attrs = ATTRS.map((a) => over[a] ?? 70);
  const row = positions.map((p) => {
    const r = predict(attrs, 50, p);
    return `${r.rounded}(${r.raw.toFixed(1)})`;
  });
  push(`| ${name} | ${row.join(" | ")} |`);
}
push("");

// ── 5. 高能力区域外推（85+ 无官方标签）────────────────────────
push("## 5. 高能力区域外推（synthetic OOD）");
push("");
push("说明：synthetic feature-space OOD（属性组合超出训练分布）与「官方 85+ 无标签」（标签覆盖缺失）是两个不同问题。以下测试前者。");
push("");
push("| profile | SF raw | SF rounded |");
push("|---|---|---|");
const high = [
  ["全 99 / Int 99", Object.fromEntries(ATTRS.map((a) => [a, 99])), 99],
  ["全 99 / Int 50", Object.fromEntries(ATTRS.map((a) => [a, 99])), 50],
  ["全 95 / Int 80", Object.fromEntries(ATTRS.map((a) => [a, 95])), 80],
  ["全 90 / Int 70", Object.fromEntries(ATTRS.map((a) => [a, 90])), 70],
  ["全 85 / Int 60", Object.fromEntries(ATTRS.map((a) => [a, 85])), 60],
];
for (const [name, over, int] of high) {
  const p = predict(ATTRS.map((a) => over[a]), int, "SF");
  push(`| ${name} | ${p.raw.toFixed(3)} | ${p.rounded} |`);
}
push("");
push("⚠️ 若全 99 也到不了 90+，说明模型在特征空间高端的饱和/外推行为需审阅（官方标签缺失下无法验证正确性，只描述行为）。");
push("");

// ── 6. Intangibles 敏感性 ─────────────────────────────────────
push("## 6. Intangibles 敏感性（全 70，SF，Int 25→99）");
push("");
push("| Intangibles | raw | rounded |");
push("|---|---|---|");
for (const int of [25, 40, 50, 60, 70, 80, 90, 99]) {
  const p = predict(ATTRS.map(() => 70), int, "SF");
  push(`| ${int} | ${p.raw.toFixed(3)} | ${p.rounded} |`);
}

writeFileSync("reports/rookie-overall-v3-synthetic-stress.md", L.join("\n"), "utf8");
console.log(L.join("\n"));
console.log("\nreport -> reports/rookie-overall-v3-synthetic-stress.md");
