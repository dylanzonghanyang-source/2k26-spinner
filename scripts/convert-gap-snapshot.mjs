#!/usr/bin/env node
/**
 * Convert DB2K "Gap-by-year draft classes (historic values, read-only)" snapshot
 * (521 records, draft years 1960-2002) -> rookieCards/{draftYear}/{slug}.json.
 *
 * Mirrors convert-db2k-to-rookiecard.mjs field maps; differences:
 *  - Multi-year single snapshot: draftYear from Vitals/DRAFTEDYEAR (authoritative).
 *  - draftPick = DRAFTPICKNUMBER + (ROUNDDRAFTED-1)*30 (2K within-round index).
 *  - OVR has no user confirmation source -> estimated via estimateGameOverall,
 *    source marked "model-estimated-gap" (user can override later via overrides).
 *  - Name variants mapped to the canonical gap-list names.
 *
 * Run:
 *   node scripts/convert-gap-snapshot.mjs \
 *     --input "/path/to/gap_by_year_draft_classes.json"
 */
import fs from "node:fs";
import path from "node:path";
import { estimateGameOverall } from "../src/rookieOverall.ts";

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const INPUT = getArg("--input") || "/Users/yangzonghan/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_u99tqi61ovek22_9013/msg/file/2026-08/gap_by_year_draft_classes.json";
const OUT_ROOT = getArg("--out") || path.join("src", "data", "rookieCards");

// ============================================================
// Field maps (mirror convert-db2k-to-rookiecard.mjs)
// ============================================================
const ATTR_MAP = {
  AGILITY: "Agility", BALLCONTROL: "Ball Handle", BLOCK: "Block", CLOSESHOT: "Close Shot",
  DEFENSECONSISTENCY: "Defensive Consistency", DEFENSEREBOUND: "Defensive Rebound",
  DRAWFOUL: "Draw Foul", DRIVINGDUNK: "Driving Dunk", FREETHROW: "Free Throw", HANDS: "Hands",
  HELPDEFENSE: "Help Defense IQ", HUSTLE: "Hustle", INTANGIBLES: "Intangibles",
  INTERIORDEFENSE: "Interior Defense", IQSHOT: "Shot IQ", MIDRANGE: "Mid-Range Shot",
  OFFENSIVECONSISTENCY: "Offensive Consistency", OFFENSIVEREBOUND: "Offensive Rebound",
  PASSACCURACY: "Pass Accuracy", PASSIQ: "Pass IQ", PASSPERCEPTION: "Pass Perception",
  PASSVISION: "Pass Vision", PERIMETERDEFENSE: "Perimeter Defense", POSTCONTROL: "Post Control",
  POSTFADE: "Post Fade", POSTHOOK: "Post Hook", SPEED: "Speed", SPEEDWITHBALL: "Speed with Ball",
  STAMINA: "Stamina", STANDINGDUNK: "Standing Dunk", STEAL: "Steal", STRENGTH: "Strength",
  VERTICAL: "Vertical",
};
ATTR_MAP.DRIVINGLAYUP = "Layup";
ATTR_MAP["3POINT"] = "Three-Point Shot";

