#!/usr/bin/env node
/**
 * Train a dedicated OVR ridge model on real rookie cards.
 *
 * This writes src/data/rookieOverallModel-rookie.json. Coefficients are clipped
 * to be non-negative so the committed model satisfies its monotonic contract:
 * increasing any attribute or badge category must never lower OVR.
 *
 * Run: node --experimental-strip-types scripts/train-rookie-card-ovr.mts
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "node:fs/promises";
import { getBadgeCategory } from "../src/badges.ts";

const root = path.resolve(process.cwd());
const ridge = 100;
const folds = 5;

const attributes = [
  "Agility", "Ball Handle", "Block", "Close Shot", "Defensive Consistency",
  "Defensive Rebound", "Draw Foul", "Driving Dunk", "Free Throw", "Hands",
  "Help Defense IQ", "Hustle", "Interior Defense", "Layup", "Mid-Range Shot",
  "Offensive Consistency", "Offensive Rebound", "Pass Accuracy", "Pass IQ",
  "Pass Perception", "Pass Vision", "Perimeter Defense", "Post Control",
  "Post Fade", "Post Hook", "Shot IQ", "Speed", "Speed with Ball", "Stamina",
  "Standing Dunk", "Steal", "Strength", "Three-Point Shot", "Vertical",
  "Intangibles",
];
const badgeCategories = ["shooting", "playmaking", "inside", "defense", "rebounding", "athleticism"];
const tierPoints = { Bronze: 1, Silver: 2, Gold: 3, HOF: 4, Legendary: 5 };
const positions = ["PG", "SG", "SF", "PF", "C"];

const cards = [];
for await (const p of glob(path.join(root, "src/data/rookieCards/*/*.json"))) {
  const base = path.basename(p);
  if (base === "review.json" || base === "capture-manifest.json") continue;
  const c = JSON.parse(await readFile(p, "utf8"));
  if (typeof c.overall !== "number" || !c.position) continue;
  const position = String(c.position).split("/")[0];
  if (!positions.includes(position)) continue;
  const badgePoints = Object.fromEntries(badgeCategories.map((cat) => [cat, 0]));
  for (const b of c.badges ?? []) {
    const cat = getBadgeCategory(b.name);
    if (cat && badgePoints[cat] !== undefined && tierPoints[b.tier]) {
      badgePoints[cat] += tierPoints[b.tier];
    }
  }
  cards.push({
    id: c.slug,
    position,
    overall: c.overall,
    features: attributes.map((a) => clamp(Number(c.detailed?.[a]) || 65, 25, 99)),
    badgeFeatures: badgeCategories.map((cat) => badgePoints[cat]),
    badgeCount: (c.badges ?? []).length,
    rawBadges: c.badges ?? [],
  });
}
if (cards.length < 50) throw new Error(`not enough cards: ${cards.length}`);
console.log(`cards: ${cards.length}, positions: ${Object.fromEntries(positions.map((p) => [p, cards.filter((c) => c.position === p).length]))}`);

// --- dedicated rookie model: per-position ridge + player-grouped CV ---
const posAttr = Object.fromEntries(positions.map((p) => [p, fitRidge(cards.filter((c) => c.position === p), ridge, false)]));
const posBadge = Object.fromEntries(positions.map((p) => [p, fitRidge(cards.filter((c) => c.position === p), ridge, true)]));

const attrErrs = [];
const jointErrs = [];
for (let fold = 0; fold < folds; fold += 1) {
  for (const position of positions) {
    const train = cards.filter((c) => c.position === position && foldFor(c.id) !== fold);
    const test = cards.filter((c) => c.position === position && foldFor(c.id) === fold);
    if (train.length < 40 || test.length === 0) continue;
    const aModel = fitRidge(train, ridge, false);
    const bModel = fitRidge(train, ridge, true);
    for (const c of test) {
      const a = predict(aModel, c.features, false);
      attrErrs.push(a - c.overall);
      const b = predict(bModel, [...c.features, ...c.badgeFeatures], true);
      jointErrs.push(Math.max(a, b) - c.overall);
    }
  }
}
const attrMae = mae(attrErrs);
const jointMae = mae(jointErrs);
console.log(`rookie-card model CV: attr MAE=${attrMae.toFixed(3)}  attr+badge MAE=${jointMae.toFixed(3)}  n=${attrErrs.length}`);

