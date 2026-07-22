import playerHeadshots from "./data/playerHeadshots.json";

const playerIds = playerHeadshots as Record<string, string>;
const normalizedHeadshots = new Map(
  Object.entries(playerIds).map(([name, playerId]) => [normalizeName(name), playerId]),
);

function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function getPlayerHeadshot(name: string) {
  const playerId = playerIds[name] ?? normalizedHeadshots.get(normalizeName(name));
  return playerId ? `https://res.nba.cn/media/img/players/head/260x190/${playerId}.png` : undefined;
}
