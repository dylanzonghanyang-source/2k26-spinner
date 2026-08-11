/**
 * Pure domain layer for the 16-slot builder result pipeline.
 *
 * Everything needed to turn slot locks + body + age into a final PlayerDraft-like
 * result lives here, free of React. RookieBuilder.tsx imports from this module,
 * and scripts/test-create-result.mts exercises the real production path with
 * real roster/rookie-card data.
 */
import { badgeTierRank, type BadgeTier } from "./badgeTiers.ts";
import type { PlayerSource } from "./domain.ts";
import {
  buildBadgesByBundle,
  downgradeBadgesForRookie,
  getBadgeCategory,
  mappedBundleIds,
  normalizeBadgeName,
  uniqueBadges,
  type PlayerBadgeLike,
  type RookieBadgeTier,
} from "./badges.ts";
import { collectTendenciesByBundle, type TendencyLookup } from "./tendencies.ts";
import { lookupRookieCard, type RookieCard, type RookieCardLookup } from "./rookieCards.ts";
import { tendencyBundleMap } from "./components/tendencyBundleMap.ts";
import { badgeBundleMap } from "./components/badgeBundleMap.ts";
import { estimateGameOverall, type OverallDataVersion } from "./rookieOverall.ts";
import { generateDurabilityAttributes, generateRookieDurability } from "./rookieDurability.ts";
import { constrainRookieInitialAttributes } from "./rookieInitialOverall.ts";
import { applyBodyConstraints, parsePlayerBody, effectivePositionDistance, parsePositionRoles, type BuilderBody, type SourceBody } from "./rookieBodyConstraints.ts";
import { attrToSlot, bodyTransferProfiles, profileFor } from "./rookieBodyProfiles.ts";

export type Position = "PG" | "SG" | "SF" | "PF" | "C";
export type BundleCategory = "technical" | "physical" | "mental";

export type Bundle = {
  id: string;
  label: string;
  attrs: string[];
  category: BundleCategory;
  color: string;
};
export type PlayerLock = { kind: "player"; playerId: string };
export type CustomLock = { kind: "custom"; values: Record<string, number> };
export type LockState = Record<string, PlayerLock | CustomLock>;
export type BundleLock = PlayerLock | CustomLock;

/**
 * Apply one bundle lock to the current lock state (pure).
 *
 * Returns the SAME reference when the bundle is already locked (no-op), so
 * callers can detect idempotency with `next === current`. Different bundles
 * always compose — this is the race-safe primitive behind the UI's rapid
 * click locking: every commit expands from the latest committed state, never
 * from a stale render closure.
 */
export function applyBundleLock(
  current: LockState,
  bundleId: string,
  lock: BundleLock,
): LockState {
  if (current[bundleId]) return current;
  return { ...current, [bundleId]: lock };
}

export type Evaluation = {
  raw: number;
  adjusted: number;
  bodyAdjustment: number;
  bodyAdjustments: Record<string, number>;
  bodyCaps: Partial<Record<string, number>>;
  supportAdjustments?: Record<string, number>;
  /** 来源无身体数据（仅应用目标 cap，未执行来源体型比较/位置交叉） */
  bodyIncomplete?: boolean;
  /** 支持依赖缺失真实值（未执行支持修正） */
  supportIncomplete?: { attr: string; missing: string[] };
  values: Record<string, number>;
  /** 主/次位置到来源的有效距离（null = 来源位置不可解析） */
  positionDistance?: number | null;
  /** 命中位置宽容区（原值继承） */
  usedGraceZone?: boolean;
};

export const positions: Position[] = ["PG", "SG", "SF", "PF", "C"];
export const ages = [18, 19, 20, 21, 22, 23];
export const secondaryPositionShare = 0.25;

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

export const bodyBases: Record<Position, BuilderBody> = {
  PG: { height: 185, weight: 82, wingspan: 46, shoulder: 46, neck: 50, torso: 48 },
  SG: { height: 193, weight: 90, wingspan: 49, shoulder: 49, neck: 50, torso: 50 },
  SF: { height: 201, weight: 98, wingspan: 53, shoulder: 53, neck: 51, torso: 52 },
  PF: { height: 206, weight: 108, wingspan: 57, shoulder: 58, neck: 52, torso: 55 },
  C: { height: 211, weight: 116, wingspan: 61, shoulder: 62, neck: 53, torso: 58 },
};

