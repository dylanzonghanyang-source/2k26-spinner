#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "src", "data");
const snapshot2k26Url = "https://raw.githubusercontent.com/Rush-Shaw/nba-player-attributes/cd6e02c14ea65022b1263d05c1add35acd1728d6/data/raw/2k26_roster_raw.json";
const api2k27Url = "https://api.nba2kapi.com/api/public/players?teamType=curr&limit=100";
const tierRank = { Bronze: 1, Silver: 2, Gold: 3, HOF: 4, Legendary: 5 };
const tierMap = {
  Bronze: "Bronze",
  Silver: "Silver",
  Gold: "Gold",
  "Hall of Fame": "HOF",
  HOF: "HOF",
  Legend: "Legendary",
  Legendary: "Legendary",
};
const sourceCategoryMap = {
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
const categoryByName = new Map([
  ["Aerial Wizard", "athleticism"],
  ["Brick Wall", "inside"],
  ["Lightning Launch", "athleticism"],
  ["Pogo Stick", "defense"],
  ["Slippery Off-Ball", "shooting"],
]);

const [rosterCatalog, gameExportOverrides2k26] = await Promise.all([
  readJson(path.join(dataDir, "rosterCatalog.json")),
  readJson(path.join(dataDir, "badgeProfiles.2k26.game-export.json")),
]);

const [snapshot2k26, api2k27] = await Promise.all([
  fetchJson(snapshot2k26Url),
  fetchAll2k27Players(),
]);

const rows2k26 = snapshot2k26.filter((row) => row.gameVersion === "2K26");
const profiles2k26 = {
  ...profilesFromRows(rows2k26),
  ...gameExportOverrides2k26,
};

const currentSlugs = new Set(
  rosterCatalog.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players.map((player) => player.id)),
);
const row2k27BySlug = new Map(api2k27.map((row) => [row.slug, row]));
const matched2k27 = [...currentSlugs]
  .map((slug) => row2k27BySlug.get(slug))
  .filter(Boolean);
const profiles2k27 = profilesFromRows(matched2k27);
const unmatchedSlugs = [...currentSlugs].filter((slug) => !row2k27BySlug.has(slug)).sort();

const metadata = {
  "2K26": profileMetadata({
    gameVersion: "2K26",
    source: snapshot2k26Url,
    rows: rows2k26,
    profiles: profiles2k26,
    unmatchedSlugs: [],
    gameExportOverrides: Object.keys(gameExportOverrides2k26).length,
  }),
  "2K27": profileMetadata({
    gameVersion: "2K27",
    source: api2k27Url,
    rows: matched2k27,
    profiles: profiles2k27,
    unmatchedSlugs,
  }),
};

await Promise.all([
  writeJson(path.join(dataDir, "badgeProfiles.2k26.json"), profiles2k26),
  writeJson(path.join(dataDir, "badgeProfiles.2k27.json"), profiles2k27),
  writeJson(path.join(dataDir, "badgeProfiles.meta.json"), metadata),
]);

console.log(JSON.stringify(metadata, null, 2));

function profilesFromRows(rows) {
  return Object.fromEntries(rows
    .filter((row) => row.slug)
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((row) => [row.slug, normalizeBadges(row.badges?.list ?? [])]));
}

function normalizeBadges(sourceBadges) {
  const unique = new Map();
  for (const sourceBadge of sourceBadges) {
    const name = sourceBadge?.name?.trim();
    const tier = tierMap[sourceBadge?.tier];
    if (!name || !tier) continue;
    const category = categoryByName.get(name) ?? sourceCategoryMap[sourceBadge.category] ?? "general";
    const badge = { name, category, tier };
    const existing = unique.get(name);
    if (!existing || tierRank[tier] > tierRank[existing.tier]) unique.set(name, badge);
  }
  return [...unique.values()].sort((left, right) =>
    tierRank[right.tier] - tierRank[left.tier] || left.name.localeCompare(right.name));
}

function profileMetadata({ gameVersion, source, rows, profiles, unmatchedSlugs, gameExportOverrides = 0 }) {
  const updated = rows.map((row) => row.lastUpdated).filter(Boolean).sort();
  const values = Object.values(profiles);
  return {
    gameVersion,
    source,
    sourceLastUpdated: updated.at(-1) ?? null,
    knownProfiles: values.length,
    positiveProfiles: values.filter((badges) => badges.length > 0).length,
    zeroBadgeProfiles: values.filter((badges) => badges.length === 0).length,
    totalBadges: values.reduce((sum, badges) => sum + badges.length, 0),
    gameExportOverrides,
    unmatchedSlugs,
  };
}

async function fetchAll2k27Players() {
  const rows = [];
  let cursor = null;
  do {
    const url = cursor ? `${api2k27Url}&cursor=${encodeURIComponent(cursor)}` : api2k27Url;
    const response = await fetchJson(url);
    if (!response.success || !Array.isArray(response.data)) throw new Error(`Unexpected NBA2KAPI response for ${url}`);
    rows.push(...response.data);
    cursor = response.meta?.pagination?.hasMore ? response.meta.pagination.nextCursor : null;
  } while (cursor);
  return rows.filter((row) => row.gameVersion === "2K27");
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "2k26-spinner badge sync" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.json();
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
