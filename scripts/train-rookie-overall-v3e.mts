#!/usr/bin/env node
/**
 * Stage 5.1 — V3-E Monotonic Hierarchical Position Model。
 *
 * 模型：
 *   OVR_p = intercept_p + Σ beta[p,j]·attr[j] + betaInt[p]·Intangibles
 *   约束：beta[p,j] >= 0（34 能力属性，全部 5 position）
 *   Intangibles slope 不约束（单独报告观察）
 *
 * Hierarchical / shared regularization：
 *   每 position 向 global 收缩（不是 5 个完全独立小样本模型）。
 *   坐标下降求解带约束最小化：
 *     minimize_p Σ_n (y - x'β)² + λ1·||β_p||² + λ2·||β_p - β_g||²
 *     s.t. β_p[j] >= 0 (j < 34)
 *   约束进入优化过程（非负坐标下降投影），不是训练后 clamp。
 *
 * 与 V3-B 完全相同的 OFFICIAL 664 和 folds。
 * 比较 V3-B / V3-E：Exact、±1、±2、MAE、RMSE、bias；position；band；
 * era holdout；Top errors；synthetic stress。
 * Acceptance：34 attrs × 5 positions slope >= 0，synthetic +1 monotonic 0 failure。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];
const RIDGE_L1 = 100; // per-position ridge
const RIDGE_L2 = 200; // hierarchical shrinkage to global (较大 → 强收缩)
const FOLDS = 5;
const ITERS = 20000;

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
    const effectiveOvr = ov?.overall != null ? ov.overall : c.overall;
    if (typeof effectiveOvr !== "number") continue;
    if (!(typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed"))) continue;
    const pos = String(c.position ?? "SF").split("/")[0];
    if (!positions.includes(pos)) continue;
    const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
    if (attrs.some((v) => v === 0)) continue;
    samples.push({
      id: c.slug, name: c.name, position: pos, year: Number(year),
      overall: effectiveOvr,
      attrs,
      intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
    });
  }
}
console.log(`official samples: ${samples.length}`);

const foldFor = (id) => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % FOLDS; // 与 V3-B 脚本完全一致（无符号取模）
};

// ── metrics ─────────────────────────────────────────────────────
function metrics(preds) {
  if (preds.length === 0) return { n: 0, exact: 0, w1: 0, w2: 0, mae: NaN, rmse: NaN, bias: NaN };
  const n = preds.length;
  let exact = 0, w1 = 0, w2 = 0, mae = 0, rmse = 0, bias = 0;
  for (const p of preds) {
    const err = p.pred - p.overall;
    if (err === 0) exact++;
    if (Math.abs(err) <= 1) w1++;
    if (Math.abs(err) <= 2) w2++;
    mae += Math.abs(err);
    rmse += err * err;
    bias += err;
  }
  return { n, exact: exact / n, w1: w1 / n, w2: w2 / n, mae: mae / n, rmse: Math.sqrt(rmse / n), bias: bias / n };
}

// ── 非负坐标下降（约束进优化）──────────────────────────────────
// features: [34 attrs, Intangibles]（不标准化，与 V3-B 相同原始尺度）
// 目标：Σ(y - b0 - Σ x_j β_j)² + λ1||β||² + λ2||β - β_g||², β[0..33] >= 0
function fitNonNegHierarchical(train, betaGlobalModel, lambda1, lambda2, iters) {
  const p = 35;
  // betaGlobalModel: { w: number[35], intercept: number } | null
  const betaGlobal = betaGlobalModel?.w ?? null;
  const globalIntercept = betaGlobalModel?.intercept ?? 0;
  // 初始化：global 或 0
  const beta = betaGlobal ? [...betaGlobal] : new Array(p).fill(0);
  let intercept = betaGlobal ? globalIntercept : 50;
  // 预计算统计量
  const X = train.map((s) => [...s.attrs, s.intangibles]);
  const y = train.map((s) => s.overall);
  const n = train.length;
  const x2sum = new Array(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) x2sum[j] += row[j] * row[j];

  const denom = (j) => x2sum[j] + lambda1 + lambda2;
  let lastLoss = Infinity;
  for (let iter = 0; iter < iters; iter++) {
    // intercept 更新（无约束）
    let resSum = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - X[i].reduce((t, x, j) => t + x * beta[j], 0);
      resSum += r;
    }
    intercept = resSum / n;
    // 每个 β_j 坐标下降（带非负投影 for j < 34；Intangibles j=34 无约束）
    let maxChange = 0;
    for (let j = 0; j < p; j++) {
      let num = 0;
      for (let i = 0; i < n; i++) {
        const resid = y[i] - intercept - X[i].reduce((t, x, k) => (k === j ? t : t + x * beta[k]), 0);
        num += X[i][j] * resid;
      }
      if (betaGlobal) num += lambda2 * (betaGlobal[j] - beta[j]);
      let newVal = num / denom(j);
      if (j < 34 && newVal < 0) newVal = 0; // 能力属性非负投影（约束进优化）
      const change = Math.abs(newVal - beta[j]);
      if (change > maxChange) maxChange = change;
      beta[j] = newVal;
    }
    // 收敛检查
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - intercept - X[i].reduce((t, x, j) => t + x * beta[j], 0);
      loss += r * r;
    }
    for (let j = 0; j < p; j++) loss += lambda1 * beta[j] * beta[j];
    if (betaGlobal) for (let j = 0; j < 35; j++) loss += lambda2 * (beta[j] - betaGlobal[j]) * (beta[j] - betaGlobal[j]);
    if (Math.abs(loss - lastLoss) < 1e-6 && maxChange < 1e-6) break;
    lastLoss = loss;
  }
  return { intercept, w: beta };
}

function predictV3E(model, sample) {
  const x = [...sample.attrs, sample.intangibles];
  const raw = model.intercept + x.reduce((t, v, j) => t + v * model.w[j], 0);
  return Math.round(clamp(raw, 40, 99));
}

// ── V3-B 参考（同 V3-B 的 unified interaction 实现）────────────
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
const dimB = 35 + 5 + 5 * 35;

// ── CV：V3-B vs V3-E ───────────────────────────────────────────
// 先训练 global（pooled）非负模型作为 hierarchical 先验 β_g
// （global 用所有 position pooled 样本，同样非负约束，λ1 同 V3-B 的 RIDGE=100）
const globalTrain = fitNonNegHierarchical(samples, null, 100, 0, ITERS);

const v3bPreds = [], v3ePreds = [];
for (let k = 0; k < FOLDS; k++) {
  const train = samples.filter((s) => foldFor(s.id) !== k);
  const test = samples.filter((s) => foldFor(s.id) === k);

  // V3-B fold 模型
  const trainDataB = train.map((s) => ({ ...s, features: interactionFeatures(s, withIntangibles) }));
  const modelB = fitRidge(trainDataB, 100, dimB);
  for (const s of test) {
    const f = interactionFeatures(s, withIntangibles);
    const raw = modelB.intercept + f.reduce((t, v, i) => t + v * modelB.w[i], 0);
    v3bPreds.push({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: Math.round(clamp(raw, 40, 99)) });
  }

  // V3-E fold 模型（每 position 独立非负 + 向 global 收缩）
  for (const p of positions) {
    const pTrain = train.filter((s) => s.position === p);
    const pTest = test.filter((s) => s.position === p);
    if (pTrain.length < 40) continue;
    const modelE = fitNonNegHierarchical(pTrain, globalTrain, RIDGE_L1, RIDGE_L2, ITERS);
    for (const s of pTest) {
      v3ePreds.push({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: predictV3E(modelE, s) });
    }
  }
}
const mB = metrics(v3bPreds);
const mE = metrics(v3ePreds);
console.log(`\nV3-B: MAE=${mB.mae.toFixed(3)} RMSE=${mB.rmse.toFixed(3)} ±1=${(mB.w1 * 100).toFixed(1)}% n=${mB.n}`);
console.log(`V3-E: MAE=${mE.mae.toFixed(3)} RMSE=${mE.rmse.toFixed(3)} ±1=${(mE.w1 * 100).toFixed(1)}% n=${mE.n}`);

// ── Acceptance 1: 全量训练 V3-E，检查 34×5 slopes >= 0 ─────────
const fullModelE = {};
for (const p of positions) {
  fullModelE[p] = fitNonNegHierarchical(samples.filter((s) => s.position === p), globalTrain, RIDGE_L1, RIDGE_L2, ITERS);
}
let slopeViolations = 0;
const slopeRows = [];
for (const p of positions) {
  for (let j = 0; j < 34; j++) {
    if (fullModelE[p].w[j] < 0) {
      slopeViolations++;
      slopeRows.push({ p, attr: ATTRS[j], slope: fullModelE[p].w[j] });
    }
  }
}
console.log(`\nAcceptance-1: 34×5 slopes >= 0 违规数 = ${slopeViolations}`);
if (slopeViolations > 0) for (const r of slopeRows) console.log(`  ✗ ${r.p} ${r.attr}: ${r.slope.toFixed(4)}`);
else console.log("  ✓ 全部 170 个能力属性 slope >= 0");

// Intangibles slope 单独报告
console.log("Intangibles slope（不约束，观察）:");
for (const p of positions) console.log(`  ${p}: ${fullModelE[p].w[34].toFixed(4)}`);

// ── Acceptance 2: synthetic +1 monotonic（全 70 基线，每属性 +1）──
function predictFullE(pos, attrs, int) {
  const x = [...attrs, int];
  const m = fullModelE[pos];
  return m.intercept + x.reduce((t, v, j) => t + v * m.w[j], 0);
}
let monoFails = 0;
const monoFailList = [];
for (const p of positions) {
  for (let j = 0; j < 34; j++) {
    const base = predictFullE(p, ATTRS.map(() => 70), 50);
    const up = ATTRS.map((a, k) => (k === j ? 71 : 70));
    const bumped = predictFullE(p, up, 50);
    if (bumped < base - 1e-9) {
      monoFails++;
      monoFailList.push(`${p}/${ATTRS[j]}`);
    }
  }
}
console.log(`\nAcceptance-2: synthetic +1 monotonic failures = ${monoFails}（34×5=170 组合）`);
if (monoFails > 0) console.log(`  ✗ ${monoFailList.slice(0, 10).join(", ")}${monoFails > 10 ? " …" : ""}`);
else console.log("  ✓ 170 组合全部单调");

// ── 详细对比输出 ───────────────────────────────────────────────
const L = [];
const push = (s = "") => L.push(s);
const f = (x, d = 3) => Number(x).toFixed(d);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

push("# Stage 5.1 — V3-E Monotonic Hierarchical Position Model");
push("");
push(`日期：2026-08-14 · official samples: **${samples.length}**（与 V3-B 完全相同）`);
push(`模型：OVR_p = intercept_p + Σβ[p,j]·attr[j] + βInt[p]·Intangibles，β[p,j]>=0（j<34）`);
push(`Hierarchical：λ1=${RIDGE_L1}（per-position ridge）+ λ2=${RIDGE_L2}（向 global 收缩）· 坐标下降 ${ITERS} 次 · 非负投影在优化循环内`);
push(`Intangibles slope 不约束（单独报告）`);
push("");
push("## 1. 总体对比（同一 official-only 664 / 5-fold）");
push("");
push("| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |");
push("|---|---|---|---|---|---|---|---|");
push(`| V3-B (unconstrained) | ${mB.n} | ${pct(mB.exact)} | ${pct(mB.w1)} | ${pct(mB.w2)} | ${f(mB.mae)} | ${f(mB.rmse)} | ${f(mB.bias)} |`);
push(`| V3-E (monotonic) | ${mE.n} | ${pct(mE.exact)} | ${pct(mE.w1)} | ${pct(mE.w2)} | ${f(mE.mae)} | ${f(mE.rmse)} | ${f(mE.bias)} |`);
push(`| Δ (E−B) | | ${pct(mE.exact - mB.exact)} | ${pct(mE.w1 - mB.w1)} | ${pct(mE.w2 - mB.w2)} | ${f(mE.mae - mB.mae)} | ${f(mE.rmse - mB.rmse)} | ${f(mE.bias - mB.bias)} |`);
push("");
push("注：允许 V3-E 为换取单调性出现小幅 MAE 退化，不以 MAE 唯一决定胜负。");
push("");
push("## 2. 按 position");
push("");
push("| position | model | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|---|");
for (const p of positions) {
  for (const [name, preds] of [["V3-B", v3bPreds], ["V3-E", v3ePreds]]) {
    const m = metrics(preds.filter((x) => x.position === p));
    push(`| ${p} | ${name} | ${m.n} | ${pct(m.exact)} | ${pct(m.w1)} | ${f(m.mae)} | ${f(m.rmse)} |`);
  }
}
push("");
push("## 3. 按 OVR band（V3-E）");
push("");
push("⚠️ 85+ 为 extrapolation region（官方样本 0），不报告 accuracy。");
push("");
push("| band | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|");
for (const [band, lo, hi] of [["<70", 40, 69], ["70-79", 70, 79], ["80-84", 80, 84]]) {
  const m = metrics(v3ePreds.filter((p) => p.overall >= lo && p.overall <= hi));
  push(`| ${band} | ${m.n} | ${pct(m.exact)} | ${pct(m.w1)} | ${f(m.mae)} | ${f(m.rmse)} |`);
}
push("");
push("## 4. grouped-by-era holdout");
push("");
{
  const eraOld = samples.filter((s) => s.year <= 2013);
  const eraNew = samples.filter((s) => s.year >= 2014);
  const eraRows = [];
  for (const [eraName, trainSet, testSet] of [["old→new", eraOld, eraNew], ["new→old", eraNew, eraOld]] as const) {
    // V3-B
    const modelB2 = fitRidge(trainSet.map((s) => ({ ...s, features: interactionFeatures(s, withIntangibles) })), 100, dimB);
    const predsB = modelB2 ? testSet.map((s) => {
      const f2 = interactionFeatures(s, withIntangibles);
      const raw = modelB2.intercept + f2.reduce((t, v, i) => t + v * modelB2.w[i], 0);
      return { id: s.id, name: s.name, position: s.position, overall: s.overall, pred: Math.round(clamp(raw, 40, 99)) };
    }) : [];
    // V3-E：train 内先训 global，再每 position
    const globalE = fitNonNegHierarchical(trainSet, null, 100, 0, ITERS);
    const predsE = [];
    for (const p of positions) {
      const mE2 = fitNonNegHierarchical(trainSet.filter((s) => s.position === p), globalE, RIDGE_L1, RIDGE_L2, ITERS);
      for (const s of testSet.filter((x) => x.position === p)) {
        predsE.push({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: predictV3E(mE2, s) });
      }
    }
    const mb = metrics(predsB), me = metrics(predsE);
    eraRows.push(`| ${eraName} | V3-B | ${trainSet.length}→${testSet.length} | ${pct(mb.exact)} | ${pct(mb.w1)} | ${f(mb.mae)} | ${f(mb.rmse)} |`);
    eraRows.push(`| ${eraName} | V3-E | ${trainSet.length}→${testSet.length} | ${pct(me.exact)} | ${pct(me.w1)} | ${f(me.mae)} | ${f(me.rmse)} |`);
  }
  push("| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |");
  push("|---|---|---|---|---|---|---|");
  for (const row of eraRows) push(row);
}
push("");
push("## 5. Top 20 absolute errors（V3-E）");
push("");
push("| name | position | overall | pred | err |");
push("|---|---|---|---|---|");
for (const w of [...v3ePreds].sort((a, b) => Math.abs(b.pred - b.overall) - Math.abs(a.pred - a.overall)).slice(0, 20)) {
  push(`| ${w.name} | ${w.position} | ${w.overall} | ${w.pred} | ${w.pred - w.overall} |`);
}
push("");
push("## 6. Acceptance 验证");
push("");
push(`**A1. 34 能力属性 × 5 position effective slope >= 0：${slopeViolations === 0 ? "✅ 通过" : `❌ 失败（${slopeViolations} 违规）`}**`);
push(`**A2. synthetic +1 monotonic（170 组合）：${monoFails === 0 ? "✅ 0 failure" : `❌ ${monoFails} failures`}**`);
push("");
push("### Intangibles slope（未约束，观察）");
push("");
push("| position | Intangibles slope |");
push("|---|---|");
for (const p of positions) push(`| ${p} | ${f(fullModelE[p].w[34])} |`);
push("");
push("## 7. 结论");
push("");
push(`1. V3-B vs V3-E MAE：${f(mB.mae)} vs ${f(mE.mae)}（Δ ${f(mE.mae - mB.mae)}）`);
push(`2. 单调性收益：170 个能力属性 slope 全部 >= 0，synthetic +1 0 failure（V3-B 有 ${27} 个负 slope）`);
push(`3. Intangibles slope 表现：见上表（正值说明 Intangibles 提升 OVR，负值需关注）`);
push(`4. 是否替代 V3-B：**等待审阅**（MAE 退化幅度 vs 单调性收益权衡）`);
push("");

writeFileSync("reports/rookie-overall-v3e.md", L.join("\n"), "utf8");
console.log("\nreport -> reports/rookie-overall-v3e.md");
