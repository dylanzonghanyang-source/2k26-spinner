/**
 * Live 2kratings.com is behind Cloudflare. This backfills player badges from
 * the Wayback Machine into data/2kratings/*.json and src/data/badgeProfiles.2k26.json.
 *
 * Usage:
 *   node scripts/backfill-badges-from-wayback.mjs [--limit N] [--concurrency N] [--slugs a,b] [--retry-failed]
 *
 * Resume-safe: existing badges and prior empty/failed attempts are skipped unless
 * --slugs or --retry-failed is set. Failures write badgeAttemptAt so the next run
 * can fast-skip them instead of hanging on the same Wayback dead ends.
 */
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(process.cwd());
const rawDir = path.join(root, "data", "2kratings");
const rosterPath = path.join(root, "src", "data", "rosterCatalog.json");
const playersPath = path.join(root, "src", "data", "players.json");
const badgeProfilesPath = path.join(root, "src", "data", "badgeProfiles.2k26.json");

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
  "Slippery Off-Ball": "shooting",
};

const { limit, concurrency, onlySlugs, retryFailed } = parseArgs(process.argv.slice(2));

const roster = JSON.parse(await readFile(rosterPath, "utf8"));
const detailedPlayers = JSON.parse(await readFile(playersPath, "utf8"));
const detailedSlugs = new Set(detailedPlayers.map((player) => player.slug).filter(Boolean));

const currentIds = [...new Set(
  roster.teams
    .filter((team) => team.category === "current")
    .flatMap((team) => team.players.map((player) => player.id))
    .filter((id) => detailedSlugs.has(id)),
)].sort();

const existingProfiles = JSON.parse(await readFile(badgeProfilesPath, "utf8").catch(() => "{}"));
const profiles = { ...existingProfiles };

await mkdir(rawDir, { recursive: true });

// Sync any raw badge rows that never made it into badgeProfiles.2k26.json.
// Object.hasOwn distinguishes "known zero badges" ([]) from "unknown" (absent);
// a known-zero profile must never be refetched or replaced by fallback data.
for (const slug of currentIds) {
  if (Object.hasOwn(profiles, slug)) continue;
  try {
    const raw = JSON.parse(await readFile(path.join(rawDir, `${slug}.json`), "utf8"));
    if (Array.isArray(raw.badges) && raw.badges.length > 0) {
      profiles[slug] = raw.badges;
    }
  } catch {
    // no raw file
  }
}

// Prefer residual outliers so badge/OVR analysis becomes useful before full coverage.
// Already-covered slugs are deferred so --limit / resume spend time on new fetches.
const prioritized = onlySlugs?.length
  ? onlySlugs
  : deferCovered(prioritizeSlugs(currentIds, detailedPlayers, roster), profiles, rawDir, retryFailed);
const targetSlugs = prioritized.slice(0, limit ?? prioritized.length);

let fetched = 0;
let withBadges = Object.values(profiles).filter((badges) => Array.isArray(badges) && badges.length > 0).length;
let failed = 0;
let skipped = 0;

console.log(`Backfilling badges for ${targetSlugs.length} players (concurrency=${concurrency}, alreadyWithBadges=${withBadges})...`);
if (targetSlugs.length) {
  console.log(`  first targets: ${targetSlugs.slice(0, 8).join(", ")}`);
}

