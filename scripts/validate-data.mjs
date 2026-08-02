import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const requiredFiles = [
  "src/data/players.json",
  "src/data/rosterCatalog.json",
  "src/data/rookieOverallModel.json",
  "src/data/currentPlayerPositions.json",
  "src/data/badgeProfiles.2k26.json",
  "src/data/badgeProfiles.2k27.json",
  "src/data/badgeProfiles.meta.json",
];

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
}

const players = JSON.parse(await readFile(path.join(root, "src/data/players.json"), "utf8"));
const roster = JSON.parse(await readFile(path.join(root, "src/data/rosterCatalog.json"), "utf8"));
const model = JSON.parse(await readFile(path.join(root, "src/data/rookieOverallModel.json"), "utf8"));
const positions = JSON.parse(await readFile(path.join(root, "src/data/currentPlayerPositions.json"), "utf8"));

assert(Array.isArray(players) && players.length > 0, "players.json must contain players");
assert(roster?.version?.includes("2K27"), `rosterCatalog version should be 2K27, got ${roster?.version}`);
assert(positions?.version?.includes("2K27"), `currentPlayerPositions version should be 2K27, got ${positions?.version}`);
assert(Array.isArray(model.attributes) && model.attributes.length > 0, "overall model attributes missing");
assert(model.positions?.PG && model.positions?.C, "overall model positions incomplete");
assert(typeof model.crossValidation?.mae === "number", "overall model CV metrics missing");

const slugs = new Set(players.map((player) => player.slug).filter(Boolean));
assert(slugs.size === players.length, "players.json contains duplicate or missing slugs");

const currentPlayers = roster.teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players);
const matched = currentPlayers.filter((player) => slugs.has(player.id)).length;
assert(matched >= 300, `expected at least 300 detailed current players, got ${matched}`);

console.log(JSON.stringify({
  status: "passed",
  players: players.length,
  currentPlayers: currentPlayers.length,
  detailedCurrentPlayers: matched,
  rosterVersion: roster.version,
  positionsVersion: positions.version,
  modelSamples: model.trainingSamples,
  modelMae: model.crossValidation.mae,
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