const BADGE_MAP = {
  AERIALWIZARD: "Aerial Wizard", ANKLEBREAKER: "Ankle Assassin", BAILOUT: "Bail Out",
  BOXOUTBEAST: "Boxout Beast", BREAKSTARTER: "Break Starter", BRICKWALL: "Brick Wall",
  CHALLENGER: "Challenger", DEADEYE: "Deadeye", DIMER: "Dimer", FLOATGAME: "Float Game",
  GLOVE: "Glove", HANDLESFORDAYS: "Handles For Days", HIGHFLYINGDENIER: "High-Flying Denier",
  HOOKSPECIALIST: "Hook Specialist", IMMOVABLEENFORCER: "Immovable Enforcer", INTERCEPTOR: "Interceptor",
  LAYUPMIXMASTER: "Layup Mixmaster", LIGHTNINGLAUNCH: "Lightning Launch", LIMITLESSRANGE: "Limitless Range",
  MINIMARKSMAN: "Mini Marksman", OFFBALLPEST: "Off-Ball Pest", ONBALLMENACE: "On-Ball Menace",
  PAINTPATROLLER: "Paint Patroller", PAINTPRODIGY: "Paint Prodigy", PHYSICALFINISHER: "Physical Finisher",
  PICKDODGER: "Pick Dodger", POGOSTICK: "Pogo Stick", POSTERIZER: "Posterizer",
  POSTFADEPHENOM: "Post Fade Phenom", POSTLOCKDOWN: "Post Lockdown", POSTPOWERHOUSE: "Post Powerhouse",
  POSTUPPOET: "Post-Up Poet", REBOUNDCHASER: "Rebound Chaser", RISEUP: "Rise Up",
  SETSPECIALISTSHOT: "Set Shot Specialist", SHIFTYSHOOTER: "Shifty Shooter", SLIPPERYOFFBALL: "Slippery Off-Ball",
  STRONGHANDLE: "Strong Handle", UNPLUCKABLE: "Unpluckable", VERSATILEVISIONARY: "Versatile Visionary",
};
const PERSONALITY_BADGES = new Set([
  "ALPHADOG", "EXPRESSIVE", "EXTREMELYCONFIDENT", "FINANCESAVVY", "FRIENDLY",
  "KEEPITREAL", "LAIDBACK", "MARKETABILITY", "MEDIARINGMASTER", "PATMYBACK",
  "RESERVED", "TEAMPLAYER", "UNPREDICTABLE", "WARMWEATHERFAN", "WORKETHIC",
]);
const BADGE_TIER = { 1: "Bronze", 2: "Silver", 3: "Gold", 4: "HOF" };

