import rookieOverallModel from "./data/rookieOverallModel.json" with { type: "json" };

export type OverallPosition = "PG" | "SG" | "SF" | "PF" | "C";

export type BadgeLike = {
  category?: string;
  tier: string;
};

type PositionModel = {
  intercept: number;
  coefficients: Record<string, number>;
  badgeCoefficients?: Record<string, number>;
};

type OverallModel = {
  attributes: string[];
  badgeCategories: string[];
  tierPoints: Record<string, number>;
  positions: Record<OverallPosition, PositionModel>;
  positionsWithBadges: Record<OverallPosition, PositionModel>;
};

const model = rookieOverallModel as OverallModel;

export const overallModelAttributes = model.attributes as readonly string[];
export const overallModelMetrics = rookieOverallModel.crossValidation;

const fallbackTierPoints: Record<string, number> = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  HOF: 4,
  Legendary: 5,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function badgeFeatureValues(badges: BadgeLike[]): number[] {
  const tierPoints = model.tierPoints ?? fallbackTierPoints;
  const points = Object.fromEntries(model.badgeCategories.map((category) => [category, 0]));
  for (const badge of badges) {
    const tier = tierPoints[badge.tier];
    if (tier && badge.category && points[badge.category] !== undefined) {
      points[badge.category] += tier;
    }
  }
  return model.badgeCategories.map((category) => points[category]);
}

export function estimateGameOverall(
  values: Record<string, number | null | undefined>,
  position: OverallPosition,
  badges?: BadgeLike[],
  fallbackValue = 65,
) {
  const hasBadges = Array.isArray(badges) && badges.length > 0;
  const attributeModel = model.positions[position] ?? model.positions.SF;
  const attributeEstimate = overallModelAttributes.reduce((total, attribute) => {
    const value = values[attribute];
    const resolved = typeof value === "number" && Number.isFinite(value)
      ? clamp(value, 25, 99)
      : attribute === "Intangibles" ? 50 : fallbackValue;
    return total + resolved * (attributeModel.coefficients[attribute] ?? 0);
  }, attributeModel.intercept);

  if (!hasBadges) return Math.round(clamp(attributeEstimate, 40, 99));

  const badgeModel = model.positionsWithBadges?.[position];
  if (!badgeModel?.badgeCoefficients) return Math.round(clamp(attributeEstimate, 40, 99));

  const jointEstimate = overallModelAttributes.reduce((total, attribute) => {
    const value = values[attribute];
    const resolved = typeof value === "number" && Number.isFinite(value)
      ? clamp(value, 25, 99)
      : attribute === "Intangibles" ? 50 : fallbackValue;
    return total + resolved * (badgeModel.coefficients[attribute] ?? 0);
  }, badgeModel.intercept);
  const badgeFeatures = badgeFeatureValues(badges);
  const badgeAdjustedEstimate = model.badgeCategories.reduce((total, category, index) => (
    total + badgeFeatures[index] * Math.max(0, badgeModel.badgeCoefficients?.[category] ?? 0)
  ), jointEstimate);

  return Math.round(clamp(Math.max(attributeEstimate, badgeAdjustedEstimate), 40, 99));
}
