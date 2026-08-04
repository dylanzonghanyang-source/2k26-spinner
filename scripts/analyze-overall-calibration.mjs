import detailedPlayers from "../src/data/versions/2k26/players.json" with { type: "json" };
import rosterCatalog from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import rookieOverallModel from "../src/data/versions/2k26/rookieOverallModel.json" with { type: "json" };

const secondaryShare = 0.25;
const folds = 5;
const bundles = [
  ["three", ["Three-Point Shot"]],
  ["mid", ["Mid-Range Shot", "Free Throw"]],
  ["face", ["Layup", "Close Shot", "Draw Foul", "Hands"]],
  ["post", ["Post Fade", "Post Hook", "Post Control"]],
  ["dunk", ["Driving Dunk", "Standing Dunk"]],
  ["handle", ["Ball Handle", "Speed with Ball"]],
  ["passing", ["Pass Accuracy", "Pass IQ", "Pass Vision"]],
  ["perimeter", ["Perimeter Defense"]],
  ["interior", ["Interior Defense"]],
  ["steal", ["Steal", "Pass Perception"]],
  ["block", ["Block"]],
  ["rebound", ["Offensive Rebound", "Defensive Rebound"]],
  ["athletic", ["Speed", "Agility", "Vertical", "Strength", "Stamina", "Hustle"]],
  ["stability", ["Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ", "Overall Durability"]]
];

const weights = {
  PG: { three: 10, mid: 10, face: 6, post: 2, dunk: 4, handle: 14, passing: 14, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 12, stability: 8 },
  SG: { three: 12, mid: 12, face: 7, post: 3, dunk: 6, handle: 10, passing: 8, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 12, stability: 10 },
  SF: { three: 10, mid: 10, face: 7, post: 3, dunk: 8, handle: 8, passing: 6, perimeter: 7, interior: 8, steal: 3, block: 4, rebound: 6, athletic: 14, stability: 6 },
  PF: { three: 8, mid: 6, face: 6, post: 6, dunk: 6, handle: 6, passing: 4, perimeter: 7, interior: 12, steal: 3, block: 8, rebound: 10, athletic: 14, stability: 4 },
  C: { three: 4, mid: 4, face: 4, post: 6, dunk: 8, handle: 2, passing: 4, perimeter: 3, interior: 14, steal: 1, block: 12, rebound: 14, athletic: 18, stability: 6 }
};

const detailedBySlug = new Map(detailedPlayers.map((player) => [player.slug, player]));
const samples = rosterCatalog.teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players)
  .flatMap((player) => {
    const detailed = detailedBySlug.get(player.id);
    if (!detailed || typeof player.overall !== "number") return [];

    const [position, secondary = position] = player.position.split("/");
    const values = Object.fromEntries(bundles.map(([bundleId, attributes]) => [
      bundleId,
      average(attributes.map((attribute) => detailed.detailed[attribute]).filter(Number.isFinite), 65)
    ]));
    const raw = Object.entries(values).reduce((total, [bundleId, value]) => {
      const weight = weights[position][bundleId] * (1 - secondaryShare) + weights[secondary][bundleId] * secondaryShare;
      return total + value * weight;
    }, 0) / 100;
    return [{
      id: player.id,
      name: player.name,
      position,
      overall: player.overall,
      raw,
      bundleMean: average(Object.values(values)),
      detailed: detailed.detailed,
      production: estimateProductionOverall(detailed.detailed, position)
    }];
  });

const predictions = [];
for (let fold = 0; fold < folds; fold += 1) {
  for (const position of Object.keys(weights)) {
    const training = samples.filter((sample) => sample.position === position && foldFor(sample.id) !== fold);
    const testing = samples.filter((sample) => sample.position === position && foldFor(sample.id) === fold);
    const calibration = fit(training);
    for (const sample of testing) {
      predictions.push({ ...sample, old: sample.raw, calibrated: calibration.intercept + calibration.slope * sample.raw });
    }
  }
}