const TENDENCY_MAP = {
  ALLEYOOP: "Alley-Oop", ALLEYOOPPASS: "Alley-Oop Pass", ATTACKSTRONGONDRIVE: "Attack Strong on Drive",
  BLOCKSHOT: "Block Shot", CONTESTEDJUMPERMIDRANGE: "Contested Jumper Mid-Range",
  CONTESTEDJUMPER3POINT: "Contested Jumper Three", CRASH: "Crash", DISHTOOPENMAN: "Dish to Open Man",
  DRIVE: "Drive", DRIVEPULLUPMIDRANGE: "Drive Pull-Up Mid-Range", DRIVEPULLUP3POINT: "Drive Pull-Up Three",
  DRIVERIGHT: "Drive Right", DRIVINGBEHINDTHEBACK: "Driving Behind the Back",
  DRIBBLECROSSOVER: "Driving Crossover", DRIVINGDOUBLECROSSOVER: "Driving Double Crossover",
  DRIVINGDRIBBLEHESITATION: "Driving Dribble Hesitation", DRIVINGDUNK: "Driving Dunk",
  DRIVINGHALFSPIN: "Driving Half Spin", DRIVINGINANDOUT: "Driving In & Out", DRIVINGLAYUP: "Driving Layup",
  DRIBBLESPIN: "Driving Spin", DRIVINGSTEPBACK: "Driving Stepback", EUROSTEPLAYUP: "Euro Step Layup",
  FLASHYDUNK: "Flashy Dunk", FLASHYPASS: "Flashy Pass", FLOATER: "Floater", FOUL: "Foul",
  HARDFOUL: "Hard Foul", HOPSTEPLAYUP: "Hop Step Layup", ISOVSAVERAGEDEFENDER: "Iso vs Average Defender",
  ISOVSELITEDEFENDER: "Iso vs Elite Defender", ISOVSGOODDEFENDER: "Iso vs Good Defender",
  NODRIVINGDRIBBLEMOVE: "No Driving Dribble Move", NOSETUPDRIBBLE: "No Setup Dribble",
  OFFSCREENDRIVE: "Off-Screen Drive", MIDOFFSCREENSHOT: "Off-Screen Shot Mid-Range",
  "3POINTOFFSCREENSHOT": "Off-Screen Shot Three", ONBALLSTEAL: "On-Ball Steal",
  PASSINTERCEPTION: "Pass Interception", PLAYDISCIPLINE: "Play Discipline",
  POSTAGGRESSIVEBACKDOWN: "Post Aggressive Backdown", POSTBACKDOWN: "Post Back Down",
  POSTDRIVE: "Post Drive", POSTDROPSTEP: "Post Drop Step", POSTFACEUP: "Post Face Up",
  POSTFADELEFT: "Post Fade Left", POSTFADERIGHT: "Post Fade Right", POSTHOOKLEFT: "Post Hook Left",
  POSTHOOKRIGHT: "Post Hook Right", HOPPOSTSHOT: "Post Hop Step", POSTSHIMMYSHOT: "Post Shimmy Shot",
  POSTSPIN: "Post Spin", POSTSTEPBACKSHOT: "Post Stepback Shot", POSTUP: "Post Up",
  POSTUPANDUNDER: "Post Up & Under", PUTBACK: "Putback", ROLLVSPOP: "Roll vs Pop",
  SETUPWITHHESITATION: "Setup With Hesitation", SETUPWITHSIZEUP: "Setup With Sizeup",
  FROMPOSTSHOT: "Shoot From Post", SHOT: "Shot", CLOSESHOT: "Shot Close",
  CLOSELEFTSHOT: "Shot Close Left", CLOSEMIDDLESHOT: "Shot Close Middle", CLOSERIGHTSHOT: "Shot Close Right",
  CENTERMIDSHOT: "Shot Mid Center", LEFTMIDSHOT: "Shot Mid Left", CENTERLEFTMIDSHOT: "Shot Mid Left-Center",
  MIDRIGHTSHOT: "Shot Mid Right", CENTERMIDRIGHTSHOT: "Shot Mid Right-Center", MIDSHOT: "Shot Mid-Range",
  "3POINTSHOT": "Shot Three", "3POINTCENTERSHOT": "Shot Three Center", "3POINTLEFTSHOT": "Shot Three Left",
  "3POINTCENTERLEFTSHOT": "Shot Three Left-Center", "3POINTRIGHTSHOT": "Shot Three Right",
  "3POINTCENTERRIGHTSHOT": "Shot Three Right-Center", BASKETUNDERSHOT: "Shot Under Basket",
  SPINJUMPER: "Spin Jumper", SPINLAYUP: "Spin Layup", SPOTUPDRIVE: "Spot Up Drive",
  MIDSPOTUPSHOT: "Spot Up Shot Mid-Range", "3POINTSPOTUPSHOT": "Spot Up Shot Three",
  STANDINGDUNK: "Standing Dunk", STEPTHROUGH: "Step Through Shot",
  STEPBACKJUMPERMIDRANGE: "Stepback Jumper Mid-Range", STEPBACKJUMPER3POINT: "Stepback Three Point Shot",
  TAKECHARGE: "Take Charge", TOUCHES: "Touches", TRANSITIONPULLUP3POINT: "Transition Pull-Up Three Point Shot",
  TRANSITIONSPOTUP: "Transition Spot Up vs Cut to the Basket", TRIPLETHREATIDLE: "Triple Threat Idle",
  TRIPLETHREATJABSTEP: "Triple Threat Jab Step", TRIPLETHREATPUMPFAKE: "Triple Threat Pump Fake",
  THREATTRIPLESHOT: "Triple Threat Shoot", USEGLASS: "Use Glass",
};

const DURABILITY_MAP = {
  head: "HEADDURABILITY", neck: "NECKDURABILITY", back: "BACKDURABILITY",
  leftShoulder: "LEFTSHOULDERDURABILITY", rightShoulder: "RIGHTSHOULDERDURABILITY",
  leftElbow: "LEFTELBOWDURABILITY", rightElbow: "RIGHTELBOWDURABILITY",
  leftHip: "LEFTHIPDURABILITY", rightHip: "RIGHTHIPDURABILITY",
  leftKnee: "LEFTKNEE DURABILITY".replace(" ", ""), rightKnee: "RIGHTKNEE DURABILITY".replace(" ", ""),
  leftAnkle: "LEFTANKLEDURABILITY", rightAnkle: "RIGHTANKLEDURABILITY",
  leftFoot: "LEFTFOOTDURABILITY", rightFoot: "RIGHTFOOTDURABILITY", overall: "MISCDURABILITY",
};
DURABILITY_MAP.leftKnee = "LEFTKNEE DURABILITY".replace(" ", "");
DURABILITY_MAP.rightKnee = "RIGHTKNEE DURABILITY".replace(" ", "");

