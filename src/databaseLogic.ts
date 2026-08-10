import type { RookieCard, RookieCardLookup } from "./rookieCards.ts";
import { getPlayerNameCN } from "./playerNames.ts";

/** 有卡的年份（降序）。 */
export function yearsWithCards(cards: RookieCardLookup | null | undefined): number[] {
  if (!cards) return [];
  const years = new Set<number>();
  for (const card of cards.values()) {
    if (Number.isFinite(card.year) && card.year > 0) years.add(card.year);
  }
  return [...years].sort((a, b) => b - a);
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.'’\-]/g, "");
}

export function matchesCard(card: RookieCard, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return normalize(card.name).includes(q) || normalize(getPlayerNameCN(card.name)).includes(q);
}

export type CardFilter = {
  year: number | null;
  query: string;
};

/** 按年份 + 关键词过滤，OVR 降序（无 OVR 排最后）。 */
export function filterCards(cards: RookieCardLookup | null | undefined, filter: CardFilter): RookieCard[] {
  if (!cards) return [];
  const yearCards = filter.year != null
    ? [...cards.values()].filter((card) => card.year === filter.year)
    : [...cards.values()];
  const matched = yearCards.filter((card) => matchesCard(card, filter.query));
  matched.sort((a, b) => {
    const ao = a.overall ?? -1;
    const bo = b.overall ?? -1;
    if (ao !== bo) return bo - ao;
    return a.name.localeCompare(b.name);
  });
  return matched;
}

export type CardSummary = {
  name: string;
  nameCN: string;
  year: number;
  overall: number | null;
  draftPick: number | null;
  team: string | null;
  position: string | null;
  heightInches: number | null;
  weightLb: number | null;
  wingspanCm: number | null;
  dominantHand: string | null;
};

export function summarizeCard(card: RookieCard): CardSummary {
  const vitals = card.vitals ?? {};
  return {
    name: card.name,
    nameCN: getPlayerNameCN(card.name),
    year: card.year,
    overall: card.overall ?? null,
    draftPick: typeof vitals.draftPick === "number" ? vitals.draftPick : null,
    team: typeof vitals.currentTeam === "string" && vitals.currentTeam !== "" ? vitals.currentTeam : null,
    position: null,
    heightInches: typeof vitals.heightInches === "number" ? vitals.heightInches : null,
    weightLb: typeof vitals.weightLb === "number" ? vitals.weightLb : null,
    wingspanCm: typeof vitals.wingspanCm === "number" ? vitals.wingspanCm : null,
    dominantHand: typeof vitals.dominantHand === "string" ? vitals.dominantHand : null,
  };
}

const POSITION_CN: Record<string, string> = {
  PG: "控卫", SG: "分卫", SF: "小前", PF: "大前", C: "中锋",
};

export function positionCN(position: string | null | undefined): string | null {
  if (!position) return null;
  const roles = String(position)
    .split("/")
    .map((part) => POSITION_CN[part.trim().toUpperCase()] ?? part.trim())
    .filter(Boolean);
  return roles.length ? roles.join("/") : null;
}

export type RosterPlayer = { id?: string; name: string; position: string | null };

/** roster 球员 key → 位置（用于给卡补位置，卡数据本身无位置字段）。 */
export function buildPositionMap(roster: RosterPlayer[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const player of roster) {
    if (!player.position) continue;
    const key = coreName(player.name);
    if (!map.has(key)) map.set(key, player.position);
  }
  return map;
}

export function positionForCard(card: RookieCard, positionMap: Map<string, string>): string | null {
  const direct = positionMap.get(coreName(card.name));
  if (direct) return direct;
  return null;
}

function coreName(raw: string) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
