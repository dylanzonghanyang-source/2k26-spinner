/**
 * Patch draft picks (idempotent): DB2K DRAFTPICKNUMBER is a *within-round* index
 * (second-round picks stored 1-30 instead of 31-60).
 *  - 2003-2018: target pick = merged.DRAFTPICKNUMBER + (ROUNDDRAFTED-1)*30 — target is
 *    fixed, so reruns are safe.
 *  - 2019-2025: explicit second-round name list; pick += 30, guarded by a log file so
 *    reruns never double-apply.
 * Rewrites rookieCards/{year}/{slug}.json vitals.draftPick, then rebuild the index.
 *
 * Run: node scripts/patch-draft-picks.mjs
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const cardsDir = path.join(root, "src/data/rookieCards");
const logPath = path.join(root, "data/raw/db2k/draft-pick-patch-log.json");
const log = existsSync(logPath) ? JSON.parse(readFileSync(logPath, "utf8")) : [];

// --- 1. authoritative round/pick from merged export (2003-2018) ---
const merged = JSON.parse(readFileSync(path.join(root, "data/raw/db2k/merged-2003-2018-full.json"), "utf8"));
const mergedInfo = new Map(); // core(name) -> { round, pick }
for (const rec of merged.records) {
  const label = core(String(rec.label ?? ""));
  const round = rec.fields?.["Vitals/ROUNDDRAFTED"]?.display_value;
  const pick = rec.fields?.["Vitals/DRAFTPICKNUMBER"]?.display_value;
  if (label && typeof round === "number" && typeof pick === "number") {
    if (!mergedInfo.has(label)) mergedInfo.set(label, { round, pick });
  }
}

// --- 2. second-round explicit list for 2019-2025 (public knowledge; pick += 30) ---
const SECOND_ROUND_BY_YEAR = {
  "2019": ["Carsen Edwards", "KZ Okpala", "Bruno Fernando", "Marcos Louzada Silva", "Cody Martin", "Deividas Sirvydis",
    "Daniel Gafford", "Alen Smailagic", "Justin James", "Eric Paschall", "Admiral Schofield", "Jaylen Nowell", "Bol Bol",
    "Isaiah Roby", "Talen Horton-Tucker", "Ignas Brazdeikis", "Terance Mann", "Quinndary Weatherspoon", "Jarrell Brantley",
    "Tremont Waters", "Jalen McDaniels", "Justin Wright-Foreman", "Marial Shayok", "Kyle Guy", "Jaylen Hands", "Jordan Bone", "Miye Oni"],
  "2020": ["Vernon Carey Jr.", "Tyrell Terry", "Mfiondu Kabengele", "Jordan Nwora", "Yam Madar", "Xavier Tillman",
    "Killian Tillie", "Vit Krejci", "Trent Forrest", "Mason Jones", "Jalen Harris", "Sam Merrill", "Immanuel Quickley",
    "Skylar Mays", "Justinian Jessup", "Kenyon Martin Jr.", "Cassius Winston", "Cassius Stanley", "Jay Scrubb",
    "Grant Riller", "Reggie Perry", "Paul Reed", "Jahlil Okafor", "Nate Hinton", "Josh Green", "Trevelin Queen",
    "Markus Howard", "Nico Mannion", "Isaiah Joe", "Drew Eubanks"],
  "2021": ["Juhann Begarin", "Isaiah Todd", "Jeremiah Robinson-Earl", "Jason Preston", "Rokas Jokubaitis", "Herb Jones",
    "Miles McBride", "JT Thor", "Ayo Dosunmu", "Neemias Queta", "Jared Butler", "Cam Thomas", "Sharife Cooper",
    "Marcus Garrett", "Quentin Grimes", "RaiQuan Gray", "Daishen Nix", "Kessler Edwards", "Austin Reaves",
    "Brandon Boston Jr.", "Luka Garza", "Bones Hyland", "Filip Petrusev", "Vrenz Bleijenbergh", "Dalen Terry",
    "Sandro Mamukelashvili", "Sam Hauser", "Yves Pons", "Greg Brown III"],
  "2022": ["Mark Williams", "Jalen Williams", "Jaylin Williams", "Andrew Nembhard", "Caleb Houstan", "Christian Koloko",
    "Jake LaRavia", "Max Christie", "Nikola Jovic", "Patrick Baldwin Jr.", "MarJon Beauchamp", "David Roddy",
    "Ryan Rollins", "Josh Minott", "Ismael Kamagate", "Vince Williams Jr.", "Kendall Brown", "Isaiah Mobley",
    "Matteo Spagnolo", "Tyty Washington Jr.", "Wendell Moore Jr.", "Gabe Brown", "Trevor Keels", "JD Davison"],
  "2023": ["Sidy Cissoko", "Keyonte George", "Jalen Pickett", "Colby Jones", "Julian Strawther", "Andre Jackson Jr.",
    "Hunter Tyson", "Seth Lundy", "Mouhamed Gueye", "Emoni Bates", "Jazian Gortman", "Trey Jemison", "Amari Bailey",
    "Brice Sensabaugh", "Ben Sheppard", "Jaylen Clark", "Toumani Camara", "James Nnaji", "Kobe Brown", "Jordan Walsh"],
  "2024": ["Tyler Kolek", "Johnny Furphy", "Jaylon Tyson", "Tyler Smith", "Kyle Filipowski", "Jonathan Mogbo",
    "Cam Christie", "Pacome Dadiet", "Dillon Jones", "Enrique Freeman", "Quinten Post", "Nikola Topic", "Adem Bona",
    "KJ Simpson", "Trey Alexander", "Kevin McCullar Jr.", "Jamal Shead", "Antonio Reeves", "Ajay Mitchell",
    "Baylor Scheierman", "Melvin Ajinca", "Bronny James", "Ulrich Chomche"],
  "2025": ["JoJo Tugler", "Maxime Raynaud", "Rasheer Fleming", "Adou Thiero", "Danny Wolf", "Isaiah Evans",
    "Noa Essengue", "Drake Powell", "Alex Karaban", "Nolan Traore", "Mouhamed Sarr", "Carter Bryant",
    "Rocco Zikarsky", "Caleb Love", "Boogie Fland", "Miles Byrd", "Jamir Watkins", "Naithan George",
    "Yaxel Lendeborg", "Trey Townsend", "Xaivian Lee", "Ben Saraf", "Kamarion Williams", "Kolton Mitchell"],
};

function core(name) {
  // keep Jr/Sr/II/III suffixes (Ron Harper vs Ron Harper Jr. are distinct)
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let fixed = 0;
const report = [];
const newLog = [];

const yearDirs = readdirSync(cardsDir).filter((d) => /^\d{4}$/.test(d)).sort();
for (const year of yearDirs) {
  for (const file of readdirSync(path.join(cardsDir, year)).filter((f) => f.endsWith(".json"))) {
    const filePath = path.join(cardsDir, year, file);
    const card = JSON.parse(readFileSync(filePath, "utf8"));
    const pick = card.vitals?.draftPick;
    if (typeof pick !== "number" || pick <= 0) continue;

    const name = String(card.name ?? "");
    let target = null;
    let source = null;
    const info = mergedInfo.get(core(name));
    if (info) {
      target = info.round === 2 ? info.pick + 30 : info.pick;
      source = `merged:round${info.round}`;
    } else {
      const alreadyPatched = log.includes(`${year}:${file}`);
      // list entries may omit a suffix the card keeps ("Xavier Tillman" vs
      // "Xavier Tillman Sr."); per-year scope makes this unambiguous
      const inSecondRound = SECOND_ROUND_BY_YEAR[year]?.some((n) => {
        const k = core(n);
        return core(name) === k || core(name) === `${k} jr` || core(name) === `${k} sr` || core(name) === `${k} ii` || core(name) === `${k} iii`;
      });
      if (inSecondRound && !alreadyPatched) {
        target = pick + 30;
        source = "second-round-list";
      }
    }

    if (target != null && target !== pick) {
      card.vitals.draftPick = target;
      writeFileSync(filePath, JSON.stringify(card, null, 2), "utf8");
      fixed++;
      newLog.push(`${year}:${file}`);
      report.push(`${year} | ${name} | ${pick} → ${target} (${source})`);
    }
  }
}

if (newLog.length) {
  writeFileSync(logPath, JSON.stringify([...log, ...newLog], null, 2), "utf8");
}
console.log(`fixed ${fixed} cards（幂等，可重复运行）`);
if (report.length) console.log("修正明细:\n" + report.join("\n"));
