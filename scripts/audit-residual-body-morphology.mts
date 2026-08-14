#!/usr/bin/env node
/**
 * Residual × Body Morphology Audit。
 *
 * residual = official OVR − attribute-only predicted OVR
 * attribute-only 模型 = V3-E 去掉 Intangibles（monotonic hierarchical，
 * 34 attrs，无 Intangibles）——V3-A 类模型。OOF 预测（5-fold）保证
 * residual 是模型无法用 attributes 解释的真实部分。
 *
 * 检查 residual / Intangibles 与：
 *   Height / Weight / BMI / Wingspan / Height×Wingspan /
 *   Height z-score (within position) / Wingspan z-score (within position)
 *
 * 单独看极端组：极高个 / 极长臂 / 极矮 / 极重 / 极轻 / position-body outlier
 * matched comparison：属性相似但体型差异大的球员对
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
    cards.push({ ...c, year: Number(year), file: `${year}/${f}` });
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
  // 身体数据：优先顶层，回退 vitals
  const hIn = Number(c.height ?? c.vitals?.heightInches);
  const wLb = Number(c.weight ?? c.vitals?.weightLb);
  let wsCm = Number(c.wingspan ?? c.vitals?.wingspanCm);
  if (!(hIn > 0 && wLb > 0 && wsCm > 0)) continue;
  // 数据 bug 修复（16 张卡）：部分卡 wingspan 为 cm×2.54 的膨胀值（>300cm 不可能），
  // 还原为真实 cm（546.12 → 215cm）。不影响 Body V2（wingspan 硬性排除），仅影响展示/形态分析。
  if (wsCm > 300) wsCm = wsCm / 2.54;
  const hCm = hIn * 2.54;
  const wKg = wLb * 0.453592;
  const wsIn = wsCm / 2.54;
  samples.push({
    id: c.slug, name: c.name, position: pos, year: c.year ?? Number(c.draftYear ?? 0),
    overall: eff, attrs,
    intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
    heightIn: hIn, weightLb: wLb, wingspanIn: wsIn,
    heightCm: hCm, weightKg: wKg,
    bmi: wKg / (hCm / 100) ** 2,
    hwProduct: hIn * wsIn,
  });
}
console.log(`official samples with body data: ${samples.length}`);

const foldFor = (id) => {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % FOLDS;
};

// ── V3-E No-Intangibles（34 attrs，monotonic hierarchical）──────
function fitNonNegHierarchical(train, betaGlobalModel, lambda1, lambda2, iters) {
  const p = 34;
  const betaGlobal = betaGlobalModel?.w ?? null;
  const globalIntercept = betaGlobalModel?.intercept ?? 0;
  const beta = betaGlobal ? [...betaGlobal] : new Array(p).fill(0);
  let intercept = betaGlobal ? globalIntercept : 50;
  const X = train.map((s) => [...s.attrs]);
  const y = train.map((s) => s.overall);
  const n = train.length;
  const x2sum = new Array(p).fill(0);
  for (const row of X) for (let j = 0; j < p; j++) x2sum[j] += row[j] * row[j];
  const denom = (j) => x2sum[j] + lambda1 + lambda2;
  let lastLoss = Infinity;
  for (let iter = 0; iter < iters; iter++) {
    let resSum = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - X[i].reduce((t, x, j) => t + x * beta[j], 0);
      resSum += r;
    }
    intercept = resSum / n;
    let maxChange = 0;
    for (let j = 0; j < p; j++) {
      let num = 0;
      for (let i = 0; i < n; i++) {
        const resid = y[i] - intercept - X[i].reduce((t, x, k) => (k === j ? t : t + x * beta[k]), 0);
        num += X[i][j] * resid;
      }
      if (betaGlobal) num += lambda2 * (betaGlobal[j] - beta[j]);
      let newVal = num / denom(j);
      if (newVal < 0) newVal = 0;
      const change = Math.abs(newVal - beta[j]);
      if (change > maxChange) maxChange = change;
      beta[j] = newVal;
    }
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const r = y[i] - intercept - X[i].reduce((t, x, j) => t + x * beta[j], 0);
      loss += r * r;
    }
    for (let j = 0; j < p; j++) loss += lambda1 * beta[j] * beta[j];
    if (betaGlobal) for (let j = 0; j < p; j++) loss += lambda2 * (beta[j] - betaGlobal[j]) * (beta[j] - betaGlobal[j]);
    if (Math.abs(loss - lastLoss) < 1e-6 && maxChange < 1e-6) break;
    lastLoss = loss;
  }
  return { intercept, w: beta };
}
function predictNoInt(model, s) {
  const raw = model.intercept + s.attrs.reduce((t, v, j) => t + v * model.w[j], 0);
  return Math.round(clamp(raw, 40, 99));
}

// OOF prediction（attribute-only）
const globalTrain = fitNonNegHierarchical(samples, null, 100, 0, ITERS);
const oofPred = new Map();
for (let k = 0; k < FOLDS; k++) {
  const train = samples.filter((s) => foldFor(s.id) !== k);
  const test = samples.filter((s) => foldFor(s.id) === k);
  const g = fitNonNegHierarchical(train, null, 100, 0, ITERS);
  for (const p of positions) {
    const m = fitNonNegHierarchical(train.filter((s) => s.position === p), g, RIDGE_L1, RIDGE_L2, ITERS);
    for (const s of test.filter((x) => x.position === p)) {
      oofPred.set(s.id, predictNoInt(m, s));
    }
  }
}

for (const s of samples) {
  s.predNoInt = oofPred.get(s.id) ?? 50;
  s.residual = s.overall - s.predNoInt;
}

// ── 相关性：residual / Intangibles × 身体指标 ──────────────────
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// position 内 z-score
const posStats = {};
for (const p of positions) {
  const sub = samples.filter((s) => s.position === p);
  const mh = sub.reduce((a, b) => a + b.heightIn, 0) / sub.length;
  const sh = Math.sqrt(sub.reduce((a, b) => a + (b.heightIn - mh) ** 2, 0) / sub.length);
  const mw = sub.reduce((a, b) => a + b.wingspanIn, 0) / sub.length;
  const sw = Math.sqrt(sub.reduce((a, b) => a + (b.wingspanIn - mw) ** 2, 0) / sub.length);
  posStats[p] = { mh, sh, mw, sw };
}
for (const s of samples) {
  const st = posStats[s.position];
  s.heightZ = (s.heightIn - st.mh) / (st.sh || 1);
  s.wingspanZ = (s.wingspanIn - st.mw) / (st.sw || 1);
}

const L = [];
const push = (s = "") => L.push(s);
const corr = (key, label) => {
  const rRes = pearson(samples.map((s) => s[key]), samples.map((s) => s.residual));
  const rInt = pearson(samples.map((s) => s[key]), samples.map((s) => s.intangibles));
  push(`| ${label} | ${rRes.toFixed(3)} | ${rInt.toFixed(3)} |`);
};

push("# Residual × Body Morphology Audit");
push("");
push(`日期：2026-08-14 · official 664（含身体数据 ${samples.length}）· attribute-only 模型 = V3-E-NoInt（monotonic hierarchical 34 attrs，OOF 5-fold）`);
push(`residual = official OVR − attribute-only predicted OVR（OOF）`);
push("");
push(`## 0. 总览`);
push("");
push(`- attribute-only OOF MAE：${(samples.reduce((a, b) => a + Math.abs(b.residual), 0) / samples.length).toFixed(3)}`);
push(`- residual mean：${(samples.reduce((a, b) => a + b.residual, 0) / samples.length).toFixed(3)} · std：${Math.sqrt(samples.reduce((a, b) => a + (b.residual - samples.reduce((x, y) => x + y.residual, 0) / samples.length) ** 2, 0) / samples.length).toFixed(3)}`);
push(`- Intangibles mean：${(samples.reduce((a, b) => a + b.intangibles, 0) / samples.length).toFixed(1)} · std：${Math.sqrt(samples.reduce((a, b) => a + (b.intangibles - samples.reduce((x, y) => x + y.intangibles, 0) / samples.length) ** 2, 0) / samples.length).toFixed(1)}`);
push(`- corr(residual, Intangibles)：${pearson(samples.map((s) => s.intangibles), samples.map((s) => s.residual)).toFixed(3)}`);
push("");
push(`## 1. Pearson 相关性（residual / Intangibles × 身体指标）`);
push("");
push("| 指标 | corr(residual) | corr(Intangibles) |");
push("|---|---|---|");
corr("heightIn", "Height (in)");
corr("weightLb", "Weight (lb)");
corr("bmi", "BMI");
corr("wingspanIn", "Wingspan (in)");
corr("hwProduct", "Height × Wingspan");
corr("heightZ", "Height z-score (within position)");
corr("wingspanZ", "Wingspan z-score (within position)");
push("");
push("注：corr 绝对值 ≥0.1 视为值得注意，≥0.2 视为强相关（n=664）。");
push("");
push("## 2. 极端体型组（residual / Intangibles 均值）");
push("");
push("| 组 | 定义 | n | mean residual | mean Intangibles | vs 全体 residual 均值 |");
push("|---|---|---|---|---|---|");
const allMeanRes = samples.reduce((a, b) => a + b.residual, 0) / samples.length;
const groups = [
  ["极高个", (s) => s.heightZ > 2],
  ["极矮", (s) => s.heightZ < -2],
  ["极长臂", (s) => s.wingspanZ > 2],
  ["极重（position 内体重 z>2）", (s) => { const st = posStats[s.position]; const zw = (s.weightLb - samples.filter(x => x.position === s.position).reduce((a, b) => a + b.weightLb, 0) / samples.filter(x => x.position === s.position).length) / (Math.sqrt(samples.filter(x => x.position === s.position).reduce((a, b) => a + (b.weightLb - samples.filter(x => x.position === s.position).reduce((x2, y2) => x2 + y2.weightLb, 0) / samples.filter(x => x.position === s.position).length) ** 2, 0) / samples.filter(x => x.position === s.position).length) || 1); return zw > 2; }],
  ["极轻（position 内体重 z<-2）", (s) => { const sub = samples.filter(x => x.position === s.position); const m = sub.reduce((a, b) => a + b.weightLb, 0) / sub.length; const sd = Math.sqrt(sub.reduce((a, b) => a + (b.weightLb - m) ** 2, 0) / sub.length) || 1; return (s.weightLb - m) / sd < -2; }],
  ["position-body outlier（|height z|+|wingspan z| ≥ 4）", (s) => Math.abs(s.heightZ) + Math.abs(s.wingspanZ) >= 4],
];
for (const [name, fn] of groups) {
  const sub = samples.filter(fn);
  if (sub.length === 0) { push(`| ${name} | — | 0 | — | — | — |`); continue; }
  const mr = sub.reduce((a, b) => a + b.residual, 0) / sub.length;
  const mi = sub.reduce((a, b) => a + b.intangibles, 0) / sub.length;
  push(`| ${name} | ${name.includes("（") ? name.slice(name.indexOf("（") + 1, name.indexOf("）")) : "position 内 z>2"} | ${sub.length} | ${mr.toFixed(2)} | ${mi.toFixed(1)} | ${(mr - allMeanRes).toFixed(2)} |`);
}
push("");
push("## 3. 极端组明细（每组 top 5 by |residual|）");
push("");
for (const [name, fn] of groups) {
  const sub = samples.filter(fn).sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 5);
  if (sub.length === 0) continue;
  push(`### ${name}`);
  push("");
  push("| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |");
  push("|---|---|---|---|---|---|---|---|");
  for (const s of sub) {
    push(`| ${s.name} | ${s.position} | ${s.heightIn} | ${s.weightLb} | ${s.wingspanIn} | ${s.intangibles} | ${s.residual >= 0 ? "+" : ""}${s.residual} | ${s.overall} |`);
  }
  push("");
}
push("## 4. Matched comparison（属性相似、体型差异大）");
push("");
push("方法：对每对球员计算 attribute vector 距离（34 维欧氏）与体型差异（|Δheight|+|Δwingspan| 归一化），");
push("筛选 attribute 距离小（同 position 前 20%）但体型差异大的对；比较 Intangibles / residual。");
push("");
{
  const pairs = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i], b = samples[j];
      if (a.position !== b.position) continue;
      let attrDist = 0;
      for (let k = 0; k < 34; k++) attrDist += (a.attrs[k] - b.attrs[k]) ** 2;
      attrDist = Math.sqrt(attrDist);
      const bodyDiff = Math.abs(a.heightIn - b.heightIn) + Math.abs(a.wingspanIn - b.wingspanIn);
      pairs.push({ a, b, attrDist, bodyDiff, intDiff: a.intangibles - b.intangibles, resDiff: a.residual - b.residual });
    }
  }
  // 同 position 内：attribute 距离最小 20% 中 bodyDiff 最大的 12 对
  const posPairs = {};
  for (const p of positions) posPairs[p] = pairs.filter((x) => x.a.position === p);
  const selected = [];
  for (const p of positions) {
    const arr = posPairs[p].sort((x, y) => x.attrDist - y.attrDist);
    const cutoff = arr[Math.floor(arr.length * 0.2)];
    const cand = arr.filter((x) => x.attrDist <= cutoff.attrDist).sort((x, y) => y.bodyDiff - x.bodyDiff).slice(0, 3);
    selected.push(...cand);
  }
  selected.sort((x, y) => y.bodyDiff - x.bodyDiff);
  push("| 对 | pos | 高个 | 矮个 | Δattr | Δbody(in) | Int 高个 | Int 矮个 | residual 高个 | residual 矮个 | 谁 Int/res 更高 |");
  push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const pr of selected) {
    const tall = pr.a.heightIn >= pr.b.heightIn ? pr.a : pr.b;
    const short = pr.a.heightIn >= pr.b.heightIn ? pr.b : pr.a;
    const intHigher = tall.intangibles > short.intangibles ? "高个" : tall.intangibles < short.intangibles ? "矮个" : "平";
    const resHigher = tall.residual > short.residual ? "高个" : tall.residual < short.residual ? "矮个" : "平";
    push(`| ${tall.name} vs ${short.name} | ${pr.a.position} | ${tall.heightIn}" | ${short.heightIn}" | ${pr.attrDist.toFixed(1)} | ${pr.bodyDiff.toFixed(0)} | ${tall.intangibles} | ${short.intangibles} | ${tall.residual >= 0 ? "+" : ""}${tall.residual} | ${short.residual >= 0 ? "+" : ""}${short.residual} | Int: ${intHigher} · Res: ${resHigher} |`);
  }
}
push("");
push("## 5. 结论");
push("");
push("（结论由审阅者根据上表数据给出——脚本仅输出事实）");

writeFileSync("reports/rookie-overall-residual-body-morphology.md", L.join("\n"), "utf8");
console.log(L.join("\n"));
console.log("\nreport -> reports/rookie-overall-residual-body-morphology.md");
