import {
  AlertTriangle,
  ArrowDown,
  Check,
  CircleHelp,
  Copy,
  Download,
  Pencil,
  RefreshCw,
  Shuffle,
  Sparkles,
  Unlock,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { badgeTierCN, getBadgeNameCN } from "../badges";
import { attrNameCN, type BadgeTier, type PlayerSource } from "../domain";
import { getPlayerHeadshot } from "../playerHeadshots";
import { getPlayerNameCN } from "../playerNames";
import { generateRookieName } from "../rookieNames";

export type RookieBuilderTeam = {
  id: string;
  name: string;
  players: PlayerSource[];
};

type Position = "PG" | "SG" | "SF" | "PF" | "C";
export type BuilderMode = "rookie" | "prime";
type BundleCategory = "technical" | "physical" | "mental";
type MobilePane = "settings" | "players" | "attributes" | "result";
type BodySettings = {
  height: number;
  weight: number;
  wingspan: number;
  shoulder: number;
  neck: number;
  torso: number;
};
type PotentialRange = {
  min: number;
  max: number;
};
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
  penaltyRate: number;
  sourcePenaltyRate: number;
  secondaryPenaltyRate: number;
  bodyAdjustment: number;
  values: Record<string, number>;
};
type TeamRound = {
  teamId: string;
  playerOrder: string[];
  offset: number;
};
type HotZoneState = "冷区" | "中性" | "热区";
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

const bundles: Bundle[] = [
  { id: "three", label: "三分", attrs: ["Three-Point Shot"], category: "technical", color: "#2f9d83" },
  { id: "mid", label: "中投", attrs: ["Mid-Range Shot", "Free Throw"], category: "technical", color: "#4f9f95" },
  { id: "finishing", label: "终结", attrs: ["Layup", "Close Shot", "Draw Foul", "Hands", "Post Fade", "Post Hook", "Post Control"], category: "technical", color: "#8f72be" },
  { id: "dunk", label: "扣篮", attrs: ["Driving Dunk", "Standing Dunk"], category: "physical", color: "#b86f5a" },
  { id: "handle", label: "控球", attrs: ["Ball Handle", "Speed with Ball"], category: "technical", color: "#4b83b8" },
  { id: "passing", label: "传球", attrs: ["Pass Accuracy", "Pass IQ", "Pass Vision"], category: "mental", color: "#6487b3" },
  { id: "perimeter", label: "外防", attrs: ["Perimeter Defense"], category: "technical", color: "#3f8b82" },
  { id: "interior", label: "内防", attrs: ["Interior Defense"], category: "technical", color: "#756d9a" },
  { id: "steal", label: "抢断", attrs: ["Steal", "Pass Perception"], category: "technical", color: "#3f8f70" },
  { id: "block", label: "盖帽", attrs: ["Block"], category: "physical", color: "#547fa6" },
  { id: "rebound", label: "篮板", attrs: ["Offensive Rebound", "Defensive Rebound"], category: "physical", color: "#a78145" },
  { id: "athletic", label: "运动", attrs: ["Speed", "Agility", "Vertical", "Strength", "Stamina", "Hustle"], category: "physical", color: "#3e8eaa" },
  { id: "stability", label: "稳定性", attrs: ["Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ", "Overall Durability"], category: "mental", color: "#6d7d87" },
];

const positions: Position[] = ["PG", "SG", "SF", "PF", "C"];
const ages = [18, 19, 20, 21, 22, 23];
const playerSwitchLimit = 3;
const teamDrawDurationMs = 740;
const secondaryPositionShare = 0.25;
const defaultReadiness = 50;

