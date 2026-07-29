export type OverallRange = {
  min: number;
  max: number;
};

const developmentGapByAge: Record<number, { standard: number; elite: number }> = {
  18: { standard: 14, elite: 17 },
  19: { standard: 12, elite: 14 },
  20: { standard: 9, elite: 12 },
  21: { standard: 7, elite: 10 },
  22: { standard: 5, elite: 8 },
  23: { standard: 4, elite: 6 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
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

export function initialOverallForPotential(potential: number, age: number, readiness: number) {
  return clamp(
    potential - developmentGap(potential, age) + readinessOverallAdjustment(potential, age, readiness),
    40,
    95,
  );
}

export function initialOverallRange(range: OverallRange, age: number, readiness: number): OverallRange {
  const lower = Math.min(range.min, range.max);
  const upper = Math.max(range.min, range.max);
  const values = Array.from(
    { length: upper - lower + 1 },
    (_, index) => initialOverallForPotential(lower + index, age, readiness),
  );
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

type CalibrationResolutionInput = {
  configuredPotential: number;
  configuredPotentialRange: OverallRange;
  projectedInitialRange: OverallRange;
  peakOverall: number;
  peakDistance: number;
  initialOverall: number;
  initialDistance: number;
  tolerance?: number;
};

export function resolveOverallCalibration({
  configuredPotential,
  configuredPotentialRange,
  projectedInitialRange,
  peakOverall,
  peakDistance,
  initialOverall,
  initialDistance,
  tolerance = 1,
}: CalibrationResolutionInput) {
  const peakUnreachable = peakDistance > tolerance;
  const initialUnreachable = initialDistance > tolerance;
  const potential = peakUnreachable
    ? Math.max(peakOverall, initialOverall)
    : Math.max(configuredPotential, initialOverall);
  return {
    hasConflict: peakUnreachable || initialUnreachable,
    peakUnreachable,
    initialUnreachable,
    potential,
    potentialRange: peakUnreachable
      ? { min: potential, max: potential }
      : { ...configuredPotentialRange },
    initialRange: initialUnreachable
      ? { min: initialOverall, max: initialOverall }
      : { ...projectedInitialRange },
  };
}