// --- write production model file (same shape as existing models) ---
const model = {
  version: 3,
  dataVersion: "rookie-cards (DB2K official rookie cards 2003-2025)",
  sourceVersions: ["rookieCards"],
  foldStrategy: "card-slug",
  trainingSamples: cards.length,
  crossValidation: {
    folds,
    mae: round(attrMae, 3),
    rmse: round(rmse(attrErrs), 3),
    badgeSubsetMae: round(jointMae, 3),
    badgeSubsetRmse: round(rmse(jointErrs), 3),
    badgeSubsetCount: jointErrs.length,
  },
  ridge,
  badgeRidge: ridge,
  attributes,
  badgeCategories,
  tierPoints,
  badgeCombination: "monotonic-max-nonnegative",
  positions: posAttr,
  positionsWithBadges: posBadge,
};
const outPath = path.join(root, "src/data/rookieOverallModel-rookie.json");
await writeFile(outPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(`trained model -> ${path.relative(root, outPath)} (${cards.length} cards)`);

// --- helpers (mirror train-rookie-overall-model.mjs) ---
function cardBadgesFor(c) {
  return [];
}
function mae(errs: number[]) { return avg(errs.map((e) => Math.abs(e))); }
function rmse(errs: number[]) { return Math.sqrt(avg(errs.map((e) => e * e))); }
function round(v: number, digits: number) { const f = 10 ** digits; return Math.round(v * f) / f; }
function avg(v: number[]) { return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function fitRidge(data, lambda, withBadges) {
  const n = data.length;
  const p = withBadges ? attributes.length + badgeCategories.length : attributes.length;
  const xtx = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const xty = Array(p + 1).fill(0);
  for (const s of data) {
    const row = withBadges ? [1, ...s.features, ...s.badgeFeatures] : [1, ...s.features];
    for (let i = 0; i <= p; i += 1) {
      xty[i] += row[i] * s.overall;
      for (let j = 0; j <= p; j += 1) xtx[i][j] += row[i] * row[j];
    }
  }
  for (let i = 1; i <= p; i += 1) xtx[i][i] += lambda;
  const coef = solve(xtx, xty);
  if (withBadges) {
    return enforceNonNegative({
      intercept: coef[0],
      coefficients: Object.fromEntries(attributes.map((a, i) => [a, coef[i + 1]])),
      badgeCoefficients: Object.fromEntries(badgeCategories.map((c, i) => [c, coef[i + 1 + attributes.length]])),
    }, data, true);
  }
  return enforceNonNegative({
    intercept: coef[0],
    coefficients: Object.fromEntries(attributes.map((a, i) => [a, coef[i + 1]])),
  }, data, false);
}

function enforceNonNegative(model, data, withBadges) {
  const coefficients = Object.fromEntries(
    Object.entries(model.coefficients).map(([key, value]) => [key, Math.max(0, value)]),
  );
  const badgeCoefficients = withBadges
    ? Object.fromEntries(
      Object.entries(model.badgeCoefficients).map(([key, value]) => [key, Math.max(0, value)]),
    )
    : undefined;

  let intercept = model.intercept;
  if (data.length > 0) {
    const meanOverall = avg(data.map((sample) => sample.overall));
    const meanAttributeContribution = attributes.reduce((total, attribute, index) => (
      total + avg(data.map((sample) => sample.features[index])) * coefficients[attribute]
    ), 0);
    const meanBadgeContribution = withBadges
      ? badgeCategories.reduce((total, category, index) => (
        total + avg(data.map((sample) => sample.badgeFeatures[index])) * badgeCoefficients[category]
      ), 0)
      : 0;
    intercept = meanOverall - meanAttributeContribution - meanBadgeContribution;
  }

  return withBadges
    ? { ...model, intercept, coefficients, badgeCoefficients }
    : { ...model, intercept, coefficients };
}
function predict(model, features, nonnegativeBadges = false) {
  const est = attributes.reduce((t, a, i) => t + features[i] * (model.coefficients[a] ?? 0), model.intercept)
    + (nonnegativeBadges ? badgeCategories.reduce((t, c, i) => t + (features[attributes.length + i] ?? 0) * Math.max(0, model.badgeCoefficients?.[c] ?? 0), 0) : 0);
  return clamp(est, 40, 99);
}
function solve(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error("singular");
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
function foldFor(value) {
  let h = 2166136261;
  for (const ch of value) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % folds;
}
