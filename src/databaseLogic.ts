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

/** 按年份 + 关键词过滤。选中年份按顺位升序（1 号顺位起，无顺位排最后）；总览按 OVR 降序。 */
export function filterCards(cards: RookieCardLookup | null | undefined, filter: CardFilter): RookieCard[] {
  if (!cards) return [];
  const yearCards = filter.year != null
    ? [...cards.values()].filter((card) => card.year === filter.year)
    : [...cards.values()];
  const matched = yearCards.filter((card) => matchesCard(card, filter.query));
  if (filter.year != null) {
    const pickOf = (card: RookieCard) => {
      const pick = card.vitals?.draftPick;
      return typeof pick === "number" && pick > 0 ? pick : Number.POSITIVE_INFINITY;
    };
    matched.sort((a, b) => {
      const ap = pickOf(a);
      const bp = pickOf(b);
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name);
    });
  } else {
    matched.sort((a, b) => {
      const ao = a.overall ?? -1;
      const bo = b.overall ?? -1;
      if (ao !== bo) return bo - ao;
      return a.name.localeCompare(b.name);
    });
  }
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

const POSITION_SUFFIX_ALIASES: Record<string, string> = {
  // roster omits the suffix for the SAME person (card keeps it)
  "bobby portis jr": "bobby portis",
  "bronny james jr": "bronny james",
};

// card name -> roster name variants for position lookup
const POSITION_NAME_ALIASES: Record<string, string> = {
  "akeem olajuwon": "hakeem olajuwon", // 1984 drafted as Akeem
  "patrick mills": "patty mills",
  "wesley matthews": "wes matthews",
  "eddie a johnson": "eddie johnson",
};

export function positionForCard(card: RookieCard, positionMap: Map<string, string>): string | null {
  const key = coreName(card.name);
  const direct = positionMap.get(key);
  if (direct) return direct;
  const alias = POSITION_SUFFIX_ALIASES[key] ?? POSITION_NAME_ALIASES[key];
  const viaAlias = alias ? positionMap.get(alias) ?? null : null;
  if (viaAlias) return viaAlias;
  // fallback: the card's own position (16 allTime players lack roster position)
  return typeof card.position === "string" && card.position !== "" ? card.position : null;
}

function coreName(raw: string) {
  // keep Jr/Sr/II/III so "Ron Harper" (1986) and "Ron Harper Jr." (2022) stay
  // distinct; position lookup adds explicit suffix aliases below.
  // NFKD-decompose accents first: "Mickael Piétrus" == "Mickael Pietrus".
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
