import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const snapshotPath = process.argv[2];

if (!snapshotPath) {
  console.error("Usage: node scripts/update-current-rosters.mjs <2kratings-roster-snapshot.json>");
  process.exit(1);
}

const catalogPath = path.resolve(process.cwd(), "src/data/rosterCatalog.json");
const positionsPath = path.resolve(process.cwd(), "src/data/currentPlayerPositions.json");
const snapshot = JSON.parse(await readFile(path.resolve(snapshotPath), "utf8"));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const positionCatalog = JSON.parse(await readFile(positionsPath, "utf8"));

validateSnapshot(snapshot);

const positionByPlayerId = new Map(positionCatalog.players.map((player) => [player.id, player.position]));

const currentTeams = new Map(snapshot.teams.map((team) => [team.name, team]));
const updatedTeams = catalog.teams.map((team) => {
  if (team.category !== "current") return team;

  const latest = currentTeams.get(team.name);
  if (!latest) {
    throw new Error(`Latest snapshot is missing current team: ${team.name}`);
  }

  return {
    ...team,
    players: latest.players.map((player) => ({
      drivingDunk: player.drivingDunk,
      height: player.height,
      id: player.slug,
      name: player.name,
      overall: player.overall,
      position: positionByPlayerId.get(player.slug) ?? player.position,
      threePoint: player.threePoint
    }))
  };
});

const updatedCatalog = {
  ...catalog,
  version: snapshot.version,
  source: snapshot.source,
  generatedAt: snapshot.generatedAt,
  teams: updatedTeams
};

await writeFile(catalogPath, `${JSON.stringify(updatedCatalog, null, 2)}\n`, "utf8");
console.log(`Updated ${snapshot.teams.length} current teams in ${catalogPath}`);

function validateSnapshot(data) {
  if (!Array.isArray(data.teams) || data.teams.length !== 30) {
    throw new Error(`Expected 30 current teams, received ${data.teams?.length ?? 0}`);
  }

  const teamNames = new Set();
  const playerOwners = new Map();

  for (const team of data.teams) {
    if (!team.name || teamNames.has(team.name)) {
      throw new Error(`Invalid or duplicate team name: ${team.name}`);
    }
    teamNames.add(team.name);

    if (!Array.isArray(team.players) || team.players.length === 0) {
      throw new Error(`Team has no players: ${team.name}`);
    }

    for (const player of team.players) {
      if (![player.slug, player.name, player.position, player.height].every((value) => typeof value === "string" && value.trim())) {
        throw new Error(`Incomplete player record on ${team.name}: ${JSON.stringify(player)}`);
      }
      validatePosition(player.position, `${team.name}: ${player.name}`);
      for (const rating of ["overall", "threePoint", "drivingDunk"]) {
        if (!Number.isInteger(player[rating]) || player[rating] < 25 || player[rating] > 99) {
          throw new Error(`Invalid ${rating} for ${team.name}: ${player.name}`);
        }
      }
      if (playerOwners.has(player.slug)) {
        throw new Error(`${player.name} appears on both ${playerOwners.get(player.slug)} and ${team.name}`);
      }
      playerOwners.set(player.slug, team.name);
    }
  }
}

function validatePosition(position, label) {
  const parts = position.split("/");
  const valid = new Set(["PG", "SG", "SF", "PF", "C"]);
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !valid.has(part)) || new Set(parts).size !== parts.length) {
    throw new Error(`Invalid position for ${label}: ${position}`);
  }
}
