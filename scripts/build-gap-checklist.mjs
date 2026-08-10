/**
 * Generate the gap-collection checklist for uncollected (pre-2003) players.
 * Outputs: data/raw/db2k/gap-collection-YYYY-MM-DD.csv + .md
 * Run: node scripts/build-gap-checklist.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const catalog = JSON.parse(readFileSync(path.join(root, "src/data/versions/2k27-play-now/rosterCatalog.json"), "utf8"));
const legacy = JSON.parse(readFileSync(path.join(root, "src/data/rookieCardIndex-legacy.min.json"), "utf8"));
const current = JSON.parse(readFileSync(path.join(root, "src/data/rookieCardIndex-current.min.json"), "utf8"));

function core(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIASES = {
  "Mo Bamba": "Mohamed Bamba", "Svi Mykhailiuk": "Sviatoslav Mykhailiuk", "Alex Sarr": "Alexandre Sarr",
  "Rob Dillingham": "Robert Dillingham", "Bub Carrington": "Carlton Carrington", "Bones Hyland": "Nah Shon Hyland",
  "Ronald Holland II": "Ron Holland", "VJ Edgecombe": "V.J. Edgecombe", "RJ Barrett": "R.J. Barrett",
  "CJ McCollum": "C.J. McCollum", "LJ Cryer": "L.J. Cryer", "Nic Claxton": "Nicolas Claxton",
  "Moussa Diabate": "Moussa Diabate", "AJ Green": "A.J. Green", "KJ Simpson": "K.J. Simpson",
  "AJ Johnson": "A.J. Johnson", "GG Jackson": "G.G. Jackson", "Yang Hansen": "Hansen Yang",
};
const aliasKeys = new Map(Object.entries(ALIASES).map(([k, v]) => [core(k), core(v)]));

const cardKeys = new Set();
for (const n of [...legacy.names, ...current.names]) cardKeys.add(core(n));

// gap players deduped with team list
const gapMap = new Map();
for (const team of catalog.teams) {
  for (const player of team.players) {
    const key = core(player.name);
    const ok = cardKeys.has(key) || (aliasKeys.has(key) && cardKeys.has(aliasKeys.get(key)));
    if (ok) continue;
    if (!gapMap.has(key)) {
      gapMap.set(key, { name: player.name, position: player.position ?? "", overall: player.overall ?? 0, teams: [] });
    }
    const entry = gapMap.get(key);
    entry.teams.push(`${team.category === "allTime" ? "ALL-TIME" : team.category === "classic" ? "CLASSIC" : "CURRENT"} ${team.name}`);
    if ((player.overall ?? 0) > entry.overall) entry.overall = player.overall;
  }
}
const players = [...gapMap.values()].sort((a, b) => b.overall - a.overall);
const date = new Date().toISOString().slice(0, 10);

// ---- CSV ----
const csvLines = ["球员,位置,OVR,来源队(最多3),类别"];
for (const p of players) {
  const cat = p.teams.some((t) => t.startsWith("CURRENT")) ? "current(2026新秀)" : p.teams.some((t) => t.startsWith("ALL-TIME")) ? "allTime" : "classic";
  csvLines.push(`${p.name},${p.position},${p.overall},${p.teams.slice(0, 3).join(" | ")},${cat}`);
}
const csvPath = path.join(root, `data/raw/db2k/gap-collection-${date}.csv`);
writeFileSync(csvPath, csvLines.join("\n"), "utf8");

// ---- MD grouped by team ----
const byTeam = new Map();
for (const p of players) {
  for (const team of p.teams) {
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(p);
  }
}
const mdLines = [
  `# 缺口球员采集清单（${date}）`,
  "",
  `共 **${players.length}** 名 2K26/2K27 有版权但尚未采集新秀卡的球员（2003 前传奇为主 + 5 名 2026 届新秀）。`,
  "",
  "## 采集流程",
  "1. Windows 游戏：MyNBA → 选择目标 draft class 年份 → DB2K Editor snapshot（2K26 支持 1960 起）",
  "2. 转移 JSON 到 Mac（文件名前缀年份）",
  "3. FaceID whitelist → `convert-db2k-to-rookiecard.mjs`",
  "4. OVR 手动在游戏内确认后填 CSV（`{year}-overrides.json`）",
  "",
  "> 提示：下表按来源队分组。经典队名带赛季年份可辅助定位球员入行年代；ALL-TIME 队球员需在游戏中按 draft class 年份对照。",
  "",
  "## 按来源队分组",
];
for (const [team, members] of [...byTeam.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  mdLines.push(`### ${team}（${members.length} 人）`);
  mdLines.push("");
  mdLines.push("| 球员 | 位置 | OVR |");
  mdLines.push("|------|------|-----|");
  for (const m of members.sort((a, b) => b.overall - a.overall)) {
    mdLines.push(`| ${m.name} | ${m.position} | ${m.overall} |`);
  }
  mdLines.push("");
}
const mdPath = path.join(root, `data/raw/db2k/gap-collection-${date}.md`);
writeFileSync(mdPath, mdLines.join("\n"), "utf8");

// ---- summary ----
const tiers = { "90+": 0, "85-89": 0, "80-84": 0, "75-79": 0, "70-74": 0, "<70": 0 };
for (const p of players) {
  const t = p.overall >= 90 ? "90+" : p.overall >= 85 ? "85-89" : p.overall >= 80 ? "80-84" : p.overall >= 75 ? "75-79" : p.overall >= 70 ? "70-74" : "<70";
  tiers[t]++;
}
console.log(`缺口清单: ${players.length} 人 → ${path.relative(root, csvPath)}`);
console.log(`按 OVR 分层: ${JSON.stringify(tiers)}`);
const byCat = {};
for (const p of players) {
  const cat = p.teams.some((t) => t.startsWith("CURRENT")) ? "current2026" : p.teams.some((t) => t.startsWith("ALL-TIME")) ? "allTime" : "classic";
  byCat[cat] = (byCat[cat] ?? 0) + 1;
}
console.log(`按类别: ${JSON.stringify(byCat)}`);
console.log(`90+ 巨星: ${players.filter((p) => p.overall >= 90).map((p) => p.name).join("、")}`);
