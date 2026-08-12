import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname;
const outputDirectory = mkdtempSync(join(tmpdir(), "2k26-rookie-initial-overall-"));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  execFileSync("npx", [
    "tsc",
    "src/rookieOverall.ts",
    "src/rookieInitialOverall.ts",
    "--target", "ES2022",
    "--module", "ESNext",
    "--moduleResolution", "Bundler",
    "--rootDir", "src",
    "--outDir", outputDirectory,
    "--resolveJsonModule",
    "--esModuleInterop",
    "--skipLibCheck",
  ], { cwd: root, stdio: "pipe" });

  const { estimateGameOverall } = await import(pathToFileURL(join(outputDirectory, "rookieOverall.js")).href);
  const { constrainRookieInitialAttributes, initialOverallForPotential } = await import(pathToFileURL(join(outputDirectory, "rookieInitialOverall.js")).href);
  const values = {
    Agility: 87, "Ball Handle": 77, Block: 82, "Close Shot": 87,
    "Defensive Consistency": 74, "Defensive Rebound": 85, "Draw Foul": 87,
    "Driving Dunk": 81, "Free Throw": 79, Hands: 87, "Help Defense IQ": 77,
    Hustle: 87, "Interior Defense": 79, Layup: 85, "Mid-Range Shot": 85,
    "Offensive Consistency": 82, "Offensive Rebound": 83, "Pass Accuracy": 83,
    "Pass IQ": 84, "Pass Perception": 78, "Pass Vision": 66,
    "Perimeter Defense": 85, "Post Control": 79, "Post Fade": 82,
    "Post Hook": 82, "Shot IQ": 78, Speed: 83, "Speed with Ball": 78,
    Stamina: 91, "Standing Dunk": 80, Steal: 77, Strength: 85,
    "Three-Point Shot": 74, Vertical: 93, Intangibles: 50,
  };
  const estimate = (candidate: Record<string, number>, badges: Array<{ category?: string; tier: string }>) => (
    estimateGameOverall(candidate, "SF", badges, 65, "2k26")
  );
  const badges = [
    { category: "inside", tier: "Silver" },
    { category: "playmaking", tier: "Silver" },
    { category: "playmaking", tier: "Silver" },
    { category: "playmaking", tier: "Silver" },
    { category: "defense", tier: "Silver" },
    { category: "defense", tier: "Silver" },
    { category: "inside", tier: "Silver" },
  ];
  const rawOverall = estimate(values, badges);
  const constrained = constrainRookieInitialAttributes({
    values,
    potential: 98,
    adjustableAttributes: Object.keys(values),
    badges,
    estimateOverall: estimate,
  });

  assert(initialOverallForPotential(98) === 86, "98 potential must target 86 OVR (age no longer participates)");
  // Golden fixture: re-trained with non-negative coefficient constraint on 2026-08-10 (958 samples).
  assert(rawOverall === 93, `Reece Martin fixture should reproduce 93 OVR, received ${rawOverall}`);
  assert(constrained.changed, "the 90 OVR fixture must be adjusted");
  assert(constrained.reachable, "the unlocked 90 OVR fixture must reach its target");
  assert(constrained.actualOverall <= 86, `constrained fixture must be <=86, received ${constrained.actualOverall}`);
  assert(estimate(constrained.values, []) === constrained.actualOverall, "reported constrained OVR must match the final attributes");

  const lowValues = Object.fromEntries(Object.keys(values).map((attribute) => [attribute, 65]));
  const unchanged = constrainRookieInitialAttributes({
    values: lowValues,
    potential: 98,
    adjustableAttributes: Object.keys(lowValues),
    estimateOverall: estimate,
  });
  assert(!unchanged.changed, "a below-target rookie must not be boosted");
  assert(unchanged.offset === 0, "a below-target rookie must keep its attributes");

  console.log(JSON.stringify({
    status: "passed",
    rawOverall,
    targetOverall: constrained.targetOverall,
    constrainedOverall: constrained.actualOverall,
    offset: constrained.offset,
  }, null, 2));
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}