function randomReadiness() {
  return Math.floor(Math.random() * 100) + 1;
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

function secondaryMismatchSteps(position: Position, secondary: Position) {
  if (isNaturalSecondaryPosition(position, secondary)) return 0;
  const secondaryIndex = positions.indexOf(secondary);
  const naturalIndices = naturalSecondaryPositions[position].map((candidate) => positions.indexOf(candidate));
  return Math.min(...naturalIndices.map((index) => Math.abs(index - secondaryIndex)));
}

function getSecondaryMismatchPenalty(position: Position, secondary: Position, bundleId: string) {
  const steps = secondaryMismatchSteps(position, secondary);
  if (steps === 0) return 0;
  const secondaryIsBigger = positions.indexOf(secondary) > positions.indexOf(position);
  const ratePerStep = secondaryIsBigger
    ? ({ three: 0.05, mid: 0.05, finishing: 0.025, handle: 0.06, passing: 0.05, perimeter: 0.05, steal: 0.03, athletic: 0.03, stability: 0.02 } as Record<string, number>)[bundleId] ?? 0
    : ({ finishing: 0.03, dunk: 0.04, interior: 0.05, block: 0.05, rebound: 0.05, athletic: 0.03, stability: 0.02 } as Record<string, number>)[bundleId] ?? 0;
  return Math.min(0.18, ratePerStep * steps);
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

const durabilityAttrs = [
  "Head Durability", "Neck Durability", "Back Durability",
  "Left Shoulder Durability", "Right Shoulder Durability",
  "Left Elbow Durability", "Right Elbow Durability",
  "Left Hip Durability", "Right Hip Durability",
  "Left Knee Durability", "Right Knee Durability",
  "Left Ankle Durability", "Right Ankle Durability",
  "Left Foot Durability", "Right Foot Durability", "Overall Durability",
];

const fullAttributeGroups = [
  { key: "offense", label: "进攻", attrs: ["Layup", "Post Fade", "Post Hook", "Post Control", "Draw Foul", "Close Shot", "Mid-Range Shot", "Three-Point Shot", "Free Throw", "Ball Handle", "Pass IQ", "Pass Accuracy", "Offensive Rebound", "Standing Dunk", "Driving Dunk", "Shot IQ", "Pass Vision", "Hands"] },
  { key: "defense", label: "防守", attrs: ["Defensive Rebound", "Interior Defense", "Perimeter Defense", "Block", "Steal"] },
  { key: "athletic", label: "运动", attrs: ["Speed", "Speed with Ball", "Vertical", "Strength", "Stamina", "Hustle", "Agility"] },
  { key: "durability", label: "耐久", attrs: durabilityAttrs },
  { key: "mental", label: "精神", attrs: ["Pass Perception", "Defensive Consistency", "Help Defense IQ", "Offensive Consistency"] },
  { key: "misc", label: "杂项", attrs: ["Intangibles", "Potential"] },
] as const;

// PG-SF and PF weights are adapted from the supplied mobile-game tables.
// Strength is folded into athleticism; perimeter-defense weight is split with steals.
// The missing C table is conservatively inferred from the PF distribution.
const positionWeights: Record<Position, Record<string, number>> = {
  PG: { three: 10, mid: 10, finishing: 8, dunk: 4, handle: 14, passing: 14, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 12, stability: 8 },
  SG: { three: 12, mid: 12, finishing: 10, dunk: 6, handle: 10, passing: 8, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 12, stability: 10 },
  SF: { three: 10, mid: 10, finishing: 10, dunk: 8, handle: 8, passing: 6, perimeter: 7, interior: 8, steal: 3, block: 4, rebound: 6, athletic: 14, stability: 6 },
  PF: { three: 8, mid: 6, finishing: 12, dunk: 6, handle: 6, passing: 4, perimeter: 7, interior: 12, steal: 3, block: 8, rebound: 10, athletic: 14, stability: 4 },
  C: { three: 4, mid: 4, finishing: 10, dunk: 8, handle: 2, passing: 4, perimeter: 3, interior: 14, steal: 1, block: 12, rebound: 14, athletic: 18, stability: 6 },
};

// Fitted against 386 current 2KRatings players with complete attributes.
// Five-fold validation: MAE 2.44 (previous raw weighted formula: 9.17).
const overallCalibration: Record<Position, { intercept: number; slope: number }> = {
  PG: { intercept: -28.9919, slope: 1.5280 },
  SG: { intercept: -14.8482, slope: 1.3428 },
  SF: { intercept: 2.1859, slope: 1.1230 },
  PF: { intercept: -1.6571, slope: 1.1658 },
  C: { intercept: 13.8012, slope: 0.9208 },
};

const defaultPotentialRange: PotentialRange = { min: 82, max: 87 };
const developmentGapByAge: Record<number, { standard: number; elite: number }> = {
  18: { standard: 14, elite: 17 },
  19: { standard: 12, elite: 14 },
  20: { standard: 9, elite: 12 },
  21: { standard: 7, elite: 10 },
  22: { standard: 5, elite: 8 },
  23: { standard: 4, elite: 6 },
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

function getBodyAttributeAdjustmentForPosition(attr: string, position: Position, body: BodySettings) {
  const base = bodyBases[position];
  const height = (body.height - base.height) / 5;
  const weight = (body.weight - base.weight) / 10;
  const wingspan = (body.wingspan - base.wingspan) / 10;
  const shoulder = (body.shoulder - base.shoulder) / 10;
  const adjustments: Record<string, number> = {
    Block: height * 0.8 + wingspan * 1.2,
    "Interior Defense": height * 0.65 + weight * 0.55 + shoulder * 0.55,
    "Offensive Rebound": height * 0.7 + wingspan + weight * 0.3,
    "Defensive Rebound": height * 0.75 + wingspan + weight * 0.35,
    "Standing Dunk": height * 0.5 + weight * 0.45 + shoulder * 0.45,
    "Driving Dunk": height * 0.15 - weight * 0.15,
    Strength: weight * 0.9 + shoulder * 0.8,
    Speed: -height * 0.55 - weight * 0.7,
    Agility: -height * 0.65 - weight * 0.55,
    "Speed with Ball": -height * 0.55 - weight * 0.45,
    "Ball Handle": -height * 0.45 - weight * 0.25,
    "Perimeter Defense": -height * 0.2 - weight * 0.35 + wingspan * 0.35,
    Steal: wingspan * 0.55,
    "Pass Perception": wingspan * 0.4,
    "Post Control": height * 0.35 + weight * 0.4 + shoulder * 0.3,
    "Post Hook": height * 0.3 + wingspan * 0.35,
    "Close Shot": height * 0.2 + wingspan * 0.2,
    Layup: height * 0.1 - weight * 0.1,
  };
  return Math.max(-5, Math.min(5, adjustments[attr] ?? 0));
}

function getBodyAttributeAdjustment(attr: string, position: Position, secondary: Position, body: BodySettings) {
  if (!isNaturalSecondaryPosition(position, secondary)) {
    return getBodyAttributeAdjustmentForPosition(attr, position, body);
  }
  return getBodyAttributeAdjustmentForPosition(attr, position, body) * (1 - secondaryPositionShare)
    + getBodyAttributeAdjustmentForPosition(attr, secondary, body) * secondaryPositionShare;
}

function playerId(player: PlayerSource) {
  return player.id ?? `${player.rosterTeam ?? player.team ?? "team"}:${player.slug ?? player.name}`;
}

function playerIdentity(player: PlayerSource) {
  return (player.slug ?? player.name).trim().toLowerCase();
}

function playerPositions(player: PlayerSource): Position[] {
  const candidates = player.position?.split(/[\/\-]/).map((value) => value.trim()) ?? [];
  const valid = candidates.filter((candidate): candidate is Position => positions.includes(candidate as Position));
  return valid.length ? valid : ["SF"];
}

function fallback(player: PlayerSource, attr: string) {
  if (["Three-Point Shot", "Mid-Range Shot", "Free Throw", "Offensive Consistency", "Shot IQ"].includes(attr)) return player.shooting ?? player.overall ?? 68;
  if (["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass IQ", "Pass Vision"].includes(attr)) return player.playmaking ?? player.overall ?? 66;
  if (["Perimeter Defense", "Interior Defense", "Steal", "Pass Perception", "Block", "Defensive Rebound", "Defensive Consistency", "Help Defense IQ"].includes(attr)) return player.defense ?? player.overall ?? 65;
  if (["Speed", "Agility", "Vertical", "Strength", "Stamina", "Hustle", "Overall Durability"].includes(attr)) return player.athleticism ?? player.overall ?? 68;
  return player.inside ?? player.overall ?? 64;
}

function getAttr(player: PlayerSource, attr: string) {
  for (const name of aliases[attr] ?? [attr]) {
    const value = player.detailed?.[name];
    if (typeof value === "number") return clamp(value);
  }
  return clamp(fallback(player, attr));
}

function getPenaltyRateForPosition(position: Position, player: PlayerSource, bundleId: string) {
  const target = positions.indexOf(position);
  const source = playerPositions(player)
    .map((candidate) => positions.indexOf(candidate))
    .sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0];
  const bigger = source - target;
  const smaller = target - source;
  const bigSkills: Record<string, number> = { block: 0.018, interior: 0.018, rebound: 0.015, dunk: 0.01, finishing: 0.006, athletic: 0.02 };
  const smallSkills: Record<string, number> = { handle: 0.018, perimeter: 0.018, athletic: 0.02, passing: 0.01, three: 0.008, mid: 0.006 };
  if (bigger > 0 && bundleId in bigSkills) return Math.min(0.05, bigger * bigSkills[bundleId]);
  if (smaller > 0 && bundleId in smallSkills) return Math.min(0.05, smaller * smallSkills[bundleId]);
  return 0;
}

function getSourcePenaltyRate(position: Position, secondary: Position, player: PlayerSource, bundleId: string) {
  const primaryPenalty = getPenaltyRateForPosition(position, player, bundleId);
  if (!isNaturalSecondaryPosition(position, secondary)) return primaryPenalty;
  return primaryPenalty * (1 - secondaryPositionShare)
    + getPenaltyRateForPosition(secondary, player, bundleId) * secondaryPositionShare;
}

function evaluate(player: PlayerSource, bundle: Bundle, position: Position, secondary: Position, body: BodySettings): Evaluation {
  const sourcePenaltyRate = getSourcePenaltyRate(position, secondary, player, bundle.id);
  const secondaryPenaltyRate = getSecondaryMismatchPenalty(position, secondary, bundle.id);
  const penaltyRate = 1 - (1 - sourcePenaltyRate) * (1 - secondaryPenaltyRate);
  const rawValues = Object.fromEntries(bundle.attrs.map((attr) => [attr, getAttr(player, attr)]));
  const bodyValues = Object.fromEntries(Object.entries(rawValues).map(([attr, value]) => [attr, clamp(value + getBodyAttributeAdjustment(attr, position, secondary, body))]));
  const values = Object.fromEntries(Object.entries(bodyValues).map(([attr, value]) => [attr, clamp(value * (1 - penaltyRate))]));
  const raw = Math.round(average(Object.values(rawValues)));
  const bodyAdjusted = Math.round(average(Object.values(bodyValues)));
  const adjusted = Math.round(average(Object.values(values)));
  return {
    raw,
    adjusted,
    penaltyRate,
    sourcePenaltyRate,
    secondaryPenaltyRate,
    bodyAdjustment: bodyAdjusted - raw,
    values,
  };
}

function evaluateCustom(bundle: Bundle, customValues: Record<string, number>): Evaluation {
  const values = Object.fromEntries(bundle.attrs.map((attr) => [attr, clamp(customValues[attr] ?? 75)]));
  const adjusted = Math.round(average(Object.values(values)));
  return { raw: adjusted, adjusted, penaltyRate: 0, sourcePenaltyRate: 0, secondaryPenaltyRate: 0, bodyAdjustment: 0, values };
}

function valueColor(value: number) {
  if (value >= 90) return "text-fuchsia-700";
  if (value >= 80) return "text-rose-700";
  if (value >= 70) return "text-emerald-700";
  if (value >= 60) return "text-blue-700";
  return "text-ink-600";
}

function createRound(teams: RookieBuilderTeam[], seed: number, previousTeamId = ""): TeamRound {
  const valid = teams.filter((team) => team.players.length > 0);
  const random = makeRandom(seed);
  let team = valid[Math.floor(random() * valid.length)] ?? valid[0];
  if (valid.length > 1 && team?.id === previousTeamId) {
    team = valid[(valid.findIndex((item) => item.id === team?.id) + 1) % valid.length];
  }
  return {
    teamId: team?.id ?? "",
    playerOrder: team ? shuffle(team.players.map(playerId), random) : [],
    offset: 0,
  };
}

function rookieValue(value: number, age: number, category: BundleCategory, readiness: number) {
  const progressByCategory: Record<BundleCategory, number[]> = {
    technical: [0.82, 0.85, 0.88, 0.91, 0.93, 0.95],
    physical: [0.92, 0.94, 0.96, 0.97, 0.98, 0.99],
    mental: [0.77, 0.81, 0.85, 0.88, 0.9, 0.92],
  };
  const readinessSensitivity: Record<BundleCategory, number> = {
    technical: 0.1,
    physical: 0.05,
    mental: 0.12,
  };
  const ageIndex = Math.max(0, Math.min(ages.length - 1, age - ages[0]));
  const readinessOffset = ((readiness - 50) / 50) * readinessSensitivity[category];
  const progress = Math.max(0.55, Math.min(1, progressByCategory[category][ageIndex] + readinessOffset));
  return clamp(25 + (value - 25) * progress);
}

function getValue(values: Record<string, number>, attrs: string[], fallbackValue = 65) {
  return average(attrs.map((attr) => values[attr]).filter((value): value is number => typeof value === "number"), fallbackValue);
}

function calibratedOverall(values: Record<string, number>, position: Position, secondary: Position, fallbackValue = 65) {
  const raw = bundles.reduce((total, bundle) => {
    const bundleValue = getValue(values, bundle.attrs, fallbackValue);
    return total + bundleValue * blendedPositionWeight(position, secondary, bundle.id);
  }, 0) / 100;
  const calibration = overallCalibration[position];
  return clamp(calibration.intercept + calibration.slope * raw, 40, 99);
}

function developmentGap(potential: number, age: number) {
  const gaps = developmentGapByAge[age] ?? developmentGapByAge[19];
  const eliteFactor = Math.max(0, Math.min(1, (potential - 87) / 5));
  return gaps.standard + (gaps.elite - gaps.standard) * eliteFactor;
}

function readinessOverallAdjustment(potential: number, age: number, readiness: number) {
  if (readiness >= 50) return ((readiness - 50) / 50) * 4;
  const eliteFactor = Math.max(0, Math.min(1, (potential - 87) / 5));
  const rawProspectPenalty = 8 + eliteFactor * 14 + Math.max(0, age - 19) * 3;
  return -((50 - readiness) / 49) * rawProspectPenalty;
}

function initialOverallRange(range: PotentialRange, age: number, readiness: number) {
  return {
    min: clamp(range.min - developmentGap(range.min, age) + readinessOverallAdjustment(range.min, age, readiness), 40, 95),
    max: clamp(range.max - developmentGap(range.max, age) + readinessOverallAdjustment(range.max, age, readiness), 40, 95),
  };
}

function calibrateAttributesToOverall(
  values: Record<string, number>,
  position: Position,
  secondary: Position,
  targetOverall: number,
) {
  const ratingAttributes = [...new Set(bundles.flatMap((bundle) => bundle.attrs))];
  let best = { ...values };
  let bestDistance = Math.abs(calibratedOverall(best, position, secondary) - targetOverall);

  // A uniform offset preserves the selected player's attribute shape. Search
  // for the closest offset because the position calibration is not 1:1.
  for (let offset = -30; offset <= 30; offset += 1) {
    const candidate = { ...values };
    for (const attr of ratingAttributes) {
      if (typeof candidate[attr] === "number") candidate[attr] = clamp(candidate[attr] + offset);
    }
    const distance = Math.abs(calibratedOverall(candidate, position, secondary) - targetOverall);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
    if (distance === 0) break;
  }

  return best;
}

function tierFor(score: number): BadgeTier {
  if (score >= 96) return "HOF";
  if (score >= 90) return "Gold";
  if (score >= 84) return "Silver";
  return "Bronze";
}

function createBadges(attrs: Record<string, number>) {
  const rules = [
    ["Set Shot Specialist", getValue(attrs, ["Three-Point Shot", "Mid-Range Shot"])],
    ["Deadeye", getValue(attrs, ["Mid-Range Shot", "Shot IQ"])],
    ["Limitless Range", getValue(attrs, ["Three-Point Shot"]) - 2],
    ["Physical Finisher", getValue(attrs, ["Layup", "Strength"])],
    ["Posterizer", getValue(attrs, ["Driving Dunk", "Vertical"])],
    ["Handles For Days", getValue(attrs, ["Ball Handle", "Stamina"])],
    ["Dimer", getValue(attrs, ["Pass Accuracy", "Pass IQ", "Pass Vision"])],
    ["Challenger", getValue(attrs, ["Perimeter Defense", "Agility"])],
    ["Interceptor", getValue(attrs, ["Steal", "Pass Perception"])],
    ["Paint Patroller", getValue(attrs, ["Block", "Interior Defense"])],
    ["Rebound Chaser", getValue(attrs, ["Offensive Rebound", "Defensive Rebound"])],
  ] as const;
  return rules.filter(([, score]) => score >= 78).map(([name, score]) => ({ name, score, tier: tierFor(score) }));
}

function downgradeTier(tier: BadgeTier, age: number, readiness: number): BadgeTier | null {
  const order: BadgeTier[] = ["Bronze", "Silver", "Gold", "HOF"];
  const ageDrop = age <= 19 ? 1 : 0;
  const readinessDrop = readiness < 35 ? 2 : readiness < 70 ? 1 : 0;
  const index = order.indexOf(tier) - ageDrop - readinessDrop;
  return index >= 0 ? order[index] : null;
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
  potentialRange: PotentialRange,
  readiness: number,
  mode: BuilderMode,
) {
  const isPrime = mode === "prime";
  let peakAttrs: Record<string, number> = {};
  let initialAttrs: Record<string, number> = {};
  const scores: number[] = [];
  for (const bundle of bundles) {
    const evaluation = evaluations[bundle.id];
    if (!evaluation) continue;
    Object.assign(peakAttrs, evaluation.values);
    scores.push(evaluation.adjusted);
  }

  const customFinalAttrs = Object.assign({}, ...Object.values(locks)
    .filter((lock): lock is CustomLock => lock.kind === "custom")
    .map((lock) => lock.values));
  Object.assign(peakAttrs, customFinalAttrs);
  const signature = `${bundles.map((bundle) => {
    const lock = locks[bundle.id];
    return lock?.kind === "player" ? lock.playerId : lock?.kind === "custom" ? JSON.stringify(lock.values) : "-";
  }).join("|")}|${Object.values(body).join("|")}`;
  const random = makeRandom(hash(`${signature}|${age}|${position}|${secondary}|${readiness}`));
  const mean = average(scores, 71);
  const top = average([...scores].sort((a, b) => b - a).slice(0, 4), mean);
  const sourcePeakOverall = calibratedOverall(peakAttrs, position, secondary, mean);
  const potentialSignal = sourcePeakOverall * 0.82 + top * 0.18;
  const rangePlacement = Math.max(0, Math.min(1, (potentialSignal - 65) / 30));
  const minPotential = isPrime ? clamp(sourcePeakOverall, 60, 99) : potentialRange.min;
  const maxPotential = isPrime ? minPotential : potentialRange.max;
  const potential = isPrime
    ? minPotential
    : clamp(minPotential + (maxPotential - minPotential) * rangePlacement, minPotential, maxPotential);

  if (!isPrime) {
    peakAttrs = calibrateAttributesToOverall(peakAttrs, position, secondary, potential);
    Object.assign(peakAttrs, customFinalAttrs);
    for (const bundle of bundles) {
      for (const attr of bundle.attrs) {
        const value = peakAttrs[attr];
        if (typeof value === "number") initialAttrs[attr] = rookieValue(value, age, bundle.category, readiness);
      }
    }
  } else {
    // Prime mode exposes the evaluated values directly: no age development curve
    // and no second overall calibration should alter the attributes the user chose.
    initialAttrs = { ...peakAttrs };
  }

  const projectedInitialRange = initialOverallRange(potentialRange, age, readiness);
  const targetInitialOverall = isPrime
    ? calibratedOverall(initialAttrs, position, secondary, mean)
    : clamp(
      projectedInitialRange.min + (projectedInitialRange.max - projectedInitialRange.min) * rangePlacement,
      projectedInitialRange.min,
      projectedInitialRange.max,
    );
  const boom = isPrime ? 0 : clamp(28 + potential - 84 - (age - 18) * 2 + (50 - readiness) * 0.12 + (random() - 0.5) * 8, 10, 55);
  const bust = isPrime ? 0 : clamp(18 - (age - 18) + (50 - readiness) * 0.18 + (random() - 0.5) * 8, 8, 40);
  const normal = 100 - boom - bust;
  const hand: "左手" | "右手" = random() < 0.11 ? "左手" : "右手";
  const dunkHand: "左手" | "右手" = random() < 0.8 ? hand : hand === "左手" ? "右手" : "左手";
  if (!isPrime) initialAttrs = calibrateAttributesToOverall(initialAttrs, position, secondary, targetInitialOverall);
  Object.assign(initialAttrs, customFinalAttrs);
  const durability = initialAttrs["Overall Durability"] ?? 72;
  const bodyBase = bodyBases[position];
  const bodyStress = Math.max(0, (body.weight - bodyBase.weight) / 15) + Math.max(0, (body.height - bodyBase.height) / 12);
  for (const attr of durabilityAttrs) {
    if (attr === "Overall Durability") continue;
    initialAttrs[attr] = clamp(durability + (random() - 0.5) * 10 - bodyStress * 1.5);
  }
  initialAttrs["Overall Durability"] = durability;
  const baseOverall = calibratedOverall(initialAttrs, position, secondary, mean);
  const initialStrength = baseOverall;
  const intangibles = 50;
  const growthGap = Math.max(0, potential - initialStrength);
  const progressSpeed = isPrime
    ? 0
    : Math.round(Math.max(2.2, Math.min(5.4, 2.4 + readiness * 0.018 + Math.max(0, (potential - 87) / 10) + (random() - 0.5) * 0.6)) * 10) / 10;
  const yearsToPeak = isPrime || progressSpeed === 0 ? 0 : Math.ceil(growthGap / progressSpeed);
  const peakStart = isPrime ? 28 : clamp(Math.max(24, age + yearsToPeak), age, 30);
  const peakDuration = isPrime ? 7 : Math.max(5, Math.min(11, 7 + (durability - 70) / 15 + (readiness - 50) / 50 + random() * 1.5));
  const peakEnd = clamp(peakStart + peakDuration, peakStart, 40);
  initialAttrs.Intangibles = intangibles;
  initialAttrs.Potential = potential;
  const peakBadges = createBadges(peakAttrs);
  const badges = isPrime
    ? peakBadges
    : peakBadges
      .map((badge) => ({ ...badge, tier: downgradeTier(badge.tier, age, readiness) }))
      .filter((badge): badge is typeof badge & { tier: BadgeTier } => badge.tier !== null);
  const hotZones = createHotZones(initialAttrs, position, secondary, hand, random);
  return {
    age, position, secondary,
    hand, dunkHand, ...body,
    potential, minPotential, maxPotential, projectedInitialRange, readiness, growthGap, progressSpeed, boom, normal, bust, peakStart, peakEnd,
    peakAttrs, initialAttrs, initialStrength, baseOverall, intangibles, peakBadges, badges, hotZones,
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
) {
  const isPrime = mode === "prime";
  return [
    `NBA 2K26 ${isPrime ? "巅峰球员" : "新秀"}创建清单`, "", "[资料]",
    `姓名: ${rookieName}`, `年龄: ${result.age}`, `位置: ${result.position}`, `次要位置: ${result.secondary}`,
    `惯用手: ${result.hand}`, `扣篮惯用手: ${result.dunkHand}`,
    `巅峰开始年龄: ${result.peakStart}`, `巅峰结束年龄: ${result.peakEnd}`,
    ...(!isPrime ? [
      `即战力: ${result.readiness}`,
      `巅峰综评区间: ${result.minPotential}-${result.maxPotential}`,
      `新秀综评区间: ${result.projectedInitialRange.min}-${result.projectedInitialRange.max}`,
      `预计进步速度: 每年 +${result.progressSpeed} 综评`,
    ] : []),
    `潜力: ${result.potential}`, `最小潜力: ${result.minPotential}`, `最大潜力: ${result.maxPotential}`,
    `成长百分比: ${result.boom}%`, `平均百分比: ${result.normal}%`, `衰退百分比: ${result.bust}%`,
    "", "[身体]", `身高: ${result.height} cm`, `体重: ${result.weight} kg`, `臂展: ${result.wingspan}`,
    `肩宽: ${result.shoulder}`, `颈部长度: ${result.neck}`, `躯干长度: ${result.torso}`,
    "", `[完整${isPrime ? "巅峰" : "初始"}属性]`,
    ...fullAttributeGroups.flatMap((group) => [
      `-- ${group.label} --`,
      ...group.attrs.map((attr) => `${attrNameCN[attr] ?? attr}: ${result.initialAttrs[attr] ?? "--"}`),
    ]),
    "", "[杂项]", `位置加权综评: ${result.baseOverall}`, `无形属性: ${result.intangibles}`,
    `${isPrime ? "巅峰综评" : "预计初始综评"}: ${result.initialStrength}`, `潜力: ${result.potential}`,
    "", "[热区]", ...Object.entries(result.hotZones).map(([name, state]) => `${name}: ${state}`),
    ...(isPrime ? [
      "", "[巅峰徽章]", ...(result.badges.length ? result.badges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier]}`) : ["无"]),
    ] : [
      "", "[当前徽章]", ...(result.badges.length ? result.badges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier]}`) : ["无"]),
      "", "[巅峰徽章]", ...(result.peakBadges.length ? result.peakBadges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier]}`) : ["无"]),
    ]),
    "", "[属性来源]", ...bundles.map((bundle) => {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        const values = bundle.attrs.map((attr) => `${attrNameCN[attr] ?? attr} ${lock.values[attr]}`).join("，");
        return `${bundle.label}: 用户自定义（${values}）`;
      }
      const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
      const evaluation = evaluations[bundle.id];
      const sourcePenaltyPercent = evaluation?.sourcePenaltyRate ? Math.round(evaluation.sourcePenaltyRate * 100) : 0;
      const secondaryPenaltyPercent = evaluation?.secondaryPenaltyRate ? Math.round(evaluation.secondaryPenaltyRate * 100) : 0;
      const bodyAdjustment = evaluation?.bodyAdjustment ?? 0;
      const adjustments = [
        bodyAdjustment ? `体型修正 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment}` : "",
        sourcePenaltyPercent ? `来源位置衰减 ${sourcePenaltyPercent}%` : "",
        secondaryPenaltyPercent ? `非常规次要位置衰减 ${secondaryPenaltyPercent}%` : "",
      ].filter(Boolean).join("，");
      return `${bundle.label}（权重 ${displayedPositionWeight(result.position, result.secondary, bundle.id)}%）: ${player ? getPlayerNameCN(player.name) : "--"}${adjustments ? `（${adjustments}）` : ""}`;
    }),
  ].join("\n");
}

function PlayerHeadshot({ name }: { name: string }) {
  const [failed, setFailed] = useState(false);
  const src = getPlayerHeadshot(name);

  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
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
      loading="lazy"
      onError={() => setFailed(true)}
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
      className="h-7 w-12 bg-transparent px-1 text-center text-[11px] font-semibold tabular-nums text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
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

function RookieBuilder({ teams, mode = "rookie" }: { teams: RookieBuilderTeam[]; mode?: BuilderMode }) {
  const isPrime = mode === "prime";
  const [rookieName, setRookieName] = useState(() => generateRookieName());
  const [position, setPosition] = useState<Position>("PG");
  const [secondaryPosition, setSecondaryPosition] = useState<Position>(() => defaultSecondaryPosition("PG"));
  const [age, setAge] = useState(19);
  const [potentialRange, setPotentialRange] = useState<PotentialRange>(defaultPotentialRange);
  const [readiness, setReadiness] = useState(defaultReadiness);
  const [body, setBody] = useState<BodySettings>(() => createBodySettings("PG", Date.now()));
  const [settingsLocked, setSettingsLocked] = useState(false);
  const [locks, setLocks] = useState<LockState>({});
  const [drawSeed, setDrawSeed] = useState(() => Date.now());
  const [round, setRound] = useState<TeamRound>(() => createRound(teams, Date.now()));
  const [isTeamDrawing, setIsTeamDrawing] = useState(false);
  const [drawingTeamName, setDrawingTeamName] = useState<string | null>(null);
  const [switchesLeft, setSwitchesLeft] = useState(playerSwitchLimit);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [customizingBundleId, setCustomizingBundleId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [status, setStatus] = useState(`确认${isPrime ? "巅峰球员" : "新秀"}设定后开始`);
  const [mobilePane, setMobilePane] = useState<MobilePane>("settings");
  const drawIntervalRef = useRef<number | null>(null);
  const drawTimeoutRef = useRef<number | null>(null);
  const customDialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const clearTeamDrawTimers = () => {
    if (drawIntervalRef.current !== null) window.clearInterval(drawIntervalRef.current);
    if (drawTimeoutRef.current !== null) window.clearTimeout(drawTimeoutRef.current);
    drawIntervalRef.current = null;
    drawTimeoutRef.current = null;
  };

  useEffect(() => () => clearTeamDrawTimers(), []);

  useEffect(() => {
    if (!customizingBundleId) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = () => {
      const focusable = customDialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])");
      focusable?.focus();
    };
    const animationFrame = window.requestAnimationFrame(focusDialog);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setCustomizingBundleId(null);
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
  }, [customizingBundleId]);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(
    () => new Map(teams.flatMap((team) => team.players.map((player) => [playerId(player), player] as const))),
    [teams],
  );
  const team = settingsLocked ? teamsById.get(round.teamId) : undefined;
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
        next[bundle.id] = evaluateCustom(bundle, lock.values);
        continue;
      }
      const player = lock?.kind === "player" ? playersById.get(lock.playerId) : undefined;
      if (player) next[bundle.id] = evaluate(player, bundle, position, secondaryPosition, body);
    }
    return next;
  }, [body, locks, playersById, position, secondaryPosition]);
  const selectedEvaluations = useMemo(() => Object.fromEntries(
    selectedPlayer ? bundles.map((bundle) => [bundle.id, evaluate(selectedPlayer, bundle, position, secondaryPosition, body)]) : [],
  ) as Record<string, Evaluation>, [body, position, secondaryPosition, selectedPlayer]);
  const penalizedAttributes = useMemo(() => new Set(
    bundles.flatMap((bundle) => evaluations[bundle.id]?.penaltyRate > 0 ? bundle.attrs : []),
  ), [evaluations]);
  const effectiveAge = isPrime ? 28 : age;
  const projectedInitialRange = useMemo(
    () => initialOverallRange(potentialRange, effectiveAge, readiness),
    [effectiveAge, potentialRange, readiness],
  );
  const result = useMemo(
    () => createResult(evaluations, locks, effectiveAge, position, secondaryPosition, body, potentialRange, readiness, mode),
    [body, effectiveAge, evaluations, locks, mode, position, potentialRange, readiness, secondaryPosition],
  );
  const completed = Object.keys(locks).length;
  const isComplete = completed === bundles.length;
  const shownIds = round.playerOrder.slice(round.offset, round.offset + 7);
  const shownPlayers = settingsLocked
    ? shownIds.map((id) => playersById.get(id)).filter((player): player is PlayerSource => Boolean(player))
    : [];
  const hasNextBatch = settingsLocked && round.offset + 7 < round.playerOrder.length;
  const zoneCounts = Object.values(result.hotZones).reduce<Record<HotZoneState, number>>(
    (counts, state) => ({ ...counts, [state]: counts[state] + 1 }),
    { 冷区: 0, 中性: 0, 热区: 0 },
  );
  const hasSecondaryMismatch = !isNaturalSecondaryPosition(position, secondaryPosition);
  const customizingBundle = bundles.find((bundle) => bundle.id === customizingBundleId);
  const customDraftIsValid = Boolean(customizingBundle?.attrs.every((attr) => {
    const value = Number(customDraft[attr]);
    return Number.isFinite(value) && value >= 25 && value <= 99;
  }));
  const wizardSteps: Array<{ key: MobilePane; label: string; enabled: boolean }> = [
    { key: "settings", label: "基础设定", enabled: true },
    { key: "players", label: "球队球员", enabled: settingsLocked },
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

  const updatePotentialMin = (value: number) => {
    if (settingsLocked) return;
    setPotentialRange((current) => ({ min: value, max: Math.max(value, current.max) }));
  };

  const updatePotentialMax = (value: number) => {
    if (settingsLocked) return;
    setPotentialRange((current) => ({ min: Math.min(current.min, value), max: value }));
  };

  const updateReadiness = (value: number) => {
    if (settingsLocked) return;
    setReadiness(clamp(value, 1, 100));
  };

  const randomizeReadiness = () => {
    if (settingsLocked) return;
    setReadiness(randomReadiness());
  };

  const randomizeBody = () => {
    if (settingsLocked) return;
    setBody(createBodySettings(position, Date.now()));
  };

  const randomizeName = () => {
    if (settingsLocked) return;
    setRookieName(generateRookieName());
    setReadiness(defaultReadiness);
  };

  const startTeamDraw = (previousTeamId: string | undefined, completionStatus: string) => {
    clearTeamDrawTimers();
    const seed = Date.now();
    const selectableTeams = teams.filter((candidate) => candidate.players.length > 0);
    const candidates = selectableTeams.filter((candidate) => candidate.id !== previousTeamId);
    const previewCandidates = candidates.length ? candidates : selectableTeams;
    const previewRandom = makeRandom(seed ^ 0x9e3779b9);
    const nextRound = createRound(teams, seed, previousTeamId);

    const nextPreviewName = () => {
      const candidate = previewCandidates[Math.floor(previewRandom() * previewCandidates.length)];
      return candidate ? teamNamesCN[candidate.name] ?? candidate.name : "匹配中";
    };

    setIsTeamDrawing(true);
    setDrawingTeamName(nextPreviewName());
    setSelectedPlayerId(null);
    setCustomizingBundleId(null);
    setStatus("正在随机抽取球队...");
    setMobilePane("players");

    drawIntervalRef.current = window.setInterval(() => setDrawingTeamName(nextPreviewName()), 190);
    drawTimeoutRef.current = window.setTimeout(() => {
      clearTeamDrawTimers();
      setDrawSeed(seed);
      setRound(nextRound);
      setDrawingTeamName(null);
      setIsTeamDrawing(false);
      setStatus(completionStatus);
    }, teamDrawDurationMs);
  };

  const confirmSettings = () => {
    setRookieName((current) => current.trim().replace(/\s+/g, " ") || generateRookieName());
    setSettingsLocked(true);
    startTeamDraw(undefined, "第 1 轮球队已抽取");
  };

  const drawNextTeam = () => {
    startTeamDraw(round.teamId, "下一轮球队已抽取");
  };

  const switchPlayers = () => {
    if (!settingsLocked || isTeamDrawing || switchesLeft <= 0 || !hasNextBatch) return;
    setRound((current) => ({
      teamId: current.teamId,
      playerOrder: current.playerOrder,
      offset: current.offset + 7,
    }));
    setSwitchesLeft((current) => current - 1);
    setSelectedPlayerId(null);
    setStatus(`已在${team ? teamNamesCN[team.name] ?? team.name : "当前球队"}内切换一批球员`);
  };

  const choosePlayer = (player: PlayerSource) => {
    const id = playerId(player);
    if (!settingsLocked || isTeamDrawing || usedBy.has(playerIdentity(player))) return;
    setSelectedPlayerId(id);
    setStatus(`${getPlayerNameCN(player.name)} 已选择`);
    setMobilePane("attributes");
  };

  const finishLock = (nextLocks: LockState) => {
    setLocks(nextLocks);
    setSelectedPlayerId(null);
    setCustomizingBundleId(null);
    if (Object.keys(nextLocks).length === bundles.length) {
      setStatus(`${isPrime ? "巅峰球员" : "新秀"}已揭晓`);
      setMobilePane("result");
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
    if (locks[bundle.id] || !settingsLocked || isTeamDrawing) return;
    const preview = selectedEvaluations[bundle.id];
    setCustomDraft(Object.fromEntries(bundle.attrs.map((attr) => [attr, String(preview?.values[attr] ?? 75)])));
    setCustomizingBundleId(bundle.id);
  };

  const confirmCustomLock = () => {
    if (!customizingBundle || !customDraftIsValid || locks[customizingBundle.id] || isTeamDrawing) return;
    const values = Object.fromEntries(customizingBundle.attrs.map((attr) => [attr, clamp(Number(customDraft[attr]))]));
    finishLock({ ...locks, [customizingBundle.id]: { kind: "custom", values } });
  };

  const autoComplete = () => {
    if (!settingsLocked || isTeamDrawing || isComplete) return;
    const nextLocks = { ...locks };
    const used = new Set(Object.values(nextLocks).flatMap((lock) => {
      if (lock.kind !== "player") return [];
      const player = playersById.get(lock.playerId);
      return player ? [playerIdentity(player)] : [];
    }));
    let seed = drawSeed;
    let previousTeam = round.teamId;
    let nextRound = round;
    let useCurrentTeam = true;
    for (const bundle of bundles) {
      if (nextLocks[bundle.id]) continue;
      if (!useCurrentTeam) {
        seed += 1;
        nextRound = createRound(teams, seed, previousTeam);
      }
      useCurrentTeam = false;
      previousTeam = nextRound.teamId;
      const nextTeam = teamsById.get(nextRound.teamId);
      if (!nextTeam) continue;
      const candidates = nextRound.playerOrder
        .map((id) => playersById.get(id))
        .filter((player): player is PlayerSource => Boolean(player))
        .filter((player) => !used.has(playerIdentity(player)))
        .sort((left, right) => evaluate(right, bundle, position, secondaryPosition, body).adjusted - evaluate(left, bundle, position, secondaryPosition, body).adjusted);
      const winner = candidates[0];
      if (!winner) continue;
      const id = playerId(winner);
      used.add(playerIdentity(winner));
      nextLocks[bundle.id] = { kind: "player", playerId: id };
    }
    const nextIsComplete = Object.keys(nextLocks).length === bundles.length;
    setDrawSeed(seed);
    setRound(nextRound);
    setLocks(nextLocks);
    setSelectedPlayerId(null);
    setStatus(nextIsComplete ? `${isPrime ? "巅峰球员" : "新秀"}已揭晓` : `可用球员不足，已补齐 ${Object.keys(nextLocks).length}/${bundles.length} 项属性`);
    setMobilePane(nextIsComplete ? "result" : "players");
  };

  const reset = () => {
    const seed = Date.now();
    clearTeamDrawTimers();
    setRookieName(generateRookieName());
    setDrawSeed(seed);
    setRound(createRound(teams, seed));
    setSettingsLocked(false);
    setIsTeamDrawing(false);
    setDrawingTeamName(null);
    setLocks({});
    setSwitchesLeft(playerSwitchLimit);
    setSelectedPlayerId(null);
    setCustomizingBundleId(null);
    setCustomDraft({});
    setStatus(`确认${isPrime ? "巅峰球员" : "新秀"}设定后开始`);
    setMobilePane("settings");
  };

  const copyResult = async () => {
    try {
      await copyText(createExportText(rookieName, result, locks, evaluations, playersById, mode));
      setStatus("清单已复制");
    } catch {
      setStatus("复制失败，请手动复制");
    }
  };

  const downloadResult = async () => {
    const blob = new Blob([createExportText(rookieName, result, locks, evaluations, playersById, mode)], { type: "text/plain;charset=utf-8" });
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
        setStatus("文件已导出");
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
    setStatus("文件已导出");
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
        <div className="flex flex-col gap-3 px-3 py-3">
          <div className="flex flex-wrap items-end gap-3 sm:gap-4">
          <div className="min-w-[190px]">
            <div className="section-label mb-1">{isPrime ? "球员姓名" : "新秀姓名"}</div>
            <div className="flex h-7 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
              <input
                aria-label={`${isPrime ? "巅峰球员" : "新秀"}英文姓名`}
                className="min-w-0 flex-1 bg-transparent px-2 text-[11px] font-semibold text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
                disabled={settingsLocked}
                maxLength={48}
                onChange={(event) => setRookieName(event.target.value)}
                spellCheck={false}
                type="text"
                value={rookieName}
              />
              <button aria-label="随机生成英文姓名" className="flex w-7 shrink-0 items-center justify-center border-l border-ink-200 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300" disabled={settingsLocked} onClick={randomizeName} title="随机生成英文姓名" type="button"><RefreshCw className="h-3 w-3" /></button>
            </div>
          </div>
          <div>
            <div className="section-label mb-1">主位置</div>
            <div aria-label="主位置" className="flex gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
              {positions.map((option) => {
                const selected = position === option;
                const stateClass = selected
                  ? "bg-ink-900 text-white"
                  : settingsLocked
                    ? "bg-ink-50 text-ink-300"
                    : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800";
                return (
                  <button key={option} aria-label={`主位置 ${option}`} aria-pressed={selected} className={`h-7 min-w-9 px-2 text-[10px] font-semibold transition disabled:cursor-not-allowed ${stateClass}`} disabled={settingsLocked} onClick={() => changePosition(option)} type="button">{option}</button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="section-label mb-1 flex items-center gap-1.5">
              次要位置
              {hasSecondaryMismatch && (
                <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold text-rose-700" title="非常规位置组合会对不匹配的属性额外衰减">
                  <AlertTriangle className="h-2.5 w-2.5" />非常规
                </span>
              )}
            </div>
            <div aria-label="次要位置" className="flex gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
              {positions.map((option) => {
                const isPrimary = option === position;
                const selected = secondaryPosition === option;
                const natural = !isPrimary && isNaturalSecondaryPosition(position, option);
                const stateClass = selected
                  ? natural ? "bg-court-700 text-white" : "bg-rose-700 text-white"
                  : settingsLocked || isPrimary
                    ? "bg-ink-50 text-ink-300"
                    : natural
                      ? "bg-white text-ink-600 hover:bg-court-50 hover:text-court-800"
                      : "bg-rose-50/60 text-rose-500 hover:bg-rose-100 hover:text-rose-800";
                return (
                  <button key={option} aria-label={`次要位置 ${option}`} aria-pressed={selected} className={`h-7 min-w-9 px-2 text-[10px] font-semibold transition disabled:cursor-not-allowed ${stateClass}`} disabled={settingsLocked || isPrimary} onClick={() => changeSecondaryPosition(option)} title={isPrimary ? "次要位置不能与主位置相同" : natural ? "常规次要位置" : "非常规次要位置：部分能力会额外衰减"} type="button">{option}</button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="section-label mb-1">年龄</div>
            <div className="flex gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200">
              {isPrime ? (
                <button aria-label="巅峰球员年龄固定为 28 岁" className="h-7 min-w-14 cursor-not-allowed bg-ink-900 px-3 text-[10px] font-semibold text-white" disabled title="巅峰球员年龄固定为 28 岁" type="button">28</button>
              ) : ages.map((option) => (
                <button key={option} className={`h-7 min-w-9 px-2 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-55 ${age === option ? "bg-ink-900 text-white" : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800"}`} disabled={settingsLocked} onClick={() => setAge(option)} type="button">{option}</button>
              ))}
            </div>
          </div>
          {isPrime ? (
          <div className="min-w-[166px]">
            <div className="section-label mb-1">属性阶段</div>
            <div className="flex h-7 items-center justify-between rounded-[5px] border border-court-200 bg-court-50 px-2 text-[10px] font-semibold text-court-800">
              <span>巅峰值直出</span>
              <span className="font-mono">28 岁</span>
            </div>
          </div>
          ) : (
          <>
            <div className="min-w-[142px]">
              <div className="section-label mb-1" title="生成球员最终可以达到的综评区间">巅峰综评</div>
              <div className="flex h-7 items-center justify-center gap-1 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
                <CompactNumberInput ariaLabel="巅峰综评下限" disabled={settingsLocked} max={99} min={60} onChange={updatePotentialMin} value={potentialRange.min} />
                <span className="text-[10px] text-ink-300">–</span>
                <CompactNumberInput ariaLabel="巅峰综评上限" disabled={settingsLocked} max={99} min={60} onChange={updatePotentialMax} value={potentialRange.max} />
              </div>
            </div>
            <div className="min-w-[142px]">
              <div className="mb-1 flex items-center justify-between gap-1">
                <div className="section-label flex items-center gap-1" title="即战力表示新秀已经兑现了多少巅峰能力；数值越高，开局越接近巅峰">
                  即战力 <CircleHelp className="h-3 w-3 text-ink-400" />
                </div>
                <span className="text-[8px] font-medium text-ink-400">越高越成熟</span>
              </div>
              <div className="flex h-7 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
                <div className="flex flex-1 items-center justify-center"><CompactNumberInput ariaLabel="即战力" disabled={settingsLocked} max={100} min={1} onChange={updateReadiness} value={readiness} /></div>
                <button aria-label="随机即战力" className="flex w-7 shrink-0 items-center justify-center border-l border-ink-200 text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300" disabled={settingsLocked} onClick={randomizeReadiness} title="随机生成 1–100 即战力" type="button"><Shuffle className="h-3 w-3" /></button>
              </div>
            </div>
            <div className="min-w-[112px]">
              <div className="section-label mb-1">新秀综评</div>
              <div className="flex h-7 items-center justify-center rounded-[5px] border border-court-200 bg-court-50 px-2 font-mono text-[11px] font-semibold text-court-800" data-testid="projected-initial-range" title="由年龄、巅峰综评和即战力共同计算">
                {projectedInitialRange.min}–{projectedInitialRange.max}
              </div>
            </div>
          </>
          )}
          <div className="min-w-[150px]">
            <div className="flex justify-between text-[9px] font-semibold text-ink-500"><span>完成进度</span><span className="tabular-nums">{completed}/{bundles.length}</span></div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-ink-200"><div className="h-full bg-court-600" style={{ width: `${(completed / bundles.length) * 100}%` }} /></div>
          </div>
          </div>
          <div className="border-t border-ink-100 pt-2.5">
            <div className="mb-2 flex items-center gap-1.5 text-[9px] font-medium text-ink-500">
              <span className="h-1.5 w-1.5 rounded-full bg-court-500" />{status}
            </div>
            <div className="flex w-full items-stretch gap-2" aria-label="设定操作">
              <div className="flex min-w-0 flex-[2] gap-2" aria-label="生成流程操作" role="group">
                {!settingsLocked && <button className="action-button primary-action flex-1 justify-center px-2.5 py-2 text-[11px] font-semibold" onClick={confirmSettings} type="button"><Check className="h-3.5 w-3.5" />确认设定</button>}
                <button className="action-button flex-1 justify-center px-2.5 py-2 text-[11px]" disabled={!settingsLocked || isTeamDrawing || isComplete} onClick={autoComplete} type="button"><Sparkles className="h-3.5 w-3.5" />自动补齐</button>
              </div>
              <div className="flex min-w-0 flex-1 border-l border-ink-200 pl-2" aria-label="重置操作" role="group">
                <button className="action-button flex-1 justify-center px-2.5 py-2 text-[11px]" onClick={reset} type="button"><RefreshCw className="h-3.5 w-3.5" />重新开始</button>
              </div>
            </div>
          </div>
        </div>
        <div className="workspace-toolbar px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="section-label">身体设定</div>
            <button aria-label="随机身体" className="action-button h-7 w-7 justify-center" disabled={settingsLocked} onClick={randomizeBody} title="随机身体" type="button"><Shuffle className="h-3.5 w-3.5" /></button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <BodyNumberInput disabled={settingsLocked} label="身高" max={300} min={150} onChange={(value) => updateBody("height", value)} unit="cm" value={body.height} />
            <BodyNumberInput disabled={settingsLocked} label="体重" max={200} min={50} onChange={(value) => updateBody("weight", value)} unit="kg" value={body.weight} />
            <BodyNumberInput disabled={settingsLocked} label="臂展" max={100} min={1} onChange={(value) => updateBody("wingspan", value)} value={body.wingspan} />
            <BodyNumberInput disabled={settingsLocked} label="肩宽" max={100} min={1} onChange={(value) => updateBody("shoulder", value)} value={body.shoulder} />
            <BodyNumberInput disabled={settingsLocked} label="颈长" max={100} min={1} onChange={(value) => updateBody("neck", value)} value={body.neck} />
            <BodyNumberInput disabled={settingsLocked} label="躯干" max={100} min={1} onChange={(value) => updateBody("torso", value)} value={body.torso} />
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
            <span className="max-w-[130px] truncate text-[9px] font-medium text-ink-500">{selectedPlayer ? getPlayerNameCN(selectedPlayer.name) : "未选球员"}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-2.5">
            {bundles.map((bundle) => {
              const lock = locks[bundle.id];
              const lockedPlayer = lock?.kind === "player" ? playersById.get(lock.playerId) : undefined;
              const lockedEvaluation = evaluations[bundle.id];
              const preview = selectedEvaluations[bundle.id];
              const value = lockedEvaluation?.adjusted ?? preview?.adjusted;
              const penaltyPercent = Math.round((lockedEvaluation?.penaltyRate ?? preview?.penaltyRate ?? 0) * 100);
              const sourcePenaltyPercent = Math.round((lockedEvaluation?.sourcePenaltyRate ?? preview?.sourcePenaltyRate ?? 0) * 100);
              const secondaryPenaltyPercent = Math.round((lockedEvaluation?.secondaryPenaltyRate ?? preview?.secondaryPenaltyRate ?? 0) * 100);
              const hasPositionPenalty = penaltyPercent > 0;
              const bodyAdjustment = lockedEvaluation?.bodyAdjustment ?? preview?.bodyAdjustment ?? 0;
              const sourceLabel = lock?.kind === "custom" ? "用户自定义" : lockedPlayer ? getPlayerNameCN(lockedPlayer.name) : (selectedPlayer ? "可锁定" : "待选择");
              const weightLabel = `主次位置综合权重 ${displayedPositionWeight(position, secondaryPosition, bundle.id)}%`;
              const bodyAdjustmentLabel = bodyAdjustment ? `体型 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment}` : "";
              const adjustmentLabel = [
                bodyAdjustmentLabel,
                sourcePenaltyPercent ? `来源位置衰减 ${sourcePenaltyPercent}%` : "",
                secondaryPenaltyPercent ? `非常规次要位置衰减 ${secondaryPenaltyPercent}%` : "",
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
                    title={lock ? `${weightLabel} · 已锁定，重新开始后才能修改` : typeof value === "number" ? `${weightLabel} · ${sourceLabel}：${lockedEvaluation?.raw ?? preview?.raw} → ${value}${adjustmentLabel ? `（${adjustmentLabel}）` : ""}` : `${bundle.label} · ${weightLabel}`}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-ink-800">{bundle.label}</span>
                      <span className="block truncate text-[8px] text-ink-400">{sourceLabel}{bodyAdjustmentLabel ? ` · ${bodyAdjustmentLabel}` : ""}</span>
                    </span>
                    {typeof value === "number" ? (
                      <span className="flex shrink-0 items-center gap-0.5" title={hasPositionPenalty ? adjustmentLabel : undefined}>
                        {hasPositionPenalty && <ArrowDown aria-hidden="true" className="h-3 w-3 stroke-[2.5] text-rose-600" />}
                        <span className={`text-[13px] font-bold tabular-nums ${valueColor(value)}`}>{value}</span>
                      </span>
                    ) : <span className="text-ink-300">--</span>}
                  </button>
                  {!lock && (
                    <button
                      aria-label={`自定义${bundle.label}`}
                      className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-ink-400 transition hover:bg-ink-200 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-200"
                      disabled={!settingsLocked || isTeamDrawing}
                      onClick={() => openCustomEditor(bundle)}
                      title={`自定义${bundle.label}最终数值`}
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
          aria-label="球队球员"
          className="builder-pane builder-player-pane panel-surface min-w-0 flex-col overflow-hidden"
          data-complete={isComplete}
          data-mobile-active={mobilePane === "players"}
          id="builder-pane-players"
          role="tabpanel"
        >
          <div className="workspace-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div>
              <div className="flex items-center gap-2"><Shuffle className={`h-3.5 w-3.5 text-court-700 ${isTeamDrawing ? "animate-spin" : ""}`} /><h2 className="text-[14px] font-semibold text-ink-900">{isTeamDrawing ? "随机球队" : team ? teamNamesCN[team.name] ?? team.name : "等待开始"}</h2></div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-400">{!settingsLocked ? "基础设定待确认" : isTeamDrawing ? "球队轮盘转动中" : isComplete ? `已完成 / ${completed}/${bundles.length}` : `第 ${completed + 1} 轮 / 展示 ${shownPlayers.length}/${team?.players.length ?? 0}`}</div>
            </div>
            {settingsLocked && !isComplete && (
              <div className="flex items-center gap-1.5">
                <button className="action-button px-2 py-1.5 text-[10px] lg:hidden" disabled={isTeamDrawing} onClick={autoComplete} type="button"><Sparkles className="h-3 w-3" />自动补齐</button>
                <button className="action-button px-2 py-1.5 text-[10px]" disabled={isTeamDrawing || switchesLeft <= 0 || !hasNextBatch} onClick={switchPlayers} title="仅在当前球队内换下一批球员，不会重新抽取球队" type="button"><UsersRound className="h-3 w-3" />换球员 {switchesLeft}</button>
              </div>
            )}
          </div>

          {settingsLocked ? isTeamDrawing ? <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center px-5 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-court-500/35 bg-court-50 text-court-700"><Shuffle className="h-5 w-5 animate-spin" /></div>
            <div className="mt-4 text-[10px] font-medium text-ink-400">正在抽取球队</div>
            <div className="mt-1.5 max-w-full truncate text-[22px] font-semibold text-ink-800" data-testid="drawing-team-name">{drawingTeamName ?? "匹配中"}</div>
            <div className="mt-3 h-1 w-32 overflow-hidden rounded-sm bg-ink-200"><div className="team-draw-progress h-full w-full bg-court-600" style={{ animationDuration: `${teamDrawDurationMs}ms` }} /></div>
          </div> : <div className="grid flex-1 auto-rows-[62px] grid-cols-2 gap-2 p-2.5">
            {shownPlayers.map((player) => {
              const id = playerId(player);
              const unavailable = usedBy.has(playerIdentity(player));
              const selected = selectedPlayerId === id;
              return (
                <button key={id} className={`flex min-w-0 items-center gap-2 rounded-[6px] border px-2 text-left transition ${selected ? "border-ink-700 bg-ink-50 shadow-[inset_3px_0_0_#2b8969]" : unavailable || isComplete ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-40" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`} disabled={unavailable || isComplete} onClick={() => choosePlayer(player)} type="button">
                  <PlayerHeadshot name={player.name} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(player.name)}</span><span className="block text-[9px] text-ink-400">{player.position ?? "--"}{unavailable ? " · 已使用" : ""}</span></span>
                  <span className={`shrink-0 text-[14px] font-bold tabular-nums ${typeof player.overall === "number" ? valueColor(player.overall) : "text-ink-400"}`}>{player.overall ?? "--"}</span>
                </button>
              );
            })}
          </div> : <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center px-4 text-center"><Check className="h-7 w-7 text-ink-300" /><div className="mt-3 text-[14px] font-semibold text-ink-600">确认设定后抽取球队</div><div className="mt-1 text-[10px] text-ink-400">{position}/{secondaryPosition} · {effectiveAge}岁 · {body.height} cm</div></div>}

          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-ink-200 bg-ink-50 px-3 py-2">
            <div className="min-w-0 truncate text-[10px] text-ink-500">{selectedPlayer ? `${getPlayerNameCN(selectedPlayer.name)} · 请选择要锁定的属性` : status}</div>
            {selectedPlayer && <button className="action-button shrink-0 px-2 py-1.5 text-[10px] lg:hidden" onClick={() => setMobilePane("attributes")} type="button">选择属性</button>}
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
            <>
              <div className="workspace-toolbar px-3 py-2.5">
                <div className="section-label">{isPrime ? "巅峰球员卡片" : "新秀卡片"}</div>
                <div className="mt-1 truncate text-[15px] font-semibold text-ink-800" data-testid="rookie-name">{rookieName}</div>
                <div className="mt-2 flex items-end justify-between">
                  <div><div className={`text-[25px] font-bold leading-none tabular-nums ${valueColor(result.initialStrength)}`} data-testid="rookie-overall">{result.initialStrength}</div><div className="mt-1 text-[9px] text-ink-400">{isPrime ? "巅峰综评" : "新秀综评"}</div></div>
                  <div className="text-right"><div className="text-[14px] font-semibold text-court-800">{position}/{secondaryPosition} · {effectiveAge}岁</div><div className="text-[10px] text-ink-500">潜力 <span className={`font-semibold tabular-nums ${valueColor(result.potential)}`} data-testid="rookie-potential">{result.potential}</span></div><div className="text-[8px] text-ink-400">位置加权 <span className={`font-semibold tabular-nums ${valueColor(result.baseOverall)}`} data-testid="rookie-base-overall">{result.baseOverall}</span> · 无形属性 <span className={`font-semibold tabular-nums ${valueColor(result.intangibles)}`}>{result.intangibles}</span></div></div>
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
                  <div className="flex items-center justify-between gap-3 text-[10px]"><span className="font-semibold text-ink-700">巅峰属性</span><span className="text-right text-ink-500">锁定值经体型与位置算法计算后直接生成</span></div>
                </div>
              ) : (
                <div className="border-b border-ink-200 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between text-[10px]"><span className="font-semibold text-ink-700">成长轨迹</span><span className="font-mono text-court-700">巅峰 {result.minPotential}–{result.maxPotential}</span></div>
                  <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 border-y border-ink-100 py-1.5 text-[9px]">
                    <div className="flex justify-between gap-2"><span className="text-ink-400">即战力</span><strong className="tabular-nums text-ink-700">{result.readiness}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">新秀区间</span><strong className="tabular-nums text-ink-700">{result.projectedInitialRange.min}–{result.projectedInitialRange.max}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">巅峰年龄</span><strong className="tabular-nums text-ink-700">{result.peakStart}–{result.peakEnd}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">进步速度</span><strong className="tabular-nums text-ink-700">+{result.progressSpeed}/年</strong></div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center text-[9px]"><div className="rounded-[5px] border border-emerald-200 bg-emerald-50 py-1.5 text-emerald-700"><strong className="block text-[12px]">{result.boom}%</strong>成长</div><div className="rounded-[5px] border border-blue-200 bg-blue-50 py-1.5 text-blue-700"><strong className="block text-[12px]">{result.normal}%</strong>平均</div><div className="rounded-[5px] border border-rose-200 bg-rose-50 py-1.5 text-rose-700"><strong className="block text-[12px]">{result.bust}%</strong>衰退</div></div>
                </div>
              )}
              <div className="border-b border-ink-200 px-3 py-2.5">
                <div className="mb-1.5 flex justify-between text-[10px]"><span className="font-semibold">{isPrime ? "巅峰徽章" : "当前徽章"}</span><span className="text-ink-400">{result.badges.length}</span></div>
                <div className="flex max-h-[58px] flex-wrap gap-1 overflow-hidden">{result.badges.length ? result.badges.slice(0, 7).map((badge) => <span key={`${badge.name}:${badge.tier}`} className="border border-amber-500/20 bg-amber-50 px-1 py-0.5 text-[8px] text-amber-800">{getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier]}</span>) : <span className="text-[9px] text-ink-400">无</span>}</div>
              </div>
              <div className="border-b border-ink-200 px-3 py-2.5">
                <div className="mb-1.5 text-[10px] font-semibold">热区</div>
                <div className="grid grid-cols-3 gap-1 text-center text-[9px]"><div className="bg-blue-50 py-1.5 text-blue-700">冷 <span data-testid="cold-zone-count">{zoneCounts.冷区}</span></div><div className="bg-ink-50 py-1.5 text-ink-600">中 <span data-testid="neutral-zone-count">{zoneCounts.中性}</span></div><div className="bg-rose-50 py-1.5 text-rose-700">热 <span data-testid="hot-zone-count">{zoneCounts.热区}</span></div></div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <Unlock className="h-7 w-7 text-ink-300" />
              <div className="mt-3 text-[15px] font-semibold text-ink-600">待生成</div>
              <div className="mt-1 max-w-full truncate text-[12px] font-semibold text-ink-700">{rookieName}</div>
              <div className="mt-1 text-[10px] leading-5 text-ink-400">已锁定 {completed}/{bundles.length} 项属性</div>
              <div className="mt-3 h-1 w-full max-w-[150px] overflow-hidden rounded-sm bg-ink-200"><div className="h-full bg-court-600" style={{ width: `${(completed / bundles.length) * 100}%` }} /></div>
              <div className="mt-3 text-[11px] font-medium text-court-700">{position}/{secondaryPosition} · {effectiveAge}岁</div>
              <div className="mt-1 text-[9px] text-ink-400">{body.height} cm · {body.weight} kg · 臂展 {body.wingspan}</div>
            </div>
          )}
          <div className="flex gap-1.5 px-3 py-2.5">
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!isComplete} onClick={copyResult} type="button"><Copy className="h-3 w-3" />复制</button>
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!isComplete} onClick={downloadResult} type="button"><Download className="h-3 w-3" />导出</button>
          </div>
        </aside>
        {isComplete && (
        <section
          className="builder-pane builder-full-preview panel-surface overflow-hidden"
          data-mobile-active={mobilePane === "result"}
          data-testid="full-attribute-preview"
        >
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
            <div className="section-label">完整属性预览</div>
            <div className="text-[10px] text-ink-400">{fullAttributeGroups.reduce((total, group) => total + group.attrs.length, 0)} 项</div>
          </div>
          <div className="attribute-preview-grid bg-ink-200">
            {fullAttributeGroups.map((group) => (
              <div key={group.key} className="attribute-preview-group bg-white px-3 py-2.5">
                <div className="mb-2 text-[10px] font-semibold text-court-700">{group.label}</div>
                <div className={group.key === "durability" ? "grid gap-x-5 sm:grid-cols-2" : ""}>
                  {group.attrs.map((attr) => {
                    const value = result.initialAttrs[attr];
                    const hasPositionPenalty = penalizedAttributes.has(attr);
                    return (
                      <div key={attr} className="flex min-h-6 items-center justify-between gap-3 border-t border-ink-700/5 py-1 text-[10px]">
                        <span className="min-w-0 text-ink-500">{attrNameCN[attr] ?? attr}</span>
                        <span className="flex shrink-0 items-center gap-0.5" title={hasPositionPenalty ? "该属性包含来源位置或非常规次要位置衰减" : undefined}>
                          {hasPositionPenalty && <ArrowDown aria-hidden="true" className="h-3 w-3 stroke-[2.5] text-rose-600" />}
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
      {customizingBundle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
          <section aria-label={`自定义${customizingBundle.label}`} aria-modal="true" className="w-full max-w-[430px] overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl" ref={customDialogRef} role="dialog">
            <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
              <div className="section-label">自定义{customizingBundle.label}</div>
              <button aria-label="关闭自定义编辑器" className="flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-500 hover:bg-ink-200 hover:text-ink-800" onClick={() => setCustomizingBundleId(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
              {customizingBundle.attrs.map((attr) => (
                <label key={attr} className="min-w-0">
                  <span className="mb-1 block truncate text-[9px] font-semibold text-ink-500" title={attrNameCN[attr] ?? attr}>{attrNameCN[attr] ?? attr}</span>
                  <input
                    aria-label={`自定义${attrNameCN[attr] ?? attr}`}
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
                <button className="action-button primary-action px-3 py-1.5 text-[10px]" disabled={!customDraftIsValid} onClick={confirmCustomLock} type="button"><Check className="h-3.5 w-3.5" />确认自定义</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default RookieBuilder;