const HOTZONE_MAP = {
  underBasket: "UNDERBASKET", closeLeft: "CLOSELEFT", closeMiddle: "CLOSEMIDDLE", closeRight: "CLOSERIGHT",
  midLeft: "MIDRANGELEFT", midLeftCenter: "MIDRANGELEFTCENTER", midCenter: "MIDRANGECENTER",
  midRightCenter: "MIDRANGERIGHTCENTER", midRight: "MIDRANGERIGHT",
  threeLeft: "3LEFT", threeLeftCenter: "3LEFTCENTER", threeCenter: "3CENTER",
  threeRightCenter: "3RIGHTCENTER", threeRight: "3RIGHT",
};

// ============================================================
// Helpers
// ============================================================
const slugify = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const core = (name) =>
  String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// canonical names: snapshot label -> gap-list name (keeps roster-consistent naming)
const NAME_VARIANTS = {
  "Ming Yao": "Yao Ming",
  "Michael Holton": "Mike Holton",
  "Mickael Piétrus": "Mickael Pietrus",
  "Patrick Mills": "Patty Mills",
  "Ömer Asik": "Omer Asik",
  "Jeff Pendergraph": "Jeff Pendegraph",
  "Slava Medvedenko": "Stanislav Medvedenko",
  "Darrell Griffith": "Darrel Griffith",
  "Cliff Robinson": "Clifford Robinson",
  "Zhi Zhi Wang": "Wang Zhizhi",
};

// ============================================================
// Load
// ============================================================
const snapshot = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const records = snapshot.records ?? [];
console.log(`snapshot: ${records.length} records, mode=${snapshot.mode}`);

// gap-list names for verification
const gapList = new Set();
const gapCsv = path.join("data", "raw", "db2k", "gap-collection-2026-08-10.csv");
if (fs.existsSync(gapCsv)) {
  for (const line of fs.readFileSync(gapCsv, "utf8").trim().split("\n").slice(1)) {
    gapList.add(core(line.split(",")[0]));
  }
}

// ============================================================
// Convert
// ============================================================
const out = [];
const review = { converted: [], skipped: [], missing_attrs: [], ovr_estimated: [], suspicious_ovr: [] };

