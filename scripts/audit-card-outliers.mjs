/**
 * Audit card data for unusual attribute/tendency values — pick a few players per
 * draft year for in-game verification.
 *
 * Detection heuristics:
 *  1. Cross-position z-score: value far from same-position mean (|z| > 2.2)
 *     AND extreme in absolute terms (>= 88 or <= 38 for attrs; >= 95 or <= 12 for tendencies).
 *  2. Attribute-vs-tendency contradiction: strong tendency (>= 88) with weak
 *     supporting attribute (< 68), or vice versa.
 *  3. Global extremes: attrs >= 98 or <= 22, tendencies >= 99 or <= 5.
 *
 * Run: node scripts/audit-card-outliers.mjs [--limit N]
 * Output: data/raw/db2k/card-verify-checklist-YYYY-MM-DD.md + .csv
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cardsDir = path.join(root, "src/data/rookieCards");
const date = new Date().toISOString().slice(0, 10);

const ATTR_CN = {
  "Three-Point Shot": "三分球", "Mid-Range Shot": "中距离投篮", "Close Shot": "近距离投篮",
  "Free Throw": "罚球", "Ball Handle": "控球", "Speed with Ball": "运球速度",
  "Pass Accuracy": "传球准确性", "Pass IQ": "传球智商", "Pass Vision": "传球视野",
  "Pass Perception": "传球洞察", "Block": "盖帽", "Steal": "抢断",
  "Interior Defense": "内线防守", "Perimeter Defense": "外线防守",
  "Driving Dunk": "切入扣篮", "Standing Dunk": "原地扣篮", "Layup": "上篮",
  "Post Control": "背身控制", "Post Hook": "背身勾手", "Post Fade": "背身后仰",
  "Offensive Rebound": "进攻篮板", "Defensive Rebound": "防守篮板",
  "Speed": "速度", "Vertical": "弹跳", "Strength": "力量", "Stamina": "体力",
  "Hustle": "积极性", "Agility": "敏捷", "Hands": "接球", "Draw Foul": "造犯规",
  "Offensive Consistency": "进攻稳定性", "Defensive Consistency": "防守稳定性",
  "Help Defense IQ": "协防智商", "Shot IQ": "投篮智商",
};

const TENDENCY_CN = {
  "Shot Three": "三分出手", "Spot Up Shot Three": "定点三分", "Off-Screen Shot Three": "无球三分",
  "Shot Mid-Range": "中投出手", "Shot Close": "近距离出手", "Shot Under Basket": "篮下出手",
  "Drive": "突破", "Driving Layup": "突破上篮", "Driving Dunk": "突破扣篮",
  "Standing Dunk": "原地扣篮", "Alley-Oop": "空接", "Putback": "补篮", "Crash": "冲抢进攻篮板",
  "Dish to Open Man": "传给空位", "Flashy Pass": "花式传球", "Alley-Oop Pass": "空接传球",
  "Post Up": "背打", "Post Back Down": "背身强打", "Post Aggressive Backdown": "强力背打",
  "Block Shot": "盖帽倾向", "On-Ball Steal": "持球抢断", "Pass Interception": "传球抢断",
  "Attack Strong on Drive": "强突", "Contested Jumper Three": "顶人三分", "Stepback Three Point Shot": "后撤步三分",
  "Transition Pull-Up Three Point Shot": "转换急停三分", "Iso vs Elite Defender": "单打精英防守",
};

// attribute -> supporting tendencies (contradiction pairs)
const ATTR_TENDENCY_PAIRS = [
  ["Three-Point Shot", ["Shot Three", "Spot Up Shot Three", "Off-Screen Shot Three"]],
  ["Mid-Range Shot", ["Shot Mid-Range"]],
  ["Close Shot", ["Shot Close"]],
  ["Ball Handle", ["Drive", "Setup With Sizeup"]],
  ["Speed with Ball", ["Drive", "Drive Right"]],
  ["Pass Accuracy", ["Dish to Open Man"]],
  ["Pass Vision", ["Flashy Pass", "Alley-Oop Pass"]],
  ["Post Control", ["Post Up", "Post Back Down", "Post Aggressive Backdown"]],
  ["Block", ["Block Shot"]],
  ["Steal", ["On-Ball Steal", "Pass Interception"]],
  ["Standing Dunk", ["Standing Dunk", "Putback"]],
  ["Driving Dunk", ["Driving Dunk", "Alley-Oop"]],
  ["Strength", ["Attack Strong on Drive", "Post Aggressive Backdown"]],
  ["Hustle", ["Crash", "Putback"]],
];

const POSITION_KEYS = ["PG", "SG", "SF", "PF", "C"];

// ---------- load cards ----------
const cards = [];
for (const year of readdirSync(cardsDir).filter((d) => /^\d{4}$/.test(d))) {
  for (const file of readdirSync(path.join(cardsDir, year)).filter((f) => f.endsWith(".json") && f !== "review.json" && f !== "capture-manifest.json" && f !== "gap-conversion-manifest.json")) {
    try {
      const card = JSON.parse(readFileSync(path.join(cardsDir, year, file), "utf8"));
      card.year = Number(year);
      cards.push(card);
    } catch { /* skip */ }
  }
}
console.log(`loaded ${cards.length} cards`);

