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

/** Prefer the global NBA CDN — nba.cn is often much slower from most networks. */
export function getPlayerHeadshot(name: string) {
  const playerId = playerIds[name] ?? normalizedHeadshots.get(normalizeName(name));
  return playerId ? `https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png` : undefined;
}

export function prefetchPlayerHeadshots(names: readonly string[]) {
  if (typeof Image === "undefined") return;

  for (const name of names) {
    const src = getPlayerHeadshot(name);
    if (!src || prefetchedUrls.has(src)) continue;
    prefetchedUrls.add(src);
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }
}
