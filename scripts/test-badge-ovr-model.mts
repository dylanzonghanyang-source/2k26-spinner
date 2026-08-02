#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateGameOverall } from "../src/rookieOverall.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = JSON.parse(fs.readFileSync(path.join(root, "src/data/rookieOverallModel.json"), "utf8"));
assert(model.positionsWithBadges?.PG?.badgeCoefficients, "model must expose positionsWithBadges with badge coefficients");
assert.equal(model.badgeCombination, "monotonic-max-nonnegative", "model metadata must describe the production badge combination");
assert(
  model.crossValidation.badgeSubsetMae < model.crossValidation.mae,
  "production badge model must improve held-out MAE over the attribute-only model",
);

const values = {
  "Three-Point Shot": 95, "Mid-Range Shot": 90, "Close Shot": 85, "Free Throw": 92,
  "Ball Handle": 94, "Pass Accuracy": 88, "Pass IQ": 90, "Pass Vision": 93,
  "Speed": 86, "Speed with Ball": 90, "Agility": 88, "Vertical": 80, "Strength": 60, "Stamina": 90, "Hustle": 85,
  "Layup": 84, "Driving Dunk": 70, "Standing Dunk": 55, "Post Control": 60, "Post Fade": 70, "Post Hook": 62,
  "Block": 40, "Steal": 65, "Perimeter Defense": 75, "Interior Defense": 60,
  "Defensive Consistency": 85, "Offensive Consistency": 95, "Shot IQ": 92,
  "Offensive Rebound": 40, "Defensive Rebound": 55, "Hands": 90, "Draw Foul": 85, "Overall Durability": 88, "Pass Perception": 80, "Help Defense IQ": 70, "Intangibles": 90,
};

const noBadges = estimateGameOverall(values, "PG");
const shootingBadges = [
  { category: "shooting", tier: "HOF" },
  { category: "shooting", tier: "Gold" },
  { category: "shooting", tier: "Gold" },
  { category: "playmaking", tier: "HOF" },
];
const balancedValues = Object.fromEntries(model.attributes.map((attribute: string) => [attribute, 70]));
const withBadges = estimateGameOverall(values, "PG", shootingBadges);

assert(noBadges >= 40 && noBadges <= 99, "no-badge estimate must stay in range");
assert(
  withBadges >= noBadges,
  `badges must never lower OVR (got ${withBadges} vs ${noBadges})`,
);
assert(
  estimateGameOverall(balancedValues, "PG", [{ category: "defense", tier: "HOF" }])
    < estimateGameOverall(balancedValues, "PG", shootingBadges),
  "shooting badges should outweigh a single defense badge for a shooter",
);

// No-badge call must use the attribute-only model. Feeding zero badges into
// the joint model systematically underrates high-end players.
const attributeOnlyExpected = Math.round(Math.min(99, Math.max(40,
  model.positions.PG.intercept
  + Object.entries(values).reduce((sum, [attribute, value]) =>
    sum + value * (model.positions.PG.coefficients[attribute] ?? 0), 0),
)));
assert.equal(noBadges, attributeOnlyExpected, "no-badge path must use the attribute-only model");

assert(
  estimateGameOverall(balancedValues, "PG", shootingBadges) > estimateGameOverall(balancedValues, "PG"),
  "high-level shooting/playmaking badges must raise a balanced PG's OVR",
);

const detailedPlayers = JSON.parse(fs.readFileSync(path.join(root, "src/data/players.json"), "utf8"));
const roster = JSON.parse(fs.readFileSync(path.join(root, "src/data/rosterCatalog.json"), "utf8"));
const badgeProfiles = JSON.parse(fs.readFileSync(path.join(root, "src/data/badgeProfiles.2k27.json"), "utf8"));
const detailedBySlug = new Map(detailedPlayers.map((player: { slug: string }) => [player.slug, player]));
for (const player of roster.teams.filter((team: { category: string }) => team.category === "current").flatMap((team: { players: unknown[] }) => team.players)) {
  const detailed = detailedBySlug.get(player.id) as { detailed: Record<string, number> } | undefined;
  const playerBadges = badgeProfiles[player.id] ?? [];
  if (!detailed || playerBadges.length === 0) continue;
  const position = player.position.split("/")[0] as "PG" | "SG" | "SF" | "PF" | "C";
  const fullOverall = estimateGameOverall(detailed.detailed, position, playerBadges);
  for (let index = 0; index < playerBadges.length; index += 1) {
    const withoutBadge = playerBadges.filter((_: unknown, badgeIndex: number) => badgeIndex !== index);
    assert(
      fullOverall >= estimateGameOverall(detailed.detailed, position, withoutBadge),
      `${player.name}: adding ${playerBadges[index].name} must not lower OVR`,
    );
  }
}

console.log(`badge OVR contract OK: no-badges=${noBadges}, with-shooting-badges=${withBadges}`);
