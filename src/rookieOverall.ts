import legacyOverallModel from "./data/rookieOverallModel.json" with { type: "json" };
import overallModel2k26 from "./data/versions/2k26/rookieOverallModel.json" with { type: "json" };
import overallModel2k27 from "./data/versions/2k27-play-now/rookieOverallModel.json" with { type: "json" };
import rookieCardModel from "./data/rookieOverallModel-rookie.json" with { type: "json" };

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

export type OverallDataVersion = "legacy" | "2k26" | "2k27" | "rookie";

type OverallModel = {
  attributes: string[];
  badgeCategories: string[];
  tierPoints: Record<string, number>;
  positions: Record<OverallPosition, PositionModel>;
  positionsWithBadges: Record<OverallPosition, PositionModel>;
};

const models: Record<OverallDataVersion, OverallModel> = {
  legacy: legacyOverallModel as OverallModel,
  "2k26": overallModel2k26 as OverallModel,
  "2k27": overallModel2k27 as OverallModel,
  rookie: rookieCardModel as OverallModel,
};

const model = models.legacy;

export const overallModelAttributes = model.attributes as readonly string[];
export const overallModelMetrics = legacyOverallModel.crossValidation;

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

function modelFor(version: OverallDataVersion): OverallModel {
  return models[version] ?? models.legacy;
}

export function badgeFeatureValues(badges: BadgeLike[], version: OverallDataVersion = "legacy"): number[] {
  const activeModel = modelFor(version);
  const tierPoints = activeModel.tierPoints ?? fallbackTierPoints;
  const points = Object.fromEntries(activeModel.badgeCategories.map((category) => [category, 0]));
  for (const badge of badges) {
    const tier = tierPoints[badge.tier];
    if (tier && badge.category && points[badge.category] !== undefined) {
      points[badge.category] += tier;
    }
  }
  return activeModel.badgeCategories.map((category) => points[category]);
}

export function estimateGameOverall(
  values: Record<string, number | null | undefined>,
  position: OverallPosition,
  badges?: BadgeLike[],
  fallbackValue = 65,
  version: OverallDataVersion = "legacy",
) {
  const activeModel = modelFor(version);
  const hasBadges = Array.isArray(badges) && badges.length > 0;
  const attributeModel = activeModel.positions[position] ?? activeModel.positions.SF;
  const attributeEstimate = activeModel.attributes.reduce((total, attribute) => {
    const value = values[attribute];
    const resolved = typeof value === "number" && Number.isFinite(value)
      ? clamp(value, 25, 99)
      : attribute === "Intangibles" ? 50 : fallbackValue;
    return total + resolved * (attributeModel.coefficients[attribute] ?? 0);
  }, attributeModel.intercept);

  if (!hasBadges) return Math.round(clamp(attributeEstimate, 40, 99));

  const badgeModel = activeModel.positionsWithBadges?.[position];
  if (!badgeModel?.badgeCoefficients) return Math.round(clamp(attributeEstimate, 40, 99));

  const jointEstimate = activeModel.attributes.reduce((total, attribute) => {
    const value = values[attribute];
    const resolved = typeof value === "number" && Number.isFinite(value)
      ? clamp(value, 25, 99)
      : attribute === "Intangibles" ? 50 : fallbackValue;
    return total + resolved * (badgeModel.coefficients[attribute] ?? 0);
  }, badgeModel.intercept);
  const badgeFeatures = badgeFeatureValues(badges, version);
  const badgeAdjustedEstimate = activeModel.badgeCategories.reduce((total, category, index) => (
    total + badgeFeatures[index] * Math.max(0, badgeModel.badgeCoefficients?.[category] ?? 0)
  ), jointEstimate);

  return Math.round(clamp(Math.max(attributeEstimate, badgeAdjustedEstimate), 40, 99));
}
