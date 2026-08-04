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

/**
 * Build ordered headshot URL candidates for a player.
 *
 * Local/dev first tries the same-origin Vite/Vercel proxy to avoid browser HTTP/2
 * failures against cdn.nba.com (common with local proxies). Then fall back to the
 * global CDN and a secondary NBA static host.
 */
export function getPlayerHeadshotSources(name: string): string[] {
  const playerId = resolvePlayerId(name);
  if (!playerId) return [];

  const base = typeof import.meta !== "undefined" && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : "/";
  const proxyPrefix = `${base.endsWith("/") ? base : `${base}/`}nba-headshots`;

  const proxiedSource = `${proxyPrefix}/${playerId}.png`;
  if (import.meta.env.DEV) return [proxiedSource];

  return [
    proxiedSource,
    `https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png`,
    `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${playerId}.png`,
  ];
}

/** Prefer the same-origin proxy, then fall back to public NBA CDN hosts. */
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