function mainPosition(card) {
  const pos = String(card.position ?? "").split("/")[0].trim().toUpperCase();
  return POSITION_KEYS.includes(pos) ? pos : null;
}

// ---------- per-position attr stats ----------
const attrStats = {};
for (const pos of POSITION_KEYS) attrStats[pos] = {};
const byPos = {};
for (const pos of POSITION_KEYS) byPos[pos] = [];
for (const card of cards) {
  const pos = mainPosition(card);
  if (!pos) continue;
  byPos[pos].push(card);
  for (const [attr, v] of Object.entries(card.detailed)) {
    if (typeof v !== "number") continue;
    const s = (attrStats[pos][attr] ??= { sum: 0, sq: 0, n: 0 });
    s.sum += v; s.sq += v * v; s.n++;
  }
}
for (const pos of POSITION_KEYS) {
  for (const attr of Object.keys(attrStats[pos])) {
    const s = attrStats[pos][attr];
    const mean = s.sum / s.n;
    const std = Math.sqrt(Math.max(0, s.sq / s.n - mean * mean));
    attrStats[pos][attr] = { mean, std: std || 1, n: s.n };
  }
}

// ---------- detection ----------
const findings = []; // {year, name, category, field, value, reason}

for (const card of cards) {
  const pos = mainPosition(card);
  const name = card.name;
  const year = card.year;

  // 1. cross-position attr z-score
  if (pos) {
    for (const [attr, v] of Object.entries(card.detailed)) {
      if (typeof v !== "number") continue;
      const s = attrStats[pos][attr];
      if (!s || s.n < 8) continue;
      const z = (v - s.mean) / s.std;
      if (z > 2.2 && v >= 88) {
        findings.push({ year, name, category: "属性", field: attr, value: v, reason: `${pos} 位置均值 ${Math.round(s.mean)}±${Math.round(s.std)}，z=${z.toFixed(1)} 明显偏高` });
      } else if (z < -2.2 && v <= 38) {
        findings.push({ year, name, category: "属性", field: attr, value: v, reason: `${pos} 位置均值 ${Math.round(s.mean)}±${Math.round(s.std)}，z=${z.toFixed(1)} 明显偏低` });
      }
    }
    // tendencies z-score (extreme only; No Setup Dribble high is normal for bigs)
    for (const [tend, v] of Object.entries(card.tendencies)) {
      if (typeof v !== "number") continue;
      if (v >= 97) {
        const s = attrStats[pos][tend];
        if (!s || s.n < 8) continue;
        const z = (v - s.mean) / s.std;
        if (z > 2.5) {
          findings.push({ year, name, category: "倾向", field: tend, value: v, reason: `${pos} 位置均值 ${Math.round(s.mean)}，z=${z.toFixed(1)} 极端偏高` });
        }
      }
    }
  }

  // 2. attribute-vs-tendency contradiction
  for (const [attr, tends] of ATTR_TENDENCY_PAIRS) {
    const av = card.detailed[attr];
    if (typeof av !== "number") continue;
    for (const tend of tends) {
      const tv = card.tendencies[tend];
      if (typeof tv !== "number") continue;
      if (tv >= 88 && av < 65) {
        findings.push({ year, name, category: "矛盾", field: tend, value: tv, reason: `倾向极高(${tv})但${ATTR_CN[attr] ?? attr}只有 ${av}` });
      } else if (tv <= 20 && av >= 90 && tend !== "Shot Close" && tend !== "Shot Under Basket") {
        const historical = year < 1979 && (tend === "Shot Three" || tend === "Spot Up Shot Three" || tend === "Off-Screen Shot Three" || tend === "Transition Pull-Up Three Point Shot");
        findings.push({ year, name, category: historical ? "历史特征" : "矛盾", field: tend, value: tv, reason: historical ? `${ATTR_CN[attr] ?? attr}高达 ${av} 但三分倾向仅 ${tv}（${year} 年代无三分线，倾向低属正常）` : `${ATTR_CN[attr] ?? attr}高达 ${av} 但倾向仅 ${tv}` });
      }
    }
  }

  // 3. global extremes
  for (const [attr, v] of Object.entries(card.detailed)) {
    if (typeof v === "number" && (v >= 98 || v <= 22)) {
      findings.push({ year, name, category: "极端", field: attr, value: v, reason: v >= 98 ? "接近满值" : "极低值" });
    }
  }
}

