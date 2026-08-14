#!/usr/bin/env node
/**
 * Final Validation — Production-Architecture grouped-by-era OOF。
 *
 * 与 V3-E grouped-by-era holdout 完全相同的数据分割：
 *   old = 2003-2013（train）→ new = 2014-2025（test），再反向。
 * 与 Review Patch 的区别：Production 架构（per-position 独立 Ridge，
 * 34 attrs，无 interaction）在**每个 era train split 内重新训练**，
 * 而不是用 Deployed 线上模型（其训练分布是 1190 全量含 ESTIMATED）。
 *
 * 输出：V3-E vs ProdArch-OOF 在 old→new / new→old 的对比。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];
const RIDGE = 100, RIDGE_L1 = 100, RIDGE_L2 = 200, ITERS = 20000;

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
    const eff = ov?.overall != null ? ov.overall : c.overall;
    if (typeof eff !== "number") continue;
    if (!(typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed"))) continue;
    const pos = String(c.position ?? "SF").split("/")[0];
    if (!positions.includes(pos)) continue;
    const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
    if (attrs.some((v) => v === 0)) continue;
    samples.push({
      id: c.slug, name: c.name, position: pos, year: Number(c.draftYear ?? 0),
      overall: eff, attrs,
      intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
    });
  }
}
console.log(`official samples: ${samples.length}`);

// ── ridge 求解（闭式）──────────────────────────────────────────
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
function predictRidge(m, s) {
  return m.intercept + s.features.reduce((t, v, i) => t + v * m.w[i], 0);
}

// ── V3-E 非负 hierarchical（XᵀX 优化版）────────────────────────
function fitModel(train, nNonNeg, betaGlobalModel, lambda1, lambda2, iters) {
  const p = 35;
  const betaGlobal = betaGlobalModel?.w ?? null;
  const globalIntercept = betaGlobalModel?.intercept ?? 0;
  const beta = betaGlobal ? [...betaGlobal] : new Array(p).fill(0);
  let intercept = betaGlobal ? globalIntercept : 50;
  const X = train.map((s) => [...s.attrs, s.intangibles]);
  const y = train.map((s) => s.overall);
  const n = train.length;
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  const xSum = new Array(p).fill(0);
  let ySum = 0, yy = 0;
  for (let i = 0; i < n; i++) {
    const row = X[i];
    ySum += y[i]; yy += y[i] * y[i];
    for (let j = 0; j < p; j++) {
      xty[j] += row[j] * y[i];
      xSum[j] += row[j];
      for (let k = j; k < p; k++) xtx[j][k] += row[j] * row[k];
    }
  }
  for (let j = 0; j < p; j++) for (let k = j + 1; k < p; k++) xtx[k][j] = xtx[j][k];
  const denom = (j) => xtx[j][j] + lambda1 + lambda2;
  let lastLoss = Infinity;
  for (let iter = 0; iter < iters; iter++) {
    let resSum = ySum;
    for (let j = 0; j < p; j++) resSum -= xSum[j] * beta[j];
    const newIntercept = resSum / n;
    let maxChange = 0;
    for (let j = 0; j < p; j++) {
      let num = xty[j] - newIntercept * xSum[j];
      for (let k = 0; k < p; k++) if (k !== j) num -= xtx[j][k] * beta[k];
      if (betaGlobal) num += lambda2 * (betaGlobal[j] - beta[j]);
      let newVal = num / denom(j);
      if (j < nNonNeg && newVal < 0) newVal = 0;
      const change = Math.abs(newVal - beta[j]);
      if (change > maxChange) maxChange = change;
      beta[j] = newVal;
    }
    intercept = newIntercept;
    let xb = 0, bXb = 0;
    for (let j = 0; j < p; j++) {
      xb += xSum[j] * beta[j];
      let row = 0;
      for (let k = 0; k < p; k++) row += xtx[j][k] * beta[k];
      bXb += beta[j] * row;
    }
    const rss = yy - 2 * newIntercept * ySum + n * newIntercept * newIntercept
      - 2 * (xty.reduce((a, v, j) => a + v * beta[j], 0) - newIntercept * xb) + bXb;
    let reg = 0;
    for (let j = 0; j < p; j++) reg += lambda1 * beta[j] * beta[j];
    if (betaGlobal) for (let j = 0; j < p; j++) reg += lambda2 * (beta[j] - betaGlobal[j]) * (beta[j] - betaGlobal[j]);
    const loss = rss + reg;
    if (Math.abs(loss - lastLoss) < 1e-5 && maxChange < 1e-7) break;
    lastLoss = loss;
  }
  return { intercept, w: beta };
}
const predictModel = (m, s) => {
  const x = [...s.attrs, s.intangibles];
  return m.intercept + x.reduce((t, v, j) => t + v * m.w[j], 0);
};

function metrics(preds) {
  const n = preds.length;
  if (!n) return { n: 0, exact: 0, w1: 0, mae: NaN, rmse: NaN };
  let exact = 0, w1 = 0, mae = 0, rmse = 0;
  for (const p of preds) {
    const r = Math.round(clamp(p.predRaw, 40, 99));
    if (r === p.overall) exact++;
    if (Math.abs(r - p.overall) <= 1) w1++;
    const e = p.predRaw - p.overall;
    mae += Math.abs(e); rmse += e * e;
  }
  return { n, exact: exact / n, w1: w1 / n, mae: mae / n, rmse: Math.sqrt(rmse / n) };
}

// ── era holdout：ProdArch-OOF（每 era train 内重训旧架构）vs V3-E ──
const eraOld = samples.filter((s) => s.year <= 2013);
const eraNew = samples.filter((s) => s.year >= 2014);
const rows = [];
for (const [eraName, trainSet, testSet] of [["old→new", eraOld, eraNew], ["new→old", eraNew, eraOld]] as const) {
  // ProdArch-OOF：per-position 独立 Ridge，34 attrs（生产架构）
  const paPreds = [];
  for (const p of positions) {
    const pt = trainSet.filter((s) => s.position === p).map((s) => ({ ...s, features: [...s.attrs] }));
    if (pt.length < 40) continue;
    const m = fitRidge(pt, RIDGE, 34);
    if (!m) continue;
    for (const s of testSet.filter((x) => x.position === p)) {
      const feats = [...s.attrs];
      paPreds.push({ id: s.id, name: s.name, position: p, overall: s.overall, predRaw: m.intercept + feats.reduce((t, v, i) => t + v * m.w[i], 0) });
    }
  }
  // V3-E：hierarchical non-neg
  const g = fitModel(trainSet, 34, null, RIDGE_L1, 0, ITERS);
  const v3ePreds = [];
  for (const p of positions) {
    const m = fitModel(trainSet.filter((s) => s.position === p), 34, g, RIDGE_L1, RIDGE_L2, ITERS);
    for (const s of testSet.filter((x) => x.position === p)) {
      v3ePreds.push({ id: s.id, name: s.name, position: p, overall: s.overall, predRaw: predictModel(m, s) });
    }
  }
  const mPA = metrics(paPreds), mE = metrics(v3ePreds);
  rows.push({ eraName, pa: mPA, v3e: mE, n: `${trainSet.length}→${testSet.length}` });
  console.log(`${eraName}: ProdArch-OOF MAE=${mPA.mae.toFixed(3)} | V3-E MAE=${mE.mae.toFixed(3)}`);
}

const L = [];
const push = (s = "") => L.push(s);
const f = (x, d = 3) => Number(x).toFixed(d);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
push("# Final Validation — Production-Architecture grouped-by-era OOF");
push("");
push("与 V3-E era holdout 完全相同的分割（old=2003-2013 / new=2014-2025）；");
push("ProdArch-OOF = 生产架构（per-position 独立 Ridge 34 attrs）在**每个 era train split 内重新训练**，");
push("不使用 Deployed 线上模型（其训练分布为 1190 全量含 ESTIMATED）。");
push("");
push("| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|---|");
for (const r of rows) {
  push(`| ${r.eraName} | ProdArch-OOF | ${r.n} | ${pct(r.pa.exact)} | ${pct(r.pa.w1)} | ${f(r.pa.mae)} | ${f(r.pa.rmse)} |`);
  push(`| ${r.eraName} | V3-E | ${r.n} | ${pct(r.v3e.exact)} | ${pct(r.v3e.w1)} | ${f(r.v3e.mae)} | ${f(r.v3e.rmse)} |`);
}
push("");
push("结论：V3-E 与同架构（无 interaction、无 Intangibles）的 ProdArch-OOF 对比，");
push("体现 hierarchical + Intangibles 的 era 泛化增益；若两方向均优于 ProdArch-OOF → 架构增益跨 era 稳健。");
writeFileSync("reports/rookie-overall-prodarch-era-oof.md", L.join("\n"), "utf8");
console.log("\nreport -> reports/rookie-overall-prodarch-era-oof.md");
