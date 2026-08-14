#!/usr/bin/env node
/**
 * Stage 6B.2 — FINAL ARCHITECTURE shadow（A→D 语义）。
 *
 * 真实生产语义：
 *   control = legacy estimator + controlIntangiblesLegacy（Potential-donor）
 *   display = V3-E + displayIntangibles Final Policy（custom > single-card > 50）
 * 因此 live display-control delta = A→D，不是此前 Stage 6B 的 B→D。
 *
 * 批次：official 664 / snapshot 1374 / synthetic 10000 / fixtures。
 * 保留 A/B/C/D 分解（estimator effect vs policy effect）。
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

// 模型
const v3eModel = JSON.parse(readFileSync("src/data/rookieOverallV3E.json", "utf8"));
const v3e = (attrs, int, pos) => {
  const p = v3eModel.positions.includes(pos) ? pos : "SF";
  const m = v3eModel.perPosition[p];
  return Math.round(Math.min(99, Math.max(40, m.intercept + [...attrs, int].reduce((t, v, j) => t + v * m.w[j], 0))));
};
const legacyModel = JSON.parse(readFileSync("src/data/rookieOverallModel-rookie.json", "utf8"));
const legacy = (attrs, int, pos) => {
  const p = legacyModel.positions[pos] ?? legacyModel.positions.SF;
  let est = p.intercept;
  for (const name of legacyModel.attributes) {
    const v = name === "Intangibles" ? int : attrs[ATTRS.indexOf(name)];
    if (typeof v === "number") est += (p.coefficients?.[name] ?? 0) * v;
  }
  return Math.round(Math.min(99, Math.max(40, est)));
};

// 单卡的 control Intangibles（Potential-donor 近似：该卡自己的 Intangibles）
const controlIntFor = (card) => clamp(Number(card.detailed?.["Intangibles"]) || 50, 25, 99);
const displayIntFor = (card, isSingle) => isSingle ? clamp(Number(card.detailed?.["Intangibles"]) || 50, 25, 99) : 50;

// ── 批次构造 ──────────────────────────────────────────────────
const rows = []; // {batch, name, pos, A, B, C, D}
const pushRow = (batch, name, pos, attrs, intControl, intDisplay) => {
  rows.push({
    batch, name, pos,
    A: legacy(attrs, intControl, pos),   // legacy + control Int
    B: legacy(attrs, intDisplay, pos),   // legacy + display Int
    C: v3e(attrs, intControl, pos),      // v3e + control Int
    D: v3e(attrs, intDisplay, pos),      // v3e + display Int（= live display）
    intC: intControl, intD: intDisplay,
  });
};

// 1. official 664（single-card：control = card 值；display = card 值 → A==B, C==D）
const official = cards.filter((c) => {
  const ov = overrides.get(c.slug);
  if (ov?.estimated === true || c.overallSource === "model-estimated-gap") return false;
  const eff = ov?.overall != null ? ov.overall : c.overall;
  return typeof eff === "number"
    && typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed")
    && positions.includes(String(c.position ?? "SF").split("/")[0]);
});
for (const c of official) {
  const pos = String(c.position ?? "SF").split("/")[0];
  const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
  const int = clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99);
  pushRow("official", c.name, pos, attrs, int, int);
}

// 2. snapshot 1374（同 official 语义：single-card）
const snapshot = JSON.parse(readFileSync("data/snapshots/2kspinner-rookies-1960-2025-2026-08-13/rookie-snapshot.json", "utf8"));
for (const c of snapshot) {
  const pos = String(c.position ?? "SF").split("/")[0];
  if (!positions.includes(pos)) continue;
  const attrs = ATTRS.map((a) => clamp(Number(c.detailed?.[a]) || 0, 25, 99));
  const int = clamp(Number(c.detailed?.["Intangibles"]) || 50, 25, 99);
  pushRow("snapshot", c.name, pos, attrs, int, int);
}

// 3. synthetic 10000（multi-donor：control = donor A 的 Int；display = 50）
for (let i = 0; i < 10000; i++) {
  let s = (0xC0FFEE + i) >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const cardA = cards[Math.floor(rnd() * cards.length)];
  const cardB = cards[Math.floor(rnd() * cards.length)];
  const pos = positions[Math.floor(rnd() * 5)];
  const attrs = ATTRS.map((a, idx) => {
    const src = rnd() < 0.5 ? cardA : cardB;
    return clamp(Number(src.detailed?.[a]) || 0, 25, 99);
  });
  const intControl = controlIntFor(cardA);
  pushRow("synthetic", `synth-${i}`, pos, attrs, intControl, 50);
}

// 4. fixtures
const fixtures = {
  "Mitchell dunk-only": { pos: "PG", attrs: ATTRS.map((a) => a === "Driving Dunk" ? 97 : a === "Standing Dunk" ? 50 : 60), intControl: 60, intDisplay: 50 },
  "Wemby tall": { pos: "C", attrs: ATTRS.map((a) => a === "Block" ? 99 : a === "Three-Point Shot" ? 80 : a === "Standing Dunk" ? 85 : 65), intControl: 98, intDisplay: 50 },
  "Jokic playmaking C": { pos: "C", attrs: ATTRS.map((a) => a === "Pass Accuracy" ? 95 : a === "Pass IQ" ? 95 : a === "Post Control" ? 88 : 65), intControl: 80, intDisplay: 50 },
  "All-99": { pos: "SF", attrs: ATTRS.map(() => 99), intControl: 99, intDisplay: 99 },
  "All-25": { pos: "PG", attrs: ATTRS.map(() => 25), intControl: 25, intDisplay: 25 },
};
for (const [name, f] of Object.entries(fixtures)) {
  pushRow("fixture", name, f.pos, f.attrs, f.intControl, f.intDisplay);
}

// ── 统计 ──────────────────────────────────────────────────────
const L = [];
const push = (s = "") => L.push(s);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const stats = (arr, label) => {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
  const z0 = arr.filter((x) => x === 0).length / arr.length;
  const z1 = arr.filter((x) => Math.abs(x) <= 1).length / arr.length;
  const z2 = arr.filter((x) => Math.abs(x) <= 2).length / arr.length;
  const z3 = arr.filter((x) => Math.abs(x) >= 3).length / arr.length;
  push(`| ${label} | ${mean.toFixed(2)} | ${sd.toFixed(2)} | ${Math.min(...arr)} / ${Math.max(...arr)} | ${pct(z0)} | ${pct(z1)} | ${pct(z2)} | ${pct(z3)} |`);
};

push("# Stage 6B.2 — FINAL ARCHITECTURE Shadow（A→D）");
push("");
push(`日期：2026-08-14 · official ${rows.filter(r => r.batch === "official").length} / snapshot ${rows.filter(r => r.batch === "snapshot").length} / synthetic ${rows.filter(r => r.batch === "synthetic").length} / fixtures ${rows.filter(r => r.batch === "fixture").length}`);
push("");
push("生产语义：control = legacy + controlIntangiblesLegacy（Potential-donor）；display = V3-E + displayIntangibles Final Policy。");
push("live display-control delta = **A→D**（此前 Stage 6B 的 synthetic -1.213 是 B→D，estimator-only 效应）。");
push("");
push("| 批次 | mean | std | min/max | Δ=0 | Δ≤1 | Δ≤2 | Δ≥3 |");
push("|---|---|---|---|---|---|---|---|");
for (const batch of ["official", "snapshot", "synthetic", "fixture"]) {
  const arr = rows.filter((r) => r.batch === batch).map((r) => r.D - r.A);
  stats(arr, batch);
}
push("");
push("## A/B/C/D 分解（synthetic，10000）");
push("");
push("| 组合 | 含义 | mean | std |");
push("|---|---|---|---|");
const syn = rows.filter((r) => r.batch === "synthetic");
const dAB = syn.map((r) => r.B - r.A);
const dAC = syn.map((r) => r.C - r.A);
const dCD = syn.map((r) => r.D - r.C);
const dBD = syn.map((r) => r.D - r.B);
const dAD = syn.map((r) => r.D - r.A);
const m = (arr) => { const x = arr.reduce((a, b) => a + b, 0) / arr.length; const sd = Math.sqrt(arr.reduce((a, b) => a + (b - x) ** 2, 0) / arr.length); return [x, sd]; };
const [mAB, sAB] = m(dAB); const [mAC, sAC] = m(dAC); const [mCD, sCD] = m(dCD); const [mBD, sBD] = m(dBD); const [mAD, sAD] = m(dAD);
push(`| A→B | legacy: displayInt − controlInt（policy 在 legacy 上） | ${mAB.toFixed(3)} | ${sAB.toFixed(3)} |`);
push(`| A→C | v3e + controlInt − legacy + controlInt（estimator，control 固定） | ${mAC.toFixed(3)} | ${sAC.toFixed(3)} |`);
push(`| C→D | v3e: displayInt − controlInt（policy 在 v3e 上） | ${mCD.toFixed(3)} | ${sCD.toFixed(3)} |`);
push(`| B→D | v3e + displayInt − legacy + displayInt（estimator，display 固定） | ${mBD.toFixed(3)} | ${sBD.toFixed(3)} |`);
push(`| **A→D** | **live: v3e+displayInt − legacy+controlInt（总 display-control delta）** | **${mAD.toFixed(3)}** | ${sAD.toFixed(3)} |`);
push("");
push("确认：Stage 6B 原 synthetic -1.213 = B→D（estimator-only）；当前 live delta = A→D。");
push("");

// position / control OVR band（official）
push("## position breakdown（official，A→D）");
push("");
push("| position | n | mean | Δ≥2 占比 |");
push("|---|---|---|---|");
for (const p of positions) {
  const arr = rows.filter((r) => r.batch === "official" && r.pos === p).map((r) => r.D - r.A);
  if (!arr.length) continue;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const big = arr.filter((x) => Math.abs(x) >= 2).length / arr.length;
  push(`| ${p} | ${arr.length} | ${mean.toFixed(2)} | ${pct(big)} |`);
}
push("");
push("## control OVR band breakdown（official，A→D，按 A=legacy+controlInt）");
push("");
push("| band | n | mean | Δ≥2 占比 |");
push("|---|---|---|---|");
for (const [band, lo, hi] of [["<70", 40, 69], ["70-79", 70, 79], ["80-84", 80, 84]]) {
  const arr = rows.filter((r) => r.batch === "official" && r.A >= lo && r.A <= hi).map((r) => r.D - r.A);
  if (!arr.length) continue;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const big = arr.filter((x) => Math.abs(x) >= 2).length / arr.length;
  push(`| ${band} | ${arr.length} | ${mean.toFixed(2)} | ${pct(big)} |`);
}
push("");
push("## Top absolute delta（official，A→D）");
push("");
push("| name | pos | control(A) | display(D) | Δ | intC→intD |");
push("|---|---|---|---|---|---|");
for (const r of [...rows].filter((x) => x.batch === "official").sort((x, y) => Math.abs(y.D - y.A) - Math.abs(x.D - x.A)).slice(0, 15)) {
  push(`| ${r.name} | ${r.pos} | ${r.A} | ${r.D} | ${r.D - r.A >= 0 ? "+" : ""}${r.D - r.A} | ${r.intC ?? "--"}→${r.intD ?? "--"} |`);
}

writeFileSync("reports/rookie-overall-stage6b2-shadow-final.md", L.join("\n"), "utf8");
console.log("report -> reports/rookie-overall-stage6b2-shadow-final.md");
console.log(`rows: ${rows.length}`);
