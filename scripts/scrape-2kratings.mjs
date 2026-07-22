import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "data", "2kratings");

const ATTRIBUTE_LABELS = {
  shooting: [
    "Close Shot",
    "Mid-Range Shot",
    "Three-Point Shot",
    "Free Throw",
    "Shot IQ",
    "Offensive Consistency"
  ],
  athleticism: ["Speed", "Strength", "Agility", "Vertical", "Hustle", "Stamina", "Overall Durability"],
  playmaking: ["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass Vision", "Pass IQ"],
  defense: [
    "Interior Defense",
    "Perimeter Defense",
    "Steal",
    "Block",
    "Pass Perception",
    "Defensive Consistency",
    "Defensive Rebound",
    "Help Defense IQ"
  ],
  inside: [
    "Layup",
    "Driving Dunk",
    "Standing Dunk",
    "Post Control",
    "Post Hook",
    "Post Fade",
    "Close Shot",
    "Draw Foul",
    "Hands",
    "Offensive Rebound"
  ]
};

const ATTRIBUTE_ALIASES = {
  "Close Shot": ["Close Shot"],
  "Mid-Range Shot": ["Mid-Range Shot"],
  "Three-Point Shot": ["Three-Point Shot"],
  "Free Throw": ["Free Throw"],
  "Offensive Consistency": ["Offensive Consistency"],
  "Shot IQ": ["Shot IQ"],
  "Speed": ["Speed"],
  "Strength": ["Strength"],
  "Agility": ["Agility", "Lateral Quickness", "Acceleration"],
  "Vertical": ["Vertical"],
  "Hustle": ["Hustle"],
  "Stamina": ["Stamina"],
  "Overall Durability": ["Overall Durability", "Durability"],
  "Ball Handle": ["Ball Handle", "Ball Control"],
  "Speed with Ball": ["Speed with Ball", "Speed With Ball"],
  "Pass Accuracy": ["Pass Accuracy"],
  "Pass Vision": ["Pass Vision"],
  "Pass IQ": ["Pass IQ"],
  "Block": ["Block"],
  "Steal": ["Steal"],
  "Pass Perception": ["Pass Perception"],
  "Interior Defense": ["Interior Defense"],
  "Perimeter Defense": ["Perimeter Defense"],
  "Defensive Consistency": ["Defensive Consistency"],
  "Help Defense IQ": ["Help Defense IQ"],
  "Layup": ["Layup", "Driving Layup"],
  "Driving Dunk": ["Driving Dunk"],
  "Standing Dunk": ["Standing Dunk"],
  "Post Hook": ["Post Hook"],
  "Post Fade": ["Post Fade"],
  "Post Control": ["Post Control"],
  "Draw Foul": ["Draw Foul"],
  "Hands": ["Hands"],
  "Offensive Rebound": ["Offensive Rebound"],
  "Defensive Rebound": ["Defensive Rebound"],
  "Intangibles": ["Intangibles"]
};

const BADGE_CATEGORY_BY_NAME = {
  "Set Shot Specialist": "shooting",
  "Deadeye": "shooting",
  "Limitless Range": "shooting",
  "Mini Marksman": "shooting",
  "Shifty Shooter": "shooting",
  "Ankle Assassin": "playmaking",
  "Bail Out": "playmaking",
  "Break Starter": "playmaking",
  "Dimer": "playmaking",
  "Handles For Days": "playmaking",
  "Lightning Launch": "athleticism",
  "Strong Handle": "playmaking",
  "Unpluckable": "playmaking",
  "Versatile Visionary": "playmaking",
  "Aerial Wizard": "athleticism",
  "Float Game": "inside",
  "Hook Specialist": "inside",
  "Layup Mixmaster": "inside",
  "Paint Prodigy": "inside",
  "Physical Finisher": "inside",
  "Post Fade Phenom": "inside",
  "Post Powerhouse": "inside",
  "Post-Up Poet": "inside",
  "Posterizer": "inside",
  "Rise Up": "inside",
  "Challenger": "defense",
  "Glove": "defense",
  "High-Flying Denier": "defense",
  "Immovable Enforcer": "defense",
  "Interceptor": "defense",
  "Off-Ball Pest": "defense",
  "On-Ball Menace": "defense",
  "Paint Patroller": "defense",
  "Pick Dodger": "defense",
  "Post Lockdown": "defense",
  "Boxout Beast": "rebounding",
  "Rebound Chaser": "rebounding",
  "Brick Wall": "inside",
  "Pogo Stick": "defense",
  "Slippery Off-Ball": "shooting"
};

const inputArgs = process.argv.slice(2);
if (inputArgs.length === 0) {
  console.error("Usage: node scripts/scrape-2kratings.mjs [--out dir] <player-url|url-file> [more-urls-or-files...]");
  process.exit(1);
}

const { outputDir, inputs } = parseArgs(inputArgs);
await mkdir(outputDir, { recursive: true });

const urls = await expandInputs(inputs);
if (urls.length === 0) {
  throw new Error("No URLs found to scrape.");
}

