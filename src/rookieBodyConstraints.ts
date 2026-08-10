import {
  profileForAttribute,
  type AxisPreference,
  type BodyTransferProfile,
} from "./rookieBodyProfiles.ts";

export type BuilderBody = {
  height: number;
  weight: number;
  wingspan: number;
  shoulder: number;
  neck: number;
  torso: number;
};

export type SourceBody = {
  height: number;
  weight: number;
  wingspan: number;
};

export type BodyConstraintResult = {
  values: Record<string, number>;
  adjustments: Record<string, number>;
  caps: Partial<Record<string, number>>;
  /** 任一属性命中位置宽容区（原值继承） */
  usedGraceZone: boolean;
};

type PlayerBodyInput = {
  height?: string | number | null;
  weight?: string | number | null;
  wingspan?: string | number | null;
};

const MIN_RATING = 25;
const MAX_RATING = 99;
const DEFAULT_WINGSPAN_ADVANTAGE_CM = 10;
// 身材结构惩罚总系数：原 2 再翻倍（用户需求：身高体重影响 ×2）
const BODY_MISMATCH_PENALTY_SCALE = 4;
// 位置交叉放大：原 0.67 × 4（用户需求：位置影响 ×4），且 bodyPressure 不设上限
const POSITION_CROSS_SCALE = 2.68;
const HEIGHT_GAP_REFERENCE_CM = 40;
const WEIGHT_GAP_REFERENCE_KG = 35;
const SECONDARY_BODY_DISTANCE_WEIGHT = 0.25;

// 宽容区（同位置 / 相邻位置）的身高、体重阈值
const GRACE_ZONE_SAME = { height: 12, weight: 18 };
const GRACE_ZONE_ADJACENT = { height: 10, weight: 15 };

export type PositionCode = "C" | "PF" | "SF" | "SG" | "PG";

export const positionAxis: Record<PositionCode, number> = {
  C: 0,
  PF: 1,
  SF: 2,
  SG: 3,
  PG: 4,
};

export type BodyConstraintOptions = {
  /** 目标主位置 */
  targetPosition?: PositionCode | null;
  /** 目标次要位置 */
  secondaryPosition?: PositionCode | null;
  /** 来源球员位置字符串（可含 C/PF 等双位置，null/unknown 时不启用位置交叉） */
  sourcePosition?: string | null;
  /** 关闭降级算法：跳过身体约束与位置交叉，原值继承（仅 clamp 到 25-99） */
  skipBody?: boolean;
};

function clampRating(value: number, min = MIN_RATING, max = MAX_RATING) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseFeetInches(value: string | number | null | undefined) {
  if (typeof value === "number") return value > 100 ? value : value * 2.54;
  const match = String(value ?? "").match(/(\d+)[^\d]+(\d+)/);
  if (!match) return null;
  return (Number(match[1]) * 12 + Number(match[2])) * 2.54;
}

