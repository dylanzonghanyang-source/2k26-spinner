import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const versions = [
  { key: "2k26", directory: "2k26" },
  { key: "2k27", directory: "2k27-play-now" },
];
const attributes = [
  "Agility", "Ball Handle", "Block", "Close Shot", "Defensive Consistency", "Defensive Rebound", "Draw Foul", "Driving Dunk", "Free Throw", "Hands", "Help Defense IQ", "Hustle", "Interior Defense", "Layup", "Mid-Range Shot", "Offensive Consistency", "Offensive Rebound", "Pass Accuracy", "Pass IQ", "Pass Perception", "Pass Vision", "Perimeter Defense", "Post Control", "Post Fade", "Post Hook", "Shot IQ", "Speed", "Speed with Ball", "Stamina", "Standing Dunk", "Steal", "Strength", "Three-Point Shot", "Vertical", "Intangibles",
];
const badgeCategories = ["shooting", "playmaking", "inside", "defense", "rebounding", "athleticism"];
const tierPoints = { Bronze: 1, Silver: 2, Gold: 3, HOF: 4, Legendary: 5 };
const positions = ["PG", "SG", "SF", "PF", "C"];
const folds = 5;
const ridge = 100;
const badgeRidge = 100;

const datasets = [];
for (const version of versions) {
  const directory = path.join(root, "src/data/versions", version.directory);
  const [players, roster, badges] = await Promise.all([
    readJson(path.join(directory, "players.json")),
    readJson(path.join(directory, "rosterCatalog.json")),
    readJson(path.join(directory, "badges.json")),
  ]);
  const detailedBySlug = new Map(players.map((player) => [player.slug, player]));
  const samples = roster.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players)
    .flatMap((player) => {
      const detailed = detailedBySlug.get(player.id);
      const position = String(player.position ?? "SF").split("/")[0];
      if (!detailed || typeof player.overall !== "number" || !positions.includes(position)) return [];
      return [{
        id: player.id,
        version: version.key,
        position,
        overall: player.overall,
        features: attributes.map((attribute) => featureValue(detailed.detailed?.[attribute], attribute)),
        badgeFeatures: badgeFeaturesFor(badges[player.id] ?? []),
        badgeCount: (badges[player.id] ?? []).length,
      }];
    });
  datasets.push({ version: version.key, samples });
}

const allSamples = datasets.flatMap((dataset) => dataset.samples);
const uniqueIds = new Set(allSamples.map((sample) => sample.id));
const sharedIds = allSamples.length - uniqueIds.size;
const paired = pairSharedSamples(datasets[0].samples, datasets[1].samples);

console.log(JSON.stringify({
  datasetCounts: Object.fromEntries(datasets.map((dataset) => [dataset.version, dataset.samples.length])),
  combinedSamples: allSamples.length,
  uniquePlayerIds: uniqueIds.size,
  sharedVersionRows: sharedIds,
  sharedPlayers: paired.length,
  sharedOverallMaeDelta: average(paired.map(([left, right]) => Math.abs(left.overall - right.overall))),
}, null, 2));

for (const dataset of datasets) {
  printMetrics(`${dataset.version} only / grouped 5-fold`, summarize(groupedPredictions(dataset.samples)));
}
const combinedPredictions = groupedPredictions(allSamples);
printMetrics("combined / grouped by player ID", summarize(combinedPredictions));
for (const version of versions.map((entry) => entry.key)) {
  printMetrics(`combined model / held-out ${version}`, summarize(combinedPredictions.filter((row) => row.version === version)));
}

for (const heldOut of versions.map((version) => version.key)) {
  const training = allSamples.filter((sample) => sample.version !== heldOut);
  const testing = allSamples.filter((sample) => sample.version === heldOut);
  printMetrics(`train other version → test ${heldOut}`, evaluateWithFullTraining(training, testing));
}

function printMetrics(label, result) {
  console.log(JSON.stringify({ label, ...result }, null, 2));
}

function groupedPredictions(samples) {
  const predictions = [];
  for (let fold = 0; fold < folds; fold += 1) {
    for (const position of positions) {
      const training = samples.filter((sample) => sample.position === position && foldFor(sample.id) !== fold);
      const testing = samples.filter((sample) => sample.position === position && foldFor(sample.id) === fold);
      if (training.length < attributes.length || testing.length === 0) continue;
      appendPredictions(predictions, training, testing);
    }
  }
  return predictions;
}

