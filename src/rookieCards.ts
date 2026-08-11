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
  position: string | null;
  overall: number | null;
  /** Top-level body values; height ALWAYS inches (see vitals unit contract). */
  height: number | null;
  detailed: Record<string, number>;
  tendencies: Record<string, number>;
  badges: { name: string; tier: string }[];
  personalityBadges: { name: string; tier: string }[];
  potential: { current: number | null; min: number | null; max: number | null } | null;
  /** 数据质量标记（如潜力范围被修正以包含 current）。 */
  dataQuality: { potentialRangeCorrected?: boolean; potentialRangeNote?: string } | null;
  /**
   * Vitals record. Unit contract:
   * - `heightInches` / top-level `height`: ALWAYS inches, plausible range 60–100.
   *   DB2K snapshots historically mixed cm values (150–250) into this field;
   *   converters normalize via scripts/lib/height-units.mjs. Never write cm here.
   * - `weightLb`: pounds. `wingspanCm`: centimeters.
   * - `dominantHand` / `dominantDunkHand`: "Left" | "Right".
   */
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
  positions?: (string | null)[];
  overalls?: (number | null)[];
  attrs?: { fields?: string[]; rows?: unknown[][] };
  tendencies?: { fields?: string[]; rows?: unknown[][] };
  badges?: unknown[][];
  personalityBadges?: unknown[][];
  potentials?: ({ current: number | null; min: number | null; max: number | null } | null)[];
  dataQualities?: ({ potentialRangeCorrected?: boolean; potentialRangeNote?: string } | null)[];
  vitals?: { fields?: string[]; rows?: unknown[][] };
  durability?: { fields?: string[]; rows?: unknown[][] };
  hotZones?: { fields?: string[]; rows?: unknown[][] };
};

export type RookieCardLookup = Map<string, RookieCard>;

/** Normalized match key: lowercase, strip punctuation & suffix (Jr/II/III...). */
export function corePlayerName(raw: string): string {
  // NFKD-decompose accents ("Mickael Piétrus" == "Mickael Pietrus"), delete
  // dots/apostrophes so "R.J. Barrett" == "RJ Barrett", keep Jr/Sr/II/III
  // suffixes ("Ron Harper" (1986) != "Ron Harper Jr." (2022))
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
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
  "CJ McCollum": "C.J. McCollum",
  "LJ Cryer": "L.J. Cryer",
  "Nic Claxton": "Nicolas Claxton",
  "Patty Mills": "Patrick Mills",
  "Moussa Diabate": "Moussa Diabaté",
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
  const key = corePlayerName(playerName);
  const direct = rookieCards.get(key);
  if (direct) return direct;
  // Roster names may drop the suffix for the SAME person (roster "Bobby
  // Portis" = card "Bobby Portis Jr."). Try suffixed variants only after a
  // direct miss, so "Ron Harper" (1986) never resolves to Ron Harper Jr.'s
  // card when both exist, and vice versa.
  const base = key.replace(/ (jr|sr|ii|iii|iv|v)$/, "");
  if (base !== key) {
    const stripped = rookieCards.get(base);
    if (stripped) return stripped;
  }
  for (const suffix of [" jr", " sr", " ii", " iii", " iv", " v"]) {
    const hit = rookieCards.get(key + suffix);
    if (hit) return hit;
  }
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

export function hasRookieCard(
  rookieCards: RookieCardLookup | null | undefined,
  playerName: string,
): boolean {
  return lookupRookieCard(rookieCards, playerName) !== null;
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
      position: index.positions?.[i] ?? null,
      overall: index.overalls?.[i] ?? null,
      detailed,
      tendencies,
      badges,
      personalityBadges,
      potential: index.potentials?.[i] ?? null,
      dataQuality: index.dataQualities?.[i] ?? null,
      height: typeof vitals["heightInches"] === "number" ? vitals.heightInches : null,
      vitals,
      durability,
      hotZones,
    });
  }
  return lookup;
}

// JSON import attributes: Node ESM requires `{ with: { type: "json" } }`, but
// browsers reject it for Vite-served chunks — the attributes form activates
// the native JSON module loader, which chokes on Vite's JS transform of the
// JSON data. So the options must resolve at runtime: attributes under Node
// (scripts/tests), undefined in browsers (Vite dev + production build). The
// literal specifier keeps rollup's lazy chunk splitting working. Rollup
// cannot statically analyze the variable options (4 expected warnings —
// filtered in vite.config.ts onwarn); the produced code is correct in both
// runtimes.
const jsonImportOptions: { with: { type: "json" } } | undefined =
  typeof process !== "undefined" && Boolean(process.versions?.node)
    ? { with: { type: "json" } }
    : undefined;

async function importLegacyPre1990Index(): Promise<{ default: RawRookieCardIndex }> {
  return await import("./data/rookieCardIndex-legacy-pre1990.min.json", jsonImportOptions);
}

async function importLegacy1990To2004Index(): Promise<{ default: RawRookieCardIndex }> {
  return await import("./data/rookieCardIndex-legacy-1990-2004.min.json", jsonImportOptions);
}

async function importLegacy2005To2017Index(): Promise<{ default: RawRookieCardIndex }> {
  return await import("./data/rookieCardIndex-legacy-2005-2017.min.json", jsonImportOptions);
}

async function importCurrentIndex(): Promise<{ default: RawRookieCardIndex }> {
  return await import("./data/rookieCardIndex-current.min.json", jsonImportOptions);
}

export function loadRookieCards(): Promise<RookieCardLookup> {
  return Promise.all([
    importLegacyPre1990Index(),
    importLegacy1990To2004Index(),
    importLegacy2005To2017Index(),
    importCurrentIndex(),
  ]).then(([legacyPre1990Module, legacy1990To2004Module, legacy2005To2017Module, currentModule]) => {
    // Insert older legacy chunks first so the earliest (true rookie) card wins
    // if a player appears in multiple partitions.
    const lookup = createRookieCardLookup(legacyPre1990Module.default);
    for (const module of [legacy1990To2004Module, legacy2005To2017Module, currentModule]) {
      const chunkLookup = createRookieCardLookup(module.default);
      for (const [key, card] of chunkLookup) {
        if (!lookup.has(key)) lookup.set(key, card);
      }
    }
    return lookup;
  });
}