function parseSourceWeight(value: string | number | null | undefined) {
  if (typeof value === "number") return value * 0.453592;
  const source = String(value ?? "").trim().toLowerCase();
  const parsed = Number.parseFloat(source.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return source.includes("kg") ? parsed : parsed * 0.453592;
}

export function parsePlayerBody(player: PlayerBodyInput): SourceBody | null {
  const height = parseFeetInches(player.height);
  const weight = parseSourceWeight(player.weight);
  const wingspan = parseFeetInches(player.wingspan) ?? (height == null ? null : height + DEFAULT_WINGSPAN_ADVANTAGE_CM);
  if (height == null || weight == null || wingspan == null) return null;
  return { height, weight, wingspan };
}

export function strengthCapForBody(body: BuilderBody) {
  const shoulderAdjustment = (body.shoulder - 50) * 0.08;
  return clampRating(body.weight * 0.65 + 27 + shoulderAdjustment, 60, MAX_RATING);
}

/** 目标自身安全上限（1-100 臂展评分只能影响这里，不与来源真实翼展比较） */
function safetyCapForAttribute(attr: string, body: BuilderBody) {
  const heightDelta = body.height - 185;
  const weightDelta = body.weight - 82;
  const wingDelta = body.wingspan - 50;
  const shoulderDelta = body.shoulder - 50;
  if (attr === "Strength") return strengthCapForBody(body);
  if (attr === "Block") return clampRating(80 + heightDelta * 0.55 + wingDelta * 0.12, 55, MAX_RATING);
  if (attr === "Interior Defense") return clampRating(82 + heightDelta * 0.42 + weightDelta * 0.14 + wingDelta * 0.08 + shoulderDelta * 0.05, 55, MAX_RATING);
  if (attr === "Offensive Rebound" || attr === "Defensive Rebound") return clampRating(82 + heightDelta * 0.5 + weightDelta * 0.1 + wingDelta * 0.08, 55, MAX_RATING);
  if (attr === "Standing Dunk") return clampRating(75 + heightDelta * 0.55 + weightDelta * 0.14 + shoulderDelta * 0.05, 45, MAX_RATING);
  return MAX_RATING;
}

// --- 位置解析与距离 ---

export function parsePositionRoles(position: string | null | undefined): PositionCode[] {
  if (!position) return [];
  return String(position)
    .split("/")
    .map((part) => part.trim().toUpperCase())
    .filter((part): part is PositionCode => part in positionAxis);
}

export function distanceToSourceRoles(target: PositionCode, sourceRoles: PositionCode[]): number | null {
  if (sourceRoles.length === 0) return null;
  const targetIndex = positionAxis[target];
  return Math.min(...sourceRoles.map((role) => Math.abs(positionAxis[role] - targetIndex)));
}

export function effectivePositionDistance(
  primary: PositionCode,
  secondary: PositionCode | null | undefined,
  sourceRoles: PositionCode[],
): number | null {
  const primaryDistance = distanceToSourceRoles(primary, sourceRoles);
  if (primaryDistance === null) return null;
  if (!secondary) return primaryDistance;
  const secondaryDistance = distanceToSourceRoles(secondary, sourceRoles);
  if (secondaryDistance === null) return primaryDistance;
  return (primaryDistance + SECONDARY_BODY_DISTANCE_WEIGHT * secondaryDistance) / (1 + SECONDARY_BODY_DISTANCE_WEIGHT);
}

/**
 * 宽容区位置类别：主位置必须相同或相邻，且有效距离不超过 1。
 * PG/C 之类仅靠次位置拉近的组合不能进入宽容区。
 */
export function graceZonePositionClass(
  primaryDistance: number | null,
  effectiveDistance: number | null,
): "same" | "adjacent" | "none" {
  if (primaryDistance === null || effectiveDistance === null) return "none";
  if (primaryDistance === 0 && effectiveDistance <= 1) return "same";
  if (primaryDistance === 1 && effectiveDistance <= 1) return "adjacent";
  return "none";
}

// --- 有符号差值 → 方向性劣势 ---

export function disadvantage(delta: number, preference: AxisPreference): number {
  if (preference === "higher") return Math.max(0, -delta);
  if (preference === "lower") return Math.max(0, delta);
  // mixed/neutral 需要属性级覆盖或明确规则；槽位默认不能决定符号。
  return 0;
}

function bodyPressureFor(profile: BodyTransferProfile, target: BuilderBody, source: SourceBody) {
  const heightDelta = target.height - source.height;
  const weightDelta = target.weight - source.weight;
  const heightDisadvantage = disadvantage(heightDelta, profile.height.preference);
  const weightDisadvantage = disadvantage(weightDelta, profile.weight.preference);
  const raw = profile.height.weight * heightDisadvantage / HEIGHT_GAP_REFERENCE_CM
    + profile.weight.weight * weightDisadvantage / WEIGHT_GAP_REFERENCE_KG;
  // 不设上限：极端身材差异（差值超过参考 40cm/35kg）继续放大位置影响。
  return Math.max(0, raw);
}

/** 结构调整（属性点）：只对目标处于不利方向的有符号差值扣分。
 * weight 决定身高/体重占比，sensitivity 整体缩放，scale 是每 10 单位基准强度。 */
function structuralAdjustmentFor(profile: BodyTransferProfile, target: BuilderBody, source: SourceBody) {
  const heightDelta = target.height - source.height;
  const weightDelta = target.weight - source.weight;
  const heightDisadvantage = disadvantage(heightDelta, profile.height.preference);
  const weightDisadvantage = disadvantage(weightDelta, profile.weight.preference);
  const raw = profile.sensitivity * (
    profile.height.weight * heightDisadvantage / 10 * profile.height.scale
    + profile.weight.weight * weightDisadvantage / 10 * profile.weight.scale
  );
  return -raw;
}

// --- 主入口 ---

export function applyBodyConstraints(
  sourceValues: Record<string, number>,
  target: BuilderBody,
  source: SourceBody | null,
  options?: BodyConstraintOptions,
): BodyConstraintResult {
  const values: Record<string, number> = {};
  const adjustments: Record<string, number> = {};
  const caps: Partial<Record<string, number>> = {};
  let usedGraceZone = false;

  if (options?.skipBody) {
    // 降级算法关闭：原值继承，不做来源比较/位置交叉/目标 cap。
    for (const [attr, rawValue] of Object.entries(sourceValues)) {
      const nextValue = clampRating(rawValue);
      values[attr] = nextValue;
      adjustments[attr] = nextValue - rawValue;
    }
    return { values, adjustments, caps, usedGraceZone };
  }

  const sourceRoles = options?.sourcePosition != null
    ? parsePositionRoles(options.sourcePosition)
    : [];
  const primaryDistance = options?.targetPosition != null
    ? distanceToSourceRoles(options.targetPosition, sourceRoles)
    : null;
  const effectiveDistance = options?.targetPosition != null
    ? effectivePositionDistance(options.targetPosition, options.secondaryPosition ?? null, sourceRoles)
    : null;
  const positionClass = graceZonePositionClass(primaryDistance, effectiveDistance);

  for (const [attr, rawValue] of Object.entries(sourceValues)) {
    if (!source) {
      // 无来源身体：只套目标自身安全上限
      const cap = safetyCapForAttribute(attr, target);
      const nextValue = clampRating(Math.min(rawValue, cap));
      values[attr] = nextValue;
      adjustments[attr] = nextValue - rawValue;
      if (cap < MAX_RATING) caps[attr] = cap;
      continue;
    }

    const profile = profileForAttribute(attr);

    // 宽容区：主位置相同/相邻且体型接近 → 非力量属性原值继承
    const inGraceZone = attr !== "Strength"
      && graceZoneWithin(positionClass, target, source);
    if (inGraceZone) {
      usedGraceZone = true;
      const nextValue = clampRating(rawValue);
      values[attr] = nextValue;
      adjustments[attr] = 0;
      continue;
    }

    const structural = structuralAdjustmentFor(profile, target, source);
    let adjustment = structural;
    if (structural < 0) {
      const bodyPressure = bodyPressureFor(profile, target, source);
      const positionMultiplier = effectiveDistance !== null
        ? 1 + effectiveDistance * POSITION_CROSS_SCALE * bodyPressure * profile.sensitivity
        : 1;
      adjustment = structural * BODY_MISMATCH_PENALTY_SCALE * positionMultiplier;
    }

    // 位置直接惩罚（传控类）：独立于身材系数，penalty = weight × distance^(squared ? 2 : 1)。
    // 传球仅此一个影响系数 → 平方放大；控球已有身材系数 → 位置线性叠加。
    const positionCross = profile.positionCross;
    if (positionCross && effectiveDistance !== null && effectiveDistance > 0) {
      const distancePower = positionCross.squared ? effectiveDistance * effectiveDistance : effectiveDistance;
      adjustment -= positionCross.weight * distancePower;
    }

    let cap = safetyCapForAttribute(attr, target);
    // 来源容量豁免：目标身体不低于来源时，来源在自身体型下证明过的
    // outlier 值不应被目标侧 cap 压低（力量仍服从体重硬上限）。
    if (attr !== "Strength"
      && target.height >= source.height - 1
      && target.weight >= source.weight - 2) {
      cap = Math.max(cap, rawValue);
    }
    const nextValue = clampRating(Math.min(rawValue + adjustment, cap));
    values[attr] = nextValue;
    adjustments[attr] = nextValue - rawValue;
    if (cap < MAX_RATING) caps[attr] = cap;
  }

  return { values, adjustments, caps, usedGraceZone };
}

function graceZoneWithin(positionClass: "same" | "adjacent" | "none", target: BuilderBody, source: SourceBody) {
  if (positionClass === "none") return false;
  const hGap = Math.abs(target.height - source.height);
  const wGap = Math.abs(target.weight - source.weight);
  const thresholds = positionClass === "same" ? GRACE_ZONE_SAME : GRACE_ZONE_ADJACENT;
  return hGap <= thresholds.height && wGap <= thresholds.weight;
}
