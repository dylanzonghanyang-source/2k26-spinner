import rookieOverallModel from "./data/rookieOverallModel.json";

export type OverallPosition = "PG" | "SG" | "SF" | "PF" | "C";

type PositionModel = {
  intercept: number;
  coefficients: Record<string, number>;
};

type OverallModel = {
  attributes: string[];
  positions: Record<OverallPosition, PositionModel>;
};

const model = rookieOverallModel as OverallModel;

export const overallModelAttributes = model.attributes as readonly string[];
export const overallModelMetrics = rookieOverallModel.crossValidation;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function estimateGameOverall(
  values: Record<string, number | null | undefined>,
  position: OverallPosition,
  fallbackValue = 65,
) {
  const positionModel = model.positions[position] ?? model.positions.SF;
  const estimate = overallModelAttributes.reduce((total, attribute) => {
    const value = values[attribute];
    const resolved = typeof value === "number" && Number.isFinite(value)
      ? clamp(value, 25, 99)
      : attribute === "Intangibles" ? 50 : fallbackValue;
    return total + resolved * (positionModel.coefficients[attribute] ?? 0);
  }, positionModel.intercept);

  return Math.round(clamp(estimate, 40, 99));
}
