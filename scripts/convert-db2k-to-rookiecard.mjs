#!/usr/bin/env node
/**
 * Convert DB2K Editor Draft Class snapshot JSON -> rookieCards/{year}/{slug}.json
 *
 * Source: discobisco/2k26-Editor `export_player_roster_snapshot_for_items()` output
 *   (mode "Draft Class", 150 records). Validated 2026-08-07 against 2018 Luka
 *   in-game card: attributes, tendencies, potential, badge tiers all match UI.
 *
 * Usage:
 *   node scripts/convert-db2k-to-rookiecard.mjs \
 *     --input /path/to/player_roster_snapshot.json \
 *     --year 2018 \
 *     --out src/data/rookieCards/2018 \
 *     [--whitelist data/raw/db2k/2018-whitelist.json] \
 *     [--overrides data/raw/db2k/2018-overrides.json]
 *
 * Output per player (schema: references/rookie-card-schema.md):
 *   { slug, name, draftYear, source, gameVersion, capturedAt, overall,
 *     position, secondaryPosition, height, weight, wingspan,
 *     detailed: {<35 project attrs>}, badges: [{name, tier}],
 *     tendencies: {<96 project fields>} }
 *
 * Notes:
 * - Stats section (incl. Stats/OVERALL) is untrusted — ignored. OVR comes
 *   exclusively from --overrides (user UI confirmation).
 * - Badge tiers: 1=Bronze, 2=Silver, 3=Gold, 4=HOF (calibrated vs Luka).
 * - Personality badges (LAIDBACK 淡定 etc.) are recorded separately, never
 *   merged into gameplay badges.
 * - Hot-zone fields (3LEFT/Hot, MIDRANGELEFT/Cold, ...) are NOT tendencies;
 *   they are skipped. CONTESTSHOT / ISOVSPOORDEFENDER are extra DB2K fields
 *   not in the project's 96-field map — also skipped.
 * - 13 DB2K zone fields + 2 extras = 112 - 96 = 16 unused fields explained.
 */

import fs from "node:fs";
import path from "node:path";
import { normalizeHeightInches } from "./lib/height-units.mjs";

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const INPUT = getArg("--input") || "/Users/yangzonghan/Downloads/player_roster_snapshot.json";
const YEAR = Number(getArg("--year") || 2018);
const OUT_DIR = getArg("--out") || path.join("src", "data", "rookieCards", String(YEAR));
const WHITELIST = getArg("--whitelist");
const OVERRIDES = getArg("--overrides");

// ============================================================
// Field name maps
// ============================================================

// DB2K Attributes/<NAME> -> project 35-attribute name
const ATTR_MAP = {
  AGILITY: "Agility",
  BALLCONTROL: "Ball Handle",
  BLOCK: "Block",
  CLOSESHOT: "Close Shot",
  DEFENSECONSISTENCY: "Defensive Consistency",
  DEFENSEREBOUND: "Defensive Rebound",
  DRAWFOUL: "Draw Foul",
  DRIVINGDUNK: "Driving Dunk",
  FREETHROW: "Free Throw",
  HANDS: "Hands",
  HELPDEFENSE: "Help Defense IQ",
  HUSTLE: "Hustle",
  INTANGIBLES: "Intangibles",
  INTERIORDEFENSE: "Interior Defense",
  IQSHOT: "Shot IQ",
  MIDRANGE: "Mid-Range Shot",
  OFFENSIVECONSISTENCY: "Offensive Consistency",
  OFFENSIVEREBOUND: "Offensive Rebound",
  PASSACCURACY: "Pass Accuracy",
  PASSIQ: "Pass IQ",
  PASSPERCEPTION: "Pass Perception",
  PASSVISION: "Pass Vision",
  PERIMETERDEFENSE: "Perimeter Defense",
  POSTCONTROL: "Post Control",
  POSTFADE: "Post Fade",
  POSTHOOK: "Post Hook",
  SPEED: "Speed",
  SPEEDWITHBALL: "Speed with Ball",
  STAMINA: "Stamina",
  STANDINGDUNK: "Standing Dunk",
  STEAL: "Steal",
  STRENGTH: "Strength",
  THREE_POINT: "Three-Point Shot", // key adjusted below
  VERTICAL: "Vertical",
  LAYUP: "Layup", // DRIVINGLAYUP
};
// DB2K uses DRIVINGLAYUP for Layup and 3POINT for Three-Point Shot
ATTR_MAP.DRIVINGLAYUP = "Layup";
ATTR_MAP["3POINT"] = "Three-Point Shot";
delete ATTR_MAP.THREE_POINT;
delete ATTR_MAP.LAYUP;

