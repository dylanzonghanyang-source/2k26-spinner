#!/usr/bin/env node
/**
 * Estimate missing rookie-card OVR via the trained rookie card model
 * (src/data/rookieOverallModel-rookie.json, non-negative coefficients, MAE≈1.3).
 *
 * Skips the high-value collection list (A/B tiers the user will capture in
 * game), then writes estimates into data/raw/db2k/{year}-overrides.json with
 * an `estimated: true` marker so user-confirmed values can later overwrite.
 *
 * Run: node --experimental-strip-types scripts/estimate-missing-ovr.mts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getBadgeCategory } from "../src/badges.ts";

const ROOT = path.resolve(process.cwd());
const CARDS = path.join(ROOT, "src/data/rookieCards");
const OVERRIDES_DIR = path.join(ROOT, "data/raw/db2k");

const model = JSON.parse(readFileSync(path.join(ROOT, "src/data/rookieOverallModel-rookie.json"), "utf8"));
const attributes = model.attributes as string[];
const badgeCategories = model.badgeCategories as string[];
const tierPoints = model.tierPoints as Record<string, number>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function coreName(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimate(
  values: Record<string, number>,
  position: string,
  badges: { name: string; tier: string }[],
): number {
  const pos = (position || "SF").split("/")[0];
  const posModel = model.positionsWithBadges?.[pos] ?? model.positions[pos] ?? model.positions.SF;
  // 属性估计（无徽章基础）
  const attributeModel = model.positions[pos] ?? model.positions.SF;
  const attributeEstimate = attributes.reduce(
    (total, attr) => total + clamp(Number(values[attr]) || 65, 25, 99) * (attributeModel.coefficients[attr] ?? 0),
    attributeModel.intercept,
  );
  // 徽章联合估计
  const badgePoints = Object.fromEntries(badgeCategories.map((cat) => [cat, 0]));
  for (const badge of badges ?? []) {
    const tier = tierPoints[badge.tier];
    const cat = getBadgeCategory(badge.name);
    if (tier && cat && badgePoints[cat] !== undefined) {
      badgePoints[cat] += tier;
    }
  }
  const jointEstimate = attributes.reduce(
    (total, attr) => total + clamp(Number(values[attr]) || 65, 25, 99) * (posModel.coefficients[attr] ?? 0),
    posModel.intercept,
  );
  const badgeAdjusted = badgeCategories.reduce(
    (total, cat, index) => total + badgePoints[cat] * Math.max(0, posModel.badgeCoefficients?.[cat] ?? 0),
    jointEstimate,
  );
  return Math.round(clamp(Math.max(attributeEstimate, badgeAdjusted), 40, 99));
}

// 高价值采集清单（用户去游戏采集，跳过估算）：A 层 pick1-5 + B 层 pick6-14 球星
const skipNames = new Set([
  // 卡名顺序/后缀与官方名不同的补充
  "Otto Porter",
  "Jianlian Yi",
  "Larry Siegfried","Dave DeBusschere","Nate Thurmond","Joe Caldwell","Dave Bing","Lou Hudson",
  "Jack Marin","Earl Monroe","Walt Frazier","Elvin Hayes","Wes Unseld","Austin Carr","Sidney Wicks",
  "Bob McAdoo","Doug Collins","David Thompson","Alvan Adams","Darryl Dawkins","Wally Walker",
  "Kent Benson","Phil Ford","Dave Greenwood","Greg Kelser","Joe Barry Carroll","Darrell Griffith",
  "Danny Vranes","LaSalle Thompson","Steve Stipanovich","Wayman Tisdale","Benoit Benjamin",
  "Chris Washburn","Kenny Walker","Reggie Williams","Pervis Ellison","Danny Ferry","J.R. Reid",
  "Billy Owens","Joe Smith","Ray Allen","Tony Battie","Jonathan Bender","Stromile Swift",
  "Darius Miles","Marcus Fizer","Kwame Brown","Eddy Curry","Jay Williams","Emeka Okafor",
  "Ben Gordon","Devin Harris","Marvin Williams","Raymond Felton","Adam Morrison","Tyrus Thomas",
  "Shelden Williams","Michael Beasley","O.J. Mayo","Tyreke Evans","Derrick Favors","Derrick Williams",
  "Dion Waiters","Thomas Robinson","Otto Porter Jr.","Cody Zeller","Alex Len","Danté Exum",
  "Jahlil Okafor","Dragan Bender","Markelle Fultz",
  "Lenny Wilkens","Jerry Lucas","John Havlicek","Willis Reed","Paul Westphal","Julius Erving",
  "Mitch Kupchak","T.J. Ford","Andrew Bynum","Yi Jianlian","Danilo Gallinari","Brandon Jennings",
  "Greg Monroe","Alec Burks","Nerlens Noel","Dario Šarić","T.J. Warren",
]);
const skipCores = new Set([...skipNames].map(coreName));

let estimated = 0;
let skipped = 0;
const byYear = new Map<string, Record<string, { overall: number; estimated: boolean }>>();

for (const year of readdirSync(CARDS)) {
  if (!/^\d{4}$/.test(year)) continue;
  const yearDir = path.join(CARDS, year);
  for (const file of readdirSync(yearDir)) {
    if (!file.endsWith(".json") || file === "review.json" || file === "capture-manifest.json") continue;
    const card = JSON.parse(readFileSync(path.join(yearDir, file), "utf8"));
    if (typeof card.overall === "number") continue;
    if (skipCores.has(coreName(card.name))) {
      skipped++;
      continue;
    }
    const overall = estimate(card.detailed ?? {}, card.position ?? "SF", card.badges ?? []);
    if (!byYear.has(year)) byYear.set(year, {});
    byYear.get(year)![card.slug] = { overall, estimated: true };
    estimated++;
  }
}

mkdirSync(OVERRIDES_DIR, { recursive: true });
let total = 0;
for (const [year, entries] of [...byYear.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const file = path.join(OVERRIDES_DIR, `${year}-overrides.json`);
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  // 已有用户确认值优先；只补充缺失的
  const merged: Record<string, { overall: number; estimated?: boolean }> = { ...existing };
  for (const [slug, entry] of Object.entries(entries)) {
    if (existing[slug]?.overall != null) continue; // 不覆盖用户确认值
    merged[slug] = entry;
  }
  writeFileSync(file, JSON.stringify(merged, null, 2));
  total += Object.keys(entries).length;
}
console.log(`estimated: ${estimated} cards across ${byYear.size} years (skipped collection list: ${skipped})`);
console.log(`merged into ${byYear.size} year-overrides files`);
