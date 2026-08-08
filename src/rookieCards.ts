/**
 * Rookie card lookup — DB2K-exported real rookie cards (2003–2025).
 *
 * Data: split lazy indexes under src/data/rookieCardIndex-{legacy,current}.min.json
 * (built by scripts/build-rookie-card-index.mjs). The combined
 * rookieCardIndex.min.json remains available for offline scripts/tests.
 * The runtime indexes are lazy-loaded only after the user confirms settings,
 * mirroring the tendency profile pattern (keeps them out of the main bundle).
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
  personalityBadges: { name: string; tier: string }[];
  potential: { current: number | null; min: number | null; max: number | null } | null;
  vitals: Record<string, string | number | boolean | null>;
  durability: Record<string, number>;
  hotZones: Record<string, string>;
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
  personalityBadges?: unknown[][];
  potentials?: ({ current: number | null; min: number | null; max: number | null } | null)[];
  vitals?: { fields?: string[]; rows?: unknown[][] };
  durability?: { fields?: string[]; rows?: unknown[][] };
  hotZones?: { fields?: string[]; rows?: unknown[][] };
};

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
  // Aliases are matched case-insensitively: the roster pipeline's
  // formatPlayerName() title-cases segments, so "R.J. Barrett" becomes
  // "Rj Barrett" (the period is not a splitter) while the alias table uses
  // the canonical "RJ Barrett". Exact object-key lookup would miss.
  const aliasKey = Object.keys(PLAYER_NAME_ALIASES).find(
    (key) => key.toLowerCase() === String(playerName).trim().toLowerCase(),
  );
  const alias = aliasKey ? PLAYER_NAME_ALIASES[aliasKey] : undefined;
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
    const rawPersonality = (index.personalityBadges?.[i] ?? []) as unknown[];
    const personalityBadges: { name: string; tier: string }[] = [];
    for (const entry of rawPersonality) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "string") {
        personalityBadges.push({ name: entry[0], tier: entry[1] });
      }
    }
    const vitals: Record<string, string | number | boolean | null> = {};
    const vitalsFields = index.vitals?.fields ?? [];
    const vitalsRow = index.vitals?.rows?.[i] ?? [];
    for (let f = 0; f < vitalsFields.length; f += 1) {
      const value = vitalsRow[f];
      if (value !== null && value !== undefined && value !== "") {
        vitals[vitalsFields[f]] = value as string | number | boolean;
      }
    }
    const durability: Record<string, number> = {};
    const durFields = index.durability?.fields ?? [];
    const durRow = index.durability?.rows?.[i] ?? [];
    for (let f = 0; f < durFields.length; f += 1) {
      const value = durRow[f];
      if (typeof value === "number") durability[durFields[f]] = value;
    }
    const hotZones: Record<string, string> = {};
    const hotFields = index.hotZones?.fields ?? [];
    const hotRow = index.hotZones?.rows?.[i] ?? [];
    for (let f = 0; f < hotFields.length; f += 1) {
      const value = hotRow[f];
      if (typeof value === "string") hotZones[hotFields[f]] = value;
    }
    lookup.set(keys[i], {
      slug: index.slugs?.[i] ?? "",
      year: index.years?.[i] ?? 0,
      name: index.names?.[i] ?? "",
      overall: index.overalls?.[i] ?? null,
      detailed,
      tendencies,
      badges,
      personalityBadges,
      potential: index.potentials?.[i] ?? null,
      vitals,
      durability,
      hotZones,
    });
  }
  return lookup;
}

async function importLegacyIndex(): Promise<{ default: RawRookieCardIndex }> {
  // Literal specifiers so rollup statically analyzes both calls and emits the
  // JSON chunks. Vite dev rejects the attributes form (?import rewrite), so
  // fall back to a bare import; Node 26 requires the attributes form.
  try {
    return await import("./data/rookieCardIndex-legacy.min.json", { with: { type: "json" } });
  } catch {
    return await import("./data/rookieCardIndex-legacy.min.json");
  }
}

async function importCurrentIndex(): Promise<{ default: RawRookieCardIndex }> {
  try {
    return await import("./data/rookieCardIndex-current.min.json", { with: { type: "json" } });
  } catch {
    return await import("./data/rookieCardIndex-current.min.json");
  }
}

export function loadRookieCards(): Promise<RookieCardLookup> {
  return Promise.all([
    importLegacyIndex(),
    importCurrentIndex(),
  ]).then(([legacyModule, currentModule]) => {
    // Legacy is inserted first so the earliest (true rookie) card wins if a
    // player appears in both partitions.
    const lookup = createRookieCardLookup(legacyModule.default);
    const currentLookup = createRookieCardLookup(currentModule.default);
    for (const [key, card] of currentLookup) {
      if (!lookup.has(key)) lookup.set(key, card);
    }
    return lookup;
  });
}
