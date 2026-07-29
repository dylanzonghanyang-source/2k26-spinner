import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const outputDirectory = mkdtempSync(join(tmpdir(), "2k26-rookie-overall-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync("npx", [
    "tsc",
    "src/rookieOverall.ts",
    "src/rookieDevelopment.ts",
    "--target", "ES2022",
    "--module", "CommonJS",
    "--moduleResolution", "Node",
    "--rootDir", "src",
    "--outDir", outputDirectory,
    "--resolveJsonModule",
    "--esModuleInterop",
    "--skipLibCheck",
  ], { cwd: root, stdio: "pipe" });

  const require = createRequire(import.meta.url);
  const { estimateGameOverall, overallModelAttributes } = require(join(outputDirectory, "rookieOverall.js"));
  const {
    initialOverallForPotential,
    initialOverallRange,
    resolveOverallCalibration,
  } = require(join(outputDirectory, "rookieDevelopment.js"));
  const players = JSON.parse(readFileSync(join(root, "src/data/players.json"), "utf8"));
  const roster = JSON.parse(readFileSync(join(root, "src/data/rosterCatalog.json"), "utf8"));
  const jordan = players.find((player) => player.slug === "jordan-walsh");
  const jordanRoster = roster.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players)
    .find((player) => player.id === "jordan-walsh");

  assert(jordan && jordanRoster, "Jordan Walsh calibration fixture is missing");
  const jordanPrediction = estimateGameOverall(jordan.detailed, "SF");
  assert(
    Math.abs(jordanPrediction - jordanRoster.overall) <= 3,
    `Jordan Walsh should be within 3 OVR (official ${jordanRoster.overall}, predicted ${jordanPrediction})`,
  );

  const baseline = Object.fromEntries(overallModelAttributes.map((attribute) => [attribute, attribute === "Intangibles" ? 50 : 70]));
  const positions = ["PG", "SG", "SF", "PF", "C"];
  for (const position of positions) {
    const baselinePrediction = estimateGameOverall(baseline, position);
    for (const attribute of overallModelAttributes) {
      const improved = { ...baseline, [attribute]: baseline[attribute] + 1 };
      assert(
        estimateGameOverall(improved, position) >= baselinePrediction,
        `${position} ${attribute} must not lower OVR when increased`,
      );
    }
  }

  const lowIntangibles = estimateGameOverall({ ...baseline, Intangibles: 50 }, "SF");
  const normalIntangibles = estimateGameOverall({ ...baseline, Intangibles: 70 }, "SF");
  assert(normalIntangibles >= lowIntangibles, "Higher Intangibles must not lower OVR");
  assert(estimateGameOverall(Object.fromEntries(overallModelAttributes.map((attribute) => [attribute, 25])), "C") === 40, "OVR floor must be 40");
  assert(estimateGameOverall(Object.fromEntries(overallModelAttributes.map((attribute) => [attribute, 99])), "PG") === 99, "OVR cap must be 99");

  const nonMonotonicRange = initialOverallRange({ min: 82, max: 99 }, 18, 1);
  assert(nonMonotonicRange.min === 53 && nonMonotonicRange.max === 65, `expected complete 53-65 range, received ${nonMonotonicRange.min}-${nonMonotonicRange.max}`);
  assert(initialOverallForPotential(87, 18, 1) === 65, "selected potential must map directly to its initial OVR");

  const lockedHigh = resolveOverallCalibration({
    configuredPotential: 87,
    configuredPotentialRange: { min: 82, max: 87 },
    projectedInitialRange: { min: 70, max: 75 },
    peakOverall: 99,
    peakDistance: 12,
    initialOverall: 99,
    initialDistance: 24,
  });
  assert(lockedHigh.potential === 99 && lockedHigh.potentialRange.min === 99 && lockedHigh.initialRange.min === 99, "unreachable 99 locks must reconcile result to 99");

  const lockedLow = resolveOverallCalibration({
    configuredPotential: 82,
    configuredPotentialRange: { min: 82, max: 87 },
    projectedInitialRange: { min: 70, max: 75 },
    peakOverall: 40,
    peakDistance: 42,
    initialOverall: 40,
    initialDistance: 30,
  });
  assert(lockedLow.potential === 40 && lockedLow.potentialRange.max === 40 && lockedLow.initialRange.max === 40, "unreachable 25 locks must reconcile result to 40 OVR floor");

  const reachable = resolveOverallCalibration({
    configuredPotential: 84,
    configuredPotentialRange: { min: 82, max: 87 },
    projectedInitialRange: { min: 70, max: 75 },
    peakOverall: 83,
    peakDistance: 1,
    initialOverall: 72,
    initialDistance: 1,
  });
  assert(!reachable.hasConflict && reachable.potential === 84, "one-point calibration tolerance must remain valid");

  const detailedBySlug = new Map(players.map((player) => [player.slug, player]));
  const samples = roster.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players)
    .flatMap((player) => {
      const detailed = detailedBySlug.get(player.id);
      if (!detailed || typeof player.overall !== "number") return [];
      const position = player.position.split("/")[0];
      return [{
        actual: player.overall,
        intangibles: detailed.detailed.Intangibles,
        predicted: estimateGameOverall(detailed.detailed, position),
      }];
    });
  const meanAbsoluteError = (rows) => rows.reduce((sum, row) => sum + Math.abs(row.predicted - row.actual), 0) / rows.length;
  const lowIntangiblesSamples = samples.filter((sample) => sample.intangibles <= 50);
  assert(samples.length === 385, `expected 385 complete calibration samples, received ${samples.length}`);
  assert(meanAbsoluteError(samples) <= 1.1, `full-data MAE regressed to ${meanAbsoluteError(samples).toFixed(3)}`);
  assert(meanAbsoluteError(lowIntangiblesSamples) <= 1.5, `low-Intangibles MAE regressed to ${meanAbsoluteError(lowIntangiblesSamples).toFixed(3)}`);

  console.log(JSON.stringify({
    status: "passed",
    samples: samples.length,
    fullDataMae: meanAbsoluteError(samples),
    lowIntangiblesSamples: lowIntangiblesSamples.length,
    lowIntangiblesMae: meanAbsoluteError(lowIntangiblesSamples),
    jordanOfficial: jordanRoster.overall,
    jordanPrediction,
  }, null, 2));
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
