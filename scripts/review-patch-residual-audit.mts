#!/usr/bin/env node
/**
 * Review Patch — 大残差样本 provenance/data audit。
 * 对 Reed Sheppard(+12)、Jaxson Hayes(+9)、Justin Edwards(+8) 等 Top 误差样本
 * 检查：OVR、position、atomic attrs、Intangibles、override、card identity 无错位。
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

// V3-B 训练样本（复现 train-rookie-overall-v3.mts 逻辑）
const ATTRS = [
  "Three-Point Shot", "Mid-Range Shot", "Free Throw", "Layup", "Close Shot",
  "Draw Foul", "Hands", "Post Fade", "Post Hook", "Post Control",
  "Driving Dunk", "Standing Dunk", "Ball Handle", "Speed with Ball",
  "Pass Accuracy", "Pass IQ", "Pass Vision", "Offensive Rebound",
  "Perimeter Defense", "Interior Defense", "Steal", "Block", "Defensive Rebound",
  "Speed", "Agility", "Vertical", "Stamina", "Hustle", "Strength", "Pass Perception",
  "Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ",
];
const positions = ["PG", "SG", "SF", "PF", "C"];
const clamp = (v, lo = 25, hi = 99) => Math.max(lo, Math.min(hi, v));

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
      overall: effectiveOvr, attrs,
      intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
      file: `${year}/${f}`, source: c.source, cardOvr: c.overall, override: ov,
    });
  }
}

// 训练 V3-B（全量）并预测
const FOLDS = 5, RIDGE = 100;
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
const trainData = samples.map((s) => ({ ...s, features: interactionFeatures(s, withIntangibles) }));
const model = fitRidge(trainData, RIDGE, dim);
if (!model) { console.error("singular"); process.exit(1); }

const preds = samples.map((s) => {
  const f = interactionFeatures(s, withIntangibles);
  const raw = model.intercept + f.reduce((t, v, i) => t + v * model.w[i], 0);
  return { ...s, pred: Math.round(clamp(raw, 40, 99)), err: Math.round(clamp(raw, 40, 99)) - s.overall };
});

// Top 误差
const worst = [...preds].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 8);
console.log("=== 大残差样本 provenance audit ===\n");
for (const s of worst) {
  const attrTop = ATTRS.map((a, i) => ({ a, v: s.attrs[i] }))
    .sort((x, y) => y.v - x.v).slice(0, 5).map((x) => `${x.a}=${x.v}`).join(", ");
  console.log(`【${s.name}】err=${s.err >= 0 ? "+" : ""}${s.err} (overall=${s.overall} pred=${s.pred})`);
  console.log(`  position=${s.position} year=${s.year} file=${s.file} source=${s.source}`);
  console.log(`  card.overall=${s.cardOvr} override=${JSON.stringify(s.override)}`);
  console.log(`  Intangibles=${s.intangibles}`);
  console.log(`  top attrs: ${attrTop}`);
  console.log("");
}