export function clamp(value: number, min = 25, max = 99) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function average(values: number[], fallback = 65) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

export function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fallback(player: PlayerSource, attr: string) {
  if (["Three-Point Shot", "Mid-Range Shot", "Free Throw", "Offensive Consistency", "Shot IQ"].includes(attr)) return player.shooting ?? player.overall ?? 68;
  if (["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass IQ", "Pass Vision"].includes(attr)) return player.playmaking ?? player.overall ?? 66;
  if (["Perimeter Defense", "Interior Defense", "Steal", "Pass Perception", "Block", "Defensive Rebound", "Defensive Consistency", "Help Defense IQ"].includes(attr)) return player.defense ?? player.overall ?? 65;
  if (["Speed", "Agility", "Vertical", "Strength", "Stamina", "Hustle", "Overall Durability"].includes(attr)) return player.athleticism ?? player.overall ?? 68;
  return player.inside ?? player.overall ?? 64;
}

const attrAliases: Record<string, string[]> = {
  Layup: ["Layup", "Driving Layup"],
  "Ball Handle": ["Ball Handle", "Ball Control"],
  Agility: ["Agility", "Lateral Quickness", "Acceleration"],
  "Overall Durability": ["Overall Durability", "Durability"],
};

function getAttr(player: PlayerSource, attr: string) {
  if (attr === "Potential") return clamp(player.potential ?? player.overall ?? 75);
  for (const name of attrAliases[attr] ?? [attr]) {
    const value = player.detailed?.[name];
    if (typeof value === "number") return clamp(value);
  }
  return clamp(fallback(player, attr));
}

/** 严格 accessor：只返回真实观测值，不做 category fallback（支持依赖专用）。 */
function getObservedAttr(player: PlayerSource, attr: string): number | undefined {
  if (attr === "Potential") return player.potential ?? undefined;
  for (const name of attrAliases[attr] ?? [attr]) {
    const value = player.detailed?.[name];
    if (typeof value === "number") return value;
  }
  return undefined;
}

/** 从 rookie card vitals 构造来源身体（英寸/磅/cm），无数据时返回 null。 */
export function cardSourceBody(card: RookieCard | null | undefined): SourceBody | null {
  const heightInches = card?.vitals?.heightInches;
  const weightLb = card?.vitals?.weightLb;
  if (typeof heightInches !== "number" || typeof weightLb !== "number") return null;
  const height = heightInches * 2.54;
  const wingspanCm = typeof card?.vitals?.wingspanCm === "number" ? card.vitals.wingspanCm : null;
  return {
    height,
    weight: weightLb * 0.453592,
    wingspan: wingspanCm ?? height + 10,
  };
}

export type EvaluateOptions = {
  targetPosition?: Position | null;
  secondaryPosition?: Position | null;
  /** 关闭降级算法：跳过身体约束与位置交叉（自选模式开关） */
  skipBody?: boolean;
};

export function evaluate(
  player: PlayerSource,
  bundle: Bundle,
  body: BuilderBody,
  card?: RookieCard | null,
  options?: EvaluateOptions,
  cardBody?: SourceBody | null,
): Evaluation {
  // In rookie mode a locked player with a real rookie card shows that card's
  // values directly (e.g. Luka mid-range shows 79, not his current 97). The
  // card is the display source; body constraints still apply on top.
  const rawValues = Object.fromEntries(bundle.attrs.map((attr) => [
    attr,
    attr === "Potential"
      ? (card?.potential?.current != null ? clamp(card.potential.current) : getAttr(player, attr))
      : (card?.detailed?.[attr] != null ? clamp(card.detailed[attr]) : getAttr(player, attr)),
  ]));
  // 来源身体优先取 rookie card 自带数据（新秀时体型），其次当前球员。
  const sourceBody = cardBody ?? parsePlayerBody(player);
  const constrained = applyBodyConstraints(rawValues, body, sourceBody, {
    targetPosition: options?.targetPosition ?? null,
    secondaryPosition: options?.secondaryPosition ?? null,
    sourcePosition: player.position,
    skipBody: options?.skipBody,
  });
  const positionDistance = options?.targetPosition != null
    ? effectivePositionDistance(
      options.targetPosition,
      options.secondaryPosition ?? null,
      parsePositionRoles(player.position),
    )
    : null;
  const raw = Math.round(average(Object.values(rawValues)));
  const adjusted = Math.round(average(Object.values(constrained.values)));
  return {
    raw,
    adjusted,
    bodyAdjustment: adjusted - raw,
    bodyAdjustments: constrained.adjustments,
    bodyCaps: constrained.caps,
    values: constrained.values,
    positionDistance,
    usedGraceZone: constrained.usedGraceZone,
    bodyIncomplete: sourceBody === null,
  };
}

