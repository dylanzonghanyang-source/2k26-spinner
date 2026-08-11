import playerHeadshots from "./data/playerHeadshots.json" with { type: "json" };
import playerHeadshotFallbacks from "./data/playerHeadshotFallbacks.json" with { type: "json" };
import playerPresentation from "./data/playerPresentation.json" with { type: "json" };

const playerIds = {
  ...(playerPresentation.headshotIds as Record<string, string>),
  ...(playerHeadshots as Record<string, string>),
};
const fallbackSlugs = playerHeadshotFallbacks as Record<string, string>;
const normalizedHeadshots = new Map(
  Object.entries(playerIds).map(([name, playerId]) => [normalizeName(name), playerId]),
);
const normalizedFallbacks = new Map(
  Object.entries(fallbackSlugs).map(([name, slug]) => [normalizeName(name), slug]),
);
const prefetchedUrls = new Set<string>();
const basketballReferenceHeadshotBase =
  "https://www.basketball-reference.com/req/202605210/images/headshots";

function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolvePlayerId(name: string) {
  return playerIds[name] ?? normalizedHeadshots.get(normalizeName(name));
}

function resolveFallbackSlug(name: string) {
  return fallbackSlugs[name] ?? normalizedFallbacks.get(normalizeName(name));
}

/**
 * Use a real historical portrait before NBA's current-size endpoint. NBA returns
 * HTTP 200 with a generic silhouette for many retired players, so onError cannot
 * detect that case after the request has already succeeded.
 */
export function getPlayerHeadshotSources(name: string): string[] {
  const playerId = resolvePlayerId(name);
  const base = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/";
  const proxyPrefix = `${base.endsWith("/") ? base : `${base}/`}nba-headshots`;
  const nbaSource = playerId ? `${proxyPrefix}/${playerId}.png` : undefined;
  const fallbackSlug = resolveFallbackSlug(name);
  const historicalSource = fallbackSlug
    ? `${basketballReferenceHeadshotBase}/${fallbackSlug}.jpg`
    : undefined;

  return [historicalSource, nbaSource].filter((source): source is string => Boolean(source));
}

/** Return the preferred source; current-player NBA assets use the same-origin proxy. */
export function getPlayerHeadshot(name: string) {
  return getPlayerHeadshotSources(name)[0];
}

export function prefetchPlayerHeadshots(names: readonly string[]) {
  if (typeof Image === "undefined") return;

  for (const name of names) {
    const sources = getPlayerHeadshotSources(name);
    if (sources.length === 0) continue;

    // Prefetch the preferred URL first; PlayerHeadshot still has runtime fallbacks.
    const src = sources[0];
    if (prefetchedUrls.has(src)) continue;
    prefetchedUrls.add(src);
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = "no-referrer";
    image.src = src;
  }
}
