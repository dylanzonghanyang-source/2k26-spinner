#!/usr/bin/env node
/**
 * Final Validation — V3-E lambda2 nested CV。
 *
 * provenance 审计：
 *   - λ1=100：继承 train-rookie-card-ovr.mts ridge=100（历史硬编码）→ V3-B RIDGE=100 → V3-E
 *   - λ2=200：V3-E 新引入（"较大 → 强收缩"），无独立 provenance → 必须验证
 *
 * 小型 nested CV：外层 5-fold（与 V3-E 相同 fold 分割），
 * 内层 3-fold 在 train 部分选 λ2 ∈ {50, 100, 200, 400}（λ1 固定 100），
 * 用选中 λ2 重训外层模型并评估外层 test。
 * 若 nested OOF ≈ 固定 λ2=200 的 OOF → 调参泄漏风险低。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];
const RIDGE_L1 = 100, ITERS = 20000, FOLDS = 5;
const L2_GRID = [50, 100, 200, 400];

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

const foldFor = (id) => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % FOLDS;
};
const innerFoldFor = (id) => {
  let h = 14695981039346656037n;
  for (const ch of String(id)) { h ^= BigInt(ch.charCodeAt(0)); h *= 1099511628211n; }
  return Number((h >> 32n) % BigInt(3));
};

// 优化版坐标下降（XᵀX 预计算）
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
  if (!n) return { mae: NaN };
  let mae = 0, rmse = 0;
  for (const p of preds) { const e = p.predRaw - p.overall; mae += Math.abs(e); rmse += e * e; }
  return { mae: mae / n, rmse: Math.sqrt(rmse / n) };
}

// ── nested CV ─────────────────────────────────────────────────
// 外层 5-fold；内层 3-fold 在 train 上选 λ2
const outerFoldPreds = {}; // λ2 -> preds
const chosenPerFold = [];
for (let k = 0; k < FOLDS; k++) {
  const train = samples.filter((s) => foldFor(s.id) !== k);
  const test = samples.filter((s) => foldFor(s.id) === k);
  // 内层选参：3-fold on train
  let bestL2 = null, bestInnerMae = Infinity;
  const innerScores = [];
  for (const l2 of L2_GRID) {
    const innerPreds = [];
    for (let ik = 0; ik < 3; ik++) {
      const itr = train.filter((s) => innerFoldFor(s.id) !== ik);
      const ite = train.filter((s) => innerFoldFor(s.id) === ik);
      const g = fitModel(itr, 34, null, RIDGE_L1, 0, ITERS);
      for (const p of positions) {
        const m = fitModel(itr.filter((s) => s.position === p), 34, g, RIDGE_L1, l2, ITERS);
        for (const s of ite.filter((x) => x.position === p)) innerPreds.push({ overall: s.overall, predRaw: predictModel(m, s) });
      }
    }
    const m = metrics(innerPreds);
    innerScores.push({ l2, mae: m.mae });
    if (m.mae < bestInnerMae) { bestInnerMae = m.mae; bestL2 = l2; }
  }
  chosenPerFold.push({ fold: k, bestL2, bestInnerMae, scores: innerScores });
  // 用选中 λ2 在外层 train 上重训、评估外层 test
  const g = fitModel(train, 34, null, RIDGE_L1, 0, ITERS);
  const preds = [];
  for (const p of positions) {
    const m = fitModel(train.filter((s) => s.position === p), 34, g, RIDGE_L1, bestL2, ITERS);
    for (const s of test.filter((x) => x.position === p)) preds.push({ id: s.id, name: s.name, position: p, overall: s.overall, predRaw: predictModel(m, s) });
  }
  outerFoldPreds[bestL2] = [...(outerFoldPreds[bestL2] ?? []), ...preds];
  console.log(`outer fold ${k}: inner chose λ2=${bestL2} (inner MAE=${bestInnerMae.toFixed(3)})`);
}

const allPreds = Object.values(outerFoldPreds).flat();
console.log(`\n=== nested CV 结果 ===`);
console.log(`nested OOF MAE: ${metrics(allPreds).mae.toFixed(3)} RMSE: ${metrics(allPreds).rmse.toFixed(3)} n=${allPreds.length}`);
console.log(`每 fold 选中 λ2: ${chosenPerFold.map((c) => c.bestL2).join(", ")}`);
console.log(`内层得分: ${JSON.stringify(chosenPerFold[0].scores.map((s) => `${s.l2}:${s.mae.toFixed(3)}`))}`);
console.log(`(参考: V3-E 固定 λ2=200 OOF MAE=0.828)`);
