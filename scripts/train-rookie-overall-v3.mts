#!/usr/bin/env node
/**
 * OVR V3 ablation — official-only, 4 feature sets, position interactions.
 *
 * Models (spec F3):
 *   A: 34 atomic attrs + position
 *   B: A + Overall Adjustment (Intangibles = 综评补偿)
 *   C: A + Overall Durability (durability.overall)
 *   D: A + both
 *
 * Position encoding (spec F4): unified Ridge + position one-hot +
 * position × atomic interactions; plus 5 independent position Ridge as
 * diagnostic baseline. NO Potential, NO slot scores, NO tendencies/badges.
 *
 * Evaluation: 5-fold grouped by card identity (no leakage), official-only
 * labels (hard requirement #4: OFFICIAL only, AMBIGUOUS excluded).
 * Same-split fair comparison with the current production model
 * (src/data/rookieOverallModel-rookie.json).
 *
 * Run: node --experimental-strip-types scripts/train-rookie-overall-v3.mts
 * Output: reports/rookie-overall-v3-ablation.md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";

const positions = ["PG", "SG", "SF", "PF", "C"];
const FOLDS = 5;
const RIDGE = 100;

// ── 34 atomic attrs（detailed 中排除 Intangibles）───────────────
const ATTRS = [
  // 18 offense
  "Three-Point Shot", "Mid-Range Shot", "Free Throw", "Layup", "Close Shot",
  "Draw Foul", "Hands", "Post Fade", "Post Hook", "Post Control",
  "Driving Dunk", "Standing Dunk", "Ball Handle", "Speed with Ball",
  "Pass Accuracy", "Pass IQ", "Pass Vision", "Offensive Rebound",
  // 5 defense
  "Perimeter Defense", "Interior Defense", "Steal", "Block", "Defensive Rebound",
  // 7 athletic
  "Speed", "Agility", "Vertical", "Stamina", "Hustle", "Strength", "Pass Perception",
  // 4 mental
  "Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ",
];
// 18 + 5 + 7 + 4 = 34
if (ATTRS.length !== 34) throw new Error(`expected 34 attrs, got ${ATTRS.length}`);

const clamp = (v, lo = 25, hi = 99) => Math.max(lo, Math.min(hi, v));
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
const coreName = (raw) => String(raw ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i")
  .toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ── load overrides ─────────────────────────────────────────────
const overrides = new Map();
for (const f of readdirSync(OVERRIDES_DIR)) {
  if (!/^\d{4}-overrides\.json$/.test(f)) continue;
  for (const [slug, v] of Object.entries(JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8")))) overrides.set(slug, v);
}

// ── load cards, keep ONLY official ─────────────────────────────
const samples = [];
let ambExcluded = 0, estExcluded = 0, noOvrExcluded = 0;
const seenCore = new Set();
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    // 去重必须在任何检查之前：coreName 首见（最早年份）即正式 rookie 卡，
    // 与 build-rookie-card-index 语义一致。否则 reggie-williams 1987(ovr=null)
    // 被提前 continue，2008(ovr=70) 会冒充正式卡进入训练集（Audit Revision #1）。
    const key = coreName(c.name);
    if (seenCore.has(key)) continue;
    seenCore.add(key);
    const ov = overrides.get(c.slug);
    const estFlag = ov?.estimated === true;
    const estSource = c.overallSource === "model-estimated-gap";
    if (estFlag || estSource) { estExcluded++; continue; }
    // Audit Revision v2：OVR 采用 index 语义（override 覆盖卡文件），
    // OFFICIAL 唯一判据 = override.source 显式 user-ui-confirmed 字段。
    const effectiveOvr = ov?.overall != null ? ov.overall : c.overall;
    if (typeof effectiveOvr !== "number") { noOvrExcluded++; continue; }
    const isConfirmed = typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed");
    if (!isConfirmed) { ambExcluded++; continue; }
    const pos = String(c.position ?? "SF").split("/")[0];
    if (!positions.includes(pos)) continue;
    const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
    if (attrs.some((v) => v === 0)) continue; // 缺字段保护
    samples.push({
      id: c.slug,
      name: c.name,
      position: pos,
      year: Number(year),
      overall: effectiveOvr,
      attrs,
      intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
      durability: clamp(Number(c.durability?.overall) || 80, 25, 99),
    });
  }
}
console.log(`official samples: ${samples.length} (excluded: est=${estExcluded} amb=${ambExcluded} noOVR=${noOvrExcluded})`);
if (samples.length < 200) throw new Error(`not enough official samples: ${samples.length}`);

// ── Ridge 线性代数 ─────────────────────────────────────────────
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
  const n = data.length;
  const p = featureDim;
  const xtx = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const xty = Array(p + 1).fill(0);
  for (const s of data) {
    const row = [1, ...s.features]; // intercept + p features
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

// ── feature builders ───────────────────────────────────────────
function baseFeatures(s) {
  return [...s.attrs]; // 34
}
function withIntangibles(s) {
  return [...s.attrs, s.intangibles]; // 35
}
function withDurability(s) {
  return [...s.attrs, s.durability]; // 35
}
function withBoth(s) {
  return [...s.attrs, s.intangibles, s.durability]; // 36
}

// position one-hot + position × attr interactions（统一 Ridge）
function interactionFeatures(s, baseFn) {
  const base = baseFn(s);
  const feats = [...base];
  for (const p of positions) feats.push(p === s.position ? 1 : 0);
  for (const p of positions) {
    for (const v of base) feats.push(p === s.position ? v : 0);
  }
  return feats;
}
function interactionDim(baseDim) {
  return baseDim + 5 + 5 * baseDim;
}

// ── production model reference（同集对比）───────────────────────
import prodModel from "../src/data/rookieOverallModel-rookie.json" with { type: "json" };
function productionPredict(s) {
  const posModel = prodModel.positions?.[s.position] ?? prodModel.positions?.SF;
  if (!posModel) return 65;
  let est = posModel.intercept ?? 0;
  const attrs = prodModel.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 1) {
    const attr = attrs[i];
    const value = s.attrs[ATTRS.indexOf(attr)];
    const resolved = value !== undefined ? clamp(value) : (attr === "Intangibles" ? 50 : 65);
    est += resolved * (posModel.coefficients?.[attr] ?? 0);
  }
  // badges 未知（V3 无 badge features），按无徽章路径
  return Math.round(clamp(est, 40, 99));
}

// ── CV ─────────────────────────────────────────────────────────
function foldFor(id) {
  let h = 2166136261;
  for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % FOLDS;
}

function runCV(buildFeatures, dim, label, opts = {}) {
  const folds = Array.from({ length: FOLDS }, () => []);
  for (const s of samples) folds[foldFor(s.id)].push(s);
  const preds = [];
  for (let k = 0; k < FOLDS; k += 1) {
    const train = folds.flatMap((fold, i) => (i === k ? [] : fold));
    const test = folds[k];
    const trainData = train.map((s) => ({ ...s, features: buildFeatures(s) }));
    const model = fitRidge(trainData, RIDGE, dim);
    if (!model) { console.warn(`fold ${k} singular`); continue; }
    for (const s of test) {
      const f = buildFeatures(s);
      const raw = model.intercept + f.reduce((t, v, i) => t + v * model.w[i], 0);
      preds.push({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: Math.round(clamp(raw, 40, 99)) });
    }
  }
  return preds;
}

function metrics(preds) {
  const errs = preds.map((p) => p.pred - p.overall);
  const mae = avg(errs.map(Math.abs));
  const rmse = Math.sqrt(avg(errs.map((e) => e * e)));
  const bias = avg(errs);
  const exact = preds.filter((p) => p.pred === p.overall).length / preds.length;
  const w1 = preds.filter((p) => Math.abs(p.pred - p.overall) <= 1).length / preds.length;
  const w2 = preds.filter((p) => Math.abs(p.pred - p.overall) <= 2).length / preds.length;
  return { n: preds.length, mae, rmse, bias, exact, w1, w2 };
}

function subgroup(preds, keyFn) {
  const groups = new Map();
  for (const p of preds) {
    const k = keyFn(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const out = {};
  for (const [k, list] of groups) out[k] = metrics(list);
  return out;
}

// ── 执行 ───────────────────────────────────────────────────────
const models = {
  "V3-A (34+pos)": { build: (s) => interactionFeatures(s, baseFeatures), dim: interactionDim(34) },
  "V3-B (+Intangibles)": { build: (s) => interactionFeatures(s, withIntangibles), dim: interactionDim(35) },
  "V3-C (+Durability)": { build: (s) => interactionFeatures(s, withDurability), dim: interactionDim(35) },
  "V3-D (+both)": { build: (s) => interactionFeatures(s, withBoth), dim: interactionDim(36) },
};

const results: Record<string, { preds: Array<{ id: string; name: string; position: string; overall: number; pred: number }>; metrics: ReturnType<typeof metrics> }> = {};
for (const [name, cfg] of Object.entries(models)) {
  const preds = runCV(cfg.build, cfg.dim, name);
  results[name] = { preds, metrics: metrics(preds) };
  console.log(`${name}: MAE=${results[name].metrics.mae.toFixed(3)} RMSE=${results[name].metrics.rmse.toFixed(3)} ±1=${(results[name].metrics.w1 * 100).toFixed(1)}% n=${preds.length}`);
}

// production model same-split
const prodPreds = samples.map((s) => ({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: productionPredict(s) }));
results["Production (current)"] = { preds: prodPreds, metrics: metrics(prodPreds) };
console.log(`Production: MAE=${results["Production (current)"].metrics.mae.toFixed(3)} RMSE=${results["Production (current)"].metrics.rmse.toFixed(3)} ±1=${(results["Production (current)"].metrics.w1 * 100).toFixed(1)}% n=${prodPreds.length}`);

// 5 independent position Ridge（诊断 baseline = Production-Architecture OOF）
// Production 架构 = 每 position 独立 Ridge（34 attrs，无 interaction）。
// 为公平架构比较，这里用与 V3 完全相同的 official-only folds 每 fold 重训，
// 作为「Production-Architecture OOF」baseline。
const posRidgeResults = {};
const posRidgePreds = [];
for (const p of positions) {
  const subset = samples.filter((s) => s.position === p);
  const preds = [];
  for (let k = 0; k < FOLDS; k += 1) {
    const train = subset.filter((s) => foldFor(s.id) !== k);
    const test = subset.filter((s) => foldFor(s.id) === k);
    if (train.length < 40 || test.length === 0) continue;
    const trainData = train.map((s) => ({ ...s, features: baseFeatures(s) }));
    const m = fitRidge(trainData, RIDGE, 34);
    if (!m) continue;
    for (const s of test) {
      const f = baseFeatures(s);
      const raw = m.intercept + f.reduce((t, v, i) => t + v * m.w[i], 0);
      preds.push({ id: s.id, name: s.name, position: p, overall: s.overall, pred: Math.round(clamp(raw, 40, 99)) });
    }
  }
  posRidgeResults[p] = metrics(preds);
  posRidgePreds.push(...preds);
  console.log(`prod-arch OOF ${p}: MAE=${posRidgeResults[p].mae.toFixed(3)} n=${preds.length}`);
}
const prodArchOOF = metrics(posRidgePreds);
console.log(`Production-Architecture OOF total: MAE=${prodArchOOF.mae.toFixed(3)} RMSE=${prodArchOOF.rmse.toFixed(3)} ±1=${(prodArchOOF.w1 * 100).toFixed(1)}% n=${prodArchOOF.n}`);

// ── V3-B effective coefficients + monotonicity audit ─────────────
// V3-B 结构：pred = intercept + Σ_i w_base[i]·attr[i]
//                + Σ_p w_onehot[p]·1[pos=p]      ← 仅影响 intercept
//                + Σ_p Σ_i w_inter[p,i]·1[pos=p]·attr[i]
// 某 position p 下 attr i 的 **effective slope**（属性斜率）：
//   slope[p,i] = w_base[i] + w_inter[p,i]
// position one-hot 只改变 intercept（w_base + w_onehot[p] 进入常数项），
// 不进入属性斜率。修正前误把 one-hot 加入 slope（Review Patch A.2）。
// 用全量 664 训练一次 V3-B 提取系数（CV 之外，仅诊断用）。
{
  const trainData = samples.map((s) => ({ ...s, features: interactionFeatures(s, withIntangibles) }));
  const dim = interactionDim(35);
  const model = fitRidge(trainData, RIDGE, dim);
  if (model) {
    const baseDim = 35; // attrs + intangibles
    const w = model.w;
    const eff = {};
    for (const p of positions) {
      eff[p] = {};
      for (let i = 0; i < baseDim; i += 1) {
        const interIdx = baseDim + 5 + positions.indexOf(p) * baseDim + i;
        // 修正：不再加 one-hot（w[baseDim + posIdx]）
        eff[p][i] = w[i] + w[interIdx];
      }
    }
    const names = [...ATTRS, "Intangibles"];
    const negRows = [];
    for (const p of positions) {
      for (let i = 0; i < names.length; i += 1) {
        if (eff[p][i] < 0) negRows.push({ p, attr: names[i], coef: eff[p][i] });
      }
    }
    console.log("\n=== V3-B monotonicity audit（effective slopes，修正公式）===");
    console.log(`负 effective slope 总数: ${negRows.length}（34 attrs + Intangibles 中）`);
    for (const r of negRows.sort((a, b) => a.coef - b.coef)) {
      console.log(`  ${r.p} ${r.attr}: ${r.coef.toFixed(4)}`);
    }
    // 保存供报告
    (globalThis as any).__v3bEff = { eff, names, negRows };
  }
}
const L: string[] = [];
const push = (s = "") => L.push(s);
push("# OVR V3 Ablation — official-only");
push("");
push(`日期：2026-08-14 · official samples: **${samples.length}**（排除 ESTIMATED ${estExcluded} / AMBIGUOUS ${ambExcluded} / NO_OVR ${noOvrExcluded}）`);
push(`CV: ${FOLDS}-fold grouped by card identity（同一球员不跨 train/test）· Ridge λ=${RIDGE} · position one-hot + position×attr interactions`);
push("");
push("## 1. 总体对比（同一 official-only CV）");
push("");
push("| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |");
push("|---|---|---|---|---|---|---|---|");
for (const [name, r] of Object.entries(results)) {
  const m = r.metrics;
  push(`| ${name} | ${m.n} | ${(m.exact * 100).toFixed(1)}% | ${(m.w1 * 100).toFixed(1)}% | ${(m.w2 * 100).toFixed(1)}% | ${m.mae.toFixed(3)} | ${m.rmse.toFixed(3)} | ${m.bias.toFixed(3)} |`);
}
push(`| Production-Architecture OOF | ${prodArchOOF.n} | ${(prodArchOOF.exact * 100).toFixed(1)}% | ${(prodArchOOF.w1 * 100).toFixed(1)}% | ${(prodArchOOF.w2 * 100).toFixed(1)}% | ${prodArchOOF.mae.toFixed(3)} | ${prodArchOOF.rmse.toFixed(3)} | ${prodArchOOF.bias.toFixed(3)} |`);
push("");
push("**baseline 语义说明（Review Patch）**：");
push("- `Production (current)` = **Deployed Production**：线上模型原样（rookieOverallModel-rookie.json，用 1190 张全量训练过），此处仅描述现有产品行为，**不是**公平 CV baseline（其训练集含 475 张 ESTIMATED 且分割不同）");
push("- `Production-Architecture OOF` = **架构公平对比**：与 V3 完全相同的 official-only folds，每 fold 重新训练现有 production 架构（每 position 独立 Ridge，34 attrs），用于回答「V3 的提升来自架构还是数据清洗」");
push("");
push("## 2. 按 position（V3-B 主诊断 + Production-Architecture OOF + Deployed）");
push("");
push("| position | model | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|---|");
for (const p of positions) {
  for (const [name, r] of [["V3-B", results["V3-B (+Intangibles)"]], ["ProdArch-OOF", { preds: posRidgePreds.filter((x) => x.position === p), metrics: posRidgeResults[p] }], ["Deployed", results["Production (current)"]]]) {
    const m = metrics(r.preds.filter((x) => x.position === p));
    push(`| ${p} | ${name} | ${m.n} | ${(m.exact * 100).toFixed(1)}% | ${(m.w1 * 100).toFixed(1)}% | ${m.mae.toFixed(3)} | ${m.rmse.toFixed(3)} |`);
  }
}
push("");
push("## 3. 按 OVR band（V3-B 主诊断）");
push("");
push("⚠️ **85+ 为 extrapolation/out-of-support region**：官方标签上限 84，85+ 样本数 = 0。");
push("不得报告 85+ accuracy；<85 的 CV 良好不得作为 production switch 的理由。");
push("");
push("| band | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|");
const bandGroups = subgroup(results["V3-B (+Intangibles)"].preds, (p) => p.overall < 70 ? "<70" : p.overall < 80 ? "70-79" : p.overall < 85 ? "80-84" : "85+");
for (const [band, m] of Object.entries(bandGroups)) {
  push(`| ${band} | ${m.n} | ${(m.exact * 100).toFixed(1)}% | ${(m.w1 * 100).toFixed(1)}% | ${m.mae.toFixed(3)} | ${m.rmse.toFixed(3)} |`);
}
push("");
push("### 3b. 80-84 逐样本诊断（V3-B）");
push("");
push("| name | position | overall | pred | err |");
push("|---|---|---|---|---|");
{
  const band8084 = results["V3-B (+Intangibles)"].preds.filter((p) => p.overall >= 80 && p.overall <= 84);
  for (const p of band8084.sort((a, b) => a.overall - b.overall || a.name.localeCompare(b.name))) {
    push(`| ${p.name} | ${p.position} | ${p.overall} | ${p.pred} | ${p.pred - p.overall} |`);
  }
  push("");
  push(`（80-84 band 共 ${band8084.length} 张，为官方 OVR 最高区间，全部列出）`);
}
push("");
push("## 4. Production-Architecture OOF 按 position（= 原 5 独立 Ridge 诊断）");
push("");
push("| position | n | MAE | RMSE |");
push("|---|---|---|---|");
for (const p of positions) push(`| ${p} | ${posRidgeResults[p].n ?? 0} | ${(posRidgeResults[p].mae ?? NaN).toFixed(3)} | ${(posRidgeResults[p].rmse ?? NaN).toFixed(3)} |`);
push("");
push("## 4b. grouped-by-era holdout（F5 要求，方向不对称说明）");
push("");
push("按 draftYear 分两段：old = 2003-2013（train），new = 2014-2025（test），再反向。");
push("仅对 V3-B 与 Deployed Production 比较（V3-B 为总体最佳）。");
{
  const eraOld = samples.filter((s) => s.year <= 2013);
  const eraNew = samples.filter((s) => s.year >= 2014);
  const eraRows = [];
  for (const [eraName, trainSet, testSet] of [
    ["old→new", eraOld, eraNew],
    ["new→old", eraNew, eraOld],
  ] as const) {
    for (const [mName, fn] of [["V3-B", (s: any) => interactionFeatures(s, withIntangibles)], ["Deployed", null]] as const) {
      let preds;
      if (fn) {
        const dim = interactionDim(35);
        const trainData = trainSet.map((s) => ({ ...s, features: fn(s) }));
        const model = fitRidge(trainData, RIDGE, dim);
        preds = model ? testSet.map((s) => {
          const f = fn(s);
          const raw = model.intercept + f.reduce((t, v, i) => t + v * model.w[i], 0);
          return { id: s.id, name: s.name, position: s.position, overall: s.overall, pred: Math.round(clamp(raw, 40, 99)) };
        }) : [];
      } else {
        preds = testSet.map((s) => ({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: productionPredict(s) }));
      }
      const m = metrics(preds);
      eraRows.push(`| ${eraName} | ${mName} | train ${trainSet.length} → test ${testSet.length} | ${(m.exact * 100).toFixed(1)}% | ${(m.w1 * 100).toFixed(1)}% | ${m.mae.toFixed(3)} | ${m.rmse.toFixed(3)} |`);
    }
  }
  push("| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |");
  push("|---|---|---|---|---|---|---|");
  for (const row of eraRows) push(row);
  push("");
  push("**方向不对称（Review Patch 修正）**：");
  push("- **old→new（2003-2013 训练 → 2014-2025 测试）**：Deployed 优于 V3-B（见上表 MAE）——旧 era 数据训练时，V3-B 依赖的 Intangibles 分布变化导致泛化受损；**不得表述为“V3-B 跨 era 整体仍优于 Production”**");
  push("- **new→old（2014-2025 训练 → 2003-2013 测试）**：V3-B 优于 Deployed");
  push("- 结论：V3-B 的优势**依赖现代 era 数据**；向旧 era 外推时优势消失甚至反转。此不对称必须如实报告，作为 production switch 的负面证据");
}
push("");
push("## 5. 最大绝对误差 Top 20（V3-B）");
push("");
push("| name | position | overall | pred | err |");
push("|---|---|---|---|---|");
const worst = [...results["V3-B (+Intangibles)"].preds].sort((a, b) => Math.abs(b.pred - b.overall) - Math.abs(a.pred - a.overall)).slice(0, 20);
for (const w of worst) push(`| ${w.name} | ${w.position} | ${w.overall} | ${w.pred} | ${w.pred - w.overall} |`);
push("");
push("## 5b. V3-B effective slopes（position × feature）与 monotonicity audit");
push("");
push("V3-B 结构：pred = intercept + Σ base·attr + Σ onehot·1[pos] + Σ inter·1[pos]·attr。");
push("某 position 下 attr 的 **effective slope** = base + interaction（one-hot 仅进 intercept，不进属性斜率）。");
push("全量 664 训练一次，仅诊断。");
push("");
{
  const effData = (globalThis as any).__v3bEff;
  if (effData) {
    const { eff, names, negRows } = effData;
    push("### 5b-1. 每 position 有效系数（绝对值最大 10 个）");
    push("");
    for (const p of positions) {
      const rows = names.map((n, i) => ({ name: n, coef: eff[p][i] })).sort((a, b) => Math.abs(b.coef) - Math.abs(a.coef)).slice(0, 10);
      push(`**${p}**：${rows.map((r) => `${r.name}=${r.coef.toFixed(3)}`).join(" · ")}`);
      push("");
    }
    push("### 5b-2. monotonicity audit（负 effective slope）");
    push("");
    push(`负 effective slope 总数：**${negRows.length}**（34 attrs + Intangibles 中，未自动修正，仅报告）`);
    push("");
    if (negRows.length > 0) {
      push("| position | feature | effective coef |");
      push("|---|---|---|");
      for (const r of negRows.sort((a, b) => a.coef - b.coef)) push(`| ${r.p} | ${r.attr} | ${r.coef.toFixed(4)} |`);
      push("");
      push("⚠️ 负 slope 意味着该 position 下该属性**增加可能导致预测 OVR 下降**，违反单调性直觉。");
      push("原因待查：可能为特征共线 / 小样本噪声 / 标签与属性错位。**不自动修正**，先报告（Review Patch 要求）；");
      push("synthetic +1 实测已证明至少部分负 slope 真实存在，monotonicity blocker 保持有效（Stage 5.1 V3-E 解决）。");
    } else {
      push("无负 effective 系数（全部 position × feature 单调）。");
    }
  }
}
push("");
push("## 6. 结论（F8 十问 + Review Patch 修正）");
push("");
const mA = results["V3-A (34+pos)"].metrics;
const mB = results["V3-B (+Intangibles)"].metrics;
const mC = results["V3-C (+Durability)"].metrics;
const mD = results["V3-D (+both)"].metrics;
const mP = results["Production (current)"].metrics;
push(`1. A/B/C/D 总体最好：${[["A", mA], ["B", mB], ["C", mC], ["D", mD]].sort((a, b) => a[1].mae - b[1].mae)[0][0]}（MAE ${Math.min(mA.mae, mB.mae, mC.mae, mD.mae).toFixed(3)}）`);
push(`2. 85+ / 各 position 最稳：85+ 无官方样本（extrapolation，不报告）；position 见第 2 节（V3-B 主诊断）`);
push(`3. Overall Adjustment (Intangibles) 增益：A→B MAE ${mA.mae.toFixed(3)}→${mB.mae.toFixed(3)}（${(mA.mae - mB.mae).toFixed(3)}）`);
push(`4. Overall Durability 增益：A→C MAE ${mA.mae.toFixed(3)}→${mC.mae.toFixed(3)}（${(mA.mae - mC.mae).toFixed(3)}）`);
push(`5. 增益是否值得 synthetic 语义复杂度：见审阅（需解释 synthetic Intangibles/Durability 来源；见 §9）`);
push(`6. interaction Ridge vs 独立 Ridge：主模型 = unified regularized position-interaction（V3-B）；Production-Architecture OOF（每 position 独立 Ridge）见第 4 节，仅为架构公平对比`);
push(`7. grouped-by-era holdout：**方向不对称**——old→new 中 Deployed 优于 V3-B；new→old 中 V3-B 优于 Deployed（见 4b 修正说明）。不得概括为“V3-B 跨 era 整体仍优于 Production”`);
push(`8. 标签污染：production 训练集混入 475 张 ESTIMATED（训练 1190 = OFFICIAL 664 + ESTIMATED 475 + AMBIGUOUS 51；本实验已排除）。[Review Patch 修正：此前误写 665/48/2]`);
push(`9. 当前生产模型 vs V3 同集比较：Deployed MAE ${mP.mae.toFixed(3)} vs V3-B MAE ${mB.mae.toFixed(3)}（${(mP.mae - mB.mae).toFixed(3)}）；Production-Architecture OOF MAE ${prodArchOOF.mae.toFixed(3)}（架构公平对比）`);
push(`10. 是否建议替换：**不建议自动切换**。理由：(a) 85+ 无官方样本，生产会 extrapolate；(b) V3-B 依赖 synthetic Intangibles 语义需确认；(c) era 外推方向不对称；(d) 等待审阅`);
push("");
push("## 7. 训练输入声明");
push("");
push("- official-only：✅（ESTIMATED/AMBIGUOUS/NO_OVR 全部排除；canonical identity universe 1797 中的 OFFICIAL 664）");
push("- Potential 进入模型：❌ 否");
push("- 16 slot score 进入模型：❌ 否");
push("- tendencies/badges/hot zones/body 进入模型：❌ 否");
push("- donor identity / player name / draft year 作为 feature：❌ 否");

const report = L.join("\n");
writeFileSync("reports/rookie-overall-v3-ablation.md", report, "utf8");
console.log("\nreport -> reports/rookie-overall-v3-ablation.md");

// ── canonical results JSON（供 Final Report Sync / 断言）─────────
const canon = {
  generatedAt: new Date().toISOString(),
  officialN: samples.length,
  excluded: { est: estExcluded, amb: ambExcluded, noOVR: noOvrExcluded },
  models: {},
  eraHoldout: {},
  topErrors: {},
  band8084: {},
  negSlopes: {},
};
for (const [name, r] of Object.entries(results)) {
  const m = r.metrics;
  canon.models[name] = {
    n: m.n, exact: m.exact, w1: m.w1, w2: m.w2, mae: m.mae, rmse: m.rmse, bias: m.bias,
    byPosition: {},
  };
  for (const p of positions) {
    const mp = metrics(r.preds.filter((x) => x.position === p));
    canon.models[name].byPosition[p] = { n: mp.n, mae: mp.mae, rmse: mp.rmse, exact: mp.exact, w1: mp.w1 };
  }
}
canon.models["Production-Architecture OOF"] = {
  n: prodArchOOF.n, exact: prodArchOOF.exact, w1: prodArchOOF.w1, w2: prodArchOOF.w2, mae: prodArchOOF.mae, rmse: prodArchOOF.rmse, bias: prodArchOOF.bias,
  byPosition: {},
};
for (const p of positions) {
  const mp = metrics(posRidgePreds.filter((x) => x.position === p));
  canon.models["Production-Architecture OOF"].byPosition[p] = { n: mp.n, mae: mp.mae, rmse: mp.rmse, exact: mp.exact, w1: mp.w1 };
}
// era holdout（与报告 4b 相同逻辑）
{
  const eraOld = samples.filter((s) => s.year <= 2013);
  const eraNew = samples.filter((s) => s.year >= 2014);
  for (const [eraName, trainSet, testSet] of [["old→new", eraOld, eraNew], ["new→old", eraNew, eraOld]] as const) {
    const row = {};
    for (const [mName, fn] of [["V3-B (+Intangibles)", (s: any) => interactionFeatures(s, withIntangibles)], ["Production (current)", null]] as const) {
      let preds;
      if (fn) {
        const dim2 = interactionDim(35);
        const model2 = fitRidge(trainSet.map((s) => ({ ...s, features: fn(s) })), RIDGE, dim2);
        preds = model2 ? testSet.map((s) => {
          const f = fn(s);
          const raw = model2.intercept + f.reduce((t, v, i) => t + v * model2.w[i], 0);
          return { id: s.id, name: s.name, position: s.position, overall: s.overall, pred: Math.round(clamp(raw, 40, 99)) };
        }) : [];
      } else {
        preds = testSet.map((s) => ({ id: s.id, name: s.name, position: s.position, overall: s.overall, pred: productionPredict(s) }));
      }
      const m = metrics(preds);
      row[mName] = { n: m.n, exact: m.exact, w1: m.w1, mae: m.mae, rmse: m.rmse };
    }
    canon.eraHoldout[eraName] = row;
  }
}
// top errors + band8084（V3-B 主诊断）
const v3bPreds = results["V3-B (+Intangibles)"].preds;
canon.topErrors["V3-B (+Intangibles)"] = [...v3bPreds]
  .sort((a, b) => Math.abs(b.pred - b.overall) - Math.abs(a.pred - a.overall))
  .slice(0, 20)
  .map((p) => ({ name: p.name, position: p.position, overall: p.overall, pred: p.pred, err: p.pred - p.overall }));
canon.band8084["V3-B (+Intangibles)"] = v3bPreds
  .filter((p) => p.overall >= 80 && p.overall <= 84)
  .sort((a, b) => a.overall - b.overall || a.name.localeCompare(b.name))
  .map((p) => ({ name: p.name, position: p.position, overall: p.overall, pred: p.pred, err: p.pred - p.overall }));
// neg slopes
const effData = (globalThis as any).__v3bEff;
if (effData) {
  canon.negSlopes = { count: effData.negRows.length, rows: effData.negRows };
}
writeFileSync("reports/rookie-overall-v3-canonical.json", JSON.stringify(canon, null, 2), "utf8");
console.log("canonical -> reports/rookie-overall-v3-canonical.json");
