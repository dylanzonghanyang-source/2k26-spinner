import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const outputDirectory = mkdtempSync(join(tmpdir(), "2k26-rookie-overall-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  execFileSync("npx", [
    "tsc",
    "src/rookieOverall.ts",
    "--target", "ES2022",
    "--module", "ESNext",
    "--moduleResolution", "Bundler",
    "--rootDir", "src",
    "--outDir", outputDirectory,
    "--resolveJsonModule",
    "--esModuleInterop",
    "--skipLibCheck",
  ], { cwd: root, stdio: "pipe" });

  writeFileSync(join(outputDirectory, "package.json"), "{\"type\":\"module\"}\n");
  const { estimateGameOverall: estimateVersionedGameOverall, overallModelAttributes } = await import(pathToFileURL(join(outputDirectory, "rookieOverall.js")).href);
  const estimate2k26 = (values, position) => estimateVersionedGameOverall(values, position, undefined, 65, "2k26");
  assert(!overallModelAttributes.includes("Overall Durability"), "Overall Durability must not be an OVR model feature");

  const players = JSON.parse(readFileSync(join(root, "src/data/versions/2k26/players.json"), "utf8"));
  const roster = JSON.parse(readFileSync(join(root, "src/data/versions/2k26/rosterCatalog.json"), "utf8"));
  const jordan = players.find((player) => player.slug === "jordan-walsh");
  const jordanRoster = roster.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players)
    .find((player) => player.id === "jordan-walsh");

  assert(jordan && jordanRoster, "Jordan Walsh calibration fixture is missing");
  const jordanPrediction = estimate2k26(jordan.detailed, "SF");
  assert(
    Math.abs(jordanPrediction - jordanRoster.overall) <= 3,
    `Jordan Walsh should be within 3 OVR (official ${jordanRoster.overall}, predicted ${jordanPrediction})`,
  );

  const baseline = Object.fromEntries(overallModelAttributes.map((attribute) => [attribute, attribute === "Intangibles" ? 50 : 70]));
  const positions = ["PG", "SG", "SF", "PF", "C"];
  for (const position of positions) {
    const baselinePrediction = estimate2k26(baseline, position);
    for (const attribute of overallModelAttributes) {
      const improved = { ...baseline, [attribute]: baseline[attribute] + 1 };
      assert(
        estimate2k26(improved, position) >= baselinePrediction,
        `${position} ${attribute} must not lower OVR when increased`,
      );
    }
  }

  const lowIntangibles = estimate2k26({ ...baseline, Intangibles: 50 }, "SF");
  const normalIntangibles = estimate2k26({ ...baseline, Intangibles: 70 }, "SF");
  assert(normalIntangibles >= lowIntangibles, "Higher Intangibles must not lower OVR");
  assert(estimate2k26(Object.fromEntries(overallModelAttributes.map((attribute) => [attribute, 25])), "C") >= 40, "OVR must not fall below 40");
  assert(estimate2k26(Object.fromEntries(overallModelAttributes.map((attribute) => [attribute, 99])), "PG") <= 99, "OVR must not exceed 99");


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
        predicted: estimate2k26(detailed.detailed, position),
      }];
    });
  const meanAbsoluteError = (rows) => rows.reduce((sum, row) => sum + Math.abs(row.predicted - row.actual), 0) / rows.length;
  const lowIntangiblesSamples = samples.filter((sample) => sample.intangibles <= 50);
  assert(samples.length === 495, `expected 495 complete 2K26 calibration samples, received ${samples.length}`);
  assert(meanAbsoluteError(samples) <= 1.1, `full-data MAE regressed to ${meanAbsoluteError(samples).toFixed(3)}`);
  if (lowIntangiblesSamples.length > 0) {
    assert(meanAbsoluteError(lowIntangiblesSamples) <= 1.5, `low-Intangibles MAE regressed to ${meanAbsoluteError(lowIntangiblesSamples).toFixed(3)}`);
  }

  console.log(JSON.stringify({
    status: "passed",
    samples: samples.length,
    fullDataMae: meanAbsoluteError(samples),
    lowIntangiblesSamples: lowIntangiblesSamples.length,
    lowIntangiblesMae: lowIntangiblesSamples.length > 0 ? meanAbsoluteError(lowIntangiblesSamples) : null,
    jordanOfficial: jordanRoster.overall,
    jordanPrediction,
  }, null, 2));
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
