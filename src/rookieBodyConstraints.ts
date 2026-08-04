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
};

type PlayerBodyInput = {
  height?: string | number | null;
  weight?: string | number | null;
  wingspan?: string | number | null;
};

type BodyAxis = "height" | "weight" | "reach" | "shoulder";

const MIN_RATING = 25;
const MAX_RATING = 99;
const DEFAULT_WINGSPAN_ADVANTAGE_CM = 10;
const WINGSPAN_MORPH_CM_PER_POINT = 0.2;
const BODY_MISMATCH_PENALTY_SCALE = 2;

const adjustmentCoefficients: Partial<Record<string, Partial<Record<BodyAxis, number>>>> = {
  Strength: { weight: 0.14, shoulder: 0.04 },
  Speed: { height: -0.14, weight: -0.09 },
  Agility: { height: -0.16, weight: -0.09 },
  "Ball Handle": { height: -0.16, weight: -0.08 },
  "Speed with Ball": { height: -0.18, weight: -0.1 },
  Block: { height: 0.18, reach: 0.1 },
  "Interior Defense": { height: 0.1, weight: 0.08, reach: 0.08, shoulder: 0.03 },
  "Offensive Rebound": { height: 0.13, weight: 0.06, reach: 0.08 },
  "Defensive Rebound": { height: 0.12, weight: 0.06, reach: 0.08 },
  "Standing Dunk": { height: 0.15, weight: 0.07, shoulder: 0.03 },
  "Post Control": { height: 0.06, weight: 0.06, shoulder: 0.02 },
  "Driving Dunk": { height: 0.03, weight: -0.04 },
  Layup: { height: -0.02, weight: -0.03 },
  "Perimeter Defense": { height: -0.06, weight: -0.04, reach: 0.03 },
  Steal: { reach: 0.04 },
  "Pass Perception": { reach: 0.03 },
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

export function targetReach(body: BuilderBody) {
  return body.height + DEFAULT_WINGSPAN_ADVANTAGE_CM + (body.wingspan - 50) * WINGSPAN_MORPH_CM_PER_POINT;
}

export function strengthCapForBody(body: BuilderBody) {
  const shoulderAdjustment = (body.shoulder - 50) * 0.08;
  return clampRating(body.weight * 0.65 + 27 + shoulderAdjustment, 60, MAX_RATING);
}

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

function targetCapacityAtLeastSource(attr: string, target: BuilderBody, source: SourceBody | null) {
  if (!source) return false;
  const reach = targetReach(target);
  if (attr === "Block") return target.height >= source.height - 0.5 && reach >= source.wingspan - 1;
  if (attr === "Interior Defense") {
    return target.height + target.weight * 0.25 + reach * 0.2
      >= source.height + source.weight * 0.25 + source.wingspan * 0.2 - 1;
  }
  if (attr === "Offensive Rebound" || attr === "Defensive Rebound") {
    return target.height + target.weight * 0.15 + reach * 0.25
      >= source.height + source.weight * 0.15 + source.wingspan * 0.25 - 1;
  }
  if (attr === "Standing Dunk") {
    return target.height + target.weight * 0.18 >= source.height + source.weight * 0.18 - 1;
  }
  return false;
}

function adjustmentForAttribute(attr: string, target: BuilderBody, source: SourceBody | null) {
  if (!source) return 0;
  const coefficients = adjustmentCoefficients[attr];
  if (!coefficients) return 0;
  const deltas: Record<BodyAxis, number> = {
    height: target.height - source.height,
    weight: target.weight - source.weight,
    reach: targetReach(target) - source.wingspan,
    shoulder: target.shoulder - 50,
  };
  return Object.entries(coefficients).reduce(
    (sum, [axis, coefficient]) => sum + deltas[axis as BodyAxis] * (coefficient ?? 0),
    0,
  );
}

export function applyBodyConstraints(
  sourceValues: Record<string, number>,
  target: BuilderBody,
  source: SourceBody | null,
): BodyConstraintResult {
  const values: Record<string, number> = {};
  const adjustments: Record<string, number> = {};
  const caps: Partial<Record<string, number>> = {};

  for (const [attr, rawValue] of Object.entries(sourceValues)) {
    const rawAdjustment = adjustmentForAttribute(attr, target, source);
    const adjustment = rawAdjustment < 0 ? rawAdjustment * BODY_MISMATCH_PENALTY_SCALE : rawAdjustment;
    let cap = safetyCapForAttribute(attr, target);
    // A real source proves that a non-Strength outlier is feasible when the
    // target has equal or better physical capacity. Strength always obeys weight.
    if (attr !== "Strength" && targetCapacityAtLeastSource(attr, target, source)) {
      cap = Math.max(cap, rawValue);
    }
    const nextValue = clampRating(Math.min(rawValue + adjustment, cap));
    values[attr] = nextValue;
    adjustments[attr] = nextValue - rawValue;
    if (cap < MAX_RATING) caps[attr] = cap;
  }

  return { values, adjustments, caps };
}
