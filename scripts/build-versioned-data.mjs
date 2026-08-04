#!/usr/bin/env node
/**
 * Build isolated data packs for NBA 2K26 and NBA 2K27 Play Now.
 *
 * Inputs:
 *   node scripts/build-versioned-data.mjs [2k26-raw.json] [2k27-api.json]
 *
 * The 2K26 input is the 2K26 roster snapshot from 2KRatings/Rush-Shaw.
 * The 2K27 input is the flattened result of the paginated NBA2KAPI request.
 * Existing versioned badge/tendency sources are copied/remapped into the packs.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const sourceDataDir = path.join(root, "src", "data");
const outputRoot = path.join(sourceDataDir, "versions");
const output26 = path.join(outputRoot, "2k26");
const output27 = path.join(outputRoot, "2k27-play-now");
const raw26Path = path.resolve(process.argv[2] ?? "/tmp/2k26_roster_raw.json");
const api27Path = path.resolve(process.argv[3] ?? "/tmp/2k27_api_curr.json");

const [raw26, api27, legacyCatalog27, badges26, badges27, tendencyProfiles] = await Promise.all([
  readJson(raw26Path),
  readJson(api27Path),
  readJson(path.join(sourceDataDir, "rosterCatalog.json")),
  readJson(path.join(sourceDataDir, "badgeProfiles.2k26.json")),
  readJson(path.join(sourceDataDir, "badgeProfiles.2k27.json")),
  readJson(path.join(sourceDataDir, "tendencyProfiles.json")),
]);

const rows26 = dedupeBySlug(raw26.filter((row) => row?.gameVersion === "2K26"));
const rows27 = dedupeBySlug(api27.filter((row) => row?.gameVersion === "2K27"));
if (rows26.length === 0) throw new Error("No 2K26 rows found in the raw input.");
if (rows27.length === 0) throw new Error("No 2K27 rows found in the API input.");

const roster26 = buildCurrentRoster(rows26, {
  version: "NBA 2K26",
  source: "https://raw.githubusercontent.com/Rush-Shaw/nba-player-attributes/cd6e02c14ea65022b1263d05c1add35acd1728d6/data/raw/2k26_roster_raw.json",
});
const roster26Ids = new Set(roster26.teams.flatMap((team) => team.players.map((player) => player.id)));
const badges26ForRoster = Object.fromEntries(Object.entries(badges26).filter(([slug]) => roster26Ids.has(slug)));
const roster27 = {
  ...legacyCatalog27,
  version: "NBA 2K27 Play Now",
  source: "https://www.2kratings.com/current-teams",
};
const roster27Ids = new Set(roster27.teams.flatMap((team) => team.players.map((player) => player.id)));

const players26 = rows26.map(normalizePlayer).sort(bySlug);
const players27 = rows27.filter((row) => roster27Ids.has(row.slug)).map(normalizePlayer).sort(bySlug);
const tendencies26 = buildCompactTendencies(roster26, tendencyProfiles);
const tendencies27 = emptyTendencies();

await mkdir(output26, { recursive: true });
await mkdir(output27, { recursive: true });

await Promise.all([
  writeJson(path.join(output26, "rosterCatalog.json"), roster26),
  writeJson(path.join(output26, "players.json"), players26),
  writeJson(path.join(output26, "badges.json"), badges26ForRoster),
  writeJson(path.join(output26, "tendencyProfiles.min.json"), tendencies26),
  writeJson(path.join(output26, "metadata.json"), {
    version: "2K26",
    label: "NBA 2K26",
    roster: { source: roster26.source, generatedAt: roster26.generatedAt, teams: roster26.teams.length, players: countRosterPlayers(roster26) },
    players: { source: roster26.source, profiles: players26.length },
    badges: { source: "src/data/badgeProfiles.2k26.json", profiles: Object.keys(badges26ForRoster).length },
    tendencies: { source: "ATD 2K26 committee export", available: tendencies26.slugs.length > 0, profiles: tendencies26.slugs.length },
    overallModel: { file: "rookieOverallModel.json" },
  }),
  writeJson(path.join(output27, "rosterCatalog.json"), roster27),
  writeJson(path.join(output27, "players.json"), players27),
  writeJson(path.join(output27, "badges.json"), badges27),
  writeJson(path.join(output27, "tendencyProfiles.min.json"), tendencies27),
  writeJson(path.join(output27, "metadata.json"), {
    version: "2K27",
    label: "NBA 2K27 Play Now",
    roster: { source: roster27.source, generatedAt: roster27.generatedAt, teams: roster27.teams.length, players: countRosterPlayers(roster27) },
    players: { source: "https://api.nba2kapi.com/api/public/players?teamType=curr&limit=100", profiles: players27.length },
    badges: { source: "src/data/badgeProfiles.2k27.json", profiles: Object.keys(badges27).length },
    tendencies: { available: false, profiles: 0, note: "目前没有独立的 2K27 Play Now 倾向来源；不复用 2K26 倾向。" },
    overallModel: { file: "rookieOverallModel.json" },
  }),
]);

console.log(JSON.stringify({
  status: "passed",
  outputRoot: path.relative(root, outputRoot),
  packs: {
    "2K26": { rosterPlayers: countRosterPlayers(roster26), detailedPlayers: players26.length, badges: Object.keys(badges26ForRoster).length, tendencies: tendencies26.slugs.length },
    "2K27 Play Now": { rosterPlayers: countRosterPlayers(roster27), detailedPlayers: players27.length, badges: Object.keys(badges27).length, tendencies: tendencies27.slugs.length },
  },
}, null, 2));

function buildCurrentRoster(rows, meta) {
  const byTeam = new Map();
  for (const row of rows) {
    const teamName = typeof row.team === "string" && row.team.trim() ? row.team.trim() : "Free Agency";
    if (!byTeam.has(teamName)) byTeam.set(teamName, []);
    byTeam.get(teamName).push({
      drivingDunk: numberOrNull(row.attributes?.drivingDunk),
      height: row.height ?? null,
      id: row.slug,
      name: row.name,
      overall: numberOrNull(row.overall),
      potential: numberOrNull(row.potential ?? row.potentialOverall),
      position: (row.positions ?? []).join("/") || null,
      threePoint: numberOrNull(row.attributes?.threePointShot),
    });
  }

  const teams = [...byTeam.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, players]) => ({
      id: slugify(name),
      name,
      category: "current",
      players: players.sort((left, right) => left.name.localeCompare(right.name)),
    }));

  return {
    version: meta.version,
    source: meta.source,
    generatedAt: latestDate(rows.map((row) => row.lastUpdated ?? row.createdAt)),
    teams,
  };
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
    name: row.name ?? row.slug.replace(/-/g, " "),
    slug: row.slug,
    overall: numberOrNull(row.overall),
    potential: numberOrNull(row.potential ?? row.potentialOverall),
    team: row.team ?? null,
    position: (row.positions ?? []).join("/") || null,
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

function buildCompactTendencies(roster, profiles) {
  const bySlug = new Map(Object.entries(profiles));
  const byName = new Map(Object.values(profiles).map((profile) => [normalizeName(profile.name), profile]));
  const mapped = new Map();
  for (const player of roster.teams.flatMap((team) => team.players)) {
    const profile = bySlug.get(player.id) ?? byName.get(normalizeName(player.name));
    if (profile?.tendencies && Object.keys(profile.tendencies).length > 0) {
      mapped.set(player.id, profile.tendencies);
    }
  }
  const slugs = [...mapped.keys()].sort();
  const fields = [...new Set(slugs.flatMap((slug) => Object.keys(mapped.get(slug) ?? {})))].sort();
  return { slugs, fields, rows: slugs.map((slug) => fields.map((field) => mapped.get(slug)?.[field] ?? null)) };
}

function emptyTendencies() {
  return { slugs: [], fields: [], rows: [] };
}

function dedupeBySlug(rows) {
  const bySlug = new Map();
  for (const row of rows) {
    if (!row?.slug) continue;
    const existing = bySlug.get(row.slug);
    const existingDate = existing?.lastUpdated ?? existing?.createdAt ?? "";
    const nextDate = row.lastUpdated ?? row.createdAt ?? "";
    if (!existing || nextDate >= existingDate) bySlug.set(row.slug, row);
  }
  return [...bySlug.values()];
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

function normalizeName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
