#!/usr/bin/env node
/**
 * Batch convert the no-card collection (AB 34 + C 14) into rookie cards.
 *
 * - AB: real rookie values from no_card_AB_rookie_current.json, OVR from the
 *   user-filled CSV (no-card-ovr-collection-2026-08-08.csv).
 * - C : current-roster values from no_card_C_capped80(1).json +
 *      david_jones_garcia_current.json (attributes already capped at 80 by the
 *      user); OVR computed with the project's rookie OVR model (version "rookie").
 * - Skips the 3 already-carded players (McCollum / Claxton / Diabaté).
 * - Writes per-player to rookieCards/{draftYear}/{slug}.json using the same
 *   field maps as convert-db2k-to-rookiecard.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateGameOverall } from "../src/rookieOverall.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_BASE = path.join(ROOT, "src", "data", "rookieCards");
const CSV = process.argv[2] ?? path.join(ROOT, ".hermes", "desktop-attachments", "no-card-ovr-collection-2026-08-08(1).csv");
const AB_SNAP = process.argv[3] ?? "/Users/yangzonghan/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_u99tqi61ovek22_9013/msg/file/2026-08/no_card_AB_rookie_current.json";
const C_SNAP = process.argv[4] ?? "/Users/yangzonghan/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_u99tqi61ovek22_9013/msg/file/2026-08/no_card_C_capped80(1).json";
const DJG_SNAP = process.argv[5] ?? path.join(ROOT, ".hermes", "desktop-attachments", "david_jones_garcia_current.json");

// ---- field maps (copied from convert-db2k-to-rookiecard.mjs) ----
const ATTR_MAP = {
  AGILITY: "Agility", BALLCONTROL: "Ball Handle", BLOCK: "Block", CLOSESHOT: "Close Shot",
  DEFENSECONSISTENCY: "Defensive Consistency", DEFENSEREBOUND: "Defensive Rebound",
  DRAWFOUL: "Draw Foul", DRIVINGDUNK: "Driving Dunk", DRIVINGLAYUP: "Layup",
  FREETHROW: "Free Throw", HANDS: "Hands", HELPDEFENSE: "Help Defense IQ",
  HUSTLE: "Hustle", INTANGIBLES: "Intangibles", INTERIORDEFENSE: "Interior Defense",
  IQSHOT: "Shot IQ", MIDRANGE: "Mid-Range Shot", OFFENSIVECONSISTENCY: "Offensive Consistency",
  OFFENSIVEREBOUND: "Offensive Rebound", PASSACCURACY: "Pass Accuracy", PASSIQ: "Pass IQ",
  PASSPERCEPTION: "Pass Perception", PASSVISION: "Pass Vision",
  PERIMETERDEFENSE: "Perimeter Defense", POSTCONTROL: "Post Control", POSTFADE: "Post Fade",
  POSTHOOK: "Post Hook", SPEED: "Speed", SPEEDWITHBALL: "Speed with Ball", STAMINA: "Stamina",
  STANDINGDUNK: "Standing Dunk", STEAL: "Steal", STRENGTH: "Strength", "3POINT": "Three-Point Shot",
  VERTICAL: "Vertical",
};

const BADGE_MAP = {
  AERIALWIZARD: "Aerial Wizard", ANKLEBREAKER: "Ankle Assassin", BAILOUT: "Bail Out",
  BOXOUTBEAST: "Boxout Beast", BREAKSTARTER: "Break Starter", BRICKWALL: "Brick Wall",
  CHALLENGER: "Challenger", DEADEYE: "Deadeye", DIMER: "Dimer", FLOATGAME: "Float Game",
  GLOVE: "Glove", HANDLESFORDAYS: "Handles For Days", HIGHFLYINGDENIER: "High-Flying Denier",
  HOOKSPECIALIST: "Hook Specialist", IMMOVABLEENFORCER: "Immovable Enforcer",
  INTERCEPTOR: "Interceptor", LAYUPMIXMASTER: "Layup Mixmaster", LIGHTNINGLAUNCH: "Lightning Launch",
  LIMITLESSRANGE: "Limitless Range", MINIMARKSMAN: "Mini Marksman", OFFBALLPEST: "Off-Ball Pest",
  ONBALLMENACE: "On-Ball Menace", PAINTPATROLLER: "Paint Patroller", PAINTPRODIGY: "Paint Prodigy",
  PHYSICALFINISHER: "Physical Finisher", PICKDODGER: "Pick Dodger", POGOSTICK: "Pogo Stick",
  POSTERIZER: "Posterizer", POSTFADEPHENOM: "Post Fade Phenom", POSTLOCKDOWN: "Post Lockdown",
  POSTPOWERHOUSE: "Post Powerhouse", POSTUPPOET: "Post-Up Poet", REBOUNDCHASER: "Rebound Chaser",
  RISEUP: "Rise Up", SETSPECIALISTSHOT: "Set Shot Specialist", SHIFTYSHOOTER: "Shifty Shooter",
  SLIPPERYOFFBALL: "Slippery Off-Ball", STRONGHANDLE: "Strong Handle",
  UNPLUCKABLE: "Unpluckable", VERSATILEVISIONARY: "Versatile Visionary",
};

const PERSONALITY_BADGES = [
  "ALPHADOG", "EXPRESSIVE", "EXTREMELYCONFIDENT", "FINANCESAVVY", "FRIENDLY",
  "KEEPITREAL", "LAIDBACK", "MARKETABILITY", "MEDIARINGMASTER", "PATMYBACK",
  "RESERVED", "TEAMPLAYER", "UNPREDICTABLE", "WARMWEATHERFAN", "WORKETHIC",
];

const BADGE_TIER = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "HOF" };

const TENDENCY_MAP = {
  ALLEYOOP: "Alley-Oop", ALLEYOOPPASS: "Alley-Oop Pass",
  ATTACKSTRONGONDRIVE: "Attack Strong on Drive", BLOCKSHOT: "Block Shot",
  CONTESTEDJUMPERMIDRANGE: "Contested Jumper Mid-Range",
  CONTESTEDJUMPER3POINT: "Contested Jumper Three", CRASH: "Crash",
  DISHTOOPENMAN: "Dish to Open Man", DRIVE: "Drive", DRIVERIGHT: "Drive Right",
  DRIVINGBEHINDTHEBACK: "Driving Behind the Back", DRIBBLECROSSOVER: "Driving Crossover",
  DRIVINGDOUBLECROSSOVER: "Driving Double Crossover",
  DRIVINGDRIBBLEHESITATION: "Driving Dribble Hesitation", DRIVINGHALFSPIN: "Driving Half Spin",
  DRIVINGINANDOUT: "Driving In & Out", DRIBBLESPIN: "Driving Spin",
  DRIVINGSTEPBACK: "Driving Stepback", NODRIVINGDRIBBLEMOVE: "No Driving Dribble Move",
  OFFSCREENDRIVE: "Off-Screen Drive", SPOTUPDRIVE: "Spot Up Drive",
  TRIPLETHREATIDLE: "Triple Threat Idle", TRIPLETHREATJABSTEP: "Triple Threat Jab Step",
  TRIPLETHREATPUMPFAKE: "Triple Threat Pump Fake", THREATTRIPLESHOT: "Triple Threat Shoot",
  SETUPWITHSIZEUP: "Setup With Sizeup", SETUPWITHHESITATION: "Setup With Hesitation",
  NOSETUPDRIBBLE: "No Setup Dribble", STEPTHROUGH: "Step Through Shot",
  BASKETUNDERSHOT: "Shot Under Basket", CLOSESHOT: "Shot Close",
  CLOSELEFTSHOT: "Shot Close Left", CLOSEMIDDLESHOT: "Shot Close Middle",
  CLOSERIGHTSHOT: "Shot Close Right", MIDSHOT: "Shot Mid-Range",
  MIDSPOTUPSHOT: "Spot Up Shot Mid-Range", MIDOFFSCREENSHOT: "Off-Screen Shot Mid-Range",
  LEFTMIDSHOT: "Shot Mid Left", CENTERLEFTMIDSHOT: "Shot Mid Left-Center",
  CENTERMIDSHOT: "Shot Mid Center", CENTERMIDRIGHTSHOT: "Shot Mid Right-Center",
  MIDRIGHTSHOT: "Shot Mid Right", "3POINTSHOT": "Shot Three",
  "3POINTSPOTUPSHOT": "Spot Up Shot Three", "3POINTOFFSCREENSHOT": "Off-Screen Shot Three",
  "3POINTLEFTSHOT": "Shot Three Left", "3POINTCENTERLEFTSHOT": "Shot Three Left-Center",
  "3POINTCENTERSHOT": "Shot Three Center", "3POINTCENTERRIGHTSHOT": "Shot Three Right-Center",
  "3POINTRIGHTSHOT": "Shot Three Right", CONTESTEDJUMPER3POINT: "Contested Jumper Three",
  STEPBACKJUMPER3POINT: "Stepback Three Point Shot", STEPBACKJUMPERMIDRANGE: "Stepback Jumper Mid-Range",
 SPINJUMPER: "Spin Jumper",
  TRANSITIONPULLUP3POINT: "Transition Pull-Up Three Point Shot",
  DRIVEPULLUP3POINT: "Drive Pull-Up Three", DRIVEPULLUPMIDRANGE: "Drive Pull-Up Mid-Range",
  DRIVINGLAYUP: "Driving Layup", SPINLAYUP: "Spin Layup", EUROSTEPLAYUP: "Euro Step Layup",
  HOPSTEPLAYUP: "Hop Step Layup", FLOATER: "Floater", USEGLASS: "Use Glass",
  ALLEYOOP: "Alley-Oop", PUTBACK: "Putback", CRASH: "Crash",
  STANDINGDUNK: "Standing Dunk", DRIVINGDUNK: "Driving Dunk", FLASHYDUNK: "Flashy Dunk",
  POSTUP: "Post Up", POSTBACKDOWN: "Post Back Down",
  POSTAGGRESSIVEBACKDOWN: "Post Aggressive Backdown", POSTSPIN: "Post Spin",
  POSTDRIVE: "Post Drive", POSTDROPSTEP: "Post Drop Step", FROMPOSTSHOT: "Shoot From Post",
  POSTHOOKLEFT: "Post Hook Left", POSTHOOKRIGHT: "Post Hook Right",
  POSTFADELEFT: "Post Fade Left", POSTFADERIGHT: "Post Fade Right",
  POSTSHIMMYSHOT: "Post Shimmy Shot", HOPPOSTSHOT: "Post Hop Step",
  POSTSTEPBACKSHOT: "Post Stepback Shot", POSTUPANDUNDER: "Post Up & Under",
  POSTFACEUP: "Post Face Up", FLASHYPASS: "Flashy Pass", ALLEYOOPPASS: "Alley-Oop Pass",
  DISHTOOPENMAN: "Dish to Open Man", ROLLVSPOP: "Roll vs Pop",
  TRANSITIONSPOTUP: "Transition Spot Up vs Cut to the Basket",
  ISOVSELITEDEFENDER: "Iso vs Elite Defender", ISOVSGOODDEFENDER: "Iso vs Good Defender",
  ISOVSAVERAGEDEFENDER: "Iso vs Average Defender",
  PLAYDISCIPLINE: "Play Discipline", TOUCHES: "Touches", SHOT: "Shot",
  TAKECHARGE: "Take Charge", FOUL: "Foul", HARDFOUL: "Hard Foul",
  ONBALLSTEAL: "On-Ball Steal", PASSINTERCEPTION: "Pass Interception",
  BLOCKSHOT: "Block Shot",
};

const HOTZONE_MAP = {
  underBasket: "UNDERBASKET", closeLeft: "CLOSELEFT", closeMiddle: "CLOSEMIDDLE", closeRight: "CLOSERIGHT",
  midLeft: "MIDRANGELEFT", midLeftCenter: "MIDRANGELEFTCENTER", midCenter: "MIDRANGECENTER",
  midRightCenter: "MIDRANGERIGHTCENTER", midRight: "MIDRANGERIGHT",
  threeLeft: "3LEFT", threeLeftCenter: "3LEFTCENTER", threeCenter: "3CENTER",
  threeRightCenter: "3RIGHTCENTER", threeRight: "3RIGHT",
};

const DURABILITY_MAP = {
  head: "HEADDURABILITY", neck: "NECKDURABILITY", back: "BACKDURABILITY",
  leftShoulder: "LEFTSHOULDERDURABILITY", rightShoulder: "RIGHTSHOULDERDURABILITY",
  leftElbow: "LEFTELBOWDURABILITY", rightElbow: "RIGHTELBOWDURABILITY",
  leftHip: "LEFTHIPDURABILITY", rightHip: "RIGHTHIPDURABILITY",
  leftKnee: "LEFTKNEEDURABILITY", rightKnee: "RIGHTKNEEDURABILITY",
  leftAnkle: "LEFTANKLEDURABILITY", rightAnkle: "RIGHTANKLEDURABILITY",
  leftFoot: "LEFTFOOTDURABILITY", rightFoot: "RIGHTFOOTDURABILITY",
  overall: "MISCDURABILITY",
};

const slugify = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- CSV: AB OVR map ----
const csvLines = fs.readFileSync(CSV, "utf8").replace(/^\uFEFF/, "").split("\n");
const csvHeader = csvLines[0].split(",").map((s) => s.trim());
const csvRows = csvLines.slice(1).filter((l) => l.trim()).map((l) => {
  const parts = l.split(",");
  return Object.fromEntries(csvHeader.map((h, i) => [h, (parts[i] ?? "").trim()]));
});
const abOvr = new Map();
for (const row of csvRows) {
  if (row.group === "AB" && row.status === "待采集" && row.overall) {
    abOvr.set(row.slug, Number(row.overall));
  }
}
console.log(`CSV: ${csvRows.length} rows, AB OVR entries: ${abOvr.size}`);

// ---- badge category helper (mirrors getBadgeCategory) ----
const badgeCategoryMap = {
  "Set Shot Specialist": "shooting", Deadeye: "shooting", "Limitless Range": "shooting",
  "Mini Marksman": "shooting", "Shifty Shooter": "shooting", "Slippery Off-Ball": "shooting",
  "Ankle Assassin": "playmaking", "Bail Out": "playmaking", "Break Starter": "playmaking",
  Dimer: "playmaking", "Handles For Days": "playmaking", "Strong Handle": "playmaking",
  "Versatile Visionary": "playmaking", "Lightning Launch": "playmaking",
  "Float Game": "inside", "Layup Mixmaster": "inside", "Paint Prodigy": "inside",
  "Physical Finisher": "inside", "Hook Specialist": "inside", "Post Fade Phenom": "inside",
  "Post Powerhouse": "inside", "Post-Up Poet": "inside", "Rise Up": "inside",
  Posterizer: "inside", "Brick Wall": "inside", "Aerial Wizard": "athleticism",
  "On-Ball Menace": "defense", "Off-Ball Pest": "defense", "Pick Dodger": "defense",
  "High-Flying Denier": "defense", "Pogo Stick": "defense", "Paint Patroller": "defense",
  "Immovable Enforcer": "defense", "Post Lockdown": "defense", Challenger: "defense",
  Glove: "defense", Interceptor: "defense", "Boxout Beast": "rebounding",
  "Rebound Chaser": "rebounding",
};

function convertRecord(rec, { overall, source }) {
  const f = rec.fields ?? {};
  const get = (section, name) => f[`${section}/${name}`]?.display_value;
  const first = String(get("Vitals", "FIRSTNAME") ?? "");
  const last = String(get("Vitals", "LASTNAME") ?? "");
  const name = `${first} ${last}`.trim();
  const slug = slugify(name);

  const detailed = {};
  for (const [dbkName, projName] of Object.entries(ATTR_MAP)) {
    const v = num(get("Attributes", dbkName));
    if (v != null) detailed[projName] = v;
  }

  const badges = [];
  const personalityBadges = [];
  for (const [dbkName, projName] of Object.entries(BADGE_MAP)) {
    const tierRaw = num(get("Badges", dbkName));
    if (tierRaw == null || tierRaw === 0) continue;
    const tier = BADGE_TIER[tierRaw];
    if (tier) badges.push({ name: projName, tier });
  }
  for (const dbkName of PERSONALITY_BADGES) {
    const tierRaw = num(get("Badges", dbkName));
    if (tierRaw == null || tierRaw === 0) continue;
    const tier = BADGE_TIER[tierRaw];
    if (tier) personalityBadges.push({ name: dbkName.toLowerCase(), tier });
  }

  const tendencies = {};
  for (const [dbkName, projName] of Object.entries(TENDENCY_MAP)) {
    const v = num(get("Tendencies", dbkName));
    if (v != null) tendencies[projName] = v;
  }

  const hotZones = {};
  for (const [key, tend] of Object.entries(HOTZONE_MAP)) {
    const v = get("Tendencies", tend);
    if (v != null) hotZones[key] = String(v);
  }

  const durability = {};
  for (const [key, attr] of Object.entries(DURABILITY_MAP)) {
    const v = num(get("Attributes", attr));
    if (v != null) durability[key] = v;
  }

  const vitals = {
    firstName: get("Vitals", "FIRSTNAME") ?? null,
    lastName: get("Vitals", "LASTNAME") ?? null,
    nickname: get("Vitals", "NICKNAME") || null,
    jerseyNickname: get("Vitals", "JERSEYNICKNAME") || null,
    birthMonth: num(get("Vitals", "BIRTHMONTH")),
    birthDay: num(get("Vitals", "BIRTHDAY")),
    birthYear: num(get("Vitals", "BIRTHYEAR")),
    ageAtSetYear: num(get("Vitals", "CUSTOMAGEATSETYEAR")),
    jerseyNumber: num(get("Vitals", "NUMBER")),
    yearsPro: num(get("Vitals", "YEARSPRO")),
    dominantHand: get("Vitals", "DOMINANTHAND"),
    dominantDunkHand: get("Vitals", "DOMINANTDUNKHAND"),
    peakStartAge: num(get("Vitals", "PEAKSTARTAGE")),
    peakEndAge: num(get("Vitals", "PEAKENDAGE")),
    boomPercent: num(get("Vitals", "BOOMPERCENTAGE")),
    averagePercent: num(get("Vitals", "AVERAGEPERCENT")),
    bustPercent: num(get("Vitals", "BUSTPERCENTAGE")),
    playForWinner: num(get("Vitals", "PLAYFORWINNER")),
    financialSecurity: num(get("Vitals", "FINANCIALSECURITY")),
    loyalty: num(get("Vitals", "LOYALTY")),
    forceNonStarter: get("Vitals", "FORCENONSTARTER"),
    playInitiator: String(get("Vitals", "PLAYINITIATOR") ?? "").toLowerCase() === "yes" ? true : (get("Vitals", "PLAYINITIATOR") == null ? null : false),
    playType1: get("Vitals", "PLAYTYPE1"),
    playType2: get("Vitals", "PLAYTYPE2"),
    playType3: get("Vitals", "PLAYTYPE3"),
    playType4: get("Vitals", "PLAYTYPE4"),
    currentTeam: num(get("Vitals", "CURRENTTEAM")),
    hometownTeam1: num(get("Vitals", "HOMETOWNTEAM1")),
    hometownTeam2: num(get("Vitals", "HOMETOWNTEAM2")),
    draftYear: num(get("Vitals", "DRAFTEDYEAR")),
    draftPick: num(get("Vitals", "DRAFTPICKNUMBER")),
    heightInches: num(get("Vitals", "HEIGHT")),
    weightLb: num(get("Vitals", "WEIGHT")),
    wingspanCm: num(get("Vitals", "WINGSPANCM")),
    armScale: num(get("Vitals", "ARMSCALE")),
    shoulderLength: num(get("Vitals", "SHOULDERLENGTH")),
    neckLength: num(get("Vitals", "NECKLENGTH")),
    trunkLength: num(get("Vitals", "TRUNKLENGTH")),
  };

  const position = get("Vitals", "POSITION");
  const secondaryPosition = get("Vitals", "SECONDARYPOSITION");
  const posKey = ["PG", "SG", "SF", "PF", "C"].includes(position) ? position : "SF";

  return {
    slug,
    name,
    draftYear: num(get("Vitals", "DRAFTEDYEAR")) ?? 2025,
    source,
    gameVersion: "NBA2K26",
    capturedAt: new Date().toISOString().slice(0, 10),
    overall,
    position,
    secondaryPosition,
    height: num(get("Vitals", "HEIGHT")),
    weight: num(get("Vitals", "WEIGHT")),
    wingspan: num(get("Vitals", "WINGSPANCM")),
    faceId: num(get("Vitals", "FACEID")),
    potential: {
      current: num(get("Attributes", "POTENTIAL")),
      min: num(get("Vitals", "MINIMUMPOTENTIAL")),
      max: num(get("Vitals", "MAXIMUMPOTENTIAL")),
    },
    vitals,
    durability,
    hotZones,
    detailed,
    badges,
    tendencies,
    personalityBadges,
    posKey,
    badgesForModel: badges.map((b) => ({ ...b, category: badgeCategoryMap[b.name] ?? "other" })),
  };
}

// ---- convert AB ----
const abSnap = JSON.parse(fs.readFileSync(AB_SNAP, "utf8"));
const written = [];
const skipped = [];
for (const rec of abSnap.records) {
  const f = rec.fields ?? {};
  const first = String(f["Vitals/FIRSTNAME"]?.display_value ?? "");
  const last = String(f["Vitals/LASTNAME"]?.display_value ?? "");
  const name = `${first} ${last}`.trim();
  const slug = slugify(name);
  if (abOvr.has(slug)) {
    const card = convertRecord(rec, { overall: abOvr.get(slug), source: "db2k-no-card-ab" });
    written.push(card);
  } else {
    skipped.push(name);
  }
}
console.log(`AB converted: ${written.length}, skipped: ${skipped.join(", ")}`);

// ---- convert C (model OVR) ----
const cSnap = JSON.parse(fs.readFileSync(C_SNAP, "utf8"));
const djgSnap = JSON.parse(fs.readFileSync(DJG_SNAP, "utf8"));
const cCards = [];
for (const rec of [...cSnap.records, ...djgSnap.records]) {
  const card = convertRecord(rec, { overall: null, source: "db2k-no-card-c-capped80" });
  // Compute OVR with the project's rookie model (attributes already capped at 80)
  const ovr = estimateGameOverall(card.detailed, card.posKey, card.badgesForModel, 65, "rookie");
  card.overall = ovr;
  cCards.push(card);
}
for (const card of cCards) {
  console.log(`C: ${card.name.padEnd(24)} model OVR=${card.overall}`);
}

// ---- write ----
const allCards = [...written, ...cCards];
for (const card of allCards) {
  const year = card.draftYear ?? 2025;
  const dir = path.join(OUT_BASE, String(year));
  fs.mkdirSync(dir, { recursive: true });
  const { posKey, badgesForModel, ...cardOut } = card;
  fs.writeFileSync(path.join(dir, `${card.slug}.json`), JSON.stringify(cardOut, null, 2) + "\n", "utf8");
}
console.log(`\nWrote ${allCards.length} cards (AB ${written.length} + C ${cCards.length})`);