function evaluateWithFullTraining(training, testing) {
  const predictions = [];
  for (const position of positions) {
    const positionTraining = training.filter((sample) => sample.position === position);
    const positionTesting = testing.filter((sample) => sample.position === position);
    if (positionTraining.length < attributes.length || positionTesting.length === 0) continue;
    appendPredictions(predictions, positionTraining, positionTesting);
  }
  return summarize(predictions);
}

function appendPredictions(output, training, testing) {
  const attributeModel = fitRidge(training, ridge, false);
  const badgeModel = fitRidge(training, badgeRidge, true);
  for (const sample of testing) {
    const attributePrediction = predict(attributeModel, sample.features);
    const jointPrediction = predict(badgeModel, [...sample.features, ...sample.badgeFeatures]);
    const productionPrediction = sample.badgeCount > 0
      ? Math.max(attributePrediction, predict(badgeModel, [...sample.features, ...sample.badgeFeatures], true))
      : attributePrediction;
    output.push({
      version: sample.version,
      actual: sample.overall,
      attributePrediction,
      productionPrediction,
      jointPrediction,
      hasBadges: sample.badgeCount > 0,
    });
  }
}

function summarize(predictions) {
  const badgeRows = predictions.filter((row) => row.hasBadges);
  return {
    samples: predictions.length,
    attributeMae: round(average(predictions.map((row) => Math.abs(row.attributePrediction - row.actual))), 3),
    attributeRmse: round(rmse(predictions.map((row) => row.attributePrediction - row.actual)), 3),
    productionBadgeMae: round(average(badgeRows.map((row) => Math.abs(row.productionPrediction - row.actual))), 3),
    productionBadgeRmse: round(rmse(badgeRows.map((row) => row.productionPrediction - row.actual)), 3),
    badgeSamples: badgeRows.length,
    jointBadgeMae: round(average(badgeRows.map((row) => Math.abs(row.jointPrediction - row.actual))), 3),
  };
}

function fitRidge(data, lambda, withBadges) {
  const p = withBadges ? attributes.length + badgeCategories.length : attributes.length;
  const xtx = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const xty = Array(p + 1).fill(0);
  for (const sample of data) {
    const row = withBadges ? [1, ...sample.features, ...sample.badgeFeatures] : [1, ...sample.features];
    for (let i = 0; i <= p; i += 1) {
      xty[i] += row[i] * sample.overall;
      for (let j = 0; j <= p; j += 1) xtx[i][j] += row[i] * row[j];
    }
  }
  for (let i = 1; i <= p; i += 1) xtx[i][i] += lambda;
  const coefficients = solveLinearSystem(xtx, xty);
  return {
    intercept: coefficients[0],
    coefficients: Object.fromEntries(attributes.map((attribute, index) => [attribute, coefficients[index + 1]])),
    badgeCoefficients: withBadges
      ? Object.fromEntries(badgeCategories.map((category, index) => [category, coefficients[index + 1 + attributes.length]]))
      : undefined,
  };
}

function predict(model, features, nonnegativeBadges = false) {
  const attributeEstimate = attributes.reduce((total, attribute, index) => total + features[index] * (model.coefficients[attribute] ?? 0), model.intercept);
  const badgeEstimate = badgeCategories.reduce((total, category, index) => total + (features[attributes.length + index] ?? 0) * (nonnegativeBadges ? Math.max(0, model.badgeCoefficients?.[category] ?? 0) : model.badgeCoefficients?.[category] ?? 0), 0);
  return clamp(attributeEstimate + badgeEstimate, 40, 99);
}

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

function pairSharedSamples(left, right) {
  const rightById = new Map(right.map((sample) => [sample.id, sample]));
  return left.flatMap((sample) => rightById.has(sample.id) ? [[sample, rightById.get(sample.id)]] : []);
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

function rmse(errors) {
  return Math.sqrt(average(errors.map((error) => error ** 2)));
}

function round(value, places) {
  return Number(value.toFixed(places));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error("Singular matrix while fitting ridge model");
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
