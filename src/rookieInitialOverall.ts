export type RookieInitialOverallBadge = {
  category?: string;
  tier: string;
};

export type RookieInitialOverallConstraint = {
  values: Record<string, number>;
  targetOverall: number;
  originalOverall: number;
  actualOverall: number;
  offset: number;
  changed: boolean;
  reachable: boolean;
};

type DevelopmentGap = {
  standard: number;
  elite: number;
};

// 年龄不再参与计算：起始综评的成长空间固定为中性基准（原 20 岁档），
// 18-23 岁生成的起始综评完全一致，大龄新秀不再获得起始加成。
const developmentGapByAge: Record<number, DevelopmentGap> = {
  20: { standard: 9, elite: 12 },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function developmentGap(potential: number) {
  const gaps = developmentGapByAge[20];
  const eliteFactor = Math.max(0, Math.min(1, (potential - 87) / 5));
  return gaps.standard + (gaps.elite - gaps.standard) * eliteFactor;
}

/**
 * Return the intended starting OVR for a prospect with a given potential.
 *
 * This is a product constraint for generated rookies, not a claim about the
 * current-player OVR model. In particular, a 19-year-old prospect with 98
 * potential targets 84 OVR, leaving a meaningful growth gap.
 */
export function initialOverallForPotential(potential: number) {
  const normalizedPotential = clamp(potential, 40, 99);
  return clamp(normalizedPotential - developmentGap(normalizedPotential), 40, 95);
}

/**
 * Lower a generated rookie's unlocked attributes until the recomputed OVR is
 * at or just below the potential/age target. A single uniform offset preserves
 * the shape of the generated build and avoids silently changing one category.
 * Custom final values are treated as hard locks and are never altered.
 */
export function constrainRookieInitialAttributes({
  values,
  potential,
  adjustableAttributes,
  lockedValues = {},
  badges = [],
  estimateOverall,
}: {
  values: Record<string, number>;
  potential: number;
  adjustableAttributes: readonly string[];
  lockedValues?: Record<string, number>;
  badges?: RookieInitialOverallBadge[];
  estimateOverall: (values: Record<string, number>, badges: RookieInitialOverallBadge[]) => number;
}): RookieInitialOverallConstraint {
  const targetOverall = initialOverallForPotential(potential);
  const originalValues = { ...values };
  const originalOverall = estimateOverall(originalValues, badges);

  if (originalOverall <= targetOverall) {
    return {
      values: originalValues,
      targetOverall,
      originalOverall,
      actualOverall: originalOverall,
      offset: 0,
      changed: false,
      reachable: true,
    };
  }

  const adjustable = new Set(adjustableAttributes);
  const evaluateAtOffset = (offset: number) => {
    const candidate = { ...originalValues };
    for (const attribute of adjustable) {
      if (Object.prototype.hasOwnProperty.call(lockedValues, attribute)) continue;
      const value = candidate[attribute];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      candidate[attribute] = clamp(value + offset, 25, 99);
    }
    return {
      values: candidate,
      overall: estimateOverall(candidate, badges),
      offset,
    };
  };

  let best = evaluateAtOffset(0);
  let bestFeasible = best.overall <= targetOverall;
  for (let offset = -1; offset >= -30; offset -= 1) {
    const candidate = evaluateAtOffset(offset);
    const feasible = candidate.overall <= targetOverall;
    if (feasible && (!bestFeasible || targetOverall - candidate.overall < targetOverall - best.overall)) {
      best = candidate;
      bestFeasible = true;
      continue;
    }
    if (!bestFeasible && candidate.overall < best.overall) best = candidate;
  }

  return {
    values: best.values,
    targetOverall,
    originalOverall,
    actualOverall: best.overall,
    offset: best.offset,
    changed: best.offset !== 0,
    reachable: bestFeasible,
  };
}
