import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const playersPath = path.resolve(root, "src/data/players.json");
const rosterPath = path.resolve(root, "src/data/rosterCatalog.json");
const badgesPath = path.resolve(root, "src/data/badgeProfiles.2k27.json");
const outputPath = path.resolve(root, process.argv[2] ?? "src/data/rookieOverallModel.json");
const ridge = Number(process.argv[3] ?? 100);
const badgeRidge = Number(process.argv[4] ?? 100);
const folds = 5;

const attributes = [
  "Agility",
  "Ball Handle",
  "Block",
  "Close Shot",
  "Defensive Consistency",
  "Defensive Rebound",
  "Draw Foul",
  "Driving Dunk",
  "Free Throw",
  "Hands",
  "Help Defense IQ",
  "Hustle",
  "Interior Defense",
  "Layup",
  "Mid-Range Shot",
  "Offensive Consistency",
  "Offensive Rebound",
  "Overall Durability",
  "Pass Accuracy",
  "Pass IQ",
  "Pass Perception",
  "Pass Vision",
  "Perimeter Defense",
  "Post Control",
  "Post Fade",
  "Post Hook",
  "Shot IQ",
  "Speed",
  "Speed with Ball",
  "Stamina",
  "Standing Dunk",
  "Steal",
  "Strength",
  "Three-Point Shot",
  "Vertical",
  "Intangibles",
];

const badgeCategories = ["shooting", "playmaking", "inside", "defense", "rebounding", "athleticism"];
const tierPoints = { Bronze: 1, Silver: 2, Gold: 3, HOF: 4, Legendary: 5 };
const positions = ["PG", "SG", "SF", "PF", "C"];
const detailedPlayers = JSON.parse(await readFile(playersPath, "utf8"));
const rosterCatalog = JSON.parse(await readFile(rosterPath, "utf8"));
const badgeProfiles = JSON.parse(await readFile(badgesPath, "utf8"));
const detailedBySlug = new Map(detailedPlayers.map((player) => [player.slug, player]));

const samples = rosterCatalog.teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players)
  .flatMap((player) => {
    const detailed = detailedBySlug.get(player.id);
    if (!detailed || typeof player.overall !== "number") return [];
    const [position] = String(player.position ?? "SF").split("/");
    if (!positions.includes(position)) return [];
    return [{
      id: player.id,
      position,
      overall: player.overall,
      features: attributes.map((attribute) => featureValue(detailed.detailed?.[attribute], attribute)),
      badgeFeatures: badgeFeaturesFor(badgeProfiles[player.id] ?? []),
      badgeCount: (badgeProfiles[player.id] ?? []).length,
      values: detailed.detailed ?? {},
    }];
  });

if (samples.length < 50) {
  throw new Error(`Not enough training samples: ${samples.length}`);
}

const positionsModel = Object.fromEntries(positions.map((position) => {
  const positionSamples = samples.filter((sample) => sample.position === position);
  const model = fitRidge(positionSamples, ridge);
  return [position, model];
}));

const positionsBadgeModel = Object.fromEntries(positions.map((position) => {
  const positionSamples = samples.filter((sample) => sample.position === position);
  const model = fitRidge(positionSamples, ridge, true);
  return [position, model];
}));

const holdoutPredictions = [];
const holdoutBadgePredictions = [];
const holdoutJointBadgePredictions = [];
for (let fold = 0; fold < folds; fold += 1) {
  for (const position of positions) {
    const training = samples.filter((sample) => sample.position === position && foldFor(sample.id) !== fold);
    const testing = samples.filter((sample) => sample.position === position && foldFor(sample.id) === fold);
    if (training.length < attributes.length || testing.length === 0) continue;
    const model = fitRidge(training, ridge);
    const badgeModel = fitRidge(training, badgeRidge, true);
    for (const sample of testing) {
      const prediction = predict(model, sample.features);
      holdoutPredictions.push({ overall: sample.overall, prediction });
      if (sample.badgeCount > 0) {
        const jointPrediction = predict(badgeModel, [...sample.features, ...sample.badgeFeatures]);
        const productionJointPrediction = predict(badgeModel, [...sample.features, ...sample.badgeFeatures], true);
        holdoutBadgePredictions.push({
          overall: sample.overall,
          prediction: Math.max(prediction, productionJointPrediction),
        });
        holdoutJointBadgePredictions.push({ overall: sample.overall, prediction: jointPrediction });
      }
    }
  }
}

