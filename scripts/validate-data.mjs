import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const packs = [
  { key: "2K26", label: "NBA 2K26", directory: "2k26", tendencyRequired: true },
  { key: "2K27", label: "NBA 2K27 Play Now", directory: "2k27-play-now", tendencyRequired: false },
];

const summaries = [];
const currentRosterIdsByVersion = new Map();

for (const pack of packs) {
  const dir = path.join(root, "src/data/versions", pack.directory);
  const files = {
    metadata: path.join(dir, "metadata.json"),
    roster: path.join(dir, "rosterCatalog.json"),
    players: path.join(dir, "players.json"),
    badges: path.join(dir, "badges.json"),
    tendencies: path.join(dir, "tendencyProfiles.min.json"),
    overallModel: path.join(dir, "rookieOverallModel.json"),
  };
  for (const file of Object.values(files)) await access(file);

  const [metadata, roster, players, badges, tendencies, overallModel] = await Promise.all(
    Object.values(files).map((file) => readJson(file)),
  );
  assert(metadata.version === pack.key, `${pack.key}: metadata version mismatch`);
  assert(metadata.label === pack.label, `${pack.key}: metadata label mismatch`);
  assert(Array.isArray(roster.teams) && roster.teams.length > 0, `${pack.key}: roster teams missing`);
  assert(Array.isArray(players) && players.length > 0, `${pack.key}: players missing`);
  assert(badges && typeof badges === "object" && !Array.isArray(badges), `${pack.key}: badges map missing`);
  assert(Array.isArray(tendencies.slugs) && Array.isArray(tendencies.fields) && Array.isArray(tendencies.rows), `${pack.key}: tendency table invalid`);
  assert(overallModel.dataVersion === "2K26 + 2K27 combined", `${pack.key}: OVR model must use the combined cross-version model`);
  assert(
    Array.isArray(overallModel.sourceVersions) && overallModel.sourceVersions.join(",") === "2k26,2k27",
    `${pack.key}: OVR model source versions mismatch`,
  );
  assert(overallModel.foldStrategy === "player-id", `${pack.key}: OVR model must group shared player IDs during CV`);
  assert(overallModel.trainingSamples >= 900, `${pack.key}: combined OVR model has too few samples`);

  const playerSlugs = new Set(players.map((player) => player.slug).filter(Boolean));
  assert(playerSlugs.size === players.length, `${pack.key}: duplicate or missing detailed player slugs`);
  const currentPlayers = roster.teams.filter((team) => team.category === "current").flatMap((team) => team.players);
  const currentIds = new Set(currentPlayers.map((player) => player.id));
  const detailedCurrent = currentPlayers.filter((player) => playerSlugs.has(player.id)).length;
  const badgeCurrent = currentPlayers.filter((player) => Object.hasOwn(badges, player.id)).length;
  assert(currentPlayers.length > 0, `${pack.key}: current roster empty`);
  assert(detailedCurrent / currentPlayers.length >= 0.9, `${pack.key}: only ${detailedCurrent}/${currentPlayers.length} current players have detailed attributes`);
  assert(badgeCurrent / currentPlayers.length >= 0.9, `${pack.key}: only ${badgeCurrent}/${currentPlayers.length} current players have badge profiles`);
  assert(tendencies.slugs.every((slug) => currentIds.has(slug)), `${pack.key}: tendency table contains a player outside its roster`);
  if (pack.tendencyRequired) assert(tendencies.slugs.length >= 400, `${pack.key}: expected the independent 2K26 tendency table`);
  if (!pack.tendencyRequired) assert(tendencies.slugs.length === 0, `${pack.key}: must not reuse 2K26 tendencies`);

  currentRosterIdsByVersion.set(pack.key, currentIds);
  summaries.push({
    version: pack.label,
    teams: roster.teams.length,
    rosterPlayers: roster.teams.reduce((sum, team) => sum + team.players.length, 0),
    currentPlayers: currentPlayers.length,
    detailedCurrent,
    badgeCurrent,
    tendencyProfiles: tendencies.slugs.length,
    ovrTrainingSamples: overallModel.trainingSamples,
    ovrMae: overallModel.crossValidation?.mae ?? null,
  });
}

const ids26 = currentRosterIdsByVersion.get("2K26");
const ids27 = currentRosterIdsByVersion.get("2K27");
const shared = [...ids26].filter((id) => ids27.has(id)).length;
assert(ids26.size !== ids27.size || shared !== ids26.size, "2K26 and 2K27 current rosters are unexpectedly identical");

console.log(JSON.stringify({ status: "passed", packs: summaries, sharedCurrentIds: shared }, null, 2));

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
