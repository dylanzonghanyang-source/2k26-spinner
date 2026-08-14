#!/usr/bin/env node
/**
 * Stage 6B — 导出 V3-E 全量模型系数（display-only）。
 * 训练：official 664 全量（与 Stage 5.1 相同的 hierarchical 非负坐标下降），
 * 输出 src/data/rookieOverallV3E.json 供 estimateDisplayOverallV3E 运行时加载。
 * 该模型只用于 display/export/shadow，绝不进入 generation control。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];
const RIDGE_L1 = 100, RIDGE_L2 = 200, ITERS = 20000;

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
    samples.push({ id: c.slug, name: c.name, position: pos, year: Number(c.draftYear ?? 0), overall: eff, attrs, intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99) });
  }
}
console.log(`official samples: ${samples.length}`);

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
      xty[j] += row[j] * y[i]; xSum[j] += row[j];
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

// 全量训练
const globalModel = fitModel(samples, 34, null, RIDGE_L1, 0, ITERS);
const perPosition = {};
for (const p of positions) {
  perPosition[p] = fitModel(samples.filter((s) => s.position === p), 34, globalModel, RIDGE_L1, RIDGE_L2, ITERS);
}

// 验证：全量 in-sample MAE（raw）
let mae = 0;
for (const s of samples) {
  const m = perPosition[s.position];
  const raw = m.intercept + [...s.attrs, s.intangibles].reduce((t, v, j) => t + v * m.w[j], 0);
  mae += Math.abs(raw - s.overall);
}
console.log(`full in-sample raw MAE: ${(mae / samples.length).toFixed(3)}`);

// 导出
const modelJson = {
  version: "v3e",
  trainedAt: new Date().toISOString(),
  officialN: samples.length,
  lambda1: RIDGE_L1,
  lambda2: RIDGE_L2,
  attributes: [...ATTRS, "Intangibles"],
  positions,
  globalIntercept: globalModel.intercept,
  globalW: globalModel.w,
  perPosition: Object.fromEntries(positions.map((p) => [p, { intercept: perPosition[p].intercept, w: perPosition[p].w }])),
};
writeFileSync("src/data/rookieOverallV3E.json", JSON.stringify(modelJson), "utf8");
console.log("exported -> src/data/rookieOverallV3E.json");