const mae = average(holdoutPredictions.map((row) => Math.abs(row.prediction - row.overall)));
const rmse = Math.sqrt(average(holdoutPredictions.map((row) => (row.prediction - row.overall) ** 2)));
const badgeMae = average(holdoutBadgePredictions.map((row) => Math.abs(row.prediction - row.overall)));
const badgeRmse = Math.sqrt(average(holdoutBadgePredictions.map((row) => (row.prediction - row.overall) ** 2)));
const jointBadgeMae = average(holdoutJointBadgePredictions.map((row) => Math.abs(row.prediction - row.overall)));
const jointBadgeRmse = Math.sqrt(average(holdoutJointBadgePredictions.map((row) => (row.prediction - row.overall) ** 2)));

const model = {
  version: 2,
  trainingSamples: samples.length,
  crossValidation: {
    folds,
    mae: round(mae, 3),
    rmse: round(rmse, 3),
    badgeSubsetMae: round(badgeMae, 3),
    badgeSubsetRmse: round(badgeRmse, 3),
    badgeSubsetCount: holdoutBadgePredictions.length,
    jointBadgeSubsetMae: round(jointBadgeMae, 3),
    jointBadgeSubsetRmse: round(jointBadgeRmse, 3),
  },
  ridge,
  badgeRidge,
  attributes,
  badgeCategories,
  tierPoints,
  badgeCombination: "monotonic-max-nonnegative",
  positions: positionsModel,
  positionsWithBadges: positionsBadgeModel,
};

await writeFile(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(`Trained model on ${samples.length} samples → ${path.relative(root, outputPath)}`);
console.log(`${folds}-fold CV: MAE=${mae.toFixed(3)}, RMSE=${rmse.toFixed(3)}`);
console.log(`${folds}-fold CV (badge subset n=${holdoutBadgePredictions.length}): attr+badge MAE=${badgeMae.toFixed(3)}, RMSE=${badgeRmse.toFixed(3)}`);
console.log(`${folds}-fold CV (unconstrained joint diagnostic): MAE=${jointBadgeMae.toFixed(3)}, RMSE=${jointBadgeRmse.toFixed(3)}`);

function badgeFeaturesFor(badges) {
  const points = Object.fromEntries(badgeCategories.map((category) => [category, 0]));
  for (const badge of badges) {
    const tier = tierPoints[badge.tier];
    if (tier && badgeCategories.includes(badge.category)) points[badge.category] += tier;
  }
  return badgeCategories.map((category) => points[category]);
}

function featureValue(value, attribute) {
  if (Number.isFinite(value)) return clamp(value, 25, 99);
  return attribute === "Intangibles" ? 50 : 65;
}

function fitRidge(data, lambda, withBadges = false) {
  const n = data.length;
  const p = withBadges ? attributes.length + badgeCategories.length : attributes.length;
  const xtx = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const xty = Array(p + 1).fill(0);

  for (const sample of data) {
    const row = withBadges
      ? [1, ...sample.features, ...sample.badgeFeatures]
      : [1, ...sample.features];
    for (let i = 0; i <= p; i += 1) {
      xty[i] += row[i] * sample.overall;
      for (let j = 0; j <= p; j += 1) {
        xtx[i][j] += row[i] * row[j];
      }
    }
  }

  for (let i = 1; i <= p; i += 1) {
    xtx[i][i] += lambda;
  }

  const coefficients = solveLinearSystem(xtx, xty);
  if (withBadges) {
    return {
      intercept: coefficients[0],
      coefficients: Object.fromEntries(attributes.map((attribute, index) => [attribute, coefficients[index + 1]])),
      badgeCoefficients: Object.fromEntries(badgeCategories.map((category, index) => [category, coefficients[index + 1 + attributes.length]])),
    };
  }
  return {
    intercept: coefficients[0],
    coefficients: Object.fromEntries(attributes.map((attribute, index) => [attribute, coefficients[index + 1]])),
  };
}

function predict(model, features, nonnegativeBadges = false) {
  const estimate = attributes.reduce((total, attribute, index) => (
    total + features[index] * (model.coefficients[attribute] ?? 0)
  ), model.intercept) + badgeCategories.reduce((total, category, index) => (
    total + (features[attributes.length + index] ?? 0) * (
      nonnegativeBadges
        ? Math.max(0, model.badgeCoefficients?.[category] ?? 0)
        : model.badgeCoefficients?.[category] ?? 0
    )
  ), 0);
  return clamp(estimate, 40, 99);
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("Singular matrix while fitting ridge model");
    }
    if (pivot !== col) [a[col], a[pivot]] = [a[pivot], a[col]];

    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }

  return a.map((row) => row[n]);
}

function foldFor(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % folds;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
