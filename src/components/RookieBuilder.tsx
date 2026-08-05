import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Pencil,
  RefreshCw,
  Shuffle,
  Unlock,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  badgeTierCN,
  buildBadgesByBundle,
  downgradeBadgesForRookie,
  getBadgeNameCN,
  type PlayerBadgeLike,
  type RookieBadgeTier,
} from "../badges";
import MarqueeDraw, { type MarqueeDrawItem } from "./MarqueeDraw";
import { attrNameCN, type BadgeTier, type PlayerSource } from "../domain";
import {
  collectTendenciesByBundle,
  loadTendencyLookup,
  type TendencyDataVersion,
  type TendencyLookup,
} from "../tendencies";
import { getTendencyNameCN } from "../tendencyNames";
import { tendencyBundleMap } from "./tendencyBundleMap";
import { badgeBundleMap } from "./badgeBundleMap";
import { getPlayerHeadshotSources, prefetchPlayerHeadshots } from "../playerHeadshots";
import { getPlayerNameCN } from "../playerNames";
import { estimateGameOverall, type OverallDataVersion } from "../rookieOverall";
import { generateRookieName } from "../rookieNames";
import {
  applyBodyConstraints,
  parsePlayerBody,
  type BuilderBody as BodySettings,
} from "../rookieBodyConstraints";
import {
  DURABILITY_ATTRIBUTES,
  generateDurabilityAttributes,
  generateRookieDurability,
} from "../rookieDurability";
import {
  constrainRookieInitialAttributes,
} from "../rookieInitialOverall";

export type RookieBuilderTeam = {
  id: string;
  name: string;
  players: PlayerSource[];
};

type Position = "PG" | "SG" | "SF" | "PF" | "C";
export type BuilderMode = "rookie" | "prime";
export type SourceSelectionMode = "random" | "manual";
type BundleCategory = "technical" | "physical" | "mental";
type MobilePane = "settings" | "players" | "attributes" | "result";


type Bundle = {
  id: string;
  label: string;
  attrs: string[];
  category: BundleCategory;
  color: string;
};
type PlayerLock = { kind: "player"; playerId: string };
type CustomLock = { kind: "custom"; values: Record<string, number> };
type LockState = Record<string, PlayerLock | CustomLock>;
type Evaluation = {
  raw: number;
  adjusted: number;
  bodyAdjustment: number;
  bodyAdjustments: Record<string, number>;
  bodyCaps: Partial<Record<string, number>>;
  values: Record<string, number>;
};
type TeamRound = {
  teamId: string;
  playerOrder: string[];
  offset: number;
};
type ManualPlayerGroup = {
  key: string;
  representative: PlayerSource;
  variants: PlayerSource[];
};
type HotZoneState = "冷区" | "中性" | "热区";
type TendencyLoadState = "idle" | "loading" | "ready" | "unavailable" | "error";
type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

export const bundles: Bundle[] = [
  { id: "three", label: "三分", attrs: ["Three-Point Shot"], category: "technical", color: "#26785f" },
  { id: "mid", label: "中投", attrs: ["Mid-Range Shot", "Free Throw"], category: "technical", color: "#26785f" },
  { id: "face", label: "面框", attrs: ["Layup", "Close Shot", "Draw Foul", "Hands"], category: "technical", color: "#9a6424" },
  { id: "post", label: "背身", attrs: ["Post Fade", "Post Hook", "Post Control"], category: "technical", color: "#9a6424" },
  { id: "dunk", label: "扣篮", attrs: ["Driving Dunk", "Standing Dunk"], category: "physical", color: "#9a6424" },
  { id: "handle", label: "控球", attrs: ["Ball Handle", "Speed with Ball"], category: "technical", color: "#4b6f91" },
  { id: "passing", label: "传球", attrs: ["Pass Accuracy", "Pass IQ", "Pass Vision"], category: "mental", color: "#4b6f91" },
  { id: "perimeter", label: "外防", attrs: ["Perimeter Defense"], category: "technical", color: "#3b776f" },
  { id: "interior", label: "内防", attrs: ["Interior Defense"], category: "technical", color: "#3b776f" },
  { id: "steal", label: "抢断", attrs: ["Steal", "Pass Perception"], category: "technical", color: "#3b776f" },
  { id: "block", label: "盖帽", attrs: ["Block"], category: "physical", color: "#3b776f" },
  { id: "rebound", label: "篮板", attrs: ["Offensive Rebound", "Defensive Rebound"], category: "physical", color: "#3b776f" },
  { id: "athletic", label: "运动", attrs: ["Speed", "Agility", "Vertical", "Stamina", "Hustle"], category: "physical", color: "#8a6a3a" },
  { id: "strength", label: "力量", attrs: ["Strength"], category: "physical", color: "#8a6a3a" },
  { id: "stability", label: "稳定性", attrs: ["Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ", "Overall Durability"], category: "mental", color: "#68737d" },
  { id: "potential", label: "潜力", attrs: ["Potential"], category: "mental", color: "#9a6424" },
];

const positions: Position[] = ["PG", "SG", "SF", "PF", "C"];
const ages = [18, 19, 20, 21, 22, 23];
const playersPerRound = 8;
const playerSwitchLimit = 3;
const teamDrawDurationMs = 2400;
const teamDrawSettleHoldMs = 360;
const secondaryPositionShare = 0.25;

const teamLogoCodes: Record<string, string> = {
  "Atlanta Hawks": "atl", "Boston Celtics": "bos", "Brooklyn Nets": "bkn", "Charlotte Hornets": "cha",
  "Chicago Bulls": "chi", "Cleveland Cavaliers": "cle", "Dallas Mavericks": "dal", "Denver Nuggets": "den",
  "Detroit Pistons": "det", "Golden State Warriors": "gs", "Houston Rockets": "hou", "Indiana Pacers": "ind",
  "Los Angeles Clippers": "lac", "Los Angeles Lakers": "lal", "Memphis Grizzlies": "mem", "Miami Heat": "mia",
  "Milwaukee Bucks": "mil", "Minnesota Timberwolves": "min", "New Orleans Pelicans": "no", "New York Knicks": "ny",
  "Oklahoma City Thunder": "okc", "Orlando Magic": "orl", "Philadelphia 76ers": "phi", "Phoenix Suns": "phx",
  "Portland Trail Blazers": "por", "Sacramento Kings": "sac", "San Antonio Spurs": "sa", "Toronto Raptors": "tor",
  "Utah Jazz": "utah", "Washington Wizards": "wsh",
};

function teamMark(team: RookieBuilderTeam) {
  return team.name
    .split(/\s+/)
    .filter((word) => !["Los", "Angeles", "New", "San"].includes(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase() || team.id.slice(0, 3).toUpperCase();
}

function teamLogoUrl(team: RookieBuilderTeam, theme: "light" | "dark" = "light") {
  const code = teamLogoCodes[team.name];
  if (!code) return undefined;
  // ESPN ships a dedicated 500-dark set that stays readable on dark panels.
  const folder = theme === "dark" ? "500-dark" : "500";
  return `https://a.espncdn.com/i/teamlogos/nba/${folder}/${code}.png`;
}

const naturalSecondaryPositions: Record<Position, Position[]> = {
  PG: ["SG", "SF"],
  SG: ["PG", "SF"],
  SF: ["PG", "SG", "PF"],
  PF: ["SF", "C"],
  C: ["PF"],
};

function defaultSecondaryPosition(position: Position): Position {
  return ({ PG: "SG", SG: "PG", SF: "PF", PF: "C", C: "PF" } as const)[position];
}

function isNaturalSecondaryPosition(position: Position, secondary: Position) {
  return naturalSecondaryPositions[position].includes(secondary);
}

function blendedPositionWeight(position: Position, secondary: Position, bundleId: string) {
  return positionWeights[position][bundleId] * (1 - secondaryPositionShare) + positionWeights[secondary][bundleId] * secondaryPositionShare;
}

function displayedPositionWeight(position: Position, secondary: Position, bundleId: string) {
  return Math.round(blendedPositionWeight(position, secondary, bundleId));
}

const bodyBases: Record<Position, BodySettings> = {
  PG: { height: 185, weight: 82, wingspan: 46, shoulder: 46, neck: 50, torso: 48 },
  SG: { height: 193, weight: 90, wingspan: 49, shoulder: 49, neck: 50, torso: 50 },
  SF: { height: 201, weight: 98, wingspan: 53, shoulder: 53, neck: 51, torso: 52 },
  PF: { height: 206, weight: 108, wingspan: 57, shoulder: 58, neck: 52, torso: 55 },
  C: { height: 211, weight: 116, wingspan: 61, shoulder: 62, neck: 53, torso: 58 },
};

const durabilityAttrs = [...DURABILITY_ATTRIBUTES];

const fullAttributeGroups = [
  { key: "offense", label: "进攻", attrs: ["Layup", "Post Fade", "Post Hook", "Post Control", "Draw Foul", "Close Shot", "Mid-Range Shot", "Three-Point Shot", "Free Throw", "Ball Handle", "Pass IQ", "Pass Accuracy", "Offensive Rebound", "Standing Dunk", "Driving Dunk", "Shot IQ", "Pass Vision", "Hands"] },
  { key: "defense", label: "防守", attrs: ["Defensive Rebound", "Interior Defense", "Perimeter Defense", "Block", "Steal"] },
  { key: "athletic", label: "运动", attrs: ["Speed", "Speed with Ball", "Vertical", "Stamina", "Hustle", "Agility"] },
  { key: "strength", label: "力量", attrs: ["Strength"] },
  { key: "durability", label: "耐久", attrs: durabilityAttrs },
  { key: "mental", label: "精神", attrs: ["Pass Perception", "Defensive Consistency", "Help Defense IQ", "Offensive Consistency"] },
  { key: "misc", label: "杂项", attrs: ["Intangibles"] },
] as const;

// PG-SF and PF weights are adapted from the supplied mobile-game tables.
// Strength is kept separate from athleticism so body weight can constrain it independently.
// The missing C table is conservatively inferred from the PF distribution.
const positionWeights: Record<Position, Record<string, number>> = {
  PG: { three: 10, mid: 10, face: 6, post: 2, dunk: 4, handle: 14, passing: 14, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 10, strength: 2, stability: 8, potential: 0 },
  SG: { three: 12, mid: 12, face: 7, post: 3, dunk: 6, handle: 10, passing: 8, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 10, strength: 2, stability: 10, potential: 0 },
  SF: { three: 10, mid: 10, face: 7, post: 3, dunk: 8, handle: 8, passing: 6, perimeter: 7, interior: 8, steal: 3, block: 4, rebound: 6, athletic: 11, strength: 3, stability: 6, potential: 0 },
  PF: { three: 8, mid: 6, face: 6, post: 6, dunk: 6, handle: 6, passing: 4, perimeter: 7, interior: 12, steal: 3, block: 8, rebound: 10, athletic: 10, strength: 4, stability: 4, potential: 0 },
  C: { three: 4, mid: 4, face: 4, post: 6, dunk: 8, handle: 2, passing: 4, perimeter: 3, interior: 14, steal: 1, block: 12, rebound: 14, athletic: 11, strength: 7, stability: 6, potential: 0 },
};

const teamNamesCN: Record<string, string> = {
  "Atlanta Hawks": "老鹰", "Boston Celtics": "凯尔特人", "Brooklyn Nets": "篮网",
  "Charlotte Hornets": "黄蜂", "Chicago Bulls": "公牛", "Cleveland Cavaliers": "骑士",
  "Dallas Mavericks": "独行侠", "Denver Nuggets": "掘金", "Detroit Pistons": "活塞",
  "Golden State Warriors": "勇士", "Houston Rockets": "火箭", "Indiana Pacers": "步行者",
  "Los Angeles Clippers": "快船", "Los Angeles Lakers": "湖人", "Memphis Grizzlies": "灰熊",
  "Miami Heat": "热火", "Milwaukee Bucks": "雄鹿", "Minnesota Timberwolves": "森林狼",
  "New Orleans Pelicans": "鹈鹕", "New York Knicks": "尼克斯", "Oklahoma City Thunder": "雷霆",
  "Orlando Magic": "魔术", "Philadelphia 76ers": "76人", "Phoenix Suns": "太阳",
  "Portland Trail Blazers": "开拓者", "Sacramento Kings": "国王", "San Antonio Spurs": "马刺",
  "Toronto Raptors": "猛龙", "Utah Jazz": "爵士", "Washington Wizards": "奇才",
};

const teamAliasesCN: Record<string, string> = {
  "76ers": "76人", "Bucks": "雄鹿", "Bulls": "公牛", "Cavaliers": "骑士", "Celtics": "凯尔特人",
  "Clippers": "快船", "Grizzlies": "灰熊", "Hawks": "老鹰", "Heat": "热火", "Hornets": "黄蜂",
  "Jazz": "爵士", "Kings": "国王", "Knicks": "尼克斯", "Lakers": "湖人", "Magic": "魔术",
  "Mavericks": "独行侠", "Nets": "篮网", "Nuggets": "掘金", "Pacers": "步行者", "Pelicans": "鹈鹕",
  "Pistons": "活塞", "Raptors": "猛龙", "Rockets": "火箭", "Spurs": "马刺", "Suns": "太阳",
  "Thunder": "雷霆", "Timberwolves": "森林狼", "Trail Blazers": "开拓者", "Warriors": "勇士",
  "Wizards": "奇才", "New Jersey Nets": "篮网", "Charlotte Bobcats": "黄蜂", "Seattle SuperSonics": "超音速",
  "New Orleans Hornets": "鹈鹕", "Vancouver Grizzlies": "灰熊", "Washington Bullets": "奇才",
};

const rosterCategoryCN: Record<NonNullable<PlayerSource["rosterCategory"]>, string> = {
  current: "现役",
  classic: "经典赛季",
  allTime: "历史阵容",
};

const aliases: Record<string, string[]> = {
  Layup: ["Layup", "Driving Layup"],
  "Ball Handle": ["Ball Handle", "Ball Control"],
  Agility: ["Agility", "Lateral Quickness", "Acceleration"],
  "Overall Durability": ["Overall Durability", "Durability"],
};

function clamp(value: number, min = 25, max = 99) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[], fallback = 65) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: () => number) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function createBodySettings(position: Position, seed: number): BodySettings {
  const base = bodyBases[position];
  const random = makeRandom(seed);
  return {
    height: clamp(base.height + (random() - 0.5) * 10, 150, 300),
    weight: clamp(base.weight + (random() - 0.5) * 16, 50, 200),
    wingspan: clamp(base.wingspan + (random() - 0.5) * 20, 1, 100),
    shoulder: clamp(base.shoulder + (random() - 0.5) * 18, 1, 100),
    neck: clamp(base.neck + (random() - 0.5) * 24, 1, 100),
    torso: clamp(base.torso + (random() - 0.5) * 20, 1, 100),
  };
}

