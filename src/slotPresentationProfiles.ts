/**
 * Slot Presentation V2 — authoritative weight configuration.
 *
 * Source of truth: DeepSeek V4Flash Slot Semantics prompt PART B (2026-08-14).
 * Body Degrade V2 finalAtomicValues are the ONLY input. No position-value
 * semantics live here; position-aware weights only describe which atomic
 * abilities a slot NAME usually summarizes for a given position (spec A3).
 *
 * Every weight table sums to 1 (checked at module load).
 */

export type SlotId =
  | "three"
  | "mid"
  | "face"
  | "post"
  | "dunk"
  | "handle"
  | "passing"
  | "perimeter"
  | "interior"
  | "steal"
  | "block"
  | "rebound"
  | "athletic"
  | "strength"
  | "stability"
  | "potential";

export type SlotPosition = "PG" | "SG" | "SF" | "PF" | "C";

export const SLOT_POSITIONS: readonly SlotPosition[] = ["PG", "SG", "SF", "PF", "C"];

/** Secondary position blend share (spec B5): effective = 0.75*primary + 0.25*secondary. */
export const SECONDARY_POSITION_SHARE = 0.25;

/**
 * Six single-atomic slots: 100% of the atomic value, identical across all
 * positions (spec B2).
 */
export const SINGLE_ATOMIC_SLOT_ATTRS: Record<string, string> = {
  three: "Three-Point Shot",
  perimeter: "Perimeter Defense",
  interior: "Interior Defense",
  block: "Block",
  strength: "Strength",
  potential: "Potential",
};

/**
 * Five fixed multi-atomic slots: position-invariant weights (spec B3).
 */
export const FIXED_WEIGHT_SLOT_WEIGHTS: Record<string, Record<string, number>> = {
  mid: {
    "Mid-Range Shot": 0.85,
    "Free Throw": 0.15,
  },
  passing: {
    "Pass Accuracy": 0.4,
    "Pass IQ": 0.3,
    "Pass Vision": 0.3,
  },
  steal: {
    Steal: 0.75,
    "Pass Perception": 0.25,
  },
  rebound: {
    "Offensive Rebound": 0.5,
    "Defensive Rebound": 0.5,
  },
  stability: {
    "Offensive Consistency": 0.25,
    "Defensive Consistency": 0.25,
    "Shot IQ": 0.15,
    "Help Defense IQ": 0.15,
    "Overall Durability": 0.2,
  },
};

/**
 * Five position-aware slots (spec B4). Rows sum to 1 per position.
 */
export const POSITION_AWARE_SLOT_WEIGHTS: Record<string, Record<SlotPosition, Record<string, number>>> = {
  face: {
    PG: { Layup: 0.5, "Close Shot": 0.15, "Draw Foul": 0.25, Hands: 0.1 },
    SG: { Layup: 0.45, "Close Shot": 0.2, "Draw Foul": 0.25, Hands: 0.1 },
    SF: { Layup: 0.38, "Close Shot": 0.27, "Draw Foul": 0.25, Hands: 0.1 },
    PF: { Layup: 0.28, "Close Shot": 0.37, "Draw Foul": 0.25, Hands: 0.1 },
    C: { Layup: 0.18, "Close Shot": 0.47, "Draw Foul": 0.25, Hands: 0.1 },
  },
  post: {
    PG: { "Post Fade": 0.45, "Post Hook": 0.15, "Post Control": 0.4 },
    SG: { "Post Fade": 0.45, "Post Hook": 0.15, "Post Control": 0.4 },
    SF: { "Post Fade": 0.4, "Post Hook": 0.2, "Post Control": 0.4 },
    PF: { "Post Fade": 0.3, "Post Hook": 0.3, "Post Control": 0.4 },
    C: { "Post Fade": 0.2, "Post Hook": 0.4, "Post Control": 0.4 },
  },
  dunk: {
    PG: { "Driving Dunk": 0.85, "Standing Dunk": 0.15 },
    SG: { "Driving Dunk": 0.8, "Standing Dunk": 0.2 },
    SF: { "Driving Dunk": 0.7, "Standing Dunk": 0.3 },
    PF: { "Driving Dunk": 0.55, "Standing Dunk": 0.45 },
    C: { "Driving Dunk": 0.4, "Standing Dunk": 0.6 },
  },
  handle: {
    PG: { "Ball Handle": 0.6, "Speed with Ball": 0.4 },
    SG: { "Ball Handle": 0.65, "Speed with Ball": 0.35 },
    SF: { "Ball Handle": 0.7, "Speed with Ball": 0.3 },
    PF: { "Ball Handle": 0.75, "Speed with Ball": 0.25 },
    C: { "Ball Handle": 0.8, "Speed with Ball": 0.2 },
  },
  athletic: {
    PG: { Speed: 0.32, Agility: 0.28, Vertical: 0.15, Stamina: 0.15, Hustle: 0.1 },
    SG: { Speed: 0.3, Agility: 0.27, Vertical: 0.18, Stamina: 0.15, Hustle: 0.1 },
    SF: { Speed: 0.27, Agility: 0.25, Vertical: 0.2, Stamina: 0.18, Hustle: 0.1 },
    PF: { Speed: 0.23, Agility: 0.23, Vertical: 0.24, Stamina: 0.2, Hustle: 0.1 },
    C: { Speed: 0.2, Agility: 0.2, Vertical: 0.28, Stamina: 0.22, Hustle: 0.1 },
  },
};

// ── module-load integrity checks ────────────────────────────────

const EPS = 1e-12;

function assertWeightsSum(weights: Record<string, number>, label: string) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > EPS) {
    throw new Error(`slotPresentationProfiles: ${label} weights sum ${sum} != 1`);
  }
}

for (const [slot, weights] of Object.entries(FIXED_WEIGHT_SLOT_WEIGHTS)) {
  assertWeightsSum(weights, `fixed[${slot}]`);
}
for (const [slot, byPosition] of Object.entries(POSITION_AWARE_SLOT_WEIGHTS)) {
  for (const position of SLOT_POSITIONS) {
    assertWeightsSum(byPosition[position], `positionAware[${slot}][${position}]`);
  }
}

/** True when the slot uses position-aware weights (spec B4). */
export function isPositionAwareSlot(slot: SlotId): boolean {
  return slot in POSITION_AWARE_SLOT_WEIGHTS;
}
