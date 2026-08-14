/**
 * Slot Presentation V2 — pure display-score evaluator.
 *
 * Computes the 16-slot UI score from Body Degrade V2 finalAtomicValues only
 * (spec PART B). Read-only downstream: it must NEVER write back into atomic
 * values, Body V2 inputs, or OVR. `provisional` only changes presentation
 * metadata, never the numeric formula (spec B6, E1.10).
 *
 * Hard rule (user requirement 2026-08-14): this displayScore is DECOUPLED
 * from the production OVR fallback mean. createResult keeps using the legacy
 * simple-average adjusted value for OVR fallback; UI/SlotPicker consumes
 * computeSlotDisplay().
 */

import {
  FIXED_WEIGHT_SLOT_WEIGHTS,
  POSITION_AWARE_SLOT_WEIGHTS,
  SECONDARY_POSITION_SHARE,
  SINGLE_ATOMIC_SLOT_ATTRS,
  isPositionAwareSlot,
  type SlotId,
  type SlotPosition,
} from "./slotPresentationProfiles.ts";

export type SlotDisplayInput = {
  slot: SlotId;
  finalAtomicValues: Record<string, number>;
  primaryPosition: SlotPosition;
  secondaryPosition?: SlotPosition | null;
  /** True when the evaluator context cannot see other slots' finalized supports. */
  supportIncomplete?: boolean;
};

export type SlotDisplayResult = {
  score: number;
  provisional: boolean;
  effectiveWeights: Record<string, number>;
  rawWeightedScore: number;
};

function clamp(value: number, min = 25, max = 99) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Position-aware weights with secondary blend (spec B5):
 * effective = 0.75 * primary + 0.25 * secondary when secondary exists and
 * differs; otherwise 100% primary. Fixed/single-atomic slots ignore position.
 */
export function effectiveWeightsFor(input: SlotDisplayInput): Record<string, number> {
  const { slot, primaryPosition, secondaryPosition } = input;

  const single = SINGLE_ATOMIC_SLOT_ATTRS[slot];
  if (single !== undefined) return { [single]: 1 };

  const fixed = FIXED_WEIGHT_SLOT_WEIGHTS[slot];
  if (fixed !== undefined) return { ...fixed };

  const byPosition = POSITION_AWARE_SLOT_WEIGHTS[slot];
  if (!byPosition) {
    throw new Error(`slotPresentation: unknown slot ${slot}`);
  }

  const primary = byPosition[primaryPosition];
  const secondary = secondaryPosition && secondaryPosition !== primaryPosition
    ? byPosition[secondaryPosition]
    : null;

  if (!secondary) return { ...primary };

  const share = SECONDARY_POSITION_SHARE;
  const blended: Record<string, number> = {};
  for (const [attr, weight] of Object.entries(primary)) {
    blended[attr] = weight * (1 - share) + (secondary[attr] ?? 0) * share;
  }
  return blended;
}

/**
 * Pure display-score computation (spec B1):
 * - reads finalAtomicValues only;
 * - keeps float internally, rounds ONCE at the end;
 * - weights sum to 1 (module-load asserted);
 * - missing atomic value → its weight is renormalized onto present attrs
 *   (defensive; production always passes complete finalAtomicValues);
 * - `provisional` reflects ONLY the caller-provided supportIncomplete flag
 *   and never changes the score formula.
 */
export function computeSlotDisplay(input: SlotDisplayInput): SlotDisplayResult {
  const weights = effectiveWeightsFor(input);
  const entries = Object.entries(weights).filter(([attr]) => {
    const v = input.finalAtomicValues[attr];
    return typeof v === "number" && Number.isFinite(v);
  });

  if (entries.length === 0) {
    return {
      score: 0,
      provisional: Boolean(input.supportIncomplete),
      effectiveWeights: weights,
      rawWeightedScore: 0,
    };
  }

  const weightSum = entries.reduce((sum, [, w]) => sum + w, 0);
  const rawWeightedScore = entries.reduce((sum, [attr, w]) => sum + (input.finalAtomicValues[attr] * w) / weightSum, 0);

  // 最终一次 round（spec E1.7）。加 epsilon 补偿 IEEE 754 浮点误差：
  // 如 97*0.85 + 50*0.15 = 89.9499999...（真实数学值 89.95）应 round 为 90
  // 而不是 89。epsilon 远小于任何真实 score 的十进制精度，不影响其他值。
  const ROUND_EPSILON = 1e-9;
  return {
    score: Math.round(clamp(rawWeightedScore + ROUND_EPSILON)),
    provisional: Boolean(input.supportIncomplete),
    effectiveWeights: weights,
    rawWeightedScore,
  };
}