function playerId(player: PlayerSource) {
  return player.id ?? `${player.rosterTeam ?? player.team ?? "team"}:${player.slug ?? player.name}`;
}

function playerIdentity(player: PlayerSource) {
  return player.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePlayerSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.'’\-]/g, "");
}

function matchesPlayerSearch(player: PlayerSource, query: string) {
  const normalizedQuery = normalizePlayerSearch(query);
  if (!normalizedQuery) return true;
  return [player.name, getPlayerNameCN(player.name), player.rosterTeam ?? "", player.position ?? ""]
    .some((value) => normalizePlayerSearch(value).includes(normalizedQuery));
}

function matchesPlayerGroupSearch(group: ManualPlayerGroup, query: string) {
  const normalizedQuery = normalizePlayerSearch(query);
  if (!normalizedQuery) return true;
  return group.variants.some((player) => matchesPlayerSearch(player, query))
    || normalizePlayerSearch(getPlayerNameCN(group.representative.name)).includes(normalizedQuery);
}

function localizedTeamName(team: string) {
  return teamNamesCN[team]
    ?? teamAliasesCN[team]
    ?? team.replace(/^(?:All-Time\s+)?(?:\d{4}-\d{2}\s+)?/, "");
}

function playerVariantLabel(player: PlayerSource) {
  const rawTeam = player.rosterTeam ?? player.team ?? "未记录球队";
  const category = player.rosterCategory ? rosterCategoryCN[player.rosterCategory] : "球员版本";
  const allTimeTeam = rawTeam.replace(/^All-Time\s+/, "");
  const classicMatch = rawTeam.match(/^(\d{4}-\d{2})\s+(.+)$/);
  if (player.rosterCategory === "allTime") return `${category} · ${localizedTeamName(allTimeTeam)}`;
  if (classicMatch) return `${category} · ${classicMatch[1]} · ${localizedTeamName(classicMatch[2])}`;
  return `${category} · ${localizedTeamName(rawTeam)}`;
}

function fallback(player: PlayerSource, attr: string) {
  if (["Three-Point Shot", "Mid-Range Shot", "Free Throw", "Offensive Consistency", "Shot IQ"].includes(attr)) return player.shooting ?? player.overall ?? 68;
  if (["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass IQ", "Pass Vision"].includes(attr)) return player.playmaking ?? player.overall ?? 66;
  if (["Perimeter Defense", "Interior Defense", "Steal", "Pass Perception", "Block", "Defensive Rebound", "Defensive Consistency", "Help Defense IQ"].includes(attr)) return player.defense ?? player.overall ?? 65;
  if (["Speed", "Agility", "Vertical", "Strength", "Stamina", "Hustle", "Overall Durability"].includes(attr)) return player.athleticism ?? player.overall ?? 68;
  return player.inside ?? player.overall ?? 64;
}

function getAttr(player: PlayerSource, attr: string) {
  if (attr === "Potential") return clamp(player.potential ?? player.overall ?? 75);
  for (const name of aliases[attr] ?? [attr]) {
    const value = player.detailed?.[name];
    if (typeof value === "number") return clamp(value);
  }
  return clamp(fallback(player, attr));
}

function evaluate(player: PlayerSource, bundle: Bundle, body: BodySettings): Evaluation {
  const rawValues = Object.fromEntries(bundle.attrs.map((attr) => [attr, getAttr(player, attr)]));
  const constrained = applyBodyConstraints(rawValues, body, parsePlayerBody(player));
  const raw = Math.round(average(Object.values(rawValues)));
  const adjusted = Math.round(average(Object.values(constrained.values)));
  return {
    raw,
    adjusted,
    bodyAdjustment: adjusted - raw,
    bodyAdjustments: constrained.adjustments,
    bodyCaps: constrained.caps,
    values: constrained.values,
  };
}

function evaluateCustom(bundle: Bundle, customValues: Record<string, number>, body: BodySettings): Evaluation {
  const rawValues = Object.fromEntries(bundle.attrs.map((attr) => [attr, clamp(customValues[attr] ?? 75)]));
  const constrained = applyBodyConstraints(rawValues, body, null);
  const raw = Math.round(average(Object.values(rawValues)));
  const adjusted = Math.round(average(Object.values(constrained.values)));
  return {
    raw,
    adjusted,
    bodyAdjustment: adjusted - raw,
    bodyAdjustments: constrained.adjustments,
    bodyCaps: constrained.caps,
    values: constrained.values,
  };
}

/** Attribute / OVR rating color.
 * Light mode uses darker semantic tokens so 80+ green and 90+ amber stay readable
 * on white / warm-gray panels. Dark mode recolors these classes in styles.css.
 */
function valueColor(value: number) {
  if (value >= 90) return "text-warning-800 value-rating value-rating-elite";
  if (value >= 80) return "text-court-800 value-rating value-rating-good";
  if (value >= 70) return "text-ink-900 value-rating value-rating-solid";
  if (value >= 60) return "text-ink-700 value-rating value-rating-fair";
  return "text-ink-600 value-rating value-rating-low";
}

function createRound(teams: RookieBuilderTeam[], seed: number, previousTeamId = ""): TeamRound {
  const valid = teams.filter((team) => team.players.length > 0);
  const random = makeRandom(seed);
  // Exclude the previous team so every remaining team stays equally likely.
  // Replacing a repeat with "next in array" doubled that neighbor's odds.
  const candidates = valid.length > 1
    ? valid.filter((team) => team.id !== previousTeamId)
    : valid;
  const pool = candidates.length > 0 ? candidates : valid;
  const team = pool[Math.floor(random() * pool.length)] ?? pool[0];
  return {
    teamId: team?.id ?? "",
    playerOrder: team ? shuffle(team.players.map(playerId), random) : [],
    offset: 0,
  };
}

function rookieValue(value: number, age: number, category: BundleCategory) {
  const progressByCategory: Record<BundleCategory, number[]> = {
    technical: [0.82, 0.85, 0.88, 0.91, 0.93, 0.95],
    physical: [0.92, 0.94, 0.96, 0.97, 0.98, 0.99],
    mental: [0.77, 0.81, 0.85, 0.88, 0.9, 0.92],
  };
  const ageIndex = Math.max(0, Math.min(ages.length - 1, age - ages[0]));
  const progress = Math.max(0.55, Math.min(1, progressByCategory[category][ageIndex]));
  return clamp(25 + (value - 25) * progress);
}

function getValue(values: Record<string, number>, attrs: string[], fallbackValue = 65) {
  return average(attrs.map((attr) => values[attr]).filter((value): value is number => typeof value === "number"), fallbackValue);
}

function calibratedOverall(
  values: Record<string, number>,
  position: Position,
  badges?: Array<{ category?: string; tier: string }>,
  fallbackValue = 65,
  version: OverallDataVersion = "legacy",
) {
  return estimateGameOverall(values, position, badges, fallbackValue, version);
}

function tierFor(score: number): BadgeTier {
  if (score >= 96) return "HOF";
  if (score >= 90) return "Gold";
  if (score >= 84) return "Silver";
  return "Bronze";
}

function createBadges(attrs: Record<string, number>): PlayerBadgeLike[] {
  const rules = [
    ["Set Shot Specialist", "shooting", getValue(attrs, ["Three-Point Shot", "Mid-Range Shot"])],
    ["Deadeye", "shooting", getValue(attrs, ["Mid-Range Shot", "Shot IQ"])],
    ["Limitless Range", "shooting", getValue(attrs, ["Three-Point Shot"]) - 2],
    ["Physical Finisher", "inside", getValue(attrs, ["Layup", "Strength"])],
    ["Posterizer", "inside", getValue(attrs, ["Driving Dunk", "Vertical"])],
    ["Handles For Days", "playmaking", getValue(attrs, ["Ball Handle", "Stamina"])],
    ["Dimer", "playmaking", getValue(attrs, ["Pass Accuracy", "Pass IQ", "Pass Vision"])],
    ["Challenger", "defense", getValue(attrs, ["Perimeter Defense", "Agility"])],
    ["Interceptor", "defense", getValue(attrs, ["Steal", "Pass Perception"])],
    ["Paint Patroller", "defense", getValue(attrs, ["Block", "Interior Defense"])],
    ["Rebound Chaser", "rebounding", getValue(attrs, ["Offensive Rebound", "Defensive Rebound"])],
  ] as const;
  return rules
    .filter(([, , score]) => score >= 78)
    .map(([name, category, score]) => ({ name, category, score, tier: tierFor(score) }));
}