// DB2K Badges/<NAME> -> canonical project badge name (from badgeBundleMap.ts)
const BADGE_MAP = {
  AERIALWIZARD: "Aerial Wizard",
  ANKLEBREAKER: "Ankle Assassin", // alias confirmed
  BAILOUT: "Bail Out",
  BOXOUTBEAST: "Boxout Beast",
  BREAKSTARTER: "Break Starter",
  BRICKWALL: "Brick Wall",
  CHALLENGER: "Challenger",
  DEADEYE: "Deadeye",
  DIMER: "Dimer",
  FLOATGAME: "Float Game",
  GLOVE: "Glove",
  HANDLESFORDAYS: "Handles For Days",
  HIGHFLYINGDENIER: "High-Flying Denier",
  HOOKSPECIALIST: "Hook Specialist",
  IMMOVABLEENFORCER: "Immovable Enforcer",
  INTERCEPTOR: "Interceptor",
  LAYUPMIXMASTER: "Layup Mixmaster",
  LIGHTNINGLAUNCH: "Lightning Launch",
  LIMITLESSRANGE: "Limitless Range",
  MINIMARKSMAN: "Mini Marksman",
  OFFBALLPEST: "Off-Ball Pest",
  ONBALLMENACE: "On-Ball Menace",
  PAINTPATROLLER: "Paint Patroller",
  PAINTPRODIGY: "Paint Prodigy",
  PHYSICALFINISHER: "Physical Finisher",
  PICKDODGER: "Pick Dodger",
  POGOSTICK: "Pogo Stick",
  POSTERIZER: "Posterizer",
  POSTFADEPHENOM: "Post Fade Phenom",
  POSTLOCKDOWN: "Post Lockdown",
  POSTPOWERHOUSE: "Post Powerhouse",
  POSTUPPOET: "Post-Up Poet",
  REBOUNDCHASER: "Rebound Chaser",
  RISEUP: "Rise Up",
  SETSPECIALISTSHOT: "Set Shot Specialist", // alias confirmed
  SHIFTYSHOOTER: "Shifty Shooter",
  SLIPPERYOFFBALL: "Slippery Off-Ball",
  STRONGHANDLE: "Strong Handle",
  UNPLUCKABLE: "Unpluckable",
  VERSATILEVISIONARY: "Versatile Visionary",
};

// Personality / marketability badges — never counted as gameplay badges
const PERSONALITY_BADGES = new Set([
  "ALPHADOG", "EXPRESSIVE", "EXTREMELYCONFIDENT", "FINANCESAVVY", "FRIENDLY",
  "KEEPITREAL", "LAIDBACK", "MARKETABILITY", "MEDIARINGMASTER", "PATMYBACK",
  "RESERVED", "TEAMPLAYER", "UNPREDICTABLE", "WARMWEATHERFAN", "WORKETHIC",
]);

const BADGE_TIER = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "HOF" };

