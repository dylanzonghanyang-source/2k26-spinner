/**
 * Rookie card lookup — DB2K-exported real rookie cards (2018–2025).
 *
 * Data: src/data/rookieCardIndex.min.json (built by scripts/build-rookie-card-index.mjs).
 * The index is columnar and lazy-loaded only after the user confirms settings,
 * mirroring the tendency profile pattern (keeps it out of the main bundle).
 *
 * Matching: players are matched by normalized "core name" (lowercase, no
 * punctuation, no Jr/II/III/IV/V suffix), so roster entries like "Bronny James"
 * match the card "Bronny James Jr.". When the same player appears in multiple
 * draft years the earliest year (their true rookie card) wins.
 *
 * Usage in RookieBuilder.createResult:
 *   const card = rookieCards?.get(coreName(player.name));
 *   if (card) { /* use card.detailed / badges / tendencies / potential *\/ }
 */

export type RookieCard = {
  slug: string;
  year: number;
  name: string;
  overall: number | null;
  detailed: Record<string, number>;
  tendencies: Record<string, number>;
  badges: { name: string; tier: string }[];
  potential: { current: number | null; min: number | null; max: number | null } | null;
};

type RookieCardIndex = {
  keys: string[];
  slugs: string[];
  years: number[];
  names: string[];
  overalls: (number | null)[];
  attrs: { fields: string[]; rows: (number | null)[][] };
  tendencies: { fields: string[]; rows: (number | null)[][] };
  badges: [string, string][][];
  potentials: ({ current: number | null; min: number | null; max: number | null } | null)[];
};

// JSON imports type rows as number[][]; values may be null in practice. The
// accessor guards with typeof checks, so treat the imported shape loosely.
type RawRookieCardIndex = {
  keys?: string[];
  slugs?: string[];
  years?: number[];
  names?: string[];
  overalls?: (number | null)[];
  attrs?: { fields?: string[]; rows?: unknown[][] };
  tendencies?: { fields?: string[]; rows?: unknown[][] };
  badges?: unknown[][];
  potentials?: ({ current: number | null; min: number | null; max: number | null } | null)[];
};

type RookieCardIndexModule = { default: RookieCardIndex };

export type RookieCardLookup = Map<string, RookieCard>;

/** Normalized match key: lowercase, strip punctuation & suffix (Jr/II/III...). */
export function corePlayerName(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Roster pools use nicknames/shorthands for some players whose rookie card is
// stored under the full name (DB2K exports use the full in-game name). These
// aliases map pool name -> card name; verified against the 2018-2025 exports.
const PLAYER_NAME_ALIASES: Record<string, string> = {
  "Mo Bamba": "Mohamed Bamba",
  "Svi Mykhailiuk": "Sviatoslav Mykhailiuk",
  "Alex Sarr": "Alexandre Sarr",
  "Rob Dillingham": "Robert Dillingham",
  "Bub Carrington": "Carlton Carrington",
  "Bones Hyland": "Nah'Shon Hyland",
  "Ronald Holland II": "Ron Holland",
  "VJ Edgecombe": "V.J. Edgecombe",
  "RJ Barrett": "R.J. Barrett",
  "AJ Green": "A.J. Green",
  "KJ Simpson": "K.J. Simpson",
  "AJ Johnson": "A.J. Johnson",
  "GG Jackson": "G.G. Jackson",
  "Yang Hansen": "Hansen Yang",
};

export function lookupRookieCard(
  rookieCards: RookieCardLookup | null | undefined,
  playerName: string,
): RookieCard | null {
  if (!rookieCards) return null;
  const direct = rookieCards.get(corePlayerName(playerName));
  if (direct) return direct;
  const alias = PLAYER_NAME_ALIASES[playerName];
  if (alias) return rookieCards.get(corePlayerName(alias)) ?? null;
  return null;
}

export function createRookieCardLookup(index: RawRookieCardIndex): RookieCardLookup {
  const lookup: RookieCardLookup = new Map();
  const keys = index.keys ?? [];
  const attrFields = index.attrs?.fields ?? [];
  const attrRows = index.attrs?.rows ?? [];
  const tendFields = index.tendencies?.fields ?? [];
  const tendRows = index.tendencies?.rows ?? [];
  for (let i = 0; i < keys.length; i += 1) {
    const row = attrRows[i] ?? [];
    const tendRow = tendRows[i] ?? [];
    const detailed: Record<string, number> = {};
    for (let f = 0; f < attrFields.length; f += 1) {
      const value = row[f];
      if (typeof value === "number") detailed[attrFields[f]] = value;
    }
    const tendencies: Record<string, number> = {};
    for (let f = 0; f < tendFields.length; f += 1) {
      const value = tendRow[f];
      if (typeof value === "number") tendencies[tendFields[f]] = value;
    }
    const rawBadges = (index.badges?.[i] ?? []) as unknown[];
    const badges: { name: string; tier: string }[] = [];
    for (const entry of rawBadges) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
        badges.push({ name: entry[0], tier: entry[1] });
      }
    }
    lookup.set(keys[i], {
      slug: index.slugs?.[i] ?? "",
      year: index.years?.[i] ?? 0,
      name: index.names?.[i] ?? "",
      overall: index.overalls?.[i] ?? null,
      detailed,
      tendencies,
      badges,
      potential: index.potentials?.[i] ?? null,
    });
  }
  return lookup;
}

export function loadRookieCards(): Promise<RookieCardLookup> {
  return import("./data/rookieCardIndex.min.json").then(({ default: index }) =>
    createRookieCardLookup(index),
  );
}