for (const rec of records) {
  const f = rec.fields ?? {};
  const get = (section, name) => f[`${section}/${name}`]?.display_value;

  const first = String(get("Vitals", "FIRSTNAME") ?? "");
  const last = String(get("Vitals", "LASTNAME") ?? "");
  const rawName = `${first} ${last}`.trim();
  if (!rawName) continue;
  const canonicalName = NAME_VARIANTS[rawName] ?? rawName;
  const slug = slugify(canonicalName);

  const draftYear = num(get("Vitals", "DRAFTEDYEAR"));
  const round = num(get("Vitals", "ROUNDDRAFTED"));
  const pickRaw = num(get("Vitals", "DRAFTPICKNUMBER"));
  const draftPick = pickRaw != null && round === 2 ? pickRaw + 30 : pickRaw;

  if (draftYear == null || draftYear < 1960) {
    review.skipped.push(`${rawName}: bad draftYear=${draftYear}`);
    continue;
  }

  // --- attributes ---
  const detailed = {};
  for (const [dbkName, projName] of Object.entries(ATTR_MAP)) {
    const v = num(get("Attributes", dbkName));
    if (v != null) detailed[projName] = v;
  }
  if (Object.keys(detailed).length < 30) {
    review.skipped.push(`${rawName}: only ${Object.keys(detailed).length} attrs`);
    continue;
  }

  // --- badges ---
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

  // --- tendencies + hot zones + durability ---
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

  // --- vitals ---
  const pick = (name) => {
    const v = get("Vitals", name);
    return v == null || v === "" ? null : v;
  };
  const boolYes = (name) => {
    const v = pick(name);
    if (v == null) return null;
    return String(v).toLowerCase() === "yes";
  };
  const vitals = {
    firstName: pick("FIRSTNAME"), lastName: pick("LASTNAME"),
    nickname: pick("NICKNAME") || null, jerseyNickname: pick("JERSEYNICKNAME") || null,
    birthMonth: num(pick("BIRTHMONTH")), birthDay: num(pick("BIRTHDAY")), birthYear: num(pick("BIRTHYEAR")),
    ageAtSetYear: num(pick("CUSTOMAGEATSETYEAR")), jerseyNumber: num(pick("NUMBER")),
    yearsPro: num(pick("YEARSPRO")), dominantHand: pick("DOMINANTHAND"), dominantDunkHand: pick("DOMINANTDUNKHAND"),
    peakStartAge: num(pick("PEAKSTARTAGE")), peakEndAge: num(pick("PEAKENDAGE")),
    boomPercent: num(pick("BOOMPERCENTAGE")), averagePercent: num(pick("AVERAGEPERCENT")),
    bustPercent: num(pick("BUSTPERCENTAGE")), playForWinner: num(pick("PLAYFORWINNER")),
    financialSecurity: num(pick("FINANCIALSECURITY")), loyalty: num(pick("LOYALTY")),
    forceNonStarter: pick("FORCENONSTARTER"), playInitiator: boolYes("PLAYINITIATOR"),
    playType1: pick("PLAYTYPE1"), playType2: pick("PLAYTYPE2"), playType3: pick("PLAYTYPE3"), playType4: pick("PLAYTYPE4"),
    currentTeam: num(pick("CURRENTTEAM")), hometownTeam1: num(pick("HOMETOWNTEAM1")), hometownTeam2: num(pick("HOMETOWNTEAM2")),
    draftYear, draftPick,
    heightInches: num(pick("HEIGHT")), weightLb: num(pick("WEIGHT")), wingspanCm: num(pick("WINGSPANCM")),
    armScale: num(pick("ARMSCALE")), shoulderLength: num(pick("SHOULDERLENGTH")),
    neckLength: num(pick("NECKLENGTH")), trunkLength: num(pick("TRUNKLENGTH")),
  };

  // --- OVR estimate (model) ---
  const pos = get("Vitals", "POSITION");
  const age = num(pick("CUSTOMAGEATSETYEAR")) ?? 20;
  const overall = estimateGameOverall(detailed, pos ?? "SF", badges, age, "2k26");
  if (overall == null) review.missing_attrs.push(canonicalName);
  else review.ovr_estimated.push(canonicalName);

  const card = {
    slug,
    name: canonicalName,
    draftYear,
    source: "db2k-gap-historic",
    gameVersion: snapshot.target_executable ?? "NBA2K26",
    capturedAt: new Date().toISOString().slice(0, 10),
    overall,
    overallSource: "model-estimated-gap",
    position: pos,
    secondaryPosition: get("Vitals", "SECONDARYPOSITION"),
    height: num(pick("HEIGHT")),
    weight: num(pick("WEIGHT")),
    wingspan: num(pick("WINGSPANCM")),
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
  };
  out.push(card);
}

// ============================================================
// Write (per draft year dirs)
// ============================================================
let written = 0;
for (const card of out) {
  const dir = path.join(OUT_ROOT, String(card.draftYear));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${card.slug}.json`), JSON.stringify(card, null, 2) + "\n", "utf8");
  written++;
}

fs.writeFileSync(
  path.join(OUT_ROOT, "gap-conversion-manifest.json"),
  JSON.stringify({
    source: "DB2K Gap-by-year draft classes snapshot",
    inputFile: INPUT,
    mode: snapshot.mode,
    recordCount: records.length,
    converted: written,
    ovrEstimated: review.ovr_estimated.length,
    capturedAt: new Date().toISOString(),
  }, null, 2) + "\n",
  "utf8",
);

console.log(`\nconverted ${written}/${records.length}`);
console.log(`OVR estimated: ${review.ovr_estimated.length} (model, source=model-estimated-gap)`);
if (review.skipped.length) {
  console.log(`skipped ${review.skipped.length}:`);
  for (const s of review.skipped) console.log("  -", s);
}
if (review.missing_attrs.length) console.log(`missing attrs (no OVR): ${review.missing_attrs.length}`);