// DB2K Tendencies/<NAME> -> project 96-field name (strict 1:1, verified)
const TENDENCY_MAP = {
  ALLEYOOP: "Alley-Oop",
  ALLEYOOPPASS: "Alley-Oop Pass",
  ATTACKSTRONGONDRIVE: "Attack Strong on Drive",
  BLOCKSHOT: "Block Shot",
  CONTESTEDJUMPERMIDRANGE: "Contested Jumper Mid-Range",
  CONTESTEDJUMPER3POINT: "Contested Jumper Three",
  CRASH: "Crash",
  DISHTOOPENMAN: "Dish to Open Man",
  DRIVE: "Drive",
  DRIVEPULLUPMIDRANGE: "Drive Pull-Up Mid-Range",
  DRIVEPULLUP3POINT: "Drive Pull-Up Three",
  DRIVERIGHT: "Drive Right",
  DRIVINGBEHINDTHEBACK: "Driving Behind the Back",
  DRIBBLECROSSOVER: "Driving Crossover",
  DRIVINGDOUBLECROSSOVER: "Driving Double Crossover",
  DRIVINGDRIBBLEHESITATION: "Driving Dribble Hesitation",
  DRIVINGDUNK: "Driving Dunk",
  DRIVINGHALFSPIN: "Driving Half Spin",
  DRIVINGINANDOUT: "Driving In & Out",
  DRIVINGLAYUP: "Driving Layup",
  DRIBBLESPIN: "Driving Spin",
  DRIVINGSTEPBACK: "Driving Stepback",
  EUROSTEPLAYUP: "Euro Step Layup",
  FLASHYDUNK: "Flashy Dunk",
  FLASHYPASS: "Flashy Pass",
  FLOATER: "Floater",
  FOUL: "Foul",
  HARDFOUL: "Hard Foul",
  HOPSTEPLAYUP: "Hop Step Layup",
  ISOVSAVERAGEDEFENDER: "Iso vs Average Defender",
  ISOVSELITEDEFENDER: "Iso vs Elite Defender",
  ISOVSGOODDEFENDER: "Iso vs Good Defender",
  NODRIVINGDRIBBLEMOVE: "No Driving Dribble Move",
  NOSETUPDRIBBLE: "No Setup Dribble",
  OFFSCREENDRIVE: "Off-Screen Drive",
  MIDOFFSCREENSHOT: "Off-Screen Shot Mid-Range",
  "3POINTOFFSCREENSHOT": "Off-Screen Shot Three",
  ONBALLSTEAL: "On-Ball Steal",
  PASSINTERCEPTION: "Pass Interception",
  PLAYDISCIPLINE: "Play Discipline",
  POSTAGGRESSIVEBACKDOWN: "Post Aggressive Backdown",
  POSTBACKDOWN: "Post Back Down",
  POSTDRIVE: "Post Drive",
  POSTDROPSTEP: "Post Drop Step",
  POSTFACEUP: "Post Face Up",
  POSTFADELEFT: "Post Fade Left",
  POSTFADERIGHT: "Post Fade Right",
  POSTHOOKLEFT: "Post Hook Left",
  POSTHOOKRIGHT: "Post Hook Right",
  HOPPOSTSHOT: "Post Hop Step",
  POSTSHIMMYSHOT: "Post Shimmy Shot",
  POSTSPIN: "Post Spin",
  POSTSTEPBACKSHOT: "Post Stepback Shot",
  POSTUP: "Post Up",
  POSTUPANDUNDER: "Post Up & Under",
  PUTBACK: "Putback",
  ROLLVSPOP: "Roll vs Pop",
  SETUPWITHHESITATION: "Setup With Hesitation",
  SETUPWITHSIZEUP: "Setup With Sizeup",
  FROMPOSTSHOT: "Shoot From Post",
  SHOT: "Shot",
  CLOSESHOT: "Shot Close",
  CLOSELEFTSHOT: "Shot Close Left",
  CLOSEMIDDLESHOT: "Shot Close Middle",
  CLOSERIGHTSHOT: "Shot Close Right",
  CENTERMIDSHOT: "Shot Mid Center",
  LEFTMIDSHOT: "Shot Mid Left",
  CENTERLEFTMIDSHOT: "Shot Mid Left-Center",
  MIDRIGHTSHOT: "Shot Mid Right",
  CENTERMIDRIGHTSHOT: "Shot Mid Right-Center",
  MIDSHOT: "Shot Mid-Range",
  "3POINTSHOT": "Shot Three",
  "3POINTCENTERSHOT": "Shot Three Center",
  "3POINTLEFTSHOT": "Shot Three Left",
  "3POINTCENTERLEFTSHOT": "Shot Three Left-Center",
  "3POINTRIGHTSHOT": "Shot Three Right",
  "3POINTCENTERRIGHTSHOT": "Shot Three Right-Center",
  BASKETUNDERSHOT: "Shot Under Basket",
  SPINJUMPER: "Spin Jumper",
  SPINLAYUP: "Spin Layup",
  SPOTUPDRIVE: "Spot Up Drive",
  MIDSPOTUPSHOT: "Spot Up Shot Mid-Range",
  "3POINTSPOTUPSHOT": "Spot Up Shot Three",
  STANDINGDUNK: "Standing Dunk",
  STEPTHROUGH: "Step Through Shot",
  STEPBACKJUMPERMIDRANGE: "Stepback Jumper Mid-Range",
  STEPBACKJUMPER3POINT: "Stepback Three Point Shot",
  TAKECHARGE: "Take Charge",
  TOUCHES: "Touches",
  TRANSITIONPULLUP3POINT: "Transition Pull-Up Three Point Shot",
  TRANSITIONSPOTUP: "Transition Spot Up vs Cut to the Basket",
  TRIPLETHREATIDLE: "Triple Threat Idle",
  TRIPLETHREATJABSTEP: "Triple Threat Jab Step",
  TRIPLETHREATPUMPFAKE: "Triple Threat Pump Fake",
  THREATTRIPLESHOT: "Triple Threat Shoot",
  USEGLASS: "Use Glass",
};