await mapPool(targetSlugs, concurrency, async (slug, index) => {
  const rawPath = path.join(rawDir, `${slug}.json`);
  let raw = null;
  try {
    raw = JSON.parse(await readFile(rawPath, "utf8"));
  } catch {
    raw = { slug, sourceUrl: `https://www.2kratings.com/${slug}` };
  }

  // Resume: keep existing good badge rows unless --slugs forces a refresh.
  if (Array.isArray(raw.badges) && raw.badges.length > 0 && !onlySlugs) {
    profiles[slug] = raw.badges;
    skipped += 1;
    return;
  }
  if (Array.isArray(profiles[slug]) && profiles[slug].length > 0 && !onlySlugs) {
    skipped += 1;
    return;
  }
  // Known-zero profiles are real data: keep them, never re-fetch or overwrite.
  if (Object.hasOwn(profiles, slug) && Array.isArray(profiles[slug]) && profiles[slug].length === 0) {
    skipped += 1;
    return;
  }
  // Fast-skip permanent empty/no-snapshot attempts. Transient network failures
  // are never permanent — they stay retryable on the next resume.
  // Use --retry-failed to re-attempt permanent misses too.
  if (!onlySlugs && !retryFailed && shouldSkipAttempt(raw)) {
    skipped += 1;
    return;
  }

  try {
    const html = await fetchWaybackHtml(slug);
    const badges = extractBadges(html);
    raw.badges = badges;
    raw.badgeSource = "wayback";
    raw.badgeFetchedAt = new Date().toISOString();
    delete raw.badgeError;
    delete raw.badgeAttemptAt;
    delete raw.badgeTransient;
    await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    if (badges.length) {
      profiles[slug] = badges;
      withBadges = Object.values(profiles).filter((entry) => Array.isArray(entry) && entry.length > 0).length;
    } else {
      // Empty scrape = confirmed zero badges (real data), NOT unknown. Keeping
      // the [] entry preserves known-zero semantics for the runtime.
      profiles[slug] = [];
    }
    // Persist incrementally so long runs can be interrupted safely.
    await persistProfiles(profiles, badgeProfilesPath);
    fetched += 1;
    if ((index + 1) % 10 === 0 || index === targetSlugs.length - 1) {
      console.log(`  progress ${index + 1}/${targetSlugs.length} fetched=${fetched} withBadges=${withBadges} failed=${failed} skipped=${skipped}`);
    }
  } catch (error) {
    failed += 1;
    const message = String(error.message ?? error).slice(0, 240);
    const transient = isTransientError(message);
    raw.badgeAttemptAt = new Date().toISOString();
    raw.badgeError = message;
    raw.badgeSource = "wayback";
    if (transient) {
      raw.badgeTransient = true;
    } else {
      delete raw.badgeTransient;
      // Permanent miss: empty fetch with a timestamp so resume can skip.
      if (!Array.isArray(raw.badges)) raw.badges = [];
      raw.badgeFetchedAt = raw.badgeFetchedAt ?? raw.badgeAttemptAt;
    }
    try {
      await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    } catch {
      // ignore persistence errors on failure path
    }
    if (failed <= 12) {
      console.warn(`  fail ${slug}${transient ? " [transient]" : ""}: ${message}`);
    }
    if ((index + 1) % 10 === 0 || index === targetSlugs.length - 1) {
      console.log(`  progress ${index + 1}/${targetSlugs.length} fetched=${fetched} withBadges=${withBadges} failed=${failed} skipped=${skipped}`);
    }
  }
});

const sorted = await persistProfiles(profiles, badgeProfilesPath);

console.log(JSON.stringify({
  status: "done",
  targets: targetSlugs.length,
  fetched,
  skippedExisting: skipped,
  withBadges: Object.keys(sorted).filter((key) => sorted[key]?.length).length,
  failed,
  badgeProfilesPath: path.relative(root, badgeProfilesPath),
}, null, 2));

function extractBadges(html) {
  const badges = [];
  const imageTags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imageTags) {
    const alt = matchAttribute(tag, "alt");
    const src = matchAttribute(tag, "data-src") ?? matchAttribute(tag, "src");
    const tierMatch = src?.match(/\/([a-z0-9-]+)-(bronze|silver|gold|hall-of-fame|hof|legendary)-badge\.png/i);
    if (!alt || !tierMatch) continue;
    const name = clean(alt);
    if (!name || /badges$/i.test(name) || /sum\.png/i.test(src)) continue;
    const rawTier = tierMatch[2].toLowerCase();
    const tier = rawTier === "hall-of-fame" || rawTier === "hof" || rawTier === "legendary"
      ? "HOF"
      : `${rawTier[0].toUpperCase()}${rawTier.slice(1)}`;
    badges.push({
      name,
      category: BADGE_CATEGORY_BY_NAME[name] ?? "general",
      tier,
    });
  }
  return [...new Map(badges.map((badge) => [`${badge.name}:${badge.tier}`, badge])).values()];
}

function matchAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function clean(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

async function fetchWaybackHtml(slug) {
  const original = `https://www.2kratings.com/${slug}`;
  const timestamps = await listWaybackTimestamps(slug);
  if (!timestamps.length) {
    throw new Error("no wayback snapshot");
  }

  const errors = [];
  // Prefer rewritten snapshots first — id_ raw captures often 404/short.
  for (const timestamp of timestamps.slice(0, 2)) {
    try {
      return await loadSnapshot(`https://web.archive.org/web/${timestamp}/${original}`, timestamp);
    } catch (error) {
      errors.push(`${timestamp}: ${error.message}`);
    }
  }

  throw new Error(errors.slice(0, 3).join("; ") || "no usable snapshot");
}

async function loadSnapshot(url, label) {
  const html = await fetchText(url, 15000);
  if (html.includes("Just a moment...")) {
    throw new Error("challenge page");
  }
  // Wayback soft-404 / calendar pages are short or lack player markup.
  if (html.length < 40000) {
    throw new Error(`short body ${html.length}`);
  }
  if (!/badge\.png/i.test(html) && !/nav-badges|Badges/i.test(html)) {
    throw new Error("no badge markup");
  }
  return html;
}

async function listWaybackTimestamps(slug) {
  const seen = new Set();
  const rows = [];
  const original = `https://www.2kratings.com/${slug}`;
  // 2K26 badge art only exists on recent captures; older pages are useless.
  const minTs = "20240101000000";

  // Availability API first — fast, but often returns 202 soft-misses.
  try {
    const available = JSON.parse(
      await fetchText(`https://archive.org/wayback/available?url=${encodeURIComponent(original)}`, 8000),
    );
    const closest = available?.archived_snapshots?.closest;
    // status must be HTTP 200; "available:true" alone includes 202/404 soft misses.
    if (closest?.timestamp && String(closest.status) === "200" && closest.timestamp >= minTs) {
      seen.add(closest.timestamp);
      rows.push({ timestamp: closest.timestamp, length: 0 });
    }
  } catch {
    // ignore
  }

  // CDX only when availability gave nothing usable. Hard-killed curl prevents hangs.
  if (rows.length === 0) {
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(`www.2kratings.com/${slug}`)}&from=2024&to=2026&output=json&filter=statuscode:200&fl=timestamp,length&limit=5&fastLatest=true`;
    try {
      const parsed = JSON.parse(await fetchText(cdxUrl, 7000));
      if (Array.isArray(parsed) && parsed.length >= 2) {
        for (const [timestamp, length] of parsed.slice(1)) {
          if (!timestamp || seen.has(timestamp) || timestamp < minTs) continue;
          // Skip tiny captures (calendar / error shells).
          if (Number(length) > 0 && Number(length) < 40000) continue;
          seen.add(timestamp);
          rows.push({ timestamp, length: Number(length) || 0 });
        }
      }
    } catch {
      // no CDX
    }
  }

  return rows
    .sort((left, right) => {
      if (left.length !== right.length) return right.length - left.length;
      return right.timestamp.localeCompare(left.timestamp);
    })
    .map((row) => row.timestamp);
}

async function fetchText(url, timeoutMs = 25000) {
  // Node undici fetch currently fails against archive.org in this environment;
  // curl is reliable and already used elsewhere in the project workflow.
  return curlText(url, timeoutMs);
}

async function curlText(url, timeoutMs = 25000) {
  const timeoutSec = Math.max(5, Math.ceil(timeoutMs / 1000));
  // Single attempt + process-level hard kill; retries just multiply hang time.
  return curlTextOnce(url, timeoutSec);
}

function curlTextOnce(url, timeoutSec) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", [
      "-sL",
      "--fail",
      "--max-time", String(timeoutSec),
      "--connect-timeout", "5",
      "-A", "2k26-spinner-badge-backfill/1.0",
      "-H", "Accept: text/html,application/json,*/*",
      url,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    const chunks = [];
    const errors = [];
    let settled = false;

    // Hard kill if curl ignores --max-time (seen with hung CDX sockets).
    const killer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      settled = true;
      reject(new Error(`curl hard-timeout ${timeoutSec}s: ${url}`));
    }, (timeoutSec + 2) * 1000);

    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      const body = Buffer.concat(chunks).toString("utf8");
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${Buffer.concat(errors).toString("utf8").slice(0, 200) || url}`));
        return;
      }
      if (!body) {
        reject(new Error(`empty response for ${url}`));
        return;
      }
      resolve(body);
    });
  });
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function mapPool(items, size, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index], index);
      // Gentle pacing so archive.org does not start refusing 443.
      await sleep(600);
    }
  });
  await Promise.all(runners);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(args) {
  let limit = null;
  // Keep concurrency low: web.archive.org starts refusing connections under burst load.
  let concurrency = 2;
  let onlySlugs = null;
  let retryFailed = false;
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--limit") {
      limit = Number(args[++index]);
    } else if (arg === "--concurrency") {
      concurrency = Number(args[++index]) || 4;
    } else if (arg === "--slugs") {
      onlySlugs = String(args[++index]).split(",").map((value) => value.trim()).filter(Boolean);
      // 路径边界（公测审计 12.5）：slug 必须匹配规范格式，禁止路径穿越。
      const invalid = onlySlugs.filter((slug) => !SLUG_RE.test(slug));
      if (invalid.length > 0) {
        console.error(`ERROR: invalid --slugs entries (must match ${SLUG_RE}): ${invalid.join(", ")}`);
        process.exit(1);
      }
    } else if (arg === "--retry-failed") {
      retryFailed = true;
    }
  }
  return { limit, concurrency, onlySlugs, retryFailed };
}

