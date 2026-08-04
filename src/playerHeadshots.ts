import playerHeadshots from "./data/playerHeadshots.json";
import playerPresentation from "./data/playerPresentation.json";

const playerIds = {
  ...(playerPresentation.headshotIds as Record<string, string>),
  ...(playerHeadshots as Record<string, string>),
};
const normalizedHeadshots = new Map(
  Object.entries(playerIds).map(([name, playerId]) => [normalizeName(name), playerId]),
);
const prefetchedUrls = new Set<string>();

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

/** Use the same-origin proxy in dev and production; failures end in the explicit fallback avatar. */
export function getPlayerHeadshotSources(name: string): string[] {
  const playerId = resolvePlayerId(name);
  if (!playerId) return [];

  const base = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/";
  const proxyPrefix = `${base.endsWith("/") ? base : `${base}/`}nba-headshots`;
  return [`${proxyPrefix}/${playerId}.png`];
}

/** Load through the same-origin proxy so local and production browsers share one fallback path. */
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
