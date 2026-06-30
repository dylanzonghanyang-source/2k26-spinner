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
  athleticism: ["Speed", "Acceleration", "Vertical", "Stamina", "Hustle", "Durability"],
  playmaking: ["Pass Accuracy", "Ball Handle", "Speed With Ball", "Pass IQ", "Offensive Consistency"],
  defense: [
    "Interior Defense",
    "Perimeter Defense",
    "Steal",
    "Block",
    "Defensive Rebound",
    "Help Defense IQ",
    "Lateral Quickness"
  ],
  inside: [
    "Driving Layup",
    "Driving Dunk",
    "Standing Dunk",
    "Post Control",
    "Post Hook",
    "Post Fade",
    "Close Shot",
    "Draw Foul"
  ]
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
      shooting: aggregateCategory(text, ATTRIBUTE_LABELS.shooting),
      athleticism: aggregateCategory(text, ATTRIBUTE_LABELS.athleticism),
      playmaking: aggregateCategory(text, ATTRIBUTE_LABELS.playmaking),
      defense: aggregateCategory(text, ATTRIBUTE_LABELS.defense),
      inside: aggregateCategory(text, ATTRIBUTE_LABELS.inside)
    },
    detailedAttributes
  };
}

function aggregateCategory(text, labels) {
  const values = labels.map((label) => guessNumber(text, [label])).filter((value) => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function extractKnownAttributes(text) {
  const known = new Map();
  for (const label of Object.values(ATTRIBUTE_LABELS).flat()) {
    const value = guessNumber(text, [label]);
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

    if (looksLikePath(item)) {
      const file = await readFile(path.resolve(item), "utf8");
      const parsed = item.endsWith(".json") ? JSON.parse(file) : file.split(/\r?\n/);
      for (const entry of parsed.flat?.() ?? parsed) {
        if (typeof entry === "string" && looksLikeUrl(entry)) {
          urls.push(entry);
        }
      }
    }
  }

  return [...new Set(urls)];
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value);
}

function looksLikePath(value) {
  return !looksLikeUrl(value);
}