async function persistProfiles(profiles, filePath) {
  // Keep explicit zero-badge profiles ([]) — they are known coverage, not gaps.
  const sorted = Object.fromEntries(
    Object.entries(profiles)
      .filter(([, badges]) => Array.isArray(badges))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  await writeFile(filePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
  return sorted;
}

function prioritizeSlugs(currentIds, detailedPlayers, rosterCatalog) {
  // Lightweight residual ranking using the production ridge model coefficients
  // already stored in rookieOverallModel.json (loaded lazily to keep script light).
  let model = null;
  try {
    model = JSON.parse(readFileSync(path.join(root, "src/data/rookieOverallModel.json"), "utf8"));
  } catch {
    return currentIds;
  }

  const detailedBySlug = new Map(detailedPlayers.map((player) => [player.slug, player]));
  const overallById = new Map(
    rosterCatalog.teams
      .filter((team) => team.category === "current")
      .flatMap((team) => team.players)
      .filter((player) => typeof player.overall === "number")
      .map((player) => [player.id, { overall: player.overall, position: player.position }]),
  );

  const scored = currentIds.map((slug) => {
    const detailed = detailedBySlug.get(slug);
    const meta = overallById.get(slug);
    if (!detailed || !meta) return { slug, score: 0 };
    const position = String(meta.position ?? "SF").split("/")[0];
    const positionModel = model.positions[position] ?? model.positions.SF;
    const estimate = model.attributes.reduce((total, attribute) => {
      const raw = detailed.detailed?.[attribute];
      const resolved = Number.isFinite(raw) ? Math.min(99, Math.max(25, raw)) : attribute === "Intangibles" ? 50 : 65;
      return total + resolved * (positionModel.coefficients[attribute] ?? 0);
    }, positionModel.intercept);
    const pred = Math.round(Math.min(99, Math.max(40, estimate)));
    const residual = Math.abs(meta.overall - pred);
    // Boost stars and large residuals so defensive specialists land early.
    const starBoost = meta.overall >= 85 ? 1.5 : 0;
    return { slug, score: residual + starBoost };
  });

  return scored.sort((left, right) => right.score - left.score || left.slug.localeCompare(right.slug)).map((row) => row.slug);
}

function deferCovered(slugs, profiles, rawDirectory, allowRetryFailed) {
  const uncovered = [];
  const covered = [];
  for (const slug of slugs) {
    // Known coverage includes explicit zero-badge profiles ([]).
    if (Object.hasOwn(profiles, slug)) {
      covered.push(slug);
      continue;
    }
    try {
      const raw = JSON.parse(readFileSync(path.join(rawDirectory, `${slug}.json`), "utf8"));
      if (Array.isArray(raw.badges) && raw.badges.length > 0) {
        covered.push(slug);
        continue;
      }
      if (!allowRetryFailed && shouldSkipAttempt(raw)) {
        covered.push(slug);
        continue;
      }
    } catch {
      // no raw yet
    }
    uncovered.push(slug);
  }
  return [...uncovered, ...covered];
}

function isTransientError(message) {
  return /curl exit 7|curl exit 28|curl exit 56|Couldn't connect|Connection refused|Connection reset|Failed to connect|timeout|timed out|hard-timeout|empty response/i.test(
    String(message ?? ""),
  );
}

function shouldSkipAttempt(raw) {
  if (!raw) return false;
  // Successful empty parse (no badges in snapshot) — skip on resume.
  if (raw.badgeFetchedAt && Array.isArray(raw.badges) && raw.badges.length === 0 && !raw.badgeTransient) {
    return true;
  }
  // Permanent miss recorded without badges (e.g. no wayback snapshot).
  if (raw.badgeAttemptAt && !raw.badgeTransient && !isTransientError(raw.badgeError)) {
    return true;
  }
  return false;
}