// ============================================================
// Helpers
// ============================================================

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ============================================================
// Load inputs
// ============================================================

if (!fs.existsSync(INPUT)) {
  console.error(`input not found: ${INPUT}`);
  process.exit(1);
}
const snapshot = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const MERGED_MODES = [
  "Draft Class 2010 (merged full DB2K export, read-only)",
  "Draft Class 2003 (relocated read-only)",
  "Draft Class 2005 (VenueLab-region relocated read-only)",
];
// Merged full exports (post-patch recovery) omit the "mode" key entirely.
if (snapshot.mode !== "Draft Class" && snapshot.mode !== undefined && !MERGED_MODES.includes(snapshot.mode)) {
  console.error(`FATAL: snapshot mode is "${snapshot.mode}", expected "Draft Class". Refusing to convert production cards from an unexpected source.`);
  process.exit(1);
}
const records = snapshot.records ?? [];
console.log(`snapshot: ${records.length} records, mode=${snapshot.mode}`);

const whitelist = WHITELIST && fs.existsSync(WHITELIST)
  ? new Set(JSON.parse(fs.readFileSync(WHITELIST, "utf8")).map((n) => n.toLowerCase().trim()))
  : null;
const overrides = OVERRIDES && fs.existsSync(OVERRIDES)
  ? JSON.parse(fs.readFileSync(OVERRIDES, "utf8"))
  : {};

// ============================================================
// Convert
// ============================================================

const out = [];
const review = { skipped_generated: [], missing_overall: [], warning: [] };

for (const rec of records) {
  const f = rec.fields ?? {};
  const get = (section, name) => f[`${section}/${name}`]?.display_value;

  const first = String(get("Vitals", "FIRSTNAME") ?? "");
  const last = String(get("Vitals", "LASTNAME") ?? "");
  const name = `${first} ${last}`.trim();
  if (!name) continue;
  const slug = slugify(name);
  const faceId = num(get("Vitals", "FACEID"));

  // --- identity / body ---
  const pos = get("Vitals", "POSITION");
  const pos2 = get("Vitals", "SECONDARYPOSITION");
  const heightIn = normalizeHeightInches(get("Vitals", "HEIGHT")); // always inches
  const weight = num(get("Vitals", "WEIGHT"));
  const wingspanCm = num(get("Vitals", "WINGSPANCM"));

  // --- attributes (35) ---
  const detailed = {};
  for (const [dbkName, projName] of Object.entries(ATTR_MAP)) {
    const v = num(get("Attributes", dbkName));
    if (v != null) detailed[projName] = v;
  }

  // --- badges (gameplay only; personality recorded separately) ---
  const badges = [];
  const personalityBadges = [];
  for (const [dbkName, projName] of Object.entries(BADGE_MAP)) {
    const tierRaw = num(get("Badges", dbkName));
    if (tierRaw == null || tierRaw === 0) continue;
    const tier = BADGE_TIER[tierRaw];
    if (tier) badges.push({ name: projName, tier });
    else review.warning.push(`${name}: unknown badge tier ${tierRaw} for ${projName}`);
  }
  for (const dbkName of PERSONALITY_BADGES) {
    const tierRaw = num(get("Badges", dbkName));
    if (tierRaw == null || tierRaw === 0) continue;
    const tier = BADGE_TIER[tierRaw];
    if (tier) personalityBadges.push({ name: dbkName.toLowerCase(), tier });
  }

  // --- tendencies (96) ---
  const tendencies = {};
  for (const [dbkName, projName] of Object.entries(TENDENCY_MAP)) {
    const v = num(get("Tendencies", dbkName));
    if (v != null) tendencies[projName] = v;
  }

  // --- potential / durability (record as extra metadata) ---
  const potential = num(get("Attributes", "POTENTIAL"));
  const potentialMin = num(get("Vitals", "MINIMUMPOTENTIAL"));
  const potentialMax = num(get("Vitals", "MAXIMUMPOTENTIAL"));

  // --- whitelist filter ---
  const nameLower = name.toLowerCase().trim();
  if (whitelist && !whitelist.has(nameLower)) {
    review.skipped_generated.push(slug);
    continue;
  }

  // --- OVR: only from user overrides (record after whitelist pass) ---
  const ovrOverride = overrides[slug];
  const overall = ovrOverride?.overall ?? null;
  if (overall == null) review.missing_overall.push(slug);

  const card = {
    slug,
    name,
    draftYear: YEAR,
    source: "db2k-draft-class",
    gameVersion: snapshot.target_executable ?? "NBA2K26",
    capturedAt: new Date().toISOString().slice(0, 10),
    overall,
    position: pos,
    secondaryPosition: pos2,
    height: heightIn,
    weight,
    wingspan: wingspanCm,
    faceId,
    potential: { current: potential, min: potentialMin, max: potentialMax },
    vitals: extractVitals(get),
    durability: extractDurability(get),
    hotZones: extractHotZones(get),
    detailed,
    badges,
    tendencies,
    personalityBadges,
  };
  out.push(card);
}

