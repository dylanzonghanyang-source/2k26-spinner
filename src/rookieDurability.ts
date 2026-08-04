const MIN_DURABILITY = 25;
const MAX_DURABILITY = 99;
const ROOKIE_DURABILITY_FLOOR = 74;
const ROOKIE_DURABILITY_CEILING = 92;

export const DURABILITY_ATTRIBUTES = [
  "Head Durability", "Neck Durability", "Back Durability",
  "Left Shoulder Durability", "Right Shoulder Durability",
  "Left Elbow Durability", "Right Elbow Durability",
  "Left Hip Durability", "Right Hip Durability",
  "Left Knee Durability", "Right Knee Durability",
  "Left Ankle Durability", "Right Ankle Durability",
  "Left Foot Durability", "Right Foot Durability",
  "Overall Durability",
] as const;

type RandomSource = () => number;
type DurabilityPartGroup = readonly [string] | readonly [string, string];

const durabilityPartGroups: readonly DurabilityPartGroup[] = [
  ["Head Durability"],
  ["Neck Durability"],
  ["Back Durability"],
  ["Left Shoulder Durability", "Right Shoulder Durability"],
  ["Left Elbow Durability", "Right Elbow Durability"],
  ["Left Hip Durability", "Right Hip Durability"],
  ["Left Knee Durability", "Right Knee Durability"],
  ["Left Ankle Durability", "Right Ankle Durability"],
  ["Left Foot Durability", "Right Foot Durability"],
];

function clampRating(value: number, min = MIN_DURABILITY, max = MAX_DURABILITY) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function boundedRandom(random: RandomSource) {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(Number.MIN_VALUE, Math.min(1 - Number.EPSILON, value));
}

function seededNormal(random: RandomSource) {
  const first = boundedRandom(random);
  const second = boundedRandom(random);
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

export function rookieDurabilityMean(
  sourceOverallDurability: number,
  bodyStress: number,
  random: RandomSource,
) {
  const source = Number.isFinite(sourceOverallDurability) ? sourceOverallDurability : 80;
  const stress = Number.isFinite(bodyStress) ? bodyStress : 0;
  return clampRating(
    82
      + 0.35 * (source - 80)
      - 0.75 * stress
      + seededNormal(random) * 1.5,
    ROOKIE_DURABILITY_FLOOR,
    ROOKIE_DURABILITY_CEILING,
  );
}

function shiftGroup(values: Record<string, number>, group: DurabilityPartGroup, direction: 1 | -1) {
  const next = group.map((attribute) => (values[attribute] ?? 0) + direction);
  if (next.some((value) => value < MIN_DURABILITY || value > MAX_DURABILITY)) return false;
  group.forEach((attribute, index) => {
    values[attribute] = next[index] ?? values[attribute] ?? 0;
  });
  return true;
}

function rebalancePartMean(values: Record<string, number>, targetMean: number) {
  const targetSum = targetMean * (DURABILITY_ATTRIBUTES.length - 1);
  let currentSum = DURABILITY_ATTRIBUTES
    .filter((attribute) => attribute !== "Overall Durability")
    .reduce((sum, attribute) => sum + (values[attribute] ?? 0), 0);
  let difference = targetSum - currentSum;

  while (difference !== 0) {
    const direction: 1 | -1 = difference > 0 ? 1 : -1;
    let progressed = false;
    for (const group of durabilityPartGroups) {
      if (difference === 0) break;
      const step = group.length === 2 && Math.abs(difference) >= 2 ? 2 : group.length === 1 ? 1 : 0;
      if (step === 0 || !shiftGroup(values, group, direction)) continue;
      difference -= direction * step;
      currentSum += direction * step;
      progressed = true;
    }
    if (!progressed) break;
  }

  return currentSum === targetSum;
}

/** Generate the 15 body-part ratings plus Overall Durability for a fixed mean. */
export function generateDurabilityAttributes(mean: number, random: RandomSource) {
  const targetMean = clampRating(mean);
  const values: Record<string, number> = {};

  for (const group of durabilityPartGroups) {
    const latent = targetMean + seededNormal(random) * 1.5;
    const base = clampRating(latent);
    if (group.length === 1) {
      values[group[0]] = base;
      continue;
    }

    const sideDifference = random() < 0.5 ? 0 : random() < 0.5 ? -1 : 1;
    values[group[0]] = base;
    values[group[1]] = clampRating(base + sideDifference);
  }

  rebalancePartMean(values, targetMean);
  values["Overall Durability"] = targetMean;
  return values;
}

/** Generate rookie durability without applying the generic mental-attribute age curve. */
export function generateRookieDurability(
  sourceOverallDurability: number,
  bodyStress: number,
  random: RandomSource,
) {
  const mean = rookieDurabilityMean(sourceOverallDurability, bodyStress, random);
  return generateDurabilityAttributes(mean, random);
}
