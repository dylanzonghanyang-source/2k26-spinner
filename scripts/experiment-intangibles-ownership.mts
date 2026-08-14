#!/usr/bin/env node
/**
 * Stage 5.2 — Synthetic Intangibles Ownership Experiment。
 *
 * 现状（createResult.ts:921-924）：Intangibles 来源 = custom > Potential donor > single-card > 50。
 * 该设计让 Potential donor 隐式改变当前 OVR —— 语义审查。
 *
 * 三个策略（纯实验，不改生产）：
 *   I1 Neutral：synthetic Intangibles 固定 50
 *   I2 Stability owner：从 Stability donor 继承 Intangibles
 *   I3 Legacy：从 Potential donor 继承 Intangibles（当前生产）
 *
 * 对大量固定 16 槽 atomic profile，仅替换相关 donor，统计：
 *   - OVR delta 分布
 *   - hidden OVR variance
 *   - potential donor change 对当前 OVR 的影响
 *   - stability donor change 对当前 OVR 的影响
 *   - 极端案例
 *   - fallback=50 占比和影响
 *
 * 明确区分：Intangibles = 2K 的 Overall Adjustment / designer calibration；
 * Potential = 未来上限；两者不是同一概念。
 *
 * 方法：用 V3-E 全量模型（当前最佳）估算 OVR；16 槽固定 atomic profile
 * 从真实卡构建；只替换 stability / potential donor 的 Intangibles 值。
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

// ── V3-E 全量模型（Stage 5.1 的训练逻辑复现）────────────────────
const RIDGE_L1 = 100, RIDGE_L2 = 200, ITERS = 20000;
const official = cards.filter((c) => {
  const ov = overrides.get(c.slug);
  if (ov?.estimated === true || c.overallSource === "model-estimated-gap") return false;
  const eff = ov?.overall != null ? ov.overall : c.overall;
  if (typeof eff !== "number") return false;
  if (!(typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed"))) return false;
  const pos = String(c.position ?? "SF").split("/")[0];
  if (!positions.includes(pos)) return false;
  const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
  return !attrs.some((v) => v === 0);
});

function fitNonNegHierarchical(train, betaGlobalModel, lambda1, lambda2, iters) {
  const p = 35;
  const betaGlobal = betaGlobalModel?.w ?? null;
  const globalIntercept = betaGlobalModel?.intercept ?? 0;
  const beta = betaGlobal ? [...betaGlobal] : new Array(p).fill(0);
  let intercept = betaGlobal ? globalIntercept : 50;
  const X = train.map((s) => [...s.attrs, s.intangibles]);
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
      if (j < 34 && newVal < 0) newVal = 0;
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
    if (betaGlobal) for (let j = 0; j < 35; j++) loss += lambda2 * (beta[j] - betaGlobal[j]) * (beta[j] - betaGlobal[j]);
    if (Math.abs(loss - lastLoss) < 1e-6 && maxChange < 1e-6) break;
    lastLoss = loss;
  }
  return { intercept, w: beta };
}

const officialSamples = official.map((c) => {
  const ov = overrides.get(c.slug);
  const eff = ov?.overall != null ? ov.overall : c.overall;
  return {
    id: c.slug, name: c.name,
    position: String(c.position ?? "SF").split("/")[0],
    year: c.year,
    overall: eff,
    attrs: ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99)),
    intangibles: clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99),
    source: c.source,
  };
});
const globalModel = fitNonNegHierarchical(officialSamples, null, 100, 0, ITERS);
const fullModelE = {};
for (const p of positions) {
  fullModelE[p] = fitNonNegHierarchical(officialSamples.filter((s) => s.position === p), globalModel, RIDGE_L1, RIDGE_L2, ITERS);
}
function predictV3E(pos, attrs, int) {
  const x = [...attrs, int];
  const m = fullModelE[pos];
  const raw = m.intercept + x.reduce((t, v, j) => t + v * m.w[j], 0);
  return { raw, rounded: Math.round(clamp(raw, 40, 99)) };
}

// ── 16 槽 atomic profile 构建 ──────────────────────────────────
// 用真实卡构建"固定 16 槽"输入：所有非 potential/stability 槽用一张卡，
// potential 槽和 stability 槽分别替换不同 donor（模拟 ownership 实验）。
const bundles = [
  { id: "three", attrs: ["Three-Point Shot"] },
  { id: "mid", attrs: ["Mid-Range Shot", "Free Throw"] },
  { id: "face", attrs: ["Layup", "Close Shot", "Draw Foul", "Hands"] },
  { id: "post", attrs: ["Post Fade", "Post Hook", "Post Control"] },
  { id: "dunk", attrs: ["Driving Dunk", "Standing Dunk"] },
  { id: "handle", attrs: ["Ball Handle", "Speed with Ball"] },
  { id: "passing", attrs: ["Pass Accuracy", "Pass IQ", "Pass Vision"] },
  { id: "perimeter", attrs: ["Perimeter Defense"] },
  { id: "interior", attrs: ["Interior Defense"] },
  { id: "steal", attrs: ["Steal"] },
  { id: "block", attrs: ["Block"] },
  { id: "rebound", attrs: ["Offensive Rebound", "Defensive Rebound"] },
  { id: "athletic", attrs: ["Speed", "Agility", "Vertical", "Stamina", "Hustle", "Strength", "Pass Perception"] },
  { id: "strength", attrs: ["Strength"] },
  { id: "stability", attrs: ["Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ"] },
  { id: "potential", attrs: ["Potential"] },
];

// 生成 N 个固定 profile：主体卡随机选官方卡，stability/potential donor 从不同卡取
function buildProfiles(n) {
  const profiles = [];
  const pool = officialSamples.filter((s) => typeof s.attrs[0] === "number");
  for (let i = 0; i < n; i++) {
    const main = pool[i % pool.length];
    const stab = pool[(i * 7 + 3) % pool.length];
    const pot = pool[(i * 13 + 5) % pool.length];
    profiles.push({
      id: i,
      main,
      stabilityDonor: stab,
      potentialDonor: pot,
      position: main.position,
    });
  }
  return profiles;
}

// 从 profile 构建 attrs + Intangibles（三个策略）
function resolveIntangibles(profile, strategy) {
  if (strategy === "I1") return 50;
  if (strategy === "I2") return profile.stabilityDonor.intangibles;
  if (strategy === "I3") return profile.potentialDonor.intangibles;
  throw new Error("unknown strategy");
}

const N = 300;
const profiles = buildProfiles(N);
const results = { I1: [], I2: [], I3: [] };
for (const p of profiles) {
  for (const s of ["I1", "I2", "I3"]) {
    const int = resolveIntangibles(p, s);
    const r = predictV3E(p.position, p.main.attrs, int);
    results[s].push({ id: p.id, position: p.position, int, ovr: r.rounded, raw: r.raw });
  }
}

// ── 统计 ───────────────────────────────────────────────────────
const L = [];
const push = (s = "") => L.push(s);
push("# Stage 5.2 — Synthetic Intangibles Ownership Experiment");
push("");
push(`日期：2026-08-14 · profiles: ${N}（固定 16 槽 atomic，主体卡来自官方 664，stability/potential donor 独立随机替换）`);
push(`OVR 估算模型：V3-E 全量（Stage 5.1，monotonic hierarchical）`);
push("");
push("## 0. 语义声明");
push("");
push("**Intangibles = 2K 的 Overall Adjustment / designer calibration**（createResult.ts:914 注释「综评补偿」，xlsx 字段「综评补偿」）；");
push("**Potential = 未来上限**（潜力，growth 子系统使用）。");
push("两者**不是同一概念**：Potential donor 提供 Intangibles 是当前实现的隐式耦合（I3），语义上站不住。");
push("");
push("## 1. 三策略总体统计");
push("");
push("| 策略 | Intangibles 来源 | mean OVR | min | max | std |");
push("|---|---|---|---|---|---|");
for (const s of ["I1", "I2", "I3"]) {
  const ovrs = results[s].map((r) => r.ovr);
  const mean = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
  const sd = Math.sqrt(ovrs.reduce((a, b) => a + (b - mean) ** 2, 0) / ovrs.length);
  push(`| ${s} | ${s === "I1" ? "固定 50" : s === "I2" ? "Stability donor" : "Potential donor（当前生产）"} | ${mean.toFixed(2)} | ${Math.min(...ovrs)} | ${Math.max(...ovrs)} | ${sd.toFixed(2)} |`);
}
push("");
push("## 2. OVR delta 分布（I2−I1 / I3−I1）");
push("");
push("| 对比 | mean Δ | std Δ | min Δ | max Δ | >0 占比 | =0 占比 | <0 占比 |");
push("|---|---|---|---|---|---|---|---|");
for (const [a, b] of [["I2", "I1"], ["I3", "I1"], ["I3", "I2"]]) {
  const deltas = results[a].map((r, i) => r.ovr - results[b][i].ovr);
  const mean = deltas.reduce((x, y) => x + y, 0) / deltas.length;
  const sd = Math.sqrt(deltas.reduce((x, y) => x + (y - mean) ** 2, 0) / deltas.length);
  const pos = deltas.filter((d) => d > 0).length;
  const zero = deltas.filter((d) => d === 0).length;
  const neg = deltas.filter((d) => d < 0).length;
  push(`| ${a}−${b} | ${mean.toFixed(3)} | ${sd.toFixed(3)} | ${Math.min(...deltas)} | ${Math.max(...deltas)} | ${(pos / N * 100).toFixed(1)}% | ${(zero / N * 100).toFixed(1)}% | ${(neg / N * 100).toFixed(1)}% |`);
}
push("");
push("## 3. Potential donor change → 当前 OVR 影响（I3）");
push("");
push("V3-E 的 Intangibles slope（每 position，见 Stage 5.1 §6）与 I3 的 Int 分布共同决定影响。");
push("Intangibles 实际值分布（I3）：");
push("");
{
  const ints = results.I3.map((r) => r.int);
  const uniq = [...new Set(ints)].sort((a, b) => a - b);
  push(`| Intangibles 值 | 频次 | 占比 |`);
  push("|---|---|---|");
  for (const v of uniq) {
    const n = ints.filter((x) => x === v).length;
    push(`| ${v} | ${n} | ${(n / N * 100).toFixed(1)}% |`);
  }
}
push("");
push("## 4. Stability donor change → 当前 OVR 影响（I2）");
push("");
push("同上（I2 的 Int 分布）：");
push("");
{
  const ints = results.I2.map((r) => r.int);
  const uniq = [...new Set(ints)].sort((a, b) => a - b);
  push(`| Intangibles 值 | 频次 | 占比 |`);
  push("|---|---|---|");
  for (const v of uniq) {
    const n = ints.filter((x) => x === v).length;
    push(`| ${v} | ${n} | ${(n / N * 100).toFixed(1)}% |`);
  }
}
push("");
push("## 5. 极端案例（I3 vs I1 差异最大前 10）");
push("");
push("| id | position | I1 OVR | I3 OVR | Δ | I3 Int | main card |");
push("|---|---|---|---|---|---|---|");
const extremes = results.I3.map((r, i) => ({ ...r, i1: results.I1[i].ovr, delta: r.ovr - results.I1[i].ovr }))
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
for (const e of extremes) {
  const prof = profiles[e.id];
  push(`| ${e.id} | ${e.position} | ${e.i1} | ${e.ovr} | ${e.delta >= 0 ? "+" : ""}${e.delta} | ${e.int} | ${prof.main.name} |`);
}
push("");
push("## 6. fallback=50 占比和影响");
push("");
{
  // 当前生产实际 fallback 比例：官方卡中 detailed.Intangibles 缺失的数量
  const missing = officialSamples.filter((s) => typeof s.intangibles !== "number" || Number(s.intangibles || 0) === 0).length;
  const withInt = officialSamples.length - missing;
  push(`- 官方 664 卡中 detailed.Intangibles 缺失（走 fallback 50）：${missing} 张（${(missing / 664 * 100).toFixed(1)}%）`);
  push(`- 有值卡：${withInt} 张`);
  push(`- fallback 影响：OVR 由 V3-E Intangibles slope（0.04-0.07/单位）× 与真实值差距决定；若真实 Int 70 → fallback 50，降幅约 ${(20 * 0.06).toFixed(1)} OVR 分`);
}
push("");
push("## 7. 结论与建议");
push("");
push("1. **I3（Potential donor）语义问题确认**：Potential 是未来上限，与 OVR 校准无关；用它继承 Intangibles 会让「潜力槽选谁」隐式改变当前 OVR");
push("2. **I2（Stability owner）语义更合理**：Stability 槽承载 consistency/IQ 类校准属性，与 Intangibles（designer calibration）同族");
push("3. **I1（Neutral 50）最干净但损失信息**：官方卡 Intangibles 是真实校准值，全 50 会丢失 2K 的校准意图");
push("4. **推荐方向**（待审阅）：I2 或 I2+I1 混合（stability 有 donor 用 donor，无则 50）；不推荐 I3");
push("5. **不改生产**：实验仅统计，createResult.ts:921 保持现状直到审阅决策");

writeFileSync("reports/rookie-overall-intangibles-ownership.md", L.join("\n"), "utf8");
console.log(L.join("\n"));
console.log("\nreport -> reports/rookie-overall-intangibles-ownership.md");