for (const url of urls) {
  const html = await fetchText(url);
  const data = parsePlayerPage(html, url);
  const filePath = path.join(outputDir, `${data.slug}.json`);
  await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Wrote ${filePath}`);
}

function parsePlayerPage(html, sourceUrl) {
  const text = htmlToText(html);
  const slug = slugFromUrl(sourceUrl);
  const name =
    matchFirst(html, [
      /<h1[^>]*>(.*?)<\/h1>/is,
      /<title[^>]*>(.*?)<\/title>/is
    ]) || slug.replace(/-/g, " ");

  const height = sanitizeMeasure(guessValue(text, ["Height"]));
  const weight = guessNumber(text, ["Weight"]);
  const wingspan = sanitizeMeasure(guessValue(text, ["Wingspan", "Wingspan (WS)"]));
  const position = sanitizePosition(guessValue(text, ["Position"]));
  const team = sanitizeTeam(guessValue(text, ["Team"]));
  const overall = guessNumber(text, ["Overall", "OVR"]);
  const archetype = guessValue(text, ["Archetype", "Player Type"]);
  const detailedAttributes = extractKnownAttributes(text);
  const badges = extractBadges(html);

  return {
    sourceUrl,
    slug,
    name: formatPlayerName(clean(name)),
    overall,
    team,
    position,
    archetype,
    height,
    weight,
    wingspan,
    attributes: {
      shooting: aggregateCategory(detailedAttributes, ATTRIBUTE_LABELS.shooting),
      athleticism: aggregateCategory(detailedAttributes, ATTRIBUTE_LABELS.athleticism),
      playmaking: aggregateCategory(detailedAttributes, ATTRIBUTE_LABELS.playmaking),
      defense: aggregateCategory(detailedAttributes, ATTRIBUTE_LABELS.defense),
      inside: aggregateCategory(detailedAttributes, ATTRIBUTE_LABELS.inside)
    },
    detailedAttributes,
    badges
  };
}

function extractBadges(html) {
  const badges = [];
  const imageTags = html.match(/<img\b[^>]*>/gi) ?? [];

  for (const tag of imageTags) {
    const alt = matchAttribute(tag, "alt");
    const src = matchAttribute(tag, "data-src") ?? matchAttribute(tag, "src");
    const tierMatch = src?.match(/\/([a-z0-9-]+)-(bronze|silver|gold|hall-of-fame)-badge\.png/i);
    if (!alt || !tierMatch) continue;

    const name = clean(alt);
    badges.push({
      name,
      category: BADGE_CATEGORY_BY_NAME[name] ?? "general",
      tier: tierMatch[2].toLowerCase() === "hall-of-fame" ? "HOF" : `${tierMatch[2][0].toUpperCase()}${tierMatch[2].slice(1).toLowerCase()}`
    });
  }

  return [...new Map(badges.map((badge) => [`${badge.name}:${badge.tier}`, badge])).values()];
}

function matchAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${escapeRegExp(name)}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function aggregateCategory(attributes, labels) {
  const values = labels.map((label) => attributes[label]).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function extractKnownAttributes(text) {
  const known = new Map();
  for (const [label, aliases] of Object.entries(ATTRIBUTE_ALIASES)) {
    const value = guessNumber(text, aliases);
    if (Number.isFinite(value)) {
      known.set(label, value);
    }
  }
  return Object.fromEntries(known.entries());
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(div|p|li|section|article|tr|td|th|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function guessValue(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*([^\\n]+)`, "i");
    const match = text.match(pattern);
    if (match) {
      return clean(match[1]);
    }
  }

  return null;
}

function guessNumber(text, labels) {
  const raw = guessValue(text, labels);
  if (!raw) {
    return null;
  }

  const match = raw.match(/(\d{1,3})/);
  return match ? Number(match[1]) : null;
}

function matchFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }
  return null;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function clean(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function formatPlayerName(value) {
  return clean(value)
    .split(/\s+/)
    .map((part) =>
      part
        .split(/([-'])/)
        .map((segment) => {
          if (segment === "-" || segment === "'") return segment;
          const lower = segment.toLowerCase();
          return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
        })
        .join("")
    )
    .join(" ");
}

function sanitizeMeasure(value) {
  if (!value) return null;
  const cleaned = clean(value);
  if (/[<>=]/.test(cleaned)) return null;
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return cleaned;
  if (/^\d+'\d+"?$/.test(cleaned)) return cleaned;
  return null;
}

function sanitizeTeam(value) {
  if (!value) return null;
  const cleaned = clean(value);
  if (cleaned.length <= 1 || cleaned.length > 40 || /[<>=]/.test(cleaned)) return null;
  return cleaned;
}

function sanitizePosition(value) {
  if (!value) return null;
  const cleaned = clean(value);
  if (/^(PG|SG|SF|PF|C|G|F|Guard|Forward|Center|Backcourt|Frontcourt)([\s/-]+(PG|SG|SF|PF|C|G|F|Guard|Forward|Center|Backcourt|Frontcourt))*$/i.test(cleaned)) {
    return cleaned;
  }
  return null;
}

function slugFromUrl(input) {
  try {
    const parsed = new URL(input);
    return parsed.pathname.split("/").filter(Boolean).pop() || "player";
  } catch {
    return input
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[^a-z0-9-]/gi, "") || "player";
  }
}

async function fetchText(input) {
  const response = await fetch(input, {
    headers: {
      "user-agent": "Mozilla/5.0 (Codex scraper; +https://openai.com/)"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${input}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(args) {
  const inputs = [];
  let outputDir = DEFAULT_OUTPUT_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--out" || item === "--output") {
      const next = args[index + 1];
      if (!next) {
        throw new Error("Missing output directory after --out.");
      }
      outputDir = path.resolve(next);
      index += 1;
      continue;
    }

    inputs.push(item);
  }

  return { outputDir, inputs };
}

async function expandInputs(items) {
  const urls = [];

  for (const item of items) {
    if (looksLikeUrl(item)) {
      urls.push(item);
      continue;
    }

    const file = await readFile(path.resolve(item), "utf8");
    const parsed = item.endsWith(".json") ? JSON.parse(file) : file.split(/\r?\n/);
    for (const entry of parsed.flat?.() ?? parsed) {
      if (typeof entry === "string" && looksLikeUrl(entry)) {
        urls.push(entry);
      }
    }
  }

  return [...new Set(urls)];
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}
