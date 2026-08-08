#!/usr/bin/env node
/**
 * Sync the current 2K27 Play Now roster from NBA2KAPI.
 *
 * Safety rules:
 * - Only updates src/data/versions/2k27-play-now.
 * - Requires all existing 30 NBA teams and at least 400 non-Free-Agency players.
 * - Keeps classic/All-Time teams untouched.
 * - Rebuilds the current player attributes, badges, and OVR model only after
 *   the API payload passes validation.
 * - Prints nothing when there is no change (useful for a silent cron watchdog).
 */

import { readFile, rename, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const root = path.resolve(process.cwd());
const packDir = path.join(root, "src/data/versions/2k27-play-now");
const rosterPath = path.join(packDir, "rosterCatalog.json");
const playersPath = path.join(packDir, "players.json");
const badgesPath = path.join(packDir, "badges.json");
const metadataPath = path.join(packDir, "metadata.json");
const apiBaseUrl = "https://api.nba2kapi.com/api/public/players?teamType=curr&limit=100";
const sourceLabel = `${apiBaseUrl} (paginated)`;
const minimumCurrentPlayers = 400;

const previousRoster = await readJson(rosterPath);
const rows = await fetchAllPlayers();
const currentTeams = previousRoster.teams.filter((team) => team.category === "current");
const teamNames = new Set(currentTeams.map((team) => team.name));
const currentRows = rows.filter((row) => row.gameVersion === "2K27" && teamNames.has(row.team));
validatePayload(currentRows, teamNames);

const nextCurrentTeams = buildCurrentTeams(currentRows, currentTeams);
const nextRoster = {
  ...previousRoster,
  version: "NBA 2K27 Play Now",
  source: sourceLabel,
  generatedAt: latestDate(currentRows.map((row) => row.lastUpdated ?? row.createdAt)) ?? new Date().toISOString(),
  teams: previousRoster.teams.map((team) => team.category === "current"
    ? nextCurrentTeams.find((candidate) => candidate.id === team.id) ?? team
    : team),
};
const nextRosterIds = new Set(nextCurrentTeams.flatMap((team) => team.players.map((player) => player.id)));
const nextPlayers = currentRows.filter((row) => nextRosterIds.has(row.slug)).map(normalizePlayer).sort(bySlug);
const nextBadges = Object.fromEntries(currentRows
  .filter((row) => nextRosterIds.has(row.slug))
  .map((row) => [row.slug, normalizeBadges(row.badges?.list ?? [])])
  .sort(([left], [right]) => left.localeCompare(right)));

const previousCurrentByPlayer = currentPlayerTeamMap(previousRoster);
const nextCurrentByPlayer = currentPlayerTeamMap(nextRoster);
const moves = [...nextCurrentByPlayer.entries()]
  .filter(([slug, team]) => previousCurrentByPlayer.has(slug) && previousCurrentByPlayer.get(slug) !== team)
  .map(([slug, team]) => ({ slug, from: previousCurrentByPlayer.get(slug), to: team }));

const changed = await hasChanges([
  [rosterPath, nextRoster],
  [playersPath, nextPlayers],
  [badgesPath, nextBadges],
]);
if (!changed) process.exit(0);

await writeJsonAtomic(rosterPath, nextRoster);
await writeJsonAtomic(playersPath, nextPlayers);
await writeJsonAtomic(badgesPath, nextBadges);

const previousMetadata = await readJson(metadataPath);
await writeJsonAtomic(metadataPath, {
  ...previousMetadata,
  label: "NBA 2K27 Play Now",
  roster: {
    source: sourceLabel,
    generatedAt: nextRoster.generatedAt,
    teams: nextRoster.teams.length,
    players: countRosterPlayers(nextRoster),
  },
  players: { source: sourceLabel, profiles: nextPlayers.length },
  badges: { source: sourceLabel, profiles: Object.keys(nextBadges).length },
  tendencies: {
    available: false,
    profiles: 0,
    note: "目前没有独立的 2K27 Play Now 倾向来源；不复用 2K26 倾向。",
  },
  overallModel: { file: "rookieOverallModel.json" },
});

// Retrain BOTH version models with the combined cross-version dataset. The
// production contract (validate:data) requires identical combined models for
// 2K26 and 2K27; a single-version retrain would silently break it.
await execFileAsync("node", ["scripts/train-rookie-overall-model.mjs", "combined", "src/data/versions/2k26/rookieOverallModel.json"], { cwd: root });
await execFileAsync("node", ["scripts/train-rookie-overall-model.mjs", "combined", "src/data/versions/2k27-play-now/rookieOverallModel.json"], { cwd: root });

// Fail closed if the updated packs no longer satisfy the data contracts;
// a broken half-synced state must not be silently shipped to production.
await execFileAsync("node", ["scripts/validate-data.mjs"], { cwd: root });
await execFileAsync("pnpm", ["run", "build"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });

console.log(JSON.stringify({
  status: "updated",
  version: "NBA 2K27 Play Now",
  currentPlayers: nextCurrentByPlayer.size,
  detailedPlayers: nextPlayers.length,
  badgeProfiles: Object.keys(nextBadges).length,
  moves: moves.slice(0, 50),
  moveCount: moves.length,
  generatedAt: nextRoster.generatedAt,
}, null, 2));

async function fetchAllPlayers() {
  const rows = [];
  let cursor = null;
  do {
    const url = cursor ? `${apiBaseUrl}&cursor=${encodeURIComponent(cursor)}` : apiBaseUrl;
    const response = await fetch(url, { headers: { "User-Agent": "2k26-spinner roster sync" } });
    if (!response.ok) throw new Error(`NBA2KAPI returned HTTP ${response.status} for ${url}`);
    const payload = await response.json();
    if (!payload.success || !Array.isArray(payload.data)) throw new Error(`Unexpected NBA2KAPI payload for ${url}`);
    rows.push(...payload.data);
    cursor = payload.meta?.pagination?.hasMore ? payload.meta.pagination.nextCursor : null;
  } while (cursor);
  return rows;
}

function validatePayload(rows, teamNames) {
  const byTeam = new Map();
  const slugs = new Set();
  for (const row of rows) {
    if (!row?.slug || !row?.name || !row?.team || !Array.isArray(row.positions) || row.positions.length === 0) {
      throw new Error(`Invalid current player record: ${JSON.stringify(row)}`);
    }
    if (slugs.has(row.slug)) throw new Error(`Duplicate current player slug from API: ${row.slug}`);
    slugs.add(row.slug);
    if (!byTeam.has(row.team)) byTeam.set(row.team, 0);
    byTeam.set(row.team, byTeam.get(row.team) + 1);
  }
  if (byTeam.size !== teamNames.size || [...teamNames].some((team) => !byTeam.has(team))) {
    throw new Error(`API team coverage failed: ${byTeam.size}/${teamNames.size} teams`);
  }
  if (rows.length < minimumCurrentPlayers) {
    throw new Error(`API current roster is suspiciously small: ${rows.length} players`);
  }
}

function buildCurrentTeams(rows, existingTeams) {
  const rowsByTeam = new Map();
  for (const row of rows) {
    if (!rowsByTeam.has(row.team)) rowsByTeam.set(row.team, []);
    rowsByTeam.get(row.team).push({
      drivingDunk: numberOrNull(row.attributes?.drivingDunk),
      height: row.height ?? null,
      id: row.slug,
      name: row.name,
      overall: numberOrNull(row.overall),
      potential: numberOrNull(row.potential ?? row.potentialOverall),
      position: row.positions.join("/") || null,
      threePoint: numberOrNull(row.attributes?.threePointShot),
    });
  }
  return existingTeams.map((team) => ({
    ...team,
    players: rowsByTeam.get(team.name).sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

function normalizePlayer(row) {
  const attrs = row.attributes ?? {};
  const detailed = {
    "Close Shot": attrs.closeShot,
    "Mid-Range Shot": attrs.midRangeShot,
    "Three-Point Shot": attrs.threePointShot,
    "Free Throw": attrs.freeThrow,
    "Offensive Consistency": attrs.offensiveConsistency,
    "Shot IQ": attrs.shotIQ,
    Speed: attrs.speed,
    Strength: attrs.strength,
    Agility: attrs.agility,
    Vertical: attrs.vertical,
    Hustle: attrs.hustle,
    Stamina: attrs.stamina,
    "Overall Durability": attrs.durability,
    "Ball Handle": attrs.ballHandle,
    "Speed with Ball": attrs.speedWithBall,
    "Pass Accuracy": attrs.passAccuracy,
    "Pass Vision": attrs.passVision,
    "Pass IQ": attrs.passIQ,
    Block: attrs.block,
    Steal: attrs.steal,
    "Pass Perception": attrs.passPerception,
    "Interior Defense": attrs.interiorDefense,
    "Perimeter Defense": attrs.perimeterDefense,
    "Defensive Consistency": attrs.defensiveConsistency,
    "Help Defense IQ": attrs.helpDefenseIQ,
    Layup: attrs.drivingLayup,
    "Driving Dunk": attrs.drivingDunk,
    "Standing Dunk": attrs.standingDunk,
    "Post Hook": attrs.postHook,
    "Post Fade": attrs.postFade,
    "Post Control": attrs.postControl,
    "Draw Foul": attrs.drawFoul,
    Hands: attrs.hands,
    "Offensive Rebound": attrs.offensiveRebound,
    "Defensive Rebound": attrs.defensiveRebound,
    Intangibles: attrs.intangibles,
  };
  return {
    name: row.name,
    slug: row.slug,
    overall: numberOrNull(row.overall),
    potential: numberOrNull(row.potential ?? row.potentialOverall),
    team: row.team ?? null,
    position: row.positions.join("/") || null,
    archetype: row.archetype ?? row.build ?? null,
    height: row.height ?? null,
    weight: parseWeight(row.weight),
    wingspan: row.wingspan ?? null,
    shooting: average([attrs.closeShot, attrs.midRangeShot, attrs.threePointShot, attrs.freeThrow, attrs.offensiveConsistency, attrs.shotIQ]),
    athleticism: average([attrs.speed, attrs.strength, attrs.agility, attrs.vertical, attrs.hustle, attrs.stamina, attrs.durability]),
    playmaking: average([attrs.ballHandle, attrs.speedWithBall, attrs.passAccuracy, attrs.passVision, attrs.passIQ]),
    defense: average([attrs.block, attrs.steal, attrs.passPerception, attrs.interiorDefense, attrs.perimeterDefense, attrs.defensiveConsistency, attrs.helpDefenseIQ, attrs.defensiveRebound]),
    inside: average([attrs.drivingLayup, attrs.drivingDunk, attrs.standingDunk, attrs.postHook, attrs.postFade, attrs.postControl, attrs.drawFoul, attrs.hands, attrs.offensiveRebound, attrs.defensiveRebound, attrs.closeShot]),
    detailed: Object.fromEntries(Object.entries(detailed).filter(([, value]) => Number.isFinite(value)).map(([key, value]) => [key, Math.round(value)])),
  };
}

function normalizeBadges(sourceBadges) {
  const categoryMap = {
    "Outside Scoring": "shooting",
    Shooting: "shooting",
    "Inside Scoring": "inside",
    Finishing: "inside",
    Playmaking: "playmaking",
    Defense: "defense",
    Rebounding: "rebounding",
    "General Offense": "general",
    "All Around": "athleticism",
    Athleticism: "athleticism",
  };
  const tierMap = { Bronze: "Bronze", Silver: "Silver", Gold: "Gold", "Hall of Fame": "HOF", HOF: "HOF", Legend: "Legendary", Legendary: "Legendary" };
  const rank = { Bronze: 1, Silver: 2, Gold: 3, HOF: 4, Legendary: 5 };
  const unique = new Map();
  for (const badge of sourceBadges) {
    const name = badge?.name?.trim();
    const tier = tierMap[badge?.tier];
    if (!name || !tier) continue;
    const normalized = { name, category: categoryMap[badge.category] ?? "general", tier };
    const previous = unique.get(name);
    if (!previous || rank[tier] > rank[previous.tier]) unique.set(name, normalized);
  }
  return [...unique.values()].sort((left, right) => rank[right.tier] - rank[left.tier] || left.name.localeCompare(right.name));
}

function currentPlayerTeamMap(roster) {
  return new Map(roster.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players.map((player) => [player.id, team.name])));
}

async function hasChanges(entries) {
  for (const [file, value] of entries) {
    const next = `${JSON.stringify(value, null, 2)}\n`;
    let previous = "";
    try { previous = await readFile(file, "utf8"); } catch { return true; }
    if (previous !== next) return true;
  }
  return false;
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;
}

function parseWeight(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function latestDate(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function countRosterPlayers(roster) {
  return roster.teams.reduce((sum, team) => sum + team.players.length, 0);
}

function bySlug(left, right) {
  return left.slug.localeCompare(right.slug);
}