function rookieTierForPotential(potential: number): RookieBadgeTier {
  if (potential >= 94) return "generational";
  if (potential >= 87) return "lottery";
  return "rotation";
}

function createHotZones(
  attrs: Record<string, number>,
  position: Position,
  secondary: Position,
  hand: "左手" | "右手",
  random: () => number,
) {
  const zones = [
    ["篮下", "rim", "center"],
    ["近距离左侧", "close", "left"], ["近距离中央", "close", "center"], ["近距离右侧", "close", "right"],
    ["中距离左侧底角", "mid", "left"], ["中距离左侧45度", "mid", "left"], ["中距离弧顶", "mid", "center"], ["中距离右侧45度", "mid", "right"], ["中距离右侧底角", "mid", "right"],
    ["三分左侧底角", "three", "left"], ["三分左侧45度", "three", "left"], ["三分弧顶", "three", "center"], ["三分右侧45度", "three", "right"], ["三分右侧底角", "three", "right"],
  ] as const;
  const preferred = hand === "左手" ? "left" : "right";
  const selectedPositions = [position, secondary];
  const scoredZones = zones.map(([name, band, side]) => {
    const base = band === "rim"
      ? getValue(attrs, ["Close Shot", "Layup", "Driving Dunk", "Standing Dunk"])
      : band === "close"
        ? getValue(attrs, ["Close Shot", "Layup", "Post Hook", "Post Control"])
        : band === "mid"
          ? getValue(attrs, ["Mid-Range Shot", "Shot IQ", "Offensive Consistency"])
          : getValue(attrs, ["Three-Point Shot", "Shot IQ", "Offensive Consistency"]);
    const handBias = side === "center" ? 0 : side === preferred ? 3 : -2;
    const roleBias = selectedPositions.some((candidate) => candidate === "PG" || candidate === "SG") && side === "center" && (band === "mid" || band === "three")
      ? 3
      : selectedPositions.some((candidate) => candidate === "PF" || candidate === "C") && (band === "rim" || band === "close") ? 4 : 0;
    const score = base + handBias + roleBias + (random() - 0.5) * 24;
    return { name, base, score, state: "中性" as HotZoneState };
  });

  // Hot-zone charts describe relative strengths, so distribute a controlled
  // number of extremes instead of classifying every zone independently.
  const rankedZones = [...scoredZones].sort((left, right) => left.score - right.score);
  const coldCount = random() < 0.7 ? 1 : 2;
  const hotCount = random() < 0.5 ? 3 : 4;
  rankedZones.slice(0, coldCount).forEach((zone) => { zone.state = "冷区"; });
  rankedZones.slice(-hotCount).forEach((zone) => { zone.state = "热区"; });

  return Object.fromEntries(scoredZones.map(({ name, state }) => [name, state]));
}

function createResult(
  evaluations: Record<string, Evaluation>,
  locks: LockState,
  age: number,
  position: Position,
  secondary: Position,
  body: BodySettings,
  mode: BuilderMode,
  players: Map<string, PlayerSource>,
  tendencyLookup: TendencyLookup | null,
  overallVersion: OverallDataVersion,
) {
  const isPrime = mode === "prime";
  let peakAttrs: Record<string, number> = {};
  let initialAttrs: Record<string, number> = {};
  const scores: number[] = [];
  for (const bundle of bundles) {
    const evaluation = evaluations[bundle.id];
    if (!evaluation) continue;
    Object.assign(peakAttrs, evaluation.values);
    if (bundle.id !== "potential") scores.push(evaluation.adjusted);
  }

  // Tendency inheritance: each slot reads only its mapped fields from the
  // compact lookup. Values are inherited verbatim, without rookie down-scaling.
  const tendencies = tendencyLookup
    ? collectTendenciesByBundle({
      sources: bundles.filter((bundle) => bundle.id !== "potential").map((bundle) => {
        const lock = locks[bundle.id];
        const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
        return { bundleId: bundle.id, playerSlug: player?.slug };
      }),
      fieldToBundle: tendencyBundleMap,
      lookup: tendencyLookup,
    })
    : {};

  const rawCustomFinalAttrs = Object.assign({}, ...Object.values(locks)
    .filter((lock): lock is CustomLock => lock.kind === "custom")
    .map((lock) => lock.values));
  const customFinalAttrs = applyBodyConstraints(rawCustomFinalAttrs, body, null).values;
  Object.assign(peakAttrs, customFinalAttrs);
  peakAttrs = applyBodyConstraints(peakAttrs, body, null).values;
  const badgeSources = bundles.filter((bundle) => bundle.id !== "potential").map((bundle) => {
    const lock = locks[bundle.id];
    return {
      bundleId: bundle.id,
      playerId: lock?.kind === "player" ? lock.playerId : undefined,
    };
  });
  const resolvePeakBadges = (attrs: Record<string, number>) => buildBadgesByBundle({
    sources: badgeSources,
    badgeToBundle: badgeBundleMap,
    badgesForPlayer: (id) => players.get(id)?.badges,
    profileKnown: (id) => players.get(id)?.badgesKnown === true,
    fallbackBadges: createBadges(attrs),
  });
  let peakBadgeResolution = resolvePeakBadges(peakAttrs);
  let peakBadges = peakBadgeResolution.badges;
  const signature = `${bundles.map((bundle) => {
    const lock = locks[bundle.id];
    return lock?.kind === "player" ? lock.playerId : lock?.kind === "custom" ? JSON.stringify(lock.values) : "-";
  }).join("|")}|${Object.values(body).join("|")}`;
  const random = makeRandom(hash(`${signature}|${age}|${position}|${secondary}`));
  const mean = average(scores, 71);
  const sourcePeakOverall = calibratedOverall(peakAttrs, position, peakBadges, mean, overallVersion);
  const potential = clamp(
    typeof peakAttrs.Potential === "number" ? peakAttrs.Potential : Math.round(sourcePeakOverall),
    40,
    99,
  );
  const rookieTier = rookieTierForPotential(potential);

  if (!isPrime) {
    peakBadgeResolution = resolvePeakBadges(peakAttrs);
    peakBadges = peakBadgeResolution.badges;
    for (const bundle of bundles) {
      for (const attr of bundle.attrs) {
        const value = peakAttrs[attr];
        if (typeof value === "number") initialAttrs[attr] = rookieValue(value, age, bundle.category);
      }
    }
  } else {
    // Prime mode exposes the evaluated values directly: no age development curve
    // and no second overall calibration should alter the attributes the user chose.
    initialAttrs = { ...peakAttrs };
  }

  const badges = isPrime ? peakBadges : downgradeBadgesForRookie(peakBadges, rookieTier);
  Object.assign(initialAttrs, customFinalAttrs);
  initialAttrs = applyBodyConstraints(initialAttrs, body, null).values;
  const sourceDurability = peakAttrs["Overall Durability"] ?? 80;
  const bodyBase = bodyBases[position];
  const bodyStress = Math.max(0, (body.weight - bodyBase.weight) / 15) + Math.max(0, (body.height - bodyBase.height) / 12);
  // Durability is calibrated separately from the generic rookie age curve.
  // Applying the mental curve first turns a source mean of ~80 into the high 60s.
  const durabilityValues = isPrime
    ? generateDurabilityAttributes(sourceDurability, random)
    : generateRookieDurability(sourceDurability, bodyStress, random);
  Object.assign(initialAttrs, durabilityValues);
  const durability = durabilityValues["Overall Durability"] ?? 82;
  const rookieOverallConstraint = isPrime
    ? null
    : constrainRookieInitialAttributes({
      values: initialAttrs,
      potential,
      age,
      adjustableAttributes: bundles
        .filter((bundle) => bundle.id !== "potential")
        .flatMap((bundle) => bundle.attrs),
      lockedValues: customFinalAttrs,
      badges,
      estimateOverall: (values, candidateBadges) => calibratedOverall(
        values,
        position,
        candidateBadges,
        mean,
        overallVersion,
      ),
    });
  if (rookieOverallConstraint) Object.assign(initialAttrs, rookieOverallConstraint.values);
  const baseOverall = calibratedOverall(initialAttrs, position, badges, mean, overallVersion);
  const initialStrength = baseOverall;
  const intangibles = 50;
  const boom = isPrime ? 0 : clamp(28 + potential - 84 - (age - 18) * 2 + (random() - 0.5) * 8, 10, 55);
  const bust = isPrime ? 0 : clamp(18 - (age - 18) + (random() - 0.5) * 8, 8, 40);
  const normal = 100 - boom - bust;
  const hand: "左手" | "右手" = random() < 0.11 ? "左手" : "右手";
  const dunkHand: "左手" | "右手" = random() < 0.8 ? hand : hand === "左手" ? "右手" : "左手";
  const growthGap = Math.max(0, potential - initialStrength);
  const progressSpeed = isPrime
    ? 0
    : Math.round(Math.max(2.2, Math.min(5.4, 2.4 + Math.max(0, (potential - 87) / 10) + (random() - 0.5) * 0.6)) * 10) / 10;
  const yearsToPeak = isPrime || progressSpeed === 0 ? 0 : Math.ceil(growthGap / progressSpeed);
  const peakStart = isPrime ? 28 : clamp(Math.max(24, age + yearsToPeak), age, 30);
  const peakDuration = isPrime ? 7 : Math.max(5, Math.min(11, 7 + (durability - 70) / 15 + random() * 1.5));
  const peakEnd = clamp(peakStart + peakDuration, peakStart, 40);
  initialAttrs.Intangibles = intangibles;
  initialAttrs.Potential = potential;
  const hotZones = createHotZones(initialAttrs, position, secondary, hand, random);
  return {
    age, position, secondary,
    hand, dunkHand, ...body,
    potential, growthGap, progressSpeed, boom, normal, bust, peakStart, peakEnd,
    peakOverall: sourcePeakOverall,
    peakAttrs, initialAttrs, initialStrength, baseOverall, intangibles, peakBadges, badges,
    initialOverallTarget: rookieOverallConstraint?.targetOverall ?? initialStrength,
    initialOverallConstraintApplied: rookieOverallConstraint?.changed ?? false,
    initialOverallConstraintReachable: rookieOverallConstraint?.reachable ?? true,
    badgesEstimated: peakBadgeResolution.estimated, rookieTier, hotZones,
    tendencies,
  };
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose Clipboard API but reject it outside a secure context.
    }
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command was rejected.");
    }
  } finally {
    textarea.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
}

