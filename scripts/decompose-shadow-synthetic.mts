#!/usr/bin/env node
/**
 * Stage 6B.1 — synthetic shadow decomposition。
 * 分解当前 synthetic mean delta=-1.21 的来源：
 *   A = legacy estimator + old Intangibles（Potential-donor 值）
 *   B = legacy estimator + neutral 50
 *   C = V3E estimator + old Intangibles
 *   D = V3E estimator + neutral 50
 * 复用 Stage 6B shadow 的 synthetic 构造（10000，同 seed）。
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
    cards.push({ ...c, year: Number(c.draftYear ?? 0) });
  }
}

const v3eModel = JSON.parse(readFileSync("src/data/rookieOverallV3E.json", "utf8"));
function v3e(attrs, int, pos) {
  const p = v3eModel.positions.includes(pos) ? pos : "SF";
  const m = v3eModel.perPosition[p];
  return Math.round(Math.min(99, Math.max(40, m.intercept + [...attrs, int].reduce((t, v, j) => t + v * m.w[j], 0))));
}
const legacyModel = JSON.parse(readFileSync("src/data/rookieOverallModel-rookie.json", "utf8"));
function legacy(attrs, int, pos) {
  const p = legacyModel.positions[pos] ?? legacyModel.positions.SF;
  let est = p.intercept;
  for (const name of legacyModel.attributes) {
    const v = name === "Intangibles" ? int : attrs[ATTRS.indexOf(name)];
    if (typeof v === "number") est += (p.coefficients?.[name] ?? 0) * v;
  }
  return Math.round(Math.min(99, Math.max(40, est)));
}

// 同 seed 构造 synthetic（与 run-shadow-mode 相同：RNG 0xC0FFEE+i，attrs 从两张卡各半取）
const N = 10000;
const rows = [];
for (let i = 0; i < N; i++) {
  let s = (0xC0FFEE + i) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const cardA = cards[Math.floor(rnd() * cards.length)];
  const cardB = cards[Math.floor(rnd() * cards.length)];
  const pos = positions[Math.floor(rnd() * 5)];
  const attrs = ATTRS.map((a, idx) => {
    const src = rnd() < 0.5 ? cardA : cardB;
    return clamp(Number(src.detailed?.[a]) || 0, 25, 99);
  });
  // old Intangibles：多 donor 下 = potential donor 的卡值（synthetic 场景近似：取 cardA 的 Int）
  const intOld = clamp(Number(cardA.detailed?.["Intangibles"]) || 50, 25, 99);
  const intNew = 50;
  rows.push({
    A: legacy(attrs, intOld, pos),
    B: legacy(attrs, intNew, pos),
    C: v3e(attrs, intOld, pos),
    D: v3e(attrs, intNew, pos),
  });
}

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const dAB = rows.map((r) => r.B - r.A);   // legacy: neutral vs old
const dAC = rows.map((r) => r.C - r.A);   // old Int: v3e vs legacy
const dCD = rows.map((r) => r.D - r.C);   // v3e: neutral vs old
const dBD = rows.map((r) => r.D - r.B);   // neutral: v3e vs legacy
const dAD = rows.map((r) => r.D - r.A);   // 总 delta（current vs pre）

const L = [];
const push = (s = "") => L.push(s);
push("# Stage 6B.1 — Synthetic Shadow Decomposition");
push("");
push(`日期：2026-08-14 · ${N} synthetic（同 seed，与 Stage 6B shadow 一致）`);
push("");
push("| 组合 | 含义 | mean delta | std | |Δ|≤1 | |Δ|≤2 |");
push("|---|---|---|---|---|---|");
const rows2 = [
  ["A→B", "legacy + neutral50 − legacy + oldInt（Intangibles policy 在 legacy 上的影响）", dAB],
  ["A→C", "v3e + oldInt − legacy + oldInt（estimator 影响，Intangibles 固定 old）", dAC],
  ["C→D", "v3e + neutral50 − v3e + oldInt（Intangibles policy 在 v3e 上的影响）", dCD],
  ["B→D", "v3e + neutral50 − legacy + neutral50（estimator 影响，Intangibles 固定 neutral）", dBD],
  ["A→D", "current − pre（总 delta，= -1.21 的分解对象）", dAD],
];
for (const [name, desc, arr] of rows2) {
  const m = mean(arr);
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
  const z1 = arr.filter((x) => Math.abs(x) <= 1).length / arr.length;
  const z2 = arr.filter((x) => Math.abs(x) <= 2).length / arr.length;
  push(`| ${name} | ${desc} | ${m.toFixed(3)} | ${sd.toFixed(3)} | ${(z1 * 100).toFixed(1)}% | ${(z2 * 100).toFixed(1)}% |`);
}
push("");
push("## 分解结论");
push("");
push(`- 总 delta (A→D) = ${mean(dAD).toFixed(3)}`);
push(`- estimator 效应（B→D，Intangibles 固定 neutral）：${mean(dBD).toFixed(3)}`);
push(`- estimator 效应（A→C，Intangibles 固定 old）：${mean(dAC).toFixed(3)}`);
push(`- policy 效应（A→B，legacy 上）：${mean(dAB).toFixed(3)}`);
push(`- policy 效应（C→D，v3e 上）：${mean(dCD).toFixed(3)}`);
push("");
push("注：A→B ≠ 0 说明 Intangibles policy 本身改变 legacy 估算（这是 Stage 6B.1 control audit 的根源）；");
push("过渡双 Intangibles 后，control 用 old、display 用 new，A→B 仅在 display/export 层面可见。");

writeFileSync("reports/rookie-overall-stage6b1-shadow-decomposition.md", L.join("\n"), "utf8");
console.log(L.join("\n"));