// --- full player record fields (mirrors the "2k26 球员全部字段" sheet) ---
// Vitals section: identity, body, growth, personality, play types.
function extractVitals(get) {
  const pick = (name) => {
    const v = get("Vitals", name);
    return v == null || v === "" ? null : v;
  };
  const boolYes = (name) => {
    const v = pick(name);
    if (v == null) return null;
    return String(v).toLowerCase() === "yes";
  };
  return {
    firstName: pick("FIRSTNAME"),
    lastName: pick("LASTNAME"),
    nickname: pick("NICKNAME") || null,
    jerseyNickname: pick("JERSEYNICKNAME") || null,
    birthMonth: num(pick("BIRTHMONTH")),
    birthDay: num(pick("BIRTHDAY")),
    birthYear: num(pick("BIRTHYEAR")),
    ageAtSetYear: num(pick("CUSTOMAGEATSETYEAR")),
    jerseyNumber: num(pick("NUMBER")),
    yearsPro: num(pick("YEARSPRO")),
    dominantHand: pick("DOMINANTHAND"),
    dominantDunkHand: pick("DOMINANTDUNKHAND"),
    peakStartAge: num(pick("PEAKSTARTAGE")),
    peakEndAge: num(pick("PEAKENDAGE")),
    boomPercent: num(pick("BOOMPERCENTAGE")),
    averagePercent: num(pick("AVERAGEPERCENT")),
    bustPercent: num(pick("BUSTPERCENTAGE")),
    playForWinner: num(pick("PLAYFORWINNER")),
    financialSecurity: num(pick("FINANCIALSECURITY")),
    loyalty: num(pick("LOYALTY")),
    forceNonStarter: pick("FORCENONSTARTER"),
    playInitiator: boolYes("PLAYINITIATOR"),
    playType1: pick("PLAYTYPE1"),
    playType2: pick("PLAYTYPE2"),
    playType3: pick("PLAYTYPE3"),
    playType4: pick("PLAYTYPE4"),
    currentTeam: num(pick("CURRENTTEAM")),
    hometownTeam1: num(pick("HOMETOWNTEAM1")),
    hometownTeam2: num(pick("HOMETOWNTEAM2")),
    draftYear: num(pick("DRAFTEDYEAR")),
    draftPick: num(pick("DRAFTPICKNUMBER")),
    // body proportions (1-100 scale in-game ratings); HEIGHT must be inches
    heightInches: normalizeHeightInches(pick("HEIGHT")),
    weightLb: num(pick("WEIGHT")),
    wingspanCm: num(pick("WINGSPANCM")),
    armScale: num(pick("ARMSCALE")),
    shoulderLength: num(pick("SHOULDERLENGTH")),
    neckLength: num(pick("NECKLENGTH")),
    trunkLength: num(pick("TRUNKLENGTH")),
  };
}

