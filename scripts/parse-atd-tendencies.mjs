#!/usr/bin/env node
/**
 * Parse ATD (Attention to Detail) 2K26 tendency workbook into tendencyProfiles.json
 *
 * Source: https://github.com/Amir0705/NBA-2K26-Tendency-Generator
 *   - "ATD Committee Roster Edits  - Tendency Test Edit - PlainSightToSee.csv" (158KB, 526 players)
 *   - NBA_2K_Tendency_Master.csv / Scales.csv (definitions, caps)
 *
 * Output: src/data/tendencyProfiles.json
 *   {
 *     "<slug>": {
 *       "name": "Joel Embiid",
 *       "team": "Philadelphia 76ers",
 *       "source": "atd-2k26-committee",
 *       "tendencies": { "Shot": 60, "Touches": 55, ... }
 *     }
 *   }
 *
 * Note: values are ATD's data-driven rework (real NBA stats), NOT official 2K26
 * MyNBA rookie-card tendencies. Non-numeric cells (e.g. "Default +10") are kept
 * as-is in a separate "raw" field and dropped from the numeric map.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src", "data");

const CSV = process.argv[2] || "/tmp/atd_tendency.csv";
const OUT = path.join(SRC, "tendencyProfiles.json");

// ---------- load players.json + rosterCatalog for slug mapping ----------
const players = JSON.parse(fs.readFileSync(path.join(SRC, "players.json"), "utf8"));
const nameToSlug = new Map();
for (const p of players) {
  const n = String(p.name || "").toLowerCase().trim();
  if (n) nameToSlug.set(n, p.slug);
}

// rosterCatalog is the actual pool the app queries (PlayerSource.id = roster player id).
// Prefer its ids so tendencyProfiles.min.json keys match App.tsx lookups.
const rosterCatalog = JSON.parse(fs.readFileSync(path.join(SRC, "rosterCatalog.json"), "utf8"));
const rosterNameToId = new Map();
for (const team of rosterCatalog.teams ?? []) {
  for (const player of team.players ?? []) {
    const n = String(player.name || "").toLowerCase().trim();
    if (n && player.id) rosterNameToId.set(n, player.id);
  }
}
const normalizedRosterKey = (raw) => raw.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
// map normalized-name -> roster id (handles dots/hyphens in roster names)
const rosterNormToId = new Map();
for (const [n, id] of rosterNameToId) rosterNormToId.set(normalizedRosterKey(n), id);

// slug lookup with fuzzy normalization
const NAME_VARIANTS = {
  "cam whitmore": "cameron whitmore",
  "nicholas claxton": "nicolas claxton",
  "alex sarr": "alexandre sarr",
  "brandon carlson": "branden carlson",
  "daequan plowden": "daeqwon plowden",
  "svi mykhailiuk": "sviatoslav mykhailiuk",
  "terrence mann": "terance mann",
  "daron holmes ii": "daron holmes",
  "ron holland ii": "ronald holland",
  "scottie pippen jr": "scotty pippen jr",
  "xavier tillman sr": "xavier tillman",
  "dereck lively ii": "dereck lively",
  "miles mcb ride": "miles mcbride",
};
function slugFor(atdName) {
  const raw = atdName.trim().toLowerCase();
  const candidates = new Set([
    raw,
    raw.replace(/\./g, ""),                       // "a.j. green" -> "aj green"
    raw.replace(/\s+jr\.?$/, ""),                  // "bobby portis jr." -> "bobby portis"
    raw.replace(/\s+jr\.?$/i, "") + " jr",         // "bruce brown" -> "bruce brown jr"
    raw.replace(/\./g, "").replace(/\s+jr$/, ""),  // both
    raw.replace(/\./g, "").replace(/['’]/g, ""),
    raw.replace(/\s+jr\.?$/i, "").replace(/\./g, ""),
    raw.replace(/-/g, " "),                        // "gilgeous-alexander" -> "gilgeous alexander"
    raw.replace(/\./g, "").replace(/-/g, " "),
    raw.replace(/[-\s]+/g, "-"),                   // spaces -> dashes
    raw.replace(/\s+(iii|iv|v|lll)\.?$/i, ""),     // "murphy iii/lll" -> "murphy"
    raw.replace(/\s+jr\.?$/i, "").replace(/-/g, " "),
    raw.replace(/\s+(ii|iii|iv|v|lll)\.?$/i, ""),  // "holmes ii" -> "holmes"
  ]);
  for (const c of candidates) {
    if (nameToSlug.has(c)) return nameToSlug.get(c);
  }
  // explicit nickname/typo map
  const mapped = NAME_VARIANTS[raw] || NAME_VARIANTS[raw.replace(/\./g, "")];
  if (mapped && nameToSlug.has(mapped)) return nameToSlug.get(mapped);
  // rosterCatalog normalized-name lookup (primary key for the app)
  const norm = normalizedRosterKey(raw);
  if (rosterNormToId.has(norm)) return rosterNormToId.get(norm);
  const mappedNorm = mapped ? normalizedRosterKey(mapped) : null;
  if (mappedNorm && rosterNormToId.has(mappedNorm)) return rosterNormToId.get(mappedNorm);
  // compact fallback: strip non-alphanumeric
  const compact = raw.replace(/[^a-z ]/g, "").replace(/\s+/g, " ");
  if (nameToSlug.has(compact)) return nameToSlug.get(compact);
  if (rosterNormToId.has(compact)) return rosterNormToId.get(compact);
  return null;
}

// ---------- parse ATD CSV ----------
const lines = fs.readFileSync(CSV, "utf8").split(/\r?\n/);
let header = [];
let dataStart = -1;
for (let i = 0; i < Math.min(lines.length, 8); i++) {
  // header spans two rows: row i = '"Tendency', row i+1 = '(In Order)",Shot,Touches,...'
  const thisRow = lines[i];
  const nextRow = i + 1 < lines.length ? lines[i + 1] : "";
  if (thisRow.includes("Tendency") && nextRow.includes("Shot")) {
    let cells = thisRow.split(",").concat(nextRow.split(","));
    header = cells.map((c) => c.replace(/^"|"$/g, "").trim());
    dataStart = i + 2;
    break;
  }
}
if (dataStart < 0) {
  console.error("Could not locate tendency header row");
  process.exit(1);
}
// header[0] = "Tendency", header[1] = "(In Order)" -> tendency names from header[2..]
const tendencyNames = header.slice(2);

const profiles = {};
const unmatchedByName = {};
let currentTeam = null;
let matched = 0;
let unmatched = [];
let parsedRows = 0;

for (let i = dataStart; i < lines.length; i++) {
  const cells = lines[i].split(",");
  const name = (cells[0] || "").replace(/^"|"$/g, "").trim();
  if (!name) continue;

  // team banner row: no numeric values in the rest of the row
  const rest = cells.slice(1).map((c) => c.trim());
  if (!rest.some((c) => /^-?\d+(\.\d+)?$/.test(c))) {
    currentTeam = name;
    continue;
  }

  parsedRows++;
  const slug = slugFor(name);
  const numeric = {};
  const raw = {};
  for (let j = 0; j < tendencyNames.length; j++) {
    const v = (cells[j + 2] || "").trim();
    if (v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0 && num <= 100) {
      numeric[tendencyNames[j]] = num;
    } else {
      // out-of-range (e.g. source typo "440") or non-numeric ("Default +10"):
      // keep original in raw, never pollute the numeric map
      raw[tendencyNames[j]] = v;
    }
  }

  if (slug) {
    matched++;
    profiles[slug] = {
      name: name,
      team: currentTeam,
      source: "atd-2k26-committee",
      tendencies: numeric,
    };
    if (Object.keys(raw).length) profiles[slug].raw = raw;
  } else {
    unmatched.push({ name, team: currentTeam, tendencies: numeric });
    // keep by-name for players missing from players.json (future mapping)
    const key = name.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
    unmatchedByName[key] = {
      name: name,
      team: currentTeam,
      source: "atd-2k26-committee",
      tendencies: numeric,
    };
    if (Object.keys(raw).length) unmatchedByName[key].raw = raw;
  }
}

fs.writeFileSync(OUT, JSON.stringify(profiles, null, 2) + "\n");
const OUT_UNMATCHED = path.join(SRC, "tendencyProfilesByName.json");
fs.writeFileSync(OUT_UNMATCHED, JSON.stringify(unmatchedByName, null, 2) + "\n");
// Compact build used by the app: shared field names + aligned value rows.
// This avoids repeating ~96 tendency keys for every player.
const OUT_MIN = path.join(SRC, "tendencyProfiles.min.json");
const compactSlugs = Object.keys(profiles).sort();
const compactFields = [...new Set(
  compactSlugs.flatMap((slug) => Object.keys(profiles[slug].tendencies)),
)].sort();
const compactRows = compactSlugs.map((slug) =>
  compactFields.map((field) => profiles[slug].tendencies[field] ?? null),
);
fs.writeFileSync(OUT_MIN, JSON.stringify({
  slugs: compactSlugs,
  fields: compactFields,
  rows: compactRows,
}) + "\n");

console.log(JSON.stringify({
  output: OUT,
  outputByName: OUT_UNMATCHED,
  parsedRows,
  matchedSlugs: matched,
  unmatched: unmatched.length,
  tendencyFields: tendencyNames.length,
  sampleUnmatched: unmatched.slice(0, 20).map((u) => u.name),
}, null, 2));
