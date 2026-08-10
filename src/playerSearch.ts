import type { PlayerSource } from "./domain.ts";
import { getPlayerNameCN } from "./playerNames.ts";

export function normalizePlayerSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.'’\-]/g, "");
}

export function matchesPlayerSearch(player: PlayerSource, query: string) {
  const normalizedQuery = normalizePlayerSearch(query);
  if (!normalizedQuery) return true;
  return [player.name, getPlayerNameCN(player.name), player.rosterTeam ?? "", player.position ?? ""]
    .some((value) => normalizePlayerSearch(value).includes(normalizedQuery));
}