function createExportText(
  rookieName: string,
  result: ReturnType<typeof createResult>,
  locks: LockState,
  evaluations: Record<string, Evaluation>,
  players: Map<string, PlayerSource>,
  mode: BuilderMode,
  tendencyLoadState: TendencyLoadState,
  dataVersionLabel: string,
) {
  const isPrime = mode === "prime";
  const tendencyLines = tendencyLoadState === "loading"
    ? ["正在加载倾向数据"]
    : tendencyLoadState === "error"
      ? ["倾向数据加载失败，请刷新后重试"]
      : tendencyLoadState === "unavailable"
        ? ["当前版本暂无独立倾向数据"]
        : Object.keys(result.tendencies).length
        ? Object.entries(result.tendencies)
          .sort(([left], [right]) => getTendencyNameCN(left).localeCompare(getTendencyNameCN(right), "zh"))
          .map(([field, value]) => `${getTendencyNameCN(field)}: ${value}`)
        : ["暂无倾向数据（来源球员没有对应档案）"];
  return [
    `${dataVersionLabel} ${isPrime ? "巅峰球员" : "新秀"}生成清单`, "", "[基本信息]",
    `姓名: ${rookieName}`, `年龄: ${result.age}`, `位置: ${result.position}`, `次要位置: ${result.secondary}`,
    `惯用手: ${result.hand}`, `扣篮惯用手: ${result.dunkHand}`,
    `巅峰开始年龄: ${result.peakStart}`, `巅峰结束年龄: ${result.peakEnd}`,
    `数据版本: ${dataVersionLabel}`,
    ...(!isPrime ? [`预计成长速度: 每年 +${result.progressSpeed} OVR`] : []),
    `潜力: ${result.potential}`,
    `成长概率: ${result.boom}%`, `平均概率: ${result.normal}%`, `衰退概率: ${result.bust}%`,
    "", "[身体设定]", `身高: ${result.height} cm`, `体重: ${result.weight} kg`, `臂展: ${result.wingspan}`,
    `肩宽: ${result.shoulder}`, `颈部长度: ${result.neck}`, `躯干长度: ${result.torso}`,
    "", `[完整${isPrime ? "巅峰" : "初始"}属性预览]`,
    ...fullAttributeGroups.flatMap((group) => [
      `-- ${group.label} --`,
      ...group.attrs.map((attr) => `${attrNameCN[attr] ?? attr}: ${result.initialAttrs[attr] ?? "--"}`),
    ]),
    "", "[杂项]", `游戏 OVR 估算: ${result.baseOverall}`, `无形属性: ${result.intangibles}`,
    `${isPrime ? "巅峰 OVR" : "预计初始 OVR"}: ${result.initialStrength}`, `潜力: ${result.potential}`,
    ...(!isPrime ? [
      `新秀初始 OVR 目标: ${result.initialOverallTarget}`,
      ...(result.initialOverallConstraintReachable ? [] : ["警告：手动锁定的数值使初始 OVR 无法完全达到目标"]),
    ] : []),
    "", "[热区]", ...Object.entries(result.hotZones).map(([name, state]) => `${name}: ${state}`),
    ...(isPrime ? [
      "", `[巅峰徽章（按属性槽继承${result.badgesEstimated ? "，含推算" : ""}）]`, ...(result.badges.length ? result.badges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier]}`) : ["无"]),
    ] : [
      "", `[当前徽章（按${result.rookieTier}档调整）]`, ...(result.badges.length ? result.badges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier]}`) : ["无"]),
      "", `[巅峰徽章（按属性槽继承${result.badgesEstimated ? "，含推算" : ""}）]`, ...(result.peakBadges.length ? result.peakBadges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier]}`) : ["无"]),
    ]),
    "", "[倾向（继承属性来源，未按等级调整）]",
    ...tendencyLines,
    "", "[属性来源]", ...bundles.map((bundle) => {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        const values = bundle.attrs.map((attr) => `${attrNameCN[attr] ?? attr} ${lock.values[attr]}`).join("，");
        return `${bundle.label}: 手动设置（${values}）`;
      }
      const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
      const evaluation = evaluations[bundle.id];
      const bodyAdjustment = evaluation?.bodyAdjustment ?? 0;
      const capLabel = Object.entries(evaluation?.bodyCaps ?? {})
        .map(([attr, cap]) => `${attrNameCN[attr] ?? attr}上限 ${cap}`)
        .join(" / ");
      const adjustments = [
        bodyAdjustment ? `身体修正 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment}` : "",
        capLabel,
        player?.isEstimated ? "估算值" : "",
      ].filter(Boolean).join("，");
      const weightLabel = bundle.id === "potential"
        ? "独立潜力来源"
        : `位置权重 ${displayedPositionWeight(result.position, result.secondary, bundle.id)}%`;
      return `${bundle.label}（${weightLabel}）: ${player ? getPlayerNameCN(player.name) : "--"}${adjustments ? `（${adjustments}）` : ""}`;
    }),
  ].join("\n");
}

const headshotSourceTimeoutMs = 2500;

function PlayerHeadshot({ name, priority = false }: { name: string; priority?: boolean }) {
  const sources = useMemo(() => getPlayerHeadshotSources(name), [name]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = sources[sourceIndex];

  useLayoutEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
  }, [name, sources]);

  useEffect(() => {
    if (!priority || !src || loaded) return;
    const timeout = window.setTimeout(() => {
      setLoaded(false);
      setSourceIndex((current) => sources[current] === src ? current + 1 : current);
    }, headshotSourceTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [loaded, priority, sources, src]);

  if (!src) {
    return (
      <span
        aria-label={`${getPlayerNameCN(name)}默认头像`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] border border-ink-200 bg-ink-100 text-ink-400"
        role="img"
        title="默认头像"
      >
        <UserRound aria-hidden="true" className="h-5 w-5 stroke-[1.6]" />
      </span>
    );
  }

  return (
    <img
      alt={`${getPlayerNameCN(name)}头像`}
      className="h-9 w-9 shrink-0 rounded-[5px] border border-ink-200 bg-ink-100 object-cover object-top"
      decoding="async"
      // Visible roster cards should load immediately; later batches can wait.
      fetchPriority={priority ? "high" : "low"}
      loading={priority ? "eager" : "lazy"}
      onError={() => {
        // Advance through proxy → primary CDN → secondary CDN; past the end shows the default avatar.
        setLoaded(false);
        setSourceIndex((current) => sources[current] === src ? current + 1 : current);
      }}
      onLoad={() => setLoaded(true)}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

function BodyNumberInput({
  disabled,
  label,
  max,
  min,
  onChange,
  unit,
  value,
}: {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  unit?: string;
  value: number;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = (rawValue: string) => {
    const parsed = Number(rawValue);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    setDraft(String(next));
    onChange(next);
  };

  return (
    <label className="min-w-0">
      <span className="mb-1 flex items-center justify-between gap-1 text-[9px] font-semibold text-ink-500"><span>{label}</span>{unit && <span className="font-normal text-ink-400">{unit}</span>}</span>
      <input
        className="h-8 w-full rounded-[5px] border border-ink-200 bg-ink-50 px-2 text-center text-[12px] font-semibold tabular-nums text-ink-800 outline-none transition focus:border-court-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
        disabled={disabled}
        inputMode="numeric"
        max={max}
        min={min}
        onBlur={(event) => commit(event.currentTarget.value)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
        type="number"
        value={draft}
      />
    </label>
  );
}

function CompactNumberInput({
  ariaLabel,
  disabled,
  max,
  min,
  onChange,
  value,
}: {
  ariaLabel: string;
  disabled: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = (rawValue: string) => {
    const parsed = Number(rawValue);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    setDraft(String(next));
    onChange(next);
  };

  return (
    <input
      aria-label={ariaLabel}
      className="h-full w-11 min-w-0 flex-1 bg-transparent px-0.5 text-center text-[12px] font-semibold tabular-nums text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
      disabled={disabled}
      inputMode="numeric"
      onBlur={(event) => commit(event.currentTarget.value)}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit(event.currentTarget.value);
          event.currentTarget.blur();
        }
      }}
      type="text"
      value={draft}
    />
  );
}

function RookieBuilder({
  teams,
  mode = "rookie",
  tendencyVersion = "2k26",
  overallVersion = "2k26",
  dataVersionLabel = "NBA 2K26",
  selectionMode = "random",
  availablePlayers = [],
  onFlowActiveChange,
}: {
  teams: RookieBuilderTeam[];
  mode?: BuilderMode;
  selectionMode?: SourceSelectionMode;
  availablePlayers?: PlayerSource[];
  tendencyVersion?: TendencyDataVersion;
  overallVersion?: OverallDataVersion;
  dataVersionLabel?: string;
  onFlowActiveChange?: (active: boolean) => void;
}) {
  const isPrime = mode === "prime";
  const isManualSelection = selectionMode === "manual";
  const [rookieName, setRookieName] = useState(() => generateRookieName());
  const [position, setPosition] = useState<Position>("PG");
  const [secondaryPosition, setSecondaryPosition] = useState<Position>(() => defaultSecondaryPosition("PG"));
  const [age, setAge] = useState(19);

  const [body, setBody] = useState<BodySettings>(() => createBodySettings("PG", Date.now()));
  const [settingsLocked, setSettingsLocked] = useState(false);
  const [tendencyLookup, setTendencyLookup] = useState<TendencyLookup | null>(null);
  const [tendencyLoadError, setTendencyLoadError] = useState(false);
  const [locks, setLocks] = useState<LockState>({});
  const [round, setRound] = useState<TeamRound>(() => createRound(teams, Date.now()));
  const [isTeamDrawing, setIsTeamDrawing] = useState(false);
  const [teamDrawPhase, setTeamDrawPhase] = useState<"rolling" | "landing">("rolling");
  const [drawingTeamId, setDrawingTeamId] = useState<string | null>(null);
  const [switchesLeft, setSwitchesLeft] = useState(playerSwitchLimit);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerVersionGroupKey, setPlayerVersionGroupKey] = useState<string | null>(null);
  const [customizingBundleId, setCustomizingBundleId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [playerSearch, setPlayerSearch] = useState("");
  const [status, setStatus] = useState(`确认${isPrime ? "巅峰球员" : "新秀"}设置后开始生成`);
  const [mobilePane, setMobilePane] = useState<MobilePane>("settings");
  const pendingTeamDrawRef = useRef<{ round: TeamRound; completionStatus: string } | null>(null);
  const customDialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onFlowActiveChange?.(settingsLocked);
  }, [onFlowActiveChange, settingsLocked]);

  useEffect(() => () => onFlowActiveChange?.(false), [onFlowActiveChange]);

  useEffect(() => () => {
    pendingTeamDrawRef.current = null;
  }, []);

  useEffect(() => {
    if (!settingsLocked || tendencyLookup || tendencyLoadError) return;
    let active = true;
    loadTendencyLookup(tendencyVersion)
      .then((lookup) => {
        if (active) setTendencyLookup(lookup);
      })
      .catch(() => {
        if (active) setTendencyLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [settingsLocked, tendencyLoadError, tendencyLookup, tendencyVersion]);

  useEffect(() => {
    if (!customizingBundleId && !playerVersionGroupKey) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = () => {
      const focusable = customDialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])");
      focusable?.focus();
    };
    const animationFrame = window.requestAnimationFrame(focusDialog);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (customizingBundleId) setCustomizingBundleId(null);
        else setPlayerVersionGroupKey(null);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(customDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? [])];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [customizingBundleId, playerVersionGroupKey]);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(
    () => new Map([
      ...teams.flatMap((team) => team.players.map((player) => [playerId(player), player] as const)),
      ...availablePlayers.map((player) => [playerId(player), player] as const),
    ]),
    [availablePlayers, teams],
  );
  const manualPlayerGroups = useMemo<ManualPlayerGroup[]>(
    () => {
      const grouped = new Map<string, Map<string, PlayerSource>>();
      for (const player of availablePlayers) {
        const identity = playerIdentity(player);
        const variants = grouped.get(identity) ?? new Map<string, PlayerSource>();
        variants.set(playerId(player), player);
        grouped.set(identity, variants);
      }

      return [...grouped.entries()]
        .map(([key, variantsById]) => {
          const variants = [...variantsById.values()].sort((left, right) => (
            (left.rosterCategory === "current" ? 0 : left.rosterCategory === "classic" ? 1 : 2)
            - (right.rosterCategory === "current" ? 0 : right.rosterCategory === "classic" ? 1 : 2)
          ) || (right.overall ?? 0) - (left.overall ?? 0) || left.name.localeCompare(right.name));
          return { key, representative: variants[0], variants };
        })
        .sort((left, right) => (
          (right.variants.reduce((max, player) => Math.max(max, player.overall ?? 0), 0))
          - (left.variants.reduce((max, player) => Math.max(max, player.overall ?? 0), 0))
        ) || getPlayerNameCN(left.representative.name).localeCompare(getPlayerNameCN(right.representative.name)));
    },
    [availablePlayers],
  );
  const playerVersionGroup = playerVersionGroupKey
    ? manualPlayerGroups.find((group) => group.key === playerVersionGroupKey)
    : undefined;
  const team = settingsLocked ? teamsById.get(round.teamId) : undefined;
  const [logoTheme, setLogoTheme] = useState<"light" | "dark">(() => (
    document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  ));

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setLogoTheme(root.dataset.theme === "dark" ? "dark" : "light");
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const teamDrawItems = useMemo<MarqueeDrawItem[]>(() => teams
    .filter((candidate) => candidate.players.length > 0)
    .map((candidate) => ({
      id: candidate.id,
      imageSrc: teamLogoUrl(candidate, logoTheme),
      label: teamNamesCN[candidate.name] ?? candidate.name,
      mark: teamMark(candidate),
      meta: `${candidate.players.length} 名球员`,
    })), [logoTheme, teams]);
  const drawingTeamLabel = drawingTeamId
    ? teamDrawItems.find((item) => item.id === drawingTeamId)?.label
    : undefined;
  const handleTeamDrawPhaseChange = useCallback((phase: "idle" | "rolling" | "landing" | "settled") => {
    if (phase === "landing") setTeamDrawPhase("landing");
    else if (phase === "rolling") setTeamDrawPhase("rolling");
  }, []);
  const displayStatus = isTeamDrawing && teamDrawPhase === "landing"
    ? `已抽中${drawingTeamLabel ?? "球队"}`
    : status;
  const selectedPlayer = selectedPlayerId ? playersById.get(selectedPlayerId) : undefined;
  const usedBy = useMemo(() => new Map(Object.entries(locks).flatMap(([bundleId, lock]) => {
    if (lock.kind !== "player") return [];
    const player = playersById.get(lock.playerId);
    return player ? [[playerIdentity(player), bundleId] as const] : [];
  })), [locks, playersById]);
  const evaluations = useMemo(() => {
    const next: Record<string, Evaluation> = {};
    for (const bundle of bundles) {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        next[bundle.id] = evaluateCustom(bundle, lock.values, body);
        continue;
      }
      const player = lock?.kind === "player" ? playersById.get(lock.playerId) : undefined;
      if (player) next[bundle.id] = evaluate(player, bundle, body);
    }
    return next;
  }, [body, locks, playersById]);
  const selectedEvaluations = useMemo(() => Object.fromEntries(
    selectedPlayer ? bundles.map((bundle) => [bundle.id, evaluate(selectedPlayer, bundle, body)]) : [],
  ) as Record<string, Evaluation>, [body, selectedPlayer]);
  const bodyAdjustedAttributes = useMemo(() => new Set(
    bundles.flatMap((bundle) => {
      const evaluation = evaluations[bundle.id];
      if (!evaluation) return [];
      return bundle.attrs.filter((attr) => (
        (evaluation.bodyAdjustments[attr] ?? 0) !== 0
        || Object.prototype.hasOwnProperty.call(evaluation.bodyCaps, attr)
      ));
    }),
  ), [evaluations]);
  const effectiveAge = isPrime ? 28 : age;
  const result = useMemo(
    () => createResult(
      evaluations,
      locks,
      effectiveAge,
      position,
      secondaryPosition,
      body,
      mode,
      playersById,
      tendencyLookup,
      overallVersion,
    ),
    [body, effectiveAge, evaluations, locks, mode, overallVersion, playersById, position, secondaryPosition, tendencyLookup],
  );
  const tendencyLoadState: TendencyLoadState = tendencyLookup?.available === false
    ? "unavailable"
    : tendencyLookup
      ? "ready"
      : tendencyLoadError
        ? "error"
        : settingsLocked
          ? "loading"
          : "idle";
  const tendencyCount = Object.keys(result.tendencies).length;
  const tendencyStatusLabel = tendencyLoadState === "ready"
    ? `${tendencyCount} 项 · 未调整`
    : tendencyLoadState === "unavailable"
      ? "当前版本暂无数据"
      : tendencyLoadState === "error"
        ? "加载失败"
        : tendencyLoadState === "loading"
          ? "正在加载…"
          : "尚未加载";
  const tendencyEmptyText = tendencyLoadState === "error"
    ? "倾向数据加载失败，请刷新后重试"
    : tendencyLoadState === "loading"
      ? "正在加载倾向数据…"
      : tendencyLoadState === "unavailable"
        ? "当前版本暂无独立倾向数据"
        : "暂无倾向数据";
  const completed = Object.keys(locks).length;
  const isComplete = completed === bundles.length;
  const exportReady = isComplete && tendencyLoadState !== "loading";
  const shownIds = round.playerOrder.slice(round.offset, round.offset + playersPerRound);
  const shownPlayers = settingsLocked
    ? shownIds.map((id) => playersById.get(id)).filter((player): player is PlayerSource => Boolean(player))
    : [];
  const filteredManualPlayerGroups = useMemo(
    () => manualPlayerGroups.filter((group) => matchesPlayerGroupSearch(group, playerSearch)),
    [manualPlayerGroups, playerSearch],
  );
  const hasNextBatch = settingsLocked && round.offset + playersPerRound < round.playerOrder.length;
  const zoneCounts = Object.values(result.hotZones).reduce<Record<HotZoneState, number>>(
    (counts, state) => ({ ...counts, [state]: counts[state] + 1 }),
    { 冷区: 0, 中性: 0, 热区: 0 },
  );
  const customizingBundle = bundles.find((bundle) => bundle.id === customizingBundleId);
  const customDraftIsValid = Boolean(customizingBundle?.attrs.every((attr) => {
    const value = Number(customDraft[attr]);
    return Number.isFinite(value) && value >= 25 && value <= 99;
  }));
  const wizardSteps: Array<{ key: MobilePane; label: string; enabled: boolean }> = [
    { key: "settings", label: "基础设置", enabled: true },
    { key: "players", label: "球队与球员", enabled: settingsLocked },
    { key: "attributes", label: "锁定属性", enabled: settingsLocked },
    { key: "result", label: isPrime ? "巅峰结果" : "新秀结果", enabled: isComplete },
  ];

  const changePosition = (nextPosition: Position) => {
    if (settingsLocked) return;
    setPosition(nextPosition);
    setSecondaryPosition(defaultSecondaryPosition(nextPosition));
    setBody(createBodySettings(nextPosition, Date.now()));
  };

  const changeSecondaryPosition = (nextPosition: Position) => {
    if (settingsLocked || nextPosition === position) return;
    setSecondaryPosition(nextPosition);
  };

  const updateBody = (key: keyof BodySettings, value: number) => {
    if (settingsLocked) return;
    setBody((current) => ({ ...current, [key]: value }));
  };


  const randomizeBody = () => {
    if (settingsLocked) return;
    setBody(createBodySettings(position, Date.now()));
  };

  const randomizeName = () => {
    if (settingsLocked) return;
    setRookieName(generateRookieName());
  };

  const finishTeamDraw = () => {
    const pendingDraw = pendingTeamDrawRef.current;
    if (!pendingDraw) return;
    pendingTeamDrawRef.current = null;
    setRound(pendingDraw.round);
    setDrawingTeamId(null);
    setIsTeamDrawing(false);
    setTeamDrawPhase("rolling");
    setStatus(pendingDraw.completionStatus);
  };

  const startTeamDraw = (previousTeamId: string | undefined, completionStatus: string) => {
    const seed = Date.now();
    const nextRound = createRound(teams, seed, previousTeamId);
    // Warm only the first visible roster batch during the marquee. Prefetching the
    // full team can saturate the local proxy and delay the cards the user can see.
    const visiblePlayerNames = nextRound.playerOrder
      .slice(0, playersPerRound)
      .map((id) => playersById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    prefetchPlayerHeadshots(visiblePlayerNames);

    setTeamDrawPhase("rolling");
    setIsTeamDrawing(true);
    setDrawingTeamId(nextRound.teamId);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    setStatus("正在抽取球队…");
    setMobilePane("players");
    pendingTeamDrawRef.current = { round: nextRound, completionStatus };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishTeamDraw();
    }
  };

  // Prefetch the next switch batch while the user browses the current eight.
  useEffect(() => {
    if (!settingsLocked || isTeamDrawing || !hasNextBatch) return;
    const upcoming = round.playerOrder
      .slice(round.offset + playersPerRound, round.offset + playersPerRound * 2)
      .map((id) => playersById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    prefetchPlayerHeadshots(upcoming);
  }, [hasNextBatch, isTeamDrawing, playersById, round.offset, round.playerOrder, settingsLocked]);

  const confirmSettings = () => {
    setRookieName((current) => current.trim().replace(/\s+/g, " ") || generateRookieName());
    setSettingsLocked(true);
    if (isManualSelection) {
      setStatus("请为每个属性槽选择来源球员");
      setMobilePane("players");
    } else {
      startTeamDraw(undefined, "第 1 轮球队已确定");
    }
  };

  const drawNextTeam = () => {
    startTeamDraw(round.teamId, "下一轮球队已确定");
  };

  const switchPlayers = () => {
    if (!settingsLocked || isTeamDrawing || switchesLeft <= 0 || !hasNextBatch) return;
    setRound((current) => ({
      teamId: current.teamId,
      playerOrder: current.playerOrder,
      offset: current.offset + playersPerRound,
    }));
    setSwitchesLeft((current) => current - 1);
    setSelectedPlayerId(null);
    setStatus(`已换一批${team ? teamNamesCN[team.name] ?? team.name : "当前球队"}球员`);
  };

  const choosePlayer = (player: PlayerSource) => {
    const id = playerId(player);
    if (!settingsLocked || isTeamDrawing || (!isManualSelection && usedBy.has(playerIdentity(player)))) return;
    setSelectedPlayerId(id);
    setPlayerVersionGroupKey(null);
    setStatus(`已选择${getPlayerNameCN(player.name)}`);
    setMobilePane("attributes");
  };

  const openPlayerVersionPicker = (group: ManualPlayerGroup) => {
    if (!settingsLocked || isTeamDrawing || isComplete) return;
    setCustomizingBundleId(null);
    setPlayerVersionGroupKey(group.key);
  };

  const finishLock = (nextLocks: LockState) => {
    setLocks(nextLocks);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    if (Object.keys(nextLocks).length === bundles.length) {
      setStatus(`${isPrime ? "巅峰球员" : "新秀"}已生成`);
      setMobilePane("result");
    } else if (isManualSelection) {
      setStatus("已锁定。请继续为下一个属性槽选择来源球员");
      setMobilePane("players");
    } else {
      drawNextTeam();
    }
  };

  const clickBundle = (bundle: Bundle) => {
    const existing = locks[bundle.id];
    if (existing || !settingsLocked || isTeamDrawing || !selectedPlayer || usedBy.has(playerIdentity(selectedPlayer))) return;
    finishLock({ ...locks, [bundle.id]: { kind: "player", playerId: playerId(selectedPlayer) } });
  };

  const openCustomEditor = (bundle: Bundle) => {
    if (bundle.id === "potential" || locks[bundle.id] || !settingsLocked || isTeamDrawing) return;
    const preview = selectedEvaluations[bundle.id];
    setCustomDraft(Object.fromEntries(bundle.attrs.map((attr) => [attr, String(preview?.values[attr] ?? 75)])));
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(bundle.id);
  };

  const confirmCustomLock = () => {
    if (!customizingBundle || customizingBundle.id === "potential" || !customDraftIsValid || locks[customizingBundle.id] || isTeamDrawing) return;
    const values = Object.fromEntries(customizingBundle.attrs.map((attr) => [attr, clamp(Number(customDraft[attr]))]));
    finishLock({ ...locks, [customizingBundle.id]: { kind: "custom", values } });
  };

  const reset = () => {
    const seed = Date.now();
    pendingTeamDrawRef.current = null;
    setRookieName(generateRookieName());
    setPosition("PG");
    setSecondaryPosition(defaultSecondaryPosition("PG"));
    setAge(19);
    setBody(createBodySettings("PG", seed));
    setRound(createRound(teams, seed));
    setSettingsLocked(false);
    setIsTeamDrawing(false);
    setTeamDrawPhase("rolling");
    setDrawingTeamId(null);
    setLocks({});
    setSwitchesLeft(playerSwitchLimit);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    setCustomDraft({});
    setPlayerSearch("");
    setStatus(`确认${isPrime ? "巅峰球员" : "新秀"}设置后开始生成`);
    setMobilePane("settings");
  };

  const copyResult = async () => {
    try {
      await copyText(createExportText(rookieName, result, locks, evaluations, playersById, mode, tendencyLoadState, dataVersionLabel));
      setStatus("已复制生成报告");
    } catch {
      setStatus("复制失败，请手动复制");
    }
  };

  const downloadResult = async () => {
    const blob = new Blob([createExportText(rookieName, result, locks, evaluations, playersById, mode, tendencyLoadState, dataVersionLabel)], { type: "text/plain;charset=utf-8" });
    const nameSlug = rookieName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suggestedName = `2k26-${isPrime ? "prime" : "rookie"}-${nameSlug || position.toLowerCase()}.txt`;
    const showSaveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

    if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName,
          types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus("已导出生成数据");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus("已取消导出");
          return;
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已导出生成数据");
  };

  return (
    <section className="flex min-h-0 flex-col gap-2.5">
      <nav aria-label="生成步骤" className="builder-wizard-nav" role="tablist">
        {wizardSteps.map((step, index) => {
          const active = mobilePane === step.key;
          const reached = step.key === "settings" || settingsLocked && step.key !== "result" || isComplete;
          return (
            <button
              aria-controls={`builder-pane-${step.key}`}
              aria-selected={active}
              className="builder-wizard-step"
              data-active={active}
              data-reached={reached}
              disabled={!step.enabled}
              id={`builder-step-${step.key}`}
              key={step.key}
              onClick={() => setMobilePane(step.key)}
              role="tab"
              type="button"
            >
              <span className="builder-wizard-index">{String(index + 1).padStart(2, "0")}</span>
              <span>{step.label}</span>
            </button>
          );
        })}
      </nav>

      <div
        aria-labelledby="builder-step-settings"
        className="builder-setup panel-surface overflow-hidden"
        data-mobile-active={mobilePane === "settings"}
        id="builder-pane-settings"
        role="tabpanel"
      >
        <div className="builder-setup-grid">
          <section aria-labelledby="player-identity-label" className="builder-setup-identity bg-white px-3 py-3">
            <div className="section-label mb-2" id="player-identity-label">球员信息</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <div className="section-label mb-1">{isPrime ? "球员姓名" : "新秀姓名"}</div>
                <div className="flex h-8 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
                  <input
                    aria-label={`${isPrime ? "巅峰球员" : "新秀"}英文姓名`}
                    className="min-w-0 flex-1 bg-transparent px-2.5 text-[12px] font-semibold text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
                    disabled={settingsLocked}
                    maxLength={48}
                    onChange={(event) => setRookieName(event.target.value)}
                    spellCheck={false}
                    type="text"
                    value={rookieName}
                  />
                  <button aria-label="随机生成英文名" className="icon-button flex w-8 shrink-0 items-center justify-center border-l border-ink-200 text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300" disabled={settingsLocked} onClick={randomizeName} title="随机生成英文名" type="button"><RefreshCw className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="min-w-0">
                <div className="section-label mb-1">年龄</div>
                <div className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200">
                  {isPrime ? (
                    <button aria-label="巅峰球员年龄固定为 28 岁" className="h-full min-w-14 cursor-not-allowed bg-ink-900 px-3 text-[11px] font-semibold text-white" disabled title="巅峰球员年龄固定为 28 岁" type="button">28</button>
                  ) : ages.map((option) => (
                    <button key={option} className={`segmented-button h-full min-w-0 flex-1 px-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 ${age === option ? "bg-ink-900 text-white" : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800"}`} disabled={settingsLocked} onClick={() => setAge(option)} type="button">{option}</button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <div className="section-label mb-1">主位置</div>
                <div aria-label="主位置" className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
                  {positions.map((option) => {
                    const selected = position === option;
                    const stateClass = selected
                      ? "bg-ink-900 text-white"
                      : settingsLocked
                        ? "bg-ink-50 text-ink-300"
                        : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800";
                    return (
                      <button key={option} aria-label={`主位置 ${option}`} aria-pressed={selected} className={`segmented-button h-full min-w-0 flex-1 px-1 text-[11px] font-semibold disabled:cursor-not-allowed ${stateClass}`} disabled={settingsLocked} onClick={() => changePosition(option)} type="button">{option}</button>
                    );
                  })}
                </div>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <div className="section-label mb-1 flex items-center gap-1.5">
                  次要位置
                </div>
                <div aria-label="次要位置" className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
                  {positions.map((option) => {
                    const isPrimary = option === position;
                    const selected = secondaryPosition === option;
                    const natural = !isPrimary && isNaturalSecondaryPosition(position, option);
                    const stateClass = selected
                      ? natural ? "bg-court-700 text-white" : "bg-warning-600 text-white"
                      : settingsLocked || isPrimary
                        ? "bg-ink-50 text-ink-300"
                        : natural
                          ? "bg-white text-ink-600 hover:bg-court-50 hover:text-court-800"
                          : "bg-warning-50/70 text-warning-600 hover:bg-warning-100 hover:text-warning-800";
                    return (
                      <button key={option} aria-label={`次要位置 ${option}`} aria-pressed={selected} className={`segmented-button h-full min-w-0 flex-1 px-1 text-[11px] font-semibold disabled:cursor-not-allowed ${stateClass}`} disabled={settingsLocked || isPrimary} onClick={() => changeSecondaryPosition(option)} title={isPrimary ? "次要位置不能与主位置相同" : natural ? "常规搭配" : "非常规搭配：仍会结合来源属性和体型计算"} type="button">{option}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>


          <section aria-labelledby="body-settings-label" className="builder-setup-body bg-ink-50/60 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="section-label" id="body-settings-label">身体设定</div>
              <button aria-label="随机生成身体设定" className="action-button h-7 w-7 justify-center" disabled={settingsLocked} onClick={randomizeBody} title="随机生成身体设定" type="button"><Shuffle className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
              <BodyNumberInput disabled={settingsLocked} label="身高" max={300} min={150} onChange={(value) => updateBody("height", value)} unit="cm" value={body.height} />
              <BodyNumberInput disabled={settingsLocked} label="体重" max={200} min={50} onChange={(value) => updateBody("weight", value)} unit="kg" value={body.weight} />
              <BodyNumberInput disabled={settingsLocked} label="臂展" max={100} min={1} onChange={(value) => updateBody("wingspan", value)} value={body.wingspan} />
              <BodyNumberInput disabled={settingsLocked} label="肩宽" max={100} min={1} onChange={(value) => updateBody("shoulder", value)} value={body.shoulder} />
              <BodyNumberInput disabled={settingsLocked} label="颈长" max={100} min={1} onChange={(value) => updateBody("neck", value)} value={body.neck} />
              <BodyNumberInput disabled={settingsLocked} label="躯干" max={100} min={1} onChange={(value) => updateBody("torso", value)} value={body.torso} />
            </div>
          </section>

          <div className="builder-setup-footer bg-ink-50/80 px-3 py-2.5">
            <div className="builder-setup-status flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-ink-500">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-court-500" />
              <span className="truncate">{displayStatus}</span>
            </div>
            <div className="builder-setup-progress" aria-label={`完成进度 ${completed}/${bundles.length}`}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-semibold text-ink-500">
                <span>完成进度</span>
                <span className="tabular-nums text-ink-700">{completed}/{bundles.length}</span>
              </div>
              <div aria-valuemax={bundles.length} aria-valuemin={0} aria-valuenow={completed} className="builder-setup-progress-track" role="progressbar">
                <div
                  className="builder-setup-progress-fill"
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, completed / bundles.length))})` }}
                />
              </div>
            </div>
            <div className="builder-setup-actions flex shrink-0 items-center justify-end gap-1.5" aria-label="设置操作">
              {!settingsLocked && (
                <button className="action-button primary-action justify-center px-3 py-1.5 text-[11px] font-semibold" onClick={confirmSettings} type="button">
                  <Check className="h-3.5 w-3.5" />确认并抽取
                </button>
              )}
              <button className="action-button justify-center px-3 py-1.5 text-[11px]" onClick={reset} type="button">
                <RefreshCw className="h-3.5 w-3.5" />{settingsLocked ? "重新开始" : "重置"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="builder-workspace">
        <aside
          aria-label="属性槽"
          className="builder-pane builder-attributes-pane panel-surface min-w-0 overflow-hidden"
          data-mobile-active={mobilePane === "attributes"}
          id="builder-pane-attributes"
          role="tabpanel"
        >
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
            <span className="section-label">属性槽</span>
            <span className="max-w-[130px] truncate text-[9px] font-medium text-ink-500">{selectedPlayer ? getPlayerNameCN(selectedPlayer.name) : "尚未选择球员"}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-2.5">
            {bundles.map((bundle) => {
              const lock = locks[bundle.id];
              const lockedPlayer = lock?.kind === "player" ? playersById.get(lock.playerId) : undefined;
              const lockedEvaluation = evaluations[bundle.id];
              const preview = selectedEvaluations[bundle.id];
              const value = lockedEvaluation?.adjusted ?? preview?.adjusted;
              const activeEvaluation = lockedEvaluation ?? preview;
              const bodyAdjustment = lockedEvaluation?.bodyAdjustment ?? preview?.bodyAdjustment ?? 0;
              const sourceLabel = lock?.kind === "custom" ? "手动设置" : lockedPlayer ? getPlayerNameCN(lockedPlayer.name) : (selectedPlayer ? "可锁定" : "等待选择");
              const weightLabel = bundle.id === "potential"
                ? "潜力独立取值，不计入位置权重"
                : `位置综合权重：${displayedPositionWeight(position, secondaryPosition, bundle.id)}%`;
              const bodyAdjustmentLabel = bodyAdjustment ? `身体修正 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment}` : "";
              const capLabels = Object.entries(activeEvaluation?.bodyCaps ?? {})
                .map(([attr, cap]) => `${attrNameCN[attr] ?? attr}上限 ${cap}`);
              const hasBodyConstraint = bodyAdjustment !== 0 || capLabels.length > 0;
              const adjustmentLabel = [
                bodyAdjustmentLabel,
                ...capLabels,
              ].filter(Boolean).join(" · ");
              return (
                <div
                  key={bundle.id}
                  className={`relative h-[52px] min-w-0 overflow-hidden rounded-[5px] border transition ${lock ? "border-court-500/25 bg-court-50/70" : selectedPlayer ? "border-ink-200 bg-white" : "border-ink-100 bg-ink-50/70"}`}
                  style={{ borderLeftColor: bundle.color, borderLeftWidth: 3 }}
                >
                  <button
                    aria-label={lock ? `已锁定${bundle.label}` : `锁定${bundle.label}`}
                    className={`flex h-full w-full min-w-0 items-center gap-1.5 px-2 pr-7 text-left transition ${lock ? "cursor-not-allowed" : selectedPlayer ? "hover:bg-ink-50" : "cursor-not-allowed"}`}
                    disabled={Boolean(lock) || !settingsLocked || !selectedPlayer}
                    onClick={() => clickBundle(bundle)}
                    title={lock ? `${weightLabel} · 已锁定；如需修改，请重新开始` : typeof value === "number" ? `${weightLabel} · ${sourceLabel}：${lockedEvaluation?.raw ?? preview?.raw} → ${value}${adjustmentLabel ? `（${adjustmentLabel}）` : ""}` : `${bundle.label} · ${weightLabel}`}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-ink-800">{bundle.label}</span>
                      <span className="block truncate text-[8px] text-ink-400">{sourceLabel}{bodyAdjustmentLabel ? ` · ${bodyAdjustmentLabel}` : ""}</span>
                    </span>
                    {typeof value === "number" ? (
                      <span className="flex shrink-0 items-center gap-1" title={hasBodyConstraint ? adjustmentLabel : undefined}>
                        {hasBodyConstraint && <span className="text-[8px] font-semibold text-court-600">身体</span>}
                        <span className={`text-[13px] font-bold tabular-nums ${valueColor(value)}`}>{value}</span>
                      </span>
                    ) : <span className="text-ink-300">--</span>}
                  </button>
                  {!lock && bundle.id !== "potential" && (
                    <button
                      aria-label={`手动设置${bundle.label}`}
                      className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-ink-400 transition hover:bg-ink-200 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-200"
                      disabled={!settingsLocked || isTeamDrawing}
                      onClick={() => openCustomEditor(bundle)}
                      title={`手动设置${bundle.label}的最终数值`}
                      type="button"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {lock && <Check className="absolute right-1 top-1 h-2.5 w-2.5 text-court-600" />}
                </div>
              );
            })}
          </div>
        </aside>

        <div
          aria-label="球队与球员"
          className="builder-pane builder-player-pane panel-surface min-w-0 flex-col overflow-hidden"
          data-complete={isComplete}
          data-mobile-active={mobilePane === "players"}
          id="builder-pane-players"
          role="tabpanel"
        >
          <div className="workspace-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div>
              <div className="flex items-center gap-2"><span className="draw-status-icon" data-active={isTeamDrawing}><UsersRound className="h-3.5 w-3.5" /></span><h2 className="text-[14px] font-semibold text-ink-900">{isManualSelection ? "自选来源" : isTeamDrawing ? "随机球队" : team ? teamNamesCN[team.name] ?? team.name : "等待开始"}</h2></div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-400">{!settingsLocked ? "等待确认基础设置" : isManualSelection ? isComplete ? `已完成 · ${completed}/${bundles.length}` : "搜索球员，选定版本后锁定属性" : isTeamDrawing ? teamDrawPhase === "landing" ? "结果已确定" : "正在抽取球队" : isComplete ? `已完成 · ${completed}/${bundles.length}` : `第 ${completed + 1} 轮 · 已展示 ${shownPlayers.length}/${team?.players.length ?? 0}`}</div>
            </div>
            {settingsLocked && !isComplete && !isManualSelection && (
              <div className="flex items-center gap-1.5">
                {(() => {
                  const switchDisabled = isTeamDrawing || switchesLeft <= 0 || !hasNextBatch;
                  const switchTitle = isTeamDrawing
                    ? "正在抽取球队，请稍候"
                    : !hasNextBatch
                      ? "本队球员已全部展示，暂时无法更换"
                      : switchesLeft <= 0
                          ? "本轮更换次数已用完"
                          : "仅更换当前球队的候选球员，不会重新抽取球队";
                  // Disabled buttons often skip hover tooltips; wrap so the hint still appears.
                  return (
                    <span className="inline-flex" title={switchTitle}>
                      <button
                        className="action-button px-2 py-1.5 text-[10px]"
                        disabled={switchDisabled}
                        onClick={switchPlayers}
                        type="button"
                      >
                        <UsersRound className="h-3 w-3" />
                        换一批（{switchesLeft}）
                      </button>
                    </span>
                  );
                })()}
              </div>
            )}
          </div>

          {settingsLocked ? isManualSelection ? <>
            <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
              <input
                aria-label="搜索来源球员"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
                onChange={(event) => setPlayerSearch(event.target.value)}
                placeholder="搜索姓名、位置或球队"
                type="search"
                value={playerSearch}
              />
              <span className="shrink-0 text-[9px] tabular-nums text-ink-400">{filteredManualPlayerGroups.length}/{manualPlayerGroups.length}</span>
            </div>
            <div className="grid flex-1 auto-rows-[62px] grid-cols-2 gap-2 overflow-y-auto p-2.5">
              {filteredManualPlayerGroups.map((group) => {
                const selected = selectedPlayer ? playerIdentity(selectedPlayer) === group.key : false;
                const representative = group.representative;
                const maxOverall = group.variants.reduce((max, player) => Math.max(max, player.overall ?? 0), 0);
                const positionSummary = [...new Set(group.variants.map((player) => player.position).filter(Boolean))].join("/");
                return (
                  <button
                    key={group.key}
                    aria-label={`选择${getPlayerNameCN(representative.name)}，${group.variants.length}个版本`}
                    aria-pressed={selected}
                    className={`interactive-card flex min-w-0 items-center gap-2 rounded-[6px] border px-2 text-left ${selected ? "border-ink-700 bg-ink-50 shadow-[inset_3px_0_0_#2b8969]" : isComplete ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-40" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`}
                    disabled={isComplete}
                    onClick={() => openPlayerVersionPicker(group)}
                    title={`${getPlayerNameCN(representative.name)} · 点击选择版本`}
                    type="button"
                  >
                    <PlayerHeadshot name={representative.name} priority={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(representative.name)}</span>
                      <span className="block truncate text-[9px] text-ink-400">{representative.name} · {group.variants.length} 个版本{positionSummary ? ` · ${positionSummary}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`text-[14px] font-bold tabular-nums ${maxOverall ? valueColor(maxOverall) : "text-ink-400"}`}>{maxOverall || "--"}</span>
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-300" />
                    </span>
                  </button>
                );
              })}
              {filteredManualPlayerGroups.length === 0 && <div className="col-span-2 flex min-h-[180px] items-center justify-center text-[11px] text-ink-400">没有找到匹配的球员</div>}
            </div>
          </> : isTeamDrawing ? <div className="flex min-h-[300px] flex-1 items-center px-2.5 py-3 sm:px-4">
            <MarqueeDraw
              currentLabel={drawingTeamLabel}
              dataKind="team"
              durationMs={teamDrawDurationMs}
              emptyText="暂无可抽取的球队"
              isDrawing
              items={teamDrawItems}
              onPhaseChange={handleTeamDrawPhaseChange}
              onSettled={finishTeamDraw}
              precedingItems={18}
              selectedId={drawingTeamId ?? undefined}
              settleHoldMs={teamDrawSettleHoldMs}
              title={teamDrawPhase === "landing" ? "抽取完成" : "正在抽取球队"}
            />
          </div> : <div className="grid flex-1 auto-rows-[62px] grid-cols-2 gap-2 p-2.5">
            {shownPlayers.map((player) => {
              const id = playerId(player);
              const unavailable = usedBy.has(playerIdentity(player));
              const selected = selectedPlayerId === id;
              return (
                <button key={id} className={`interactive-card flex min-w-0 items-center gap-2 rounded-[6px] border px-2 text-left ${selected ? "border-ink-700 bg-ink-50 shadow-[inset_3px_0_0_#2b8969]" : unavailable || isComplete ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-40" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`} disabled={unavailable || isComplete} onClick={() => choosePlayer(player)} type="button">
                  <PlayerHeadshot name={player.name} priority />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(player.name)}</span><span className="block text-[9px] text-ink-400">{player.position ?? "--"}{player.isEstimated ? " · 估算值" : ""}{unavailable ? " · 已选用" : ""}</span></span>
                  <span className={`shrink-0 text-[14px] font-bold tabular-nums ${typeof player.overall === "number" ? valueColor(player.overall) : "text-ink-400"}`}>{player.overall ?? "--"}</span>
                </button>
              );
            })}
          </div> : <div className="builder-empty-state flex min-h-[300px] flex-1 flex-col items-center justify-center px-5 text-center"><span className="builder-empty-icon"><Shuffle className="h-4 w-4" /></span><div className="mt-3 text-[15px] font-semibold text-ink-700">先从一支球队开始</div><div className="mt-1 max-w-[310px] text-[10px] leading-5 text-ink-400">确认球员设置后抽取球队，再从候选球员中锁定 16 个属性槽。</div><div className="builder-empty-steps" aria-hidden="true"><span data-current="true">设置</span><ChevronRight /><span>抽取球队</span><ChevronRight /><span>锁定属性</span></div></div>}

          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-ink-200 bg-ink-50 px-3 py-2">
            <div className="min-w-0 truncate text-[10px] text-ink-500">{selectedPlayer ? `${getPlayerNameCN(selectedPlayer.name)} · 请选择要锁定的属性槽` : displayStatus}</div>
            {selectedPlayer && <button className="action-button shrink-0 px-2 py-1.5 text-[10px] lg:hidden" onClick={() => setMobilePane("attributes")} type="button">选择属性槽</button>}
          </div>
        </div>

        <aside
          aria-label={isPrime ? "巅峰结果" : "新秀结果"}
          className="builder-pane builder-result-pane panel-surface min-w-0 overflow-hidden"
          data-mobile-active={mobilePane === "result"}
          id="builder-pane-result"
          role="tabpanel"
        >
          {isComplete ? (
            <div className="builder-result-reveal">
              <div className="workspace-toolbar px-3 py-2.5">
                <div className="section-label">{isPrime ? "巅峰球员卡" : "新秀球员卡"}</div>
                <div className="mt-1 truncate text-[15px] font-semibold text-ink-800" data-testid="rookie-name">{rookieName}</div>
                <div className="mt-2 flex items-end justify-between">
                  <div><div className={`text-[25px] font-bold leading-none tabular-nums ${valueColor(result.initialStrength)}`} data-testid="rookie-overall">{result.initialStrength}</div><div className="mt-1 text-[9px] text-ink-400">{isPrime ? "巅峰 OVR" : "新秀 OVR"}</div></div>
                  <div className="text-right"><div className="text-[14px] font-semibold text-court-800">{position}/{secondaryPosition} · {effectiveAge}岁</div><div className="text-[10px] text-ink-500">潜力 <span className={`font-semibold tabular-nums ${valueColor(result.potential)}`} data-testid="rookie-potential">{result.potential}</span></div><div className="text-[8px] text-ink-400">游戏 OVR <span className={`font-semibold tabular-nums ${valueColor(result.baseOverall)}`} data-testid="rookie-base-overall">{result.baseOverall}</span> · 无形属性 <span className={`font-semibold tabular-nums ${valueColor(result.intangibles)}`}>{result.intangibles}</span></div></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-ink-200 text-[10px]">
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">身高</span><strong className="float-right">{result.height}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">体重</span><strong className="float-right">{result.weight}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">臂展</span><strong className="float-right">{result.wingspan}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">肩宽</span><strong className="float-right">{result.shoulder}</strong></div>
              </div>
              {isPrime ? (
                <div className="border-b border-ink-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-[10px]"><span className="font-semibold text-ink-700">巅峰属性</span><span className="text-right text-ink-500">锁定值已结合体型和位置计算</span></div>
                </div>
              ) : (
                <div className="border-b border-ink-200 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between text-[10px]"><span className="font-semibold text-ink-700">成长轨迹</span><span className="font-mono text-court-700">潜力 {result.potential}</span></div>
                  <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 border-y border-ink-100 py-1.5 text-[9px]">
                    <div className="flex justify-between gap-2"><span className="text-ink-400">预计初始 OVR</span><strong className="tabular-nums text-ink-700">{result.initialStrength}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">巅峰年龄</span><strong className="tabular-nums text-ink-700">{result.peakStart}–{result.peakEnd}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">成长速度</span><strong className="tabular-nums text-ink-700">+{result.progressSpeed}/年</strong></div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center text-[9px]"><div className="rounded-[5px] border border-court-200 bg-court-50 py-1.5 text-court-700"><strong className="block text-[12px]">{result.boom}%</strong>成长</div><div className="rounded-[5px] border border-ink-200 bg-ink-50 py-1.5 text-ink-700"><strong className="block text-[12px]">{result.normal}%</strong>平均</div><div className="rounded-[5px] border border-rose-200 bg-rose-50 py-1.5 text-rose-700"><strong className="block text-[12px]">{result.bust}%</strong>衰退</div></div>
                </div>
              )}
              <div className="border-b border-ink-200 px-3 py-2.5">
                <div className="mb-1.5 flex justify-between text-[10px]"><span className="font-semibold">{isPrime ? "巅峰徽章" : "当前徽章"}</span><span className="text-ink-400" data-testid="badge-status">{result.badgesEstimated ? "含估算" : "按属性槽继承"} · {result.badges.length}</span></div>
                <div className="flex max-h-[58px] flex-wrap gap-1 overflow-hidden">{result.badges.length ? result.badges.slice(0, 7).map((badge) => <span key={`${badge.name}:${badge.tier}`} className="border border-warning-500/20 bg-warning-50 px-1 py-0.5 text-[8px] text-warning-800">{getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier]}</span>) : <span className="text-[9px] text-ink-400">无</span>}</div>
              </div>
              <div className="border-b border-ink-200 px-3 py-2.5">
                <div className="mb-1.5 text-[10px] font-semibold">热区</div>
                <div className="grid grid-cols-3 gap-1 text-center text-[9px]"><div className="bg-blue-50 py-1.5 text-blue-700">冷 <span data-testid="cold-zone-count">{zoneCounts.冷区}</span></div><div className="bg-ink-50 py-1.5 text-ink-600">中 <span data-testid="neutral-zone-count">{zoneCounts.中性}</span></div><div className="bg-rose-50 py-1.5 text-rose-700">热 <span data-testid="hot-zone-count">{zoneCounts.热区}</span></div></div>
              </div>
              <div aria-live="polite" className="border-b border-ink-200 px-3 py-2.5" data-tendency-state={tendencyLoadState}>
                <div className="mb-1.5 flex justify-between text-[10px]"><span className="font-semibold">倾向</span><span className="text-ink-400" data-testid="tendency-status">{tendencyStatusLabel}</span></div>
                <div className="flex max-h-[58px] flex-wrap gap-1 overflow-hidden">{tendencyCount ? Object.entries(result.tendencies).slice(0, 8).map(([field, value]) => <span key={field} className="border border-court-500/20 bg-court-50 px-1 py-0.5 text-[8px] text-court-800">{getTendencyNameCN(field)} {value}</span>) : <span className="text-[9px] text-ink-400">{tendencyEmptyText}</span>}</div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <Unlock className="h-7 w-7 text-ink-300" />
              <div className="mt-3 text-[15px] font-semibold text-ink-600">尚未生成</div>
              <div className="mt-1 max-w-full truncate text-[12px] font-semibold text-ink-700">{rookieName}</div>
              <div className="mt-1 text-[10px] leading-5 text-ink-400">已锁定属性：{completed}/{bundles.length}</div>
              <div aria-valuemax={bundles.length} aria-valuemin={0} aria-valuenow={completed} className="builder-result-progress-track" role="progressbar"><div className="builder-result-progress-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, completed / bundles.length))})` }} /></div>
              <div className="mt-3 text-[11px] font-medium text-court-700">{position}/{secondaryPosition} · {effectiveAge}岁</div>
              <div className="mt-1 text-[9px] text-ink-400">{body.height} cm · {body.weight} kg · 臂展 {body.wingspan}</div>
            </div>
          )}
          <div className="flex gap-1.5 px-3 py-2.5">
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!exportReady} onClick={copyResult} type="button"><Copy className="h-3 w-3" />复制</button>
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!exportReady} onClick={downloadResult} type="button"><Download className="h-3 w-3" />导出</button>
          </div>
        </aside>
        {isComplete && (
        <section
          className="builder-pane builder-full-preview builder-result-reveal panel-surface overflow-hidden"
          data-mobile-active={mobilePane === "result"}
          data-testid="full-attribute-preview"
        >
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
            <div className="section-label">属性明细</div>
            <div className="text-[10px] text-ink-400">{fullAttributeGroups.reduce((total, group) => total + group.attrs.length, 0)} 项属性</div>
          </div>
          <div className="attribute-preview-grid bg-ink-200">
            {fullAttributeGroups.map((group) => (
              <div key={group.key} className="attribute-preview-group bg-white px-3 py-2.5">
                <div className="mb-2 text-[10px] font-semibold text-court-700">{group.label}</div>
                <div className={group.key === "durability" ? "grid gap-x-5 sm:grid-cols-2" : ""}>
                  {group.attrs.map((attr) => {
                    const value = result.initialAttrs[attr];
                    const hasBodyAdjustment = bodyAdjustedAttributes.has(attr);
                    return (
                      <div key={attr} className="flex min-h-6 items-center justify-between gap-3 border-t border-ink-700/5 py-1 text-[10px]">
                        <span className="min-w-0 text-ink-500">{attrNameCN[attr] ?? attr}</span>
                        <span className="flex shrink-0 items-center gap-1" title={hasBodyAdjustment ? "该属性包含身体修正或上限" : undefined}>
                          {hasBodyAdjustment && <span className="text-[8px] font-semibold text-court-600">身体</span>}
                          <span className={`font-semibold tabular-nums ${typeof value === "number" ? valueColor(value) : "text-ink-300"}`}>{value ?? "--"}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
        )}
      </div>
      {playerVersionGroup && (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
          <section aria-label={`选择${getPlayerNameCN(playerVersionGroup.representative.name)}的来源版本`} aria-modal="true" className="dialog-surface w-full max-w-[520px] overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl" ref={customDialogRef} role="dialog">
            <div className="workspace-toolbar flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <PlayerHeadshot name={playerVersionGroup.representative.name} priority />
                <div className="min-w-0">
                  <div className="section-label">选择来源版本</div>
                  <div className="truncate text-[14px] font-semibold text-ink-800">{getPlayerNameCN(playerVersionGroup.representative.name)}</div>
                  <div className="truncate text-[9px] text-ink-400">{playerVersionGroup.representative.name} · {playerVersionGroup.variants.length} 个版本可选</div>
                </div>
              </div>
              <button aria-label="关闭版本选择" className="dialog-close-button flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-ink-500 hover:bg-ink-200 hover:text-ink-800" onClick={() => setPlayerVersionGroupKey(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[58vh] space-y-1.5 overflow-y-auto border-t border-ink-200 p-3">
              {playerVersionGroup.variants.map((variant) => {
                const id = playerId(variant);
                const selected = selectedPlayerId === id;
                return (
                  <button
                    aria-pressed={selected}
                    className={`interactive-card flex w-full items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left ${selected ? "border-court-600 bg-court-50 shadow-[inset_3px_0_0_#2b8969]" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`}
                    key={id}
                    onClick={() => choosePlayer(variant)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-ink-800">{playerVariantLabel(variant)}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-ink-400">{variant.position ?? "--"} · {variant.height ?? "身高未记录"}{variant.isEstimated ? " · 部分属性为估算值" : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`text-[16px] font-bold tabular-nums ${typeof variant.overall === "number" ? valueColor(variant.overall) : "text-ink-400"}`}>{variant.overall ?? "--"}</span>
                      {selected ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-court-600" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-300" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-ink-200 bg-ink-50 px-3 py-2.5 text-[10px] text-ink-500">
              选定版本后返回属性槽，再点击目标属性完成锁定。
            </div>
          </section>
        </div>
      )}
      {customizingBundle && (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
          <section aria-label={`手动设置${customizingBundle.label}`} aria-modal="true" className="dialog-surface w-full max-w-[430px] overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl" ref={customDialogRef} role="dialog">
            <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
              <div className="section-label">手动设置{customizingBundle.label}</div>
              <button aria-label="关闭设置" className="dialog-close-button flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-500 hover:bg-ink-200 hover:text-ink-800" onClick={() => setCustomizingBundleId(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
              {customizingBundle.attrs.map((attr) => (
                <label key={attr} className="min-w-0">
                  <span className="mb-1 block truncate text-[9px] font-semibold text-ink-500" title={attrNameCN[attr] ?? attr}>{attrNameCN[attr] ?? attr}</span>
                  <input
                    aria-label={`设置${attrNameCN[attr] ?? attr}`}
                    className="h-9 w-full rounded-[5px] border border-ink-200 bg-ink-50 px-2 text-center text-[13px] font-semibold tabular-nums text-ink-800 outline-none focus:border-court-500 focus:bg-white"
                    inputMode="numeric"
                    onChange={(event) => setCustomDraft((current) => ({ ...current, [attr]: event.target.value }))}
                    pattern="[0-9]*"
                    type="text"
                    value={customDraft[attr] ?? ""}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-ink-200 bg-ink-50 px-3 py-2.5">
              <div className="flex gap-2">
                <button className="action-button px-3 py-1.5 text-[10px]" onClick={() => setCustomizingBundleId(null)} type="button">取消</button>
                <button className="action-button primary-action px-3 py-1.5 text-[10px]" disabled={!customDraftIsValid} onClick={confirmCustomLock} type="button"><Check className="h-3.5 w-3.5" />保存设置</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default RookieBuilder;