console.log(`Matched samples: ${samples.length}`);
console.log(`Old formula: ${formatMetrics(metrics(predictions, "old"))}`);
console.log(`${folds}-fold calibrated: ${formatMetrics(metrics(predictions, "calibrated"))}`);
console.log(`Production model full-data fit: ${formatMetrics(metrics(samples, "production"))}`);
console.log(`Production model recorded ${rookieOverallModel.crossValidation.folds}-fold validation: MAE=${rookieOverallModel.crossValidation.mae.toFixed(3)}, RMSE=${rookieOverallModel.crossValidation.rmse.toFixed(3)}`);
const lowIntangibles = samples.filter((sample) => sample.detailed.Intangibles <= 50);
console.log(lowIntangibles.length > 0
  ? `Production model Intangibles <= 50: n=${lowIntangibles.length}, ${formatMetrics(metrics(lowIntangibles, "production"))}`
  : "Production model Intangibles <= 50: n=0, no observed subset");
const jordanWalsh = samples.find((sample) => sample.id === "jordan-walsh");
const jordanWalshOld = predictions.find((sample) => sample.id === "jordan-walsh");
if (jordanWalsh) console.log(`Jordan Walsh: official=${jordanWalsh.overall}, old=${jordanWalshOld?.calibrated.toFixed(2) ?? "n/a"}, production=${jordanWalsh.production}`);
for (const position of Object.keys(weights)) {
  const positionSamples = predictions.filter((sample) => sample.position === position);
  const calibration = fit(samples.filter((sample) => sample.position === position));
  console.log(`${position}: n=${positionSamples.length}, ${formatMetrics(metrics(positionSamples, "calibrated"))}, intercept=${calibration.intercept.toFixed(4)}, slope=${calibration.slope.toFixed(4)}`);
}

const pointGuards = predictions.filter((sample) => sample.position === "PG");
for (const [minimum, maximum] of [[60, 70], [70, 75], [75, 78], [78, 82], [82, 100]]) {
  const group = pointGuards.filter((sample) => sample.bundleMean >= minimum && sample.bundleMean < maximum);
  if (group.length === 0) continue;
  console.log(`PG slot mean ${minimum}-${maximum}: n=${group.length}, official=${average(group.map((sample) => sample.overall)).toFixed(2)}, old=${average(group.map((sample) => sample.old)).toFixed(2)}, calibrated=${average(group.map((sample) => sample.calibrated)).toFixed(2)}`);
}
for (const [minimum, maximum] of [[65, 70], [70, 75], [75, 80], [80, 85], [85, 100]]) {
  const group = pointGuards.filter((sample) => sample.raw >= minimum && sample.raw < maximum);
  if (group.length === 0) continue;
  console.log(`PG raw ${minimum}-${maximum}: n=${group.length}, official=${average(group.map((sample) => sample.overall)).toFixed(2)}, old=${average(group.map((sample) => sample.old)).toFixed(2)}, calibrated=${average(group.map((sample) => sample.calibrated)).toFixed(2)}`);
}

function average(values, fallback = 0) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function estimateProductionOverall(values, position) {
  const positionModel = rookieOverallModel.positions[position] ?? rookieOverallModel.positions.SF;
  const estimate = rookieOverallModel.attributes.reduce((total, attribute) => {
    const value = Number.isFinite(values[attribute]) ? values[attribute] : attribute === "Intangibles" ? 50 : 65;
    return total + Math.max(25, Math.min(99, value)) * (positionModel.coefficients[attribute] ?? 0);
  }, positionModel.intercept);
  return Math.round(Math.max(40, Math.min(99, estimate)));
}

function fit(data) {
  const meanRaw = average(data.map((sample) => sample.raw));
  const meanOverall = average(data.map((sample) => sample.overall));
  const slope = data.reduce((sum, sample) => sum + (sample.raw - meanRaw) * (sample.overall - meanOverall), 0)
    / data.reduce((sum, sample) => sum + (sample.raw - meanRaw) ** 2, 0);
  return { intercept: meanOverall - slope * meanRaw, slope };
}

function foldFor(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % folds;
}

function metrics(data, key) {
  return {
    mae: average(data.map((sample) => Math.abs(sample[key] - sample.overall))),
    bias: average(data.map((sample) => sample[key] - sample.overall)),
    rmse: Math.sqrt(average(data.map((sample) => (sample[key] - sample.overall) ** 2)))
  };
}

function formatMetrics(result) {
  return `MAE=${result.mae.toFixed(2)}, RMSE=${result.rmse.toFixed(2)}, bias=${result.bias.toFixed(2)}`;
}
