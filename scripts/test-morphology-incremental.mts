#!/usr/bin/env node
/**
 * Morphology Incremental Value Test（最终版，不改 production）。
 *
 * M0 = 34 atomic + position（V3-E-NoInt 架构：monotonic hierarchical）
 * M1 = M0 + Height + Weight + BMI + source real Wingspan + position-relative Height/Wingspan z
 * M2 = M1 + 预注册 12 个篮球合理 interaction（不允许事后添加）：
 *      Height×Close Shot, Height×Standing Dunk, Height×Block,
 *      Height×OREB, Height×DREB,
 *      Wingspan×Block, Wingspan×Steal, Wingspan×OREB, Wingspan×DREB,
 *      Wingspan×Perimeter Defense,
 *      BMI×Strength, BMI×Interior Defense
 *      （"Weight/BMI" 预注册解释为 BMI，避免与 Weight 主效应共线）
 *
 * 1. residual 用 raw OOF prediction（不先 round）：residualRaw = officialOVR − rawPred
 * 2. 完全相同 folds，M0/M1/M2 都 official-only OOF
 * 3. 报 MAE/RMSE/bias、position、OVR band、era；特别报 M1−M0、M2−M0 增量
 * 4. fold-level variation 报告增量稳定性（不因 0.01 MAE 声称 morphology 有价值）
 * 5. matched comparison：标准化 attribute distance + 同 position all-pairs 中位数匹配
 * 6. 修复 §2 Markdown 表头/列数不一致
 * 7. source wingspan 是真实 cm 可用于本研究；target 1-100 不 invent conversion
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];
const RIDGE_L1 = 100, RIDGE_L2 = 200, ITERS = 20000, FOLDS = 5;

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

const samples = [];
for (const c of cards) {
  const ov = overrides.get(c.slug);
  if (ov?.estimated === true || c.overallSource === "model-estimated-gap") continue;
  const eff = ov?.overall != null ? ov.overall : c.overall;
  if (typeof eff !== "number") continue;
  if (!(typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed"))) continue;
  const pos = String(c.position ?? "SF").split("/")[0];
  if (!positions.includes(pos)) continue;
  const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
  if (attrs.some((v) => v === 0)) continue;
  const hIn = Number(c.height ?? c.vitals?.heightInches);
  const wLb = Number(c.weight ?? c.vitals?.weightLb);
  let wsCm = Number(c.wingspan ?? c.vitals?.wingspanCm);
  if (!(hIn > 0 && wLb > 0 && wsCm > 0)) continue;
  if (wsCm > 300) wsCm = wsCm / 2.54; // 16 张卡单位膨胀修复
  const hCm = hIn * 2.54;
  const wKg = wLb * 0.453592;
  samples.push({
    id: c.slug, name: c.name, position: pos, year: c.year,
    overall: eff, attrs,
    intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
    heightCm: hCm, weightKg: wKg, bmi: wKg / (hCm / 100) ** 2, wingspanCm: wsCm,
  });
}
console.log(`official samples: ${samples.length}`);

// position 内 z（用于 M1 特征）
const posStats = {};
for (const p of positions) {
  const sub = samples.filter((s) => s.position === p);
  const mh = sub.reduce((a, b) => a + b.heightCm, 0) / sub.length;
  const sh = Math.sqrt(sub.reduce((a, b) => a + (b.heightCm - mh) ** 2, 0) / sub.length) || 1;
  const mw = sub.reduce((a, b) => a + b.wingspanCm, 0) / sub.length;
  const sw = Math.sqrt(sub.reduce((a, b) => a + (b.wingspanCm - mw) ** 2, 0) / sub.length) || 1;
  posStats[p] = { mh, sh, mw, sw };
}

// ── 特征构建 ───────────────────────────────────────────────────
// body 特征：Height/Weight/BMI/Wingspan（真实 cm）+ position 相对 z
function bodyFeatures(s) {
  const st = posStats[s.position];
  return [
    s.heightCm, s.weightKg, s.bmi, s.wingspanCm,
    (s.heightCm - st.mh) / st.sh,
    (s.wingspanCm - st.mw) / st.sw,
  ];
}
const BODY_NAMES = ["HeightCm", "WeightKg", "BMI", "WingspanCm", "HeightZ", "WingspanZ"];

// 预注册 interactions（body index 用 z-scored，attr 用 raw）
function interactionDefs() {
  return [
    ["Height×CloseShot", 0, 4],       // HeightCm × Close Shot
    ["Height×StandingDunk", 0, 11],
    ["Height×Block", 0, 21],
    ["Height×OREB", 0, 17],
    ["Height×DREB", 0, 22],
    ["Wingspan×Block", 3, 21],
    ["Wingspan×Steal", 3, 20],
    ["Wingspan×OREB", 3, 17],
    ["Wingspan×DREB", 3, 22],
    ["Wingspan×Perimeter", 3, 18],
    ["BMI×Strength", 2, 28],
    ["BMI×Interior", 2, 19],
  ];
}

// 特征向量（attr 主效应 + body 主效应 + interactions）
// body 与 interaction 在 train 内 z-score；attr 保持 raw（V3-E 语义）
function buildFeatureVec(s, bodyZ, useM1, useM2, interactionMeta) {
  const feats = [...s.attrs];
  if (useM1 || useM2) {
    const b = bodyFeatures(s);
    for (let k = 0; k < b.length; k++) feats.push((b[k] - bodyZ.mean[k]) / bodyZ.std[k]);
    if (useM2) {
      for (const [name, bi, ai] of interactionMeta) {
        const bz = (bodyFeatures(s)[bi] - bodyZ.mean[bi]) / bodyZ.std[bi];
        const az = (s.attrs[ai] - bodyZ.attrMean[ai]) / bodyZ.attrStd[ai];
        feats.push(bz * az);
      }
    }
  }
  return feats;
}
const N_BODY = 6;
const N_INTER = 12;

// ── 非负 hierarchical 拟合（attr 非负，body/interaction 自由）────
// 优化：预计算 XᵀX 与 Xᵀy，坐标下降每轮 O(p²)（原实现 O(n·p²) 全量重算残差，52 维下过慢）
function fitModel(train, dim, nNonNeg, betaGlobalModel, lambda1, lambda2, iters) {
  const p = dim;
  const betaGlobal = betaGlobalModel?.w ?? null;
  const globalIntercept = betaGlobalModel?.intercept ?? 0;
  const beta = betaGlobal ? [...betaGlobal] : new Array(p).fill(0);
  let intercept = betaGlobal ? globalIntercept : 50;
  const X = train.map((s) => s.features);
  const y = train.map((s) => s.overall);
  const n = train.length;
  // 预计算 XᵀX (p×p)、Xᵀy、Xᵀ1、sum_y
  const xtx = Array.from({ length: p }, () => new Array(p).fill(0));
  const xty = new Array(p).fill(0);
  const xSum = new Array(p).fill(0);
  let ySum = 0;
  for (let i = 0; i < n; i++) {
    const row = X[i];
    ySum += y[i];
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
    // intercept：argmin Σ(y - b0 - Xβ)² → b0 = (Σy - ΣXβ)/n
    let resSum = ySum;
    for (let j = 0; j < p; j++) resSum -= xSum[j] * beta[j];
    const newIntercept = resSum / n;
    // 坐标下降（用 XᵀX 预计算）
    let maxChange = 0;
    for (let j = 0; j < p; j++) {
      // num_j = Σ_i x_ij (y_i - b0 - Σ_k≠j x_ik β_k)
      //       = xty[j] - b0·xSum[j] - Σ_k≠j xtx[j][k]·β_k
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
    // loss（用 XᵀX 预计算）：RSS + λ1||β||² + λ2||β-βg||²
    let yy = 0;
    for (let i = 0; i < n; i++) yy += y[i] * y[i];
    let xb = 0;
    for (let j = 0; j < p; j++) xb += xSum[j] * beta[j];
    let bXb = 0;
    for (let j = 0; j < p; j++) {
      let row = 0;
      for (let k = 0; k < p; k++) row += xtx[j][k] * beta[k];
      bXb += beta[j] * row;
    }
    let rss = yy - 2 * newIntercept * ySum + n * newIntercept * newIntercept
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
function predict(model, s) {
  return model.intercept + s.features.reduce((t, v, j) => t + v * model.w[j], 0);
}

const foldFor = (id) => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % FOLDS;
};

function metricsRaw(preds) {
  // preds: {overall, predRaw}，MAE 用 raw 预测
  if (preds.length === 0) return { n: 0, exact: 0, w1: 0, w2: 0, mae: NaN, rmse: NaN, bias: NaN };
  const n = preds.length;
  let exact = 0, w1 = 0, w2 = 0, mae = 0, rmse = 0, bias = 0;
  for (const p of preds) {
    const err = p.predRaw - p.overall;
    if (Math.round(p.predRaw) === p.overall) exact++;
    if (Math.abs(Math.round(p.predRaw) - p.overall) <= 1) w1++;
    if (Math.abs(Math.round(p.predRaw) - p.overall) <= 2) w2++;
    mae += Math.abs(err);
    rmse += err * err;
    bias += err;
  }
  return { n, exact: exact / n, w1: w1 / n, w2: w2 / n, mae: mae / n, rmse: Math.sqrt(rmse / n), bias: bias / n };
}

// ── OOF CV：M0 / M1 / M2 相同 folds ───────────────────────────
const interactionMeta = interactionDefs();
function zStatsOn(data) {
  const mean = new Array(N_BODY).fill(0);
  const std = new Array(N_BODY).fill(0);
  const attrMean = new Array(34).fill(0);
  const attrStd = new Array(34).fill(0);
  for (const s of data) {
    const b = bodyFeatures(s);
    for (let k = 0; k < N_BODY; k++) mean[k] += b[k];
    for (let k = 0; k < 34; k++) attrMean[k] += s.attrs[k];
  }
  for (let k = 0; k < N_BODY; k++) mean[k] /= data.length;
  for (let k = 0; k < 34; k++) attrMean[k] /= data.length;
  for (const s of data) {
    const b = bodyFeatures(s);
    for (let k = 0; k < N_BODY; k++) std[k] += (b[k] - mean[k]) ** 2;
    for (let k = 0; k < 34; k++) attrStd[k] += (s.attrs[k] - attrMean[k]) ** 2;
  }
  for (let k = 0; k < N_BODY; k++) std[k] = Math.sqrt(std[k] / data.length) || 1;
  for (let k = 0; k < 34; k++) attrStd[k] = Math.sqrt(attrStd[k] / data.length) || 1;
  return { mean, std, attrMean, attrStd };
}

const resultsOOF = { M0: [], M1: [], M2: [] };
const foldMae = { M0: new Array(FOLDS).fill(NaN), M1: new Array(FOLDS).fill(NaN), M2: new Array(FOLDS).fill(NaN) };
const foldCount = new Array(FOLDS).fill(0);

for (let k = 0; k < FOLDS; k++) {
  const train = samples.filter((s) => foldFor(s.id) !== k);
  const test = samples.filter((s) => foldFor(s.id) === k);
  foldCount[k] = test.length;
  const z = zStatsOn(train);
  const interMeta = interactionMeta;

  for (const [modelName, useM1, useM2, nFeat, nNonNeg] of [["M0", false, false, 34, 34], ["M1", true, false, 34 + N_BODY, 34], ["M2", true, true, 34 + N_BODY + N_INTER, 34]]) {
    // 构建 fold 特征
    const tr = train.map((s) => ({ ...s, features: buildFeatureVec(s, z, useM1, useM2, interMeta) }));
    const te = test.map((s) => ({ ...s, features: buildFeatureVec(s, z, useM1, useM2, interMeta) }));
    // global + per-position
    const g = fitModel(tr, nFeat, nNonNeg, null, 100, 0, ITERS);
    const preds = [];
    for (const p of positions) {
      const pt = tr.filter((s) => s.position === p);
      const pte = te.filter((s) => s.position === p);
      if (pt.length < 40) { for (const s of pte) preds.push({ id: s.id, name: s.name, position: p, overall: s.overall, predRaw: 50 }); continue; }
      const m = fitModel(pt, nFeat, nNonNeg, g, RIDGE_L1, RIDGE_L2, ITERS);
      for (const s of pte) preds.push({ id: s.id, name: s.name, position: p, overall: s.overall, predRaw: predict(m, s) });
    }
    resultsOOF[modelName].push(...preds);
    foldMae[modelName][k] = metricsRaw(preds).mae;
  }
}

const m0 = metricsRaw(resultsOOF.M0);
const m1 = metricsRaw(resultsOOF.M1);
const m2 = metricsRaw(resultsOOF.M2);
console.log(`\nM0: MAE=${m0.mae.toFixed(3)} RMSE=${m0.rmse.toFixed(3)} bias=${m0.bias.toFixed(3)}`);
console.log(`M1: MAE=${m1.mae.toFixed(3)} RMSE=${m1.rmse.toFixed(3)} bias=${m1.bias.toFixed(3)}  Δ=${(m1.mae - m0.mae).toFixed(3)}`);
console.log(`M2: MAE=${m2.mae.toFixed(3)} RMSE=${m2.rmse.toFixed(3)} bias=${m2.bias.toFixed(3)}  Δ=${(m2.mae - m0.mae).toFixed(3)}`);

// fold-level 稳定性
const d1 = foldMae.M1.map((v, k) => v - foldMae.M0[k]);
const d2 = foldMae.M2.map((v, k) => v - foldMae.M0[k]);
const meanD1 = d1.reduce((a, b) => a + b, 0) / FOLDS;
const sdD1 = Math.sqrt(d1.reduce((a, b) => a + (b - meanD1) ** 2, 0) / FOLDS);
const meanD2 = d2.reduce((a, b) => a + b, 0) / FOLDS;
const sdD2 = Math.sqrt(d2.reduce((a, b) => a + (b - meanD2) ** 2, 0) / FOLDS);
console.log(`fold Δ M1−M0: mean=${meanD1.toFixed(3)} sd=${sdD1.toFixed(3)} per-fold=[${d1.map((x) => x.toFixed(3)).join(", ")}]`);
console.log(`fold Δ M2−M0: mean=${meanD2.toFixed(3)} sd=${sdD2.toFixed(3)} per-fold=[${d2.map((x) => x.toFixed(3)).join(", ")}]`);

// ── 报告 ───────────────────────────────────────────────────────
const L = [];
const push = (s = "") => L.push(s);
const f = (x, d = 3) => Number(x).toFixed(d);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

push("# Morphology Incremental Value Test（最终版）");
push("");
push(`日期：2026-08-14 · official-only OOF 664（canonical，与 V3-B/V3-E 相同 folds）· residual 用 **raw OOF prediction**（不先 round）`);
push(`residualRaw = officialOVR − rawPrediction`);
push("");
push("| 模型 | 特征 |");
push("|---|---|");
push("| M0 | 34 atomic + position（V3-E-NoInt 架构：monotonic hierarchical） |");
push("| M1 | M0 + Height + Weight + BMI + source real Wingspan + Height z + Wingspan z (position-relative) |");
push("| M2 | M1 + 预注册 12 个 interaction（见下，不允许事后添加） |");
push("");
push("预注册 interactions：Height×CloseShot, Height×StandingDunk, Height×Block, Height×OREB, Height×DREB, Wingspan×Block, Wingspan×Steal, Wingspan×OREB, Wingspan×DREB, Wingspan×Perimeter, BMI×Strength, BMI×Interior（“Weight/BMI”预注册解释为 BMI，避免与 Weight 主效应共线）");
push("");
push("## 1. 总体（raw OOF）");
push("");
push("| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |");
push("|---|---|---|---|---|---|---|---|");
push(`| M0 | ${m0.n} | ${pct(m0.exact)} | ${pct(m0.w1)} | ${pct(m0.w2)} | ${f(m0.mae)} | ${f(m0.rmse)} | ${f(m0.bias)} |`);
push(`| M1 | ${m1.n} | ${pct(m1.exact)} | ${pct(m1.w1)} | ${pct(m1.w2)} | ${f(m1.mae)} | ${f(m1.rmse)} | ${f(m1.bias)} |`);
push(`| M2 | ${m2.n} | ${pct(m2.exact)} | ${pct(m2.w1)} | ${pct(m2.w2)} | ${f(m2.mae)} | ${f(m2.rmse)} | ${f(m2.bias)} |`);
push(`| Δ M1−M0 | | ${pct(m1.exact - m0.exact)} | ${pct(m1.w1 - m0.w1)} | ${pct(m1.w2 - m0.w2)} | ${f(m1.mae - m0.mae)} | ${f(m1.rmse - m0.rmse)} | ${f(m1.bias - m0.bias)} |`);
push(`| Δ M2−M0 | | ${pct(m2.exact - m0.exact)} | ${pct(m2.w1 - m0.w1)} | ${pct(m2.w2 - m0.w2)} | ${f(m2.mae - m0.mae)} | ${f(m2.rmse - m0.rmse)} | ${f(m2.bias - m0.bias)} |`);
push("");
push("## 2. fold-level 增量稳定性（Δ MAE per fold）");
push("");
push("| fold | n | M0 MAE | M1 MAE | M2 MAE | Δ M1−M0 | Δ M2−M0 |");
push("|---|---|---|---|---|---|---|");
for (let k = 0; k < FOLDS; k++) {
  push(`| ${k} | ${foldCount[k]} | ${f(foldMae.M0[k])} | ${f(foldMae.M1[k])} | ${f(foldMae.M2[k])} | ${f(d1[k])} | ${f(d2[k])} |`);
}
push(`| mean | | ${f(m0.mae)} | ${f(m1.mae)} | ${f(m2.mae)} | ${f(meanD1)} ± ${f(sdD1)} | ${f(meanD2)} ± ${f(sdD2)} |`);
push("");
push("判定：|mean Δ| < 0.05 或 fold 间符号不一致 → 增量不稳定，**不声称 morphology 有价值**。");
push("");
push("## 3. 按 position（raw OOF）");
push("");
push("| position | model | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|---|");
for (const p of positions) {
  for (const [name, arr] of [["M0", resultsOOF.M0], ["M1", resultsOOF.M1], ["M2", resultsOOF.M2]]) {
    const m = metricsRaw(arr.filter((x) => x.position === p));
    push(`| ${p} | ${name} | ${m.n} | ${pct(m.exact)} | ${pct(m.w1)} | ${f(m.mae)} | ${f(m.rmse)} |`);
  }
}
push("");
push("## 4. 按 OVR band（raw OOF）");
push("");
push("| band | model | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|---|");
for (const [band, lo, hi] of [["<70", 40, 69], ["70-79", 70, 79], ["80-84", 80, 84]]) {
  for (const [name, arr] of [["M0", resultsOOF.M0], ["M1", resultsOOF.M1], ["M2", resultsOOF.M2]]) {
    const m = metricsRaw(arr.filter((x) => x.overall >= lo && x.overall <= hi));
    push(`| ${band} | ${name} | ${m.n} | ${pct(m.exact)} | ${pct(m.w1)} | ${f(m.mae)} | ${f(m.rmse)} |`);
  }
}
push("");
push("## 5. grouped-by-era holdout");
push("");
{
  const eraOld = samples.filter((s) => s.year <= 2013);
  const eraNew = samples.filter((s) => s.year >= 2014);
  push("| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |");
  push("|---|---|---|---|---|---|---|");
  for (const [eraName, trainSet, testSet] of [["old→new", eraOld, eraNew], ["new→old", eraNew, eraOld]] as const) {
    const z = zStatsOn(trainSet);
    for (const [modelName, useM1, useM2, nFeat] of [["M0", false, false, 34], ["M1", true, false, 40], ["M2", true, true, 52]]) {
      const tr = trainSet.map((s) => ({ ...s, features: buildFeatureVec(s, z, useM1, useM2, interactionMeta) }));
      const te = testSet.map((s) => ({ ...s, features: buildFeatureVec(s, z, useM1, useM2, interactionMeta) }));
      const g = fitModel(tr, nFeat, 34, null, 100, 0, ITERS);
      const preds = [];
      for (const p of positions) {
        const m = fitModel(tr.filter((s) => s.position === p), nFeat, 34, g, RIDGE_L1, RIDGE_L2, ITERS);
        for (const s of te.filter((x) => x.position === p)) preds.push({ id: s.id, name: s.name, position: p, overall: s.overall, predRaw: predict(m, s) });
      }
      const m = metricsRaw(preds);
      push(`| ${eraName} | ${modelName} | ${trainSet.length}→${testSet.length} | ${pct(m.exact)} | ${pct(m.w1)} | ${f(m.mae)} | ${f(m.rmse)} |`);
    }
  }
}
push("");
push("## 6. Matched comparison（z-scored all-pairs threshold matching）");
push("");
push("方法：34 属性 z-score（全体 664 上标准化）→ **同 position 内全部球员对**（all-pairs）→ 只保留属性距离 ≤ position 内中位数的 matched 对 → 按 body 差异分组比较 Int/residualRaw。");
push("注（Final Validation 修正）：此前文档误称 1-NN；实现为 all-pairs + 中位数阈值，文档已对齐实现。Morphology Research CLOSED，不新增模型。");
push("");
{
  // z-score attrs
  const attrMean = new Array(34).fill(0);
  for (const s of samples) for (let k = 0; k < 34; k++) attrMean[k] += s.attrs[k];
  for (let k = 0; k < 34; k++) attrMean[k] /= samples.length;
  const attrStd = new Array(34).fill(0);
  for (const s of samples) for (let k = 0; k < 34; k++) attrStd[k] += (s.attrs[k] - attrMean[k]) ** 2;
  for (let k = 0; k < 34; k++) attrStd[k] = Math.sqrt(attrStd[k] / samples.length) || 1;
  const predMap = new Map(resultsOOF.M2.map((p) => [p.id, p]));
  const zVec = (s) => s.attrs.map((v, k) => (v - attrMean[k]) / attrStd[k]);
  const dist = (a, b) => { const va = zVec(a), vb = zVec(b); let d = 0; for (let k = 0; k < 34; k++) d += (va[k] - vb[k]) ** 2; return Math.sqrt(d); };
  const bodyDist = (a, b) => Math.abs(a.heightCm - b.heightCm) + Math.abs(a.wingspanCm - b.wingspanCm);
  // per-position all-pairs + 中位数距离（非 1-NN；文档与实现一致）
  const matched = [];
  for (const p of positions) {
    const sub = samples.filter((s) => s.position === p);
    const pairs = [];
    for (let i = 0; i < sub.length; i++) for (let j = i + 1; j < sub.length; j++) pairs.push({ a: sub[i], b: sub[j], d: dist(sub[i], sub[j]) });
    pairs.sort((x, y) => x.d - y.d);
    const med = pairs[Math.floor(pairs.length / 2)].d;
    for (const pr of pairs.filter((x) => x.d <= med)) {
      const ra = predMap.get(pr.a.id), rb = predMap.get(pr.b.id);
      if (!ra || !rb) continue;
      matched.push({
        a: pr.a, b: pr.b, attrD: pr.d, bodyD: bodyDist(pr.a, pr.b),
        intA: pr.a.intangibles ?? 50, intB: pr.b.intangibles ?? 50,
        resA: pr.a.overall - ra.predRaw, resB: pr.b.overall - rb.predRaw,
      });
    }
  }
  // 分组：bodyD 三分位
  const sorted = [...matched].sort((x, y) => x.bodyD - y.bodyD);
  const t1 = sorted.slice(0, Math.floor(sorted.length / 3));
  const t3 = sorted.slice(Math.floor(sorted.length * 2 / 3));
  const intDiff = (arr) => Math.abs(arr.reduce((a, b) => a + (b.intA - b.intB), 0) / arr.length);
  const resDiff = (arr) => Math.abs(arr.reduce((a, b) => a + (b.resA - b.resB), 0) / arr.length);
  push(`matched 对总数：${matched.length}（属性距离 ≤ position 中位数）`);
  push("");
  push("| body 差异组 | n | mean attrD | mean bodyD (cm) | mean |ΔInt| | mean |ΔresidualRaw| |");
  push("|---|---|---|---|---|---|");
  push(`| 低 body 差异（下 1/3） | ${t1.length} | ${f(t1.reduce((a, b) => a + b.attrD, 0) / t1.length, 1)} | ${f(t1.reduce((a, b) => a + b.bodyD, 0) / t1.length, 1)} | ${f(intDiff(t1), 2)} | ${f(resDiff(t1), 2)} |`);
  push(`| 高 body 差异（上 1/3） | ${t3.length} | ${f(t3.reduce((a, b) => a + b.attrD, 0) / t3.length, 1)} | ${f(t3.reduce((a, b) => a + b.bodyD, 0) / t3.length, 1)} | ${f(intDiff(t3), 2)} | ${f(resDiff(t3), 2)} |`);
  push("");
  push("若 高 body 差异组 的 |ΔInt| / |ΔresidualRaw| 显著高于低组 → morphology 有独立信息；否则无。");
  push("");
  push("### 高 body 差异 matched 对 top 12");
  push("");
  push("| 对 | pos | Δattr (z) | Δbody (cm) | Int A/B | resRaw A/B |");
  push("|---|---|---|---|---|---|");
  for (const pr of sorted.slice(-12).reverse()) {
    push(`| ${pr.a.name} vs ${pr.b.name} | ${pr.a.position} | ${f(pr.attrD, 1)} | ${f(pr.bodyD, 0)} | ${pr.intA}/${pr.intB} | ${f(pr.resA, 1)}/${f(pr.resB, 1)} |`);
  }
}
push("");
push("## 7. 结论");
push("");
push("- M1−M0 与 M2−M0 的增量改善：见 §1/§2（fold-level 稳定性判定）");
push("- **不因 0.01 MAE 改善声称 morphology 有价值**；判断标准 = 增量是否跨 fold 稳定且幅度 > 噪声");
push("- source wingspan 为真实 cm 仅用于本研究；**target Create Player wingspan 是 opaque 1-100，无验证映射，不 invent conversion**");

writeFileSync("reports/rookie-overall-morphology-incremental-test.md", L.join("\n"), "utf8");
console.log(L.join("\n"));
console.log("\nreport -> reports/rookie-overall-morphology-incremental-test.md");