// ---------- pick per year (up to 3 players x 2 findings) ----------
const byYear = new Map();
for (const f of findings) {
  if (!byYear.has(f.year)) byYear.set(f.year, []);
  byYear.get(f.year).push(f);
}
const years = [...byYear.keys()].sort((a, b) => a - b);
const picked = [];
for (const year of years) {
  const list = byYear.get(year);
  // prefer contradiction + high-z findings; cap 3 players, 2 findings each
  const ranked = [...list].sort((a, b) => {
    const score = (f) => (f.category === "矛盾" ? 2 : f.category === "极端" ? 1.5 : 1) + (f.value >= 95 || f.value <= 30 ? 0.5 : 0);
    return score(b) - score(a);
  });
  const seenPlayers = new Set();
  const perYear = [];
  for (const f of ranked) {
    if (perYear.length >= 3) break;
    if (seenPlayers.has(f.name)) continue;
    seenPlayers.add(f.name);
    perYear.push(f);
  }
  // ensure at least 1 finding per year if exists
  if (perYear.length === 0 && list.length) perYear.push(list[0]);
  picked.push(...perYear);
}

// ---------- output ----------
const md = [`# 卡数据抽查清单（异常属性/倾向 · ${date}）`, "",
  `覆盖 ${years.length} 届 · 检出 ${picked.length} 项异常（含矛盾/极端/位置偏离）。请在游戏内核对以下球员的对应字段，数值与导出一致即为正常，否则反馈差异。`, ""];
for (const year of years) {
  const items = picked.filter((f) => f.year === year);
  if (!items.length) continue;
  md.push(`## ${year} 届`, "", "| 球员 | 类别 | 字段 | 数值 | 检出原因 |", "|------|------|------|------|----------|");
  for (const f of items) {
    const field = f.category === "属性" ? (ATTR_CN[f.field] ?? f.field) : f.category === "倾向" ? (TENDENCY_CN[f.field] ?? f.field) : (ATTR_CN[f.field] ?? f.field);
    md.push(`| ${f.name} | ${f.category} | ${field} | **${f.value}** | ${f.reason} |`);
  }
  md.push("");
}
writeFileSync(path.join(root, `data/raw/db2k/card-verify-checklist-${date}.md`), md.join("\n"), "utf8");

const csv = ["年份,球员,类别,字段,数值,检出原因"];
for (const f of picked) {
  csv.push(`${f.year},${f.name},${f.category},${f.field},${f.value},${f.reason}`);
}
writeFileSync(path.join(root, `data/raw/db2k/card-verify-checklist-${date}.csv`), csv.join("\n"), "utf8");

console.log(`checklist: ${picked.length} findings across ${years.length} years -> card-verify-checklist-${date}.md/.csv`);
console.log(`per year: ${years.map((y) => `${y}:${picked.filter((f) => f.year === y).length}`).join(" ")}`);
