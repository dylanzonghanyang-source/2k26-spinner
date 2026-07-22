import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2];

if (!sourcePath) {
  console.error("Usage: node scripts/sync-current-player-positions.mjs <nba2klab-player-roster.json>");
  process.exit(1);
}

const catalogPath = path.resolve(process.cwd(), "src/data/rosterCatalog.json");
const positionsPath = path.resolve(process.cwd(), "src/data/currentPlayerPositions.json");
const source = JSON.parse(await readFile(path.resolve(sourcePath), "utf8"));
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

if (!Array.isArray(source) || source.length < 450) {
  throw new Error(`Expected a full NBA2KLab roster, received ${source?.length ?? 0} records`);
}

// NBA2KLab has a handful of spelling variants. Normalize only verified aliases;
// fuzzy matching would risk assigning one player's position to another player.
const sourceNameAliases = new Map(Object.entries({
  "Alexandre Sarr": "Alex Sarr",
  "Alperen Sengunun": "Alperen Sengun",
  "Carlton Carrington": "Bub Carrington",
  "Daniel Gaffford": "Daniel Gafford",
  "Dario Whitehead": "Dariq Whitehead",
  "Domantatas Sabonis": "Domantas Sabonis",
  "Luke Garza": "Luka Garza",
  "lvica Zubacac": "Ivica Zubac",
  "Nicolas Claxton": "Nic Claxton",
  "Robert Dillingham": "Rob Dillingham",
  "Ron Holland": "Ronald Holland II",
  "Stephon Curry": "Stephen Curry",
  "Sviatoslav Mykhailiuk": "Svi Mykhailiuk",
  "Terence Mann": "Terance Mann",
  "Tristen Da Silva": "Tristan da Silva",
  "Tristen Vukcevic": "Tristan Vukcevic",
  "Zacchararie Risacher": "Zaccharie Risacher"
}));

const manualOverrides = new Map(Object.entries({
  "chaney-johnson": {
    position: "SG/SF",
    source: "nba-official",
    reason: "NBA official roster lists Johnson as guard-forward.",
    evidence: ["https://www.nba.com/player/1643052/chaney-johnson"]
  },
  "charles-bassey": {
    position: "C/PF",
    source: "nba-official",
    reason: "NBA official roster lists Bassey as center-forward.",
    evidence: ["https://www.nba.com/player/1629646/charles-bassey"]
  },
  "gary-payton-ii": {
    position: "SG/SF",
    source: "nba-official",
    reason: "NBA official roster lists Payton as a guard; the 2KRatings SF/PF fallback conflicts with that role.",
    evidence: ["https://www.nba.com/player/1627780/gary-payton-ii"]
  },
  "jaylin-williams": {
    position: "PF/C",
    source: "nba-official",
    reason: "NBA official roster lists F and the Thunder describes Williams as a forward/center.",
    evidence: [
      "https://www.nba.com/players",
      "https://www.nba.com/thunder/news/release-williams-250629"
    ]
  },
  "taj-gibson": {
    position: "PF/C",
    source: "nba-official",
    reason: "NBA official roster lists Gibson as a forward; center remains his secondary 2K role.",
    evidence: ["https://www.nba.com/player/201959/taj-gibson"]
  },
  "thomas-bryant": {
    position: "C/PF",
    source: "nba-official",
    reason: "NBA official roster lists Bryant as center-forward.",
    evidence: ["https://www.nba.com/player/1628418/thomas-bryant"]
  }
}));

const sourceByName = new Map();
for (const player of source) {
  const sourceName = `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  const canonicalName = sourceNameAliases.get(sourceName) ?? sourceName;
  const position = normalizePosition(player.position);
  if (!canonicalName || !position) continue;

  const key = normalizeName(canonicalName);
  if (sourceByName.has(key)) {
    throw new Error(`Duplicate NBA2KLab player after normalization: ${canonicalName}`);
  }
  sourceByName.set(key, { position });
}

const currentTeams = catalog.teams.filter((team) => team.category === "current");
const records = [];
const unresolved = [];
let matched = 0;
let overridden = 0;

for (const team of currentTeams) {
  for (const player of team.players) {
    const override = manualOverrides.get(player.id);
    const baseline = sourceByName.get(normalizeName(player.name));
    const position = override?.position ?? baseline?.position ?? player.position;
    validatePosition(position, `${team.name}: ${player.name}`);

    if (override) overridden += 1;
    else if (baseline) matched += 1;
    else unresolved.push({ id: player.id, name: player.name, team: team.name, position });

    player.position = position;
    records.push({
      id: player.id,
      name: player.name,
      team: team.name,
      position,
      source: override?.source ?? (baseline ? "nba2klab" : "2kratings"),
      ...(override ? { reason: override.reason, evidence: override.evidence } : {})
    });
  }
}

const positions = {
  version: "NBA 2K26 Play Now positions",
  generatedAt: new Date().toISOString(),
  sources: {
    nba2klab: "https://www.nba2klab.com/.netlify/functions/player-roster",
    nbaOfficial: "https://www.nba.com/players",
    fallback: catalog.source
  },
  summary: {
    currentTeams: currentTeams.length,
    currentPlayers: records.length,
    nba2klabMatches: matched,
    manualOverrides: overridden,
    fallbackRecords: unresolved.length
  },
  players: records
};

await writeFile(positionsPath, `${JSON.stringify(positions, null, 2)}\n`, "utf8");
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");

console.log(`Synced ${records.length} current-player positions (${matched} NBA2KLab, ${overridden} official overrides, ${unresolved.length} fallbacks).`);
if (unresolved.length > 0) {
  console.log("Fallback records retained from 2KRatings:");
  for (const player of unresolved) {
    console.log(`- ${player.team}: ${player.name} (${player.position})`);
  }
}

function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .replace(/(jr|sr|ii|iii|iv)$/i, "");
}

function normalizePosition(value) {
  if (typeof value !== "string") return null;
  return value.trim().replace(/\s*\|\s*/g, "/");
}

function validatePosition(position, label) {
  const parts = typeof position === "string" ? position.split("/") : [];
  const valid = new Set(["PG", "SG", "SF", "PF", "C"]);
  if (parts.length < 1 || parts.length > 2 || parts.some((part) => !valid.has(part)) || new Set(parts).size !== parts.length) {
    throw new Error(`Invalid position for ${label}: ${position}`);
  }
}