// Attributes durability section (16 body-part durabilities).
function extractDurability(get) {
  const map = {
    head: "HEADDURABILITY", neck: "NECKDURABILITY", back: "BACKDURABILITY",
    leftShoulder: "LEFTSHOULDERDURABILITY", rightShoulder: "RIGHTSHOULDERDURABILITY",
    leftElbow: "LEFTELBOWDURABILITY", rightElbow: "RIGHTELBOWDURABILITY",
    leftHip: "LEFTHIPDURABILITY", rightHip: "RIGHTHIPDURABILITY",
    leftKnee: "LEFTKNEEDURABILITY", rightKnee: "RIGHTKNEEDURABILITY",
    leftAnkle: "LEFTANKLEDURABILITY", rightAnkle: "RIGHTANKLEDURABILITY",
    leftFoot: "LEFTFOOTDURABILITY", rightFoot: "RIGHTFOOTDURABILITY",
    overall: "MISCDURABILITY",
  };
  const durability = {};
  for (const [key, attr] of Object.entries(map)) {
    const v = num(get("Attributes", attr));
    if (v != null) durability[key] = v;
  }
  return durability;
}

// Hot zones live in the tendencies section (Hot / Neutral / Cold values).
function extractHotZones(get) {
  const map = {
    underBasket: "UNDERBASKET",
    closeLeft: "CLOSELEFT", closeMiddle: "CLOSEMIDDLE", closeRight: "CLOSERIGHT",
    midLeft: "MIDRANGELEFT", midLeftCenter: "MIDRANGELEFTCENTER", midCenter: "MIDRANGECENTER",
    midRightCenter: "MIDRANGERIGHTCENTER", midRight: "MIDRANGERIGHT",
    threeLeft: "3LEFT", threeLeftCenter: "3LEFTCENTER", threeCenter: "3CENTER",
    threeRightCenter: "3RIGHTCENTER", threeRight: "3RIGHT",
  };
  const hotZones = {};
  for (const [key, tend] of Object.entries(map)) {
    const v = get("Tendencies", tend);
    if (v != null) hotZones[key] = String(v);
  }
  return hotZones;
}

// ============================================================
// Write
// ============================================================

fs.mkdirSync(OUT_DIR, { recursive: true });
let written = 0;
for (const card of out) {
  fs.writeFileSync(
    path.join(OUT_DIR, `${card.slug}.json`),
    JSON.stringify(card, null, 2) + "\n",
    "utf8",
  );
  written++;
}

// Remove stale per-player cards from a previous conversion of the same year so
// the directory always mirrors exactly this snapshot (idempotent re-runs).
const writtenSlugs = new Set(out.map((card) => `${card.slug}.json`));
for (const file of fs.readdirSync(OUT_DIR)) {
  if (!file.endsWith(".json")) continue;
  if (file === "review.json" || file === "capture-manifest.json") continue;
  if (!writtenSlugs.has(file)) {
    fs.unlinkSync(path.join(OUT_DIR, file));
    console.log(`removed stale card: ${file}`);
  }
}
fs.writeFileSync(
  path.join(OUT_DIR, "capture-manifest.json"),
  JSON.stringify(
    {
      source: "DB2K Editor Draft Class snapshot",
      inputFile: INPUT,
      targetExecutable: snapshot.target_executable,
      mode: snapshot.mode,
      recordCount: records.length,
      converted: written,
      year: YEAR,
      capturedAt: new Date().toISOString(),
      badgeTierMap: BADGE_TIER,
      whitelistUsed: !!whitelist,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
fs.writeFileSync(
  path.join(OUT_DIR, "review.json"),
  JSON.stringify(review, null, 2) + "\n",
  "utf8",
);

console.log(`\nconverted ${written}/${records.length} -> ${OUT_DIR}`);
console.log(`skipped (not in whitelist): ${review.skipped_generated.length}`);
console.log(`missing OVR override: ${review.missing_overall.length}`);
if (review.warning.length) {
  console.log(`warnings: ${review.warning.length}`);
  for (const w of review.warning.slice(0, 10)) console.log("  -", w);
}