export function evaluateCustom(bundle: Bundle, customValues: Record<string, number>, body: BuilderBody, options?: EvaluateOptions): Evaluation {
  const rawValues = Object.fromEntries(bundle.attrs.map((attr) => [attr, clamp(customValues[attr] ?? 75)]));
  const constrained = applyBodyConstraints(rawValues, body, null, { skipBody: options?.skipBody });
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

// --- 两阶段批量评估（槽位身体修正 + 跨槽位支持依赖） ---

const SUPPORT_MAX_CUT = 8;
const SUPPORT_MIN_KEEP = 0.65;
/** 支持属性每 20 点差值折算 1 单位支持缺口 */
const SUPPORT_GAP_REFERENCE = 20;

export type SlotInput = {
  bundle: Bundle;
  player: PlayerSource | null;
  card?: RookieCard | null;
  customValues?: Record<string, number>;
};

function supportDeficitFor(
  player: PlayerSource,
  card: RookieCard | null | undefined,
  attr: string,
  bundleId: string,
  targetSupport: Record<string, number>,
): { deficit: number; missing: string[] } {
  const slotProfile = bodyTransferProfiles[bundleId];
  if (!slotProfile) return { deficit: 0, missing: [] };
  const attrProfile = profileFor(slotProfile, attr);
  const support = attrProfile.support ?? slotProfile.support;
  if (!support?.length) return { deficit: 0, missing: [] };
  let deficit = 0;
  const missing: string[] = [];
  for (const dep of support) {
    // 支持属性与槽位 raw 值使用同一来源：优先 rookie card，其次当前球员。
    // 只认真实观测值；缺失时跳过该依赖（不猜聚合值），并上报 missing。
    const sourceValue = card?.detailed?.[dep.attr] ?? getObservedAttr(player, dep.attr);
    const targetValue = targetSupport[dep.attr];
    if (typeof sourceValue !== "number" || typeof targetValue !== "number") {
      if (typeof sourceValue !== "number") missing.push(dep.attr);
      continue;
    }
    deficit += dep.weight * Math.max(0, sourceValue - targetValue) / SUPPORT_GAP_REFERENCE;
  }
  return { deficit, missing };
}

/**
 * 两阶段评估：
 * 1. 每个锁定槽位独立身体评估（有符号差值 + 位置交叉 + 目标 cap）；
 * 2. 读取目标已调整的根属性（athletic/strength），对依赖槽位应用软支持修正。
 * 预览与最终 createResult 共用此函数，保证结果一致。
 */
export function evaluateAll(
  inputs: SlotInput[],
  body: BuilderBody,
  options?: EvaluateOptions,
): Record<string, Evaluation> {
  const evaluations: Record<string, Evaluation> = {};
  for (const input of inputs) {
    if (input.customValues) {
      evaluations[input.bundle.id] = evaluateCustom(input.bundle, input.customValues, body, options);
      continue;
    }
    if (!input.player) continue;
    evaluations[input.bundle.id] = evaluate(
      input.player,
      input.bundle,
      body,
      input.card,
      options,
      cardSourceBody(input.card),
    );
  }

  // 目标支持值：第一阶段后 athletic/strength 槽位的最终值
  const targetSupport: Record<string, number> = {};
  for (const [attr, slot] of Object.entries(attrToSlot)) {
    const evaluation = evaluations[slot];
    if (evaluation && typeof evaluation.values[attr] === "number") {
      targetSupport[attr] = evaluation.values[attr];
    }
  }

  // 第二阶段：支持依赖软修正
  for (const input of inputs) {
    if (!input.player) continue;
    const evaluation = evaluations[input.bundle.id];
    if (!evaluation) continue;
    const deltas: Record<string, number> = {};
    const incompleteAttrs: string[] = [];
    for (const attr of input.bundle.attrs) {
      const { deficit, missing } = supportDeficitFor(input.player, input.card, attr, input.bundle.id, targetSupport);
      if (missing.length) incompleteAttrs.push(attr);
      if (deficit <= 0) continue;
      const cut = Math.min(deficit, SUPPORT_MAX_CUT);
      const current = evaluation.values[attr] ?? 0;
      const floor = Math.round(current * SUPPORT_MIN_KEEP);
      const next = Math.max(current - cut, floor);
      if (next !== current) deltas[attr] = next - current;
    }
    if (incompleteAttrs.length) {
      const player = input.player;
      const missing = incompleteAttrs.flatMap((attr) =>
        supportDeficitFor(player, input.card, attr, input.bundle.id, targetSupport).missing);
      evaluation.supportIncomplete = { attr: incompleteAttrs.join(","), missing: [...new Set(missing)] };
    }
    if (Object.keys(deltas).length === 0) continue;
    const nextValues = { ...evaluation.values };
    for (const [attr, delta] of Object.entries(deltas)) {
      // clamp 内部四舍五入：supportAdjustments 记录取整后的实际差值，
      // 保证诊断值与最终 values 完全一致。
      nextValues[attr] = clamp((nextValues[attr] ?? 0) + delta);
    }
    evaluation.supportAdjustments = Object.fromEntries(
      Object.entries(deltas).map(([attr]) => [attr, nextValues[attr] - (evaluation.values[attr] ?? 0)]),
    );
    evaluation.values = nextValues;
    evaluation.adjusted = Math.round(average(input.bundle.attrs.map((attr) => nextValues[attr])));
  }

  return evaluations;
}

/**
 * 候选预览：在"当前已锁定槽位 + 候选球员替换一个未锁定槽位"的假设下
 * 评估该槽位，与最终锁定结果走完全相同的两阶段路径。
 */
export function evaluateAllPreview(
  currentInputs: SlotInput[],
  candidate: SlotInput,
  body: BuilderBody,
  options?: EvaluateOptions,
): Evaluation | undefined {
  const inputs = [
    ...currentInputs.filter((input) => input.bundle.id !== candidate.bundle.id),
    candidate,
  ];
  return evaluateAll(inputs, body, options)[candidate.bundle.id];
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

export type HotZoneState = "冷区" | "中性" | "热区";

function createHotZones(
  attrs: Record<string, number>,
  position: Position,
  secondary: Position | null,
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

export type BuilderResult = ReturnType<typeof createResult>;

export function createResult(
  locks: LockState,
  age: number,
  position: Position,
  secondary: Position | null,
  body: BuilderBody,
  players: Map<string, PlayerSource>,
  tendencyLookup: TendencyLookup | null,
  overallVersion: OverallDataVersion,
  rookieCards: RookieCardLookup | null,
  constraintOptions?: { skipBody?: boolean },
) {
  const skipBody = constraintOptions?.skipBody === true;
  // Peak attributes must reflect the source player's real (non-card) values:
  // the displayed slot evaluations may already be rookie-card values in rookie
  // mode, so rebuild the peak evaluation here without any card override.
  let peakAttrs: Record<string, number> = {};
  let initialAttrs: Record<string, number> = {};
  const scores: number[] = [];
  // 两阶段批量评估：先各槽位身体修正（真实非卡值），再统一支持依赖修正。
  const slotInputs: SlotInput[] = [];
  for (const bundle of bundles) {
    const lock = locks[bundle.id];
    if (lock?.kind === "custom") {
      slotInputs.push({ bundle, player: null, customValues: lock.values });
    } else if (lock?.kind === "player") {
      const player = players.get(lock.playerId);
      if (player) slotInputs.push({ bundle, player, card: null });
    }
  }
  const evaluations = evaluateAll(slotInputs, body, {
    targetPosition: position,
    secondaryPosition: secondary,
    skipBody,
  });
  for (const bundle of bundles) {
    const evaluation = evaluations[bundle.id];
    if (!evaluation) continue;
    Object.assign(peakAttrs, evaluation.values);
    if (bundle.id !== "potential") scores.push(evaluation.adjusted);
  }

  // Rookie card sources: a slot whose locked player has a real rookie card
  // inherits that card's attributes/badges/tendencies verbatim (no age-curve
  // downgrade, no badge downgrade). Slots without a card keep the existing
  // peak inheritance path.
  const useRookieCards = true;
  const cardByBundle = new Map<string, RookieCard | null>();
  for (const bundle of bundles) {
    const lock = locks[bundle.id];
    const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
    const card = useRookieCards && player ? lookupRookieCard(rookieCards, player.name) : null;
    cardByBundle.set(bundle.id, card);
  }
  const hasRookieCard = [...cardByBundle.values()].some((card) => card !== null);

  // Tendency inheritance: each slot reads only its mapped fields from the
  // compact lookup. Values are inherited verbatim, without rookie down-scaling.
  // Slots with a real rookie card prefer the card's game-exported tendencies;
  // other slots fall back to the ATD lookup.
  const tendencies = tendencyLookup || hasRookieCard
    ? collectTendenciesByBundle({
      sources: bundles.filter((bundle) => bundle.id !== "potential").map((bundle) => {
        const lock = locks[bundle.id];
        const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
        return { bundleId: bundle.id, playerSlug: player?.slug };
      }),
      fieldToBundle: tendencyBundleMap,
      lookup: tendencyLookup,
      cardForPlayer: (playerSlug) => {
        const player = [...players.values()].find((p) => p.slug === playerSlug);
        return player ? lookupRookieCard(rookieCards, player.name) : null;
      },
    })
    : {};

  const rawCustomFinalAttrs = Object.assign({}, ...Object.values(locks)
    .filter((lock): lock is CustomLock => lock.kind === "custom")
    .map((lock) => lock.values));
  const customFinalAttrs = applyBodyConstraints(rawCustomFinalAttrs, body, null, { skipBody }).values;
  Object.assign(peakAttrs, customFinalAttrs);
  peakAttrs = applyBodyConstraints(peakAttrs, body, null, { skipBody }).values;
  const badgeSources = bundles.filter((bundle) => bundle.id !== "potential" && !cardByBundle.get(bundle.id)).map((bundle) => {
    const lock = locks[bundle.id];
    return {
      bundleId: bundle.id,
      playerId: lock?.kind === "player" ? lock.playerId : undefined,
    };
  });
  // Real rookie-card badges for slots whose locked player has a card. These are
  // inherited verbatim (the card already carries rookie-tier levels) and never
  // pass through downgradeBadgesForRookie. Names are normalized and categories
  // filled so the joint OVR model can price them.
  const cardBadges: PlayerBadgeLike[] = [];
  for (const [bundleId, card] of cardByBundle) {
    if (!card) continue;
    for (const badge of card.badges) {
      const name = normalizeBadgeName(badge.name);
      const mapped = mappedBundleIds(badgeBundleMap, name);
      if (mapped.includes(bundleId) && badgeTierRank[badge.tier as BadgeTier] !== undefined) {
        cardBadges.push({ name, category: getBadgeCategory(name), tier: badge.tier as BadgeTier });
      }
    }
  }
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
  // Rookie-mode initial OVR uses the rookie-card-trained model.
  const initialOverallVersion: OverallDataVersion = "rookie";
  // Potential slot: a real rookie card wins over both the peak evaluation and
  // the cross-version OVR fallback. The card also carries the official min/max
  // potential range; without a card we fall back to a symmetric ±5 band around
  // the resolved potential.
  const potentialCard = cardByBundle.get("potential") ?? null;
  const potential = clamp(
    potentialCard?.potential?.current
      ?? (typeof peakAttrs.Potential === "number" ? peakAttrs.Potential : Math.round(sourcePeakOverall)),
    40,
    99,
  );
  const potentialMin = clamp(potentialCard?.potential?.min ?? potential - 5, 40, 99);
  const potentialMax = clamp(potentialCard?.potential?.max ?? potential + 5, 40, 99);
  const rookieTier = rookieTierForPotential(potential);

  // Rookie-mode initial attributes: card slots go through the same two-phase
  // body-constraint path as the UI preview (card-aware), so the final card
  // values match what the user saw when locking. Non-card slots keep the peak
  // evaluation with the rookie age-curve downgrade.
  const cardConstrainedValues: Record<string, number> = {};
  const cardLockedValues: Record<string, number> = {};
  const cardInputs: SlotInput[] = [];
  for (const bundle of bundles) {
    const lock = locks[bundle.id];
    if (lock?.kind === "custom") {
      cardInputs.push({ bundle, player: null, customValues: lock.values });
      continue;
    }
    const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
    if (player) cardInputs.push({ bundle, player, card: cardByBundle.get(bundle.id) ?? null });
  }
  const cardEvaluations = evaluateAll(cardInputs, body, { targetPosition: position, secondaryPosition: secondary, skipBody });
  peakBadgeResolution = resolvePeakBadges(peakAttrs);
  peakBadges = peakBadgeResolution.badges;
  for (const bundle of bundles) {
    const card = cardByBundle.get(bundle.id);
    const evaluation = cardEvaluations[bundle.id];
    for (const attr of bundle.attrs) {
      const cardValue = card?.detailed[attr];
      if (typeof cardValue === "number") {
        // Card raw value with the full body constraint path (same as preview).
        const constrained = evaluation?.values[attr];
        initialAttrs[attr] = clamp(constrained ?? cardValue, 25, 99);
        cardConstrainedValues[attr] = initialAttrs[attr];
        continue;
      }
      const value = peakAttrs[attr];
      if (typeof value === "number") initialAttrs[attr] = rookieValue(value, age, bundle.category);
    }
  }
  // Card attributes are locked (real game data) — the OVR constraint must not
  // lower them, only the non-card slots remain adjustable. The lock values are
  // the body-constrained card values (what the user actually sees).
  for (const bundle of bundles) {
    const card = cardByBundle.get(bundle.id);
    if (!card) continue;
    for (const attr of bundle.attrs) {
      const constrained = cardConstrainedValues[attr];
      if (constrained != null) cardLockedValues[attr] = constrained;
      else if (typeof card.detailed[attr] === "number") cardLockedValues[attr] = card.detailed[attr];
    }
  }

  // Merge: card badges verbatim + downgraded non-card badges.
  const badges = uniqueBadges([...downgradeBadgesForRookie(peakBadges, rookieTier), ...cardBadges]);
  Object.assign(initialAttrs, customFinalAttrs);
  initialAttrs = applyBodyConstraints(initialAttrs, body, null, { skipBody }).values;
  // 恢复卡槽位的完整身体约束结果（含来源容量豁免），避免被上面 source=null
  // 的目标 cap 二次压低；非卡槽位保持目标 cap 校验。
  for (const [attr, value] of Object.entries(cardConstrainedValues)) {
    initialAttrs[attr] = value;
  }
  const sourceDurability = peakAttrs["Overall Durability"] ?? 80;
  const bodyBase = bodyBases[position];
  const bodyStress = Math.max(0, (body.weight - bodyBase.weight) / 15) + Math.max(0, (body.height - bodyBase.height) / 12);
  // Durability is calibrated separately from the generic rookie age curve.
  // Applying the mental curve first turns a source mean of ~80 into the high 60s.
  // A manually locked Overall Durability is a hard lock: it becomes the fixed
  // mean and the 15 body parts are generated around it, never overwritten.
  const manualOverallDurability = customFinalAttrs["Overall Durability"];
  const durabilityValues = manualOverallDurability != null
    ? generateDurabilityAttributes(manualOverallDurability, random)
    : generateRookieDurability(sourceDurability, bodyStress, random);
  Object.assign(initialAttrs, durabilityValues);
  const durability = durabilityValues["Overall Durability"] ?? 82;
  const rookieOverallConstraint = constrainRookieInitialAttributes({
    values: initialAttrs,
    potential,
    age,
    adjustableAttributes: bundles
      .filter((bundle) => bundle.id !== "potential")
      .flatMap((bundle) => bundle.attrs),
    lockedValues: { ...customFinalAttrs, ...cardLockedValues },
    badges,
    estimateOverall: (values, candidateBadges) => calibratedOverall(
      values,
      position,
      candidateBadges,
      mean,
      initialOverallVersion,
    ),
  });
  if (rookieOverallConstraint) Object.assign(initialAttrs, rookieOverallConstraint.values);
  // Build card identity: when EVERY non-potential slot is locked to the same
  // rookie card, keep that card as the result's source record. OVR still follows
  // the generated final attributes after body/position constraints; otherwise a
  // changed target body can show an official card OVR that no longer matches the
  // visible attributes.
  const nonPotentialCards = bundles
    .filter((bundle) => bundle.id !== "potential")
    .map((bundle) => cardByBundle.get(bundle.id) ?? null);
  const firstCard = nonPotentialCards[0] ?? null;
  const singleCard = firstCard !== null && nonPotentialCards.every(
    (card) => card !== null && card.slug === firstCard.slug,
  )
    ? firstCard
    : null;
  const baseOverall = calibratedOverall(initialAttrs, position, badges, mean, initialOverallVersion);
  const initialStrength = baseOverall;
  // 综评补偿 (Intangibles): 优先继承潜力来源卡的真实值，其次同卡构建的卡值，最后默认 50。
  const intangibles = potentialCard?.detailed?.["Intangibles"]
    ?? singleCard?.detailed?.["Intangibles"]
    ?? 50;
  // 惯用手: 继承运动槽来源卡的真实值；扣篮惯用手: 继承扣篮槽来源卡的真实值。
  // vitals 存 "Left"/"Right"，无卡或值无效时回退原有随机逻辑。
  const handFromVital = cardByBundle.get("athletic")?.vitals?.dominantHand;
  const dunkHandFromVital = cardByBundle.get("dunk")?.vitals?.dominantDunkHand;
  const hand: "左手" | "右手" = handFromVital === "Left" || handFromVital === "Right"
    ? handFromVital === "Left" ? "左手" : "右手"
    : random() < 0.11 ? "左手" : "右手";
  const dunkHand: "左手" | "右手" = dunkHandFromVital === "Left" || dunkHandFromVital === "Right"
    ? dunkHandFromVital === "Left" ? "左手" : "右手"
    : random() < 0.8 ? hand : hand === "左手" ? "右手" : "左手";
  const growthGap = Math.max(0, potential - initialStrength);
  // Career/peak fields: inherit the potential slot's rookie-card vitals when
  // available (real game data: 巅峰开始/结束年龄, 成长/平均/衰退百分比).
  // Without a card (or when the card carries no value) fall back to the
  // deterministic formulas. 成长速度 is not a sheet field, so it is derived
  // from the inherited peak start so the trajectory stays consistent.
  const vitalNumber = (key: string): number | null => {
    const value = potentialCard?.vitals?.[key];
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const vitalPeakStart = vitalNumber("peakStartAge");
  const vitalPeakEnd = vitalNumber("peakEndAge");
  const vitalBoom = vitalNumber("boomPercent");
  const vitalBust = vitalNumber("bustPercent");
  const vitalAverage = vitalNumber("averagePercent");
  const hasVitalProbabilities = vitalBoom !== null && vitalBust !== null && vitalAverage !== null;
  const progressSpeed = Math.round(Math.max(2.2, Math.min(5.4, 2.4 + Math.max(0, (potential - 87) / 10) + (random() - 0.5) * 0.6)) * 10) / 10;
  const yearsToPeak = progressSpeed === 0 ? 0 : Math.ceil(growthGap / progressSpeed);
  const peakStart = vitalPeakStart !== null && vitalPeakStart >= age
    ? vitalPeakStart
    : clamp(Math.max(24, age + yearsToPeak), age, 30);
  const peakDuration = Math.max(5, Math.min(11, 7 + (durability - 70) / 15 + random() * 1.5));
  const peakEnd = vitalPeakEnd !== null && vitalPeakEnd >= peakStart
    ? vitalPeakEnd
    : clamp(peakStart + peakDuration, peakStart, 40);
  const boom = hasVitalProbabilities
    ? vitalBoom
    : clamp(28 + potential - 84 - (age - 18) * 2 + (random() - 0.5) * 8, 10, 55);
  const bust = hasVitalProbabilities
    ? vitalBust
    : clamp(18 - (age - 18) + (random() - 0.5) * 8, 8, 40);
  const normal = hasVitalProbabilities
    ? vitalAverage
    : 100 - boom - bust;
  initialAttrs.Intangibles = intangibles;
  initialAttrs.Potential = potential;
  const hotZones = createHotZones(initialAttrs, position, secondary, hand, random);
  return {
    age, position, secondary,
    hand, dunkHand, ...body,
    potential, growthGap, progressSpeed, boom, normal, bust, peakStart, peakEnd,
    peakOverall: sourcePeakOverall,
    peakAttrs, initialAttrs, initialStrength, baseOverall, intangibles, peakBadges, badges,
    potentialMin, potentialMax,
    card: singleCard,
    initialOverallTarget: rookieOverallConstraint?.targetOverall ?? initialStrength,
    initialOverallConstraintApplied: rookieOverallConstraint?.changed ?? false,
    initialOverallConstraintReachable: rookieOverallConstraint?.reachable ?? true,
    badgesEstimated: peakBadgeResolution.estimated, rookieTier, hotZones,
    tendencies,
  };
}
