export type TendencyCell = number | null;

export type TendencyTable = {
  slugs: string[];
  fields: string[];
  rows: TendencyCell[][];
};

export type TendencyLookup = {
  get(playerSlug: string, field: string): number | undefined;
  countFor(playerSlug: string): number;
  available?: boolean;
};

type TendencyTableModule = { default: TendencyTable };
type TendencyTableImporter = () => Promise<TendencyTableModule>;

export function createTendencyLoader(importTable: TendencyTableImporter): () => Promise<TendencyLookup> {
  let lookupPromise: Promise<TendencyLookup> | null = null;
  return () => {
    lookupPromise ??= importTable().then(({ default: table }) => createTendencyLookup(table));
    return lookupPromise;
  };
}

export type TendencyDataVersion = "2k26" | "2k27";

const tendencyImporters: Record<TendencyDataVersion, TendencyTableImporter> = {
  "2k26": () => import("./data/versions/2k26/tendencyProfiles.min.json") as Promise<TendencyTableModule>,
  "2k27": () => import("./data/versions/2k27-play-now/tendencyProfiles.min.json") as Promise<TendencyTableModule>,
};

export function loadTendencyLookup(version: TendencyDataVersion = "2k26"): Promise<TendencyLookup> {
  return createTendencyLoader(tendencyImporters[version])();
}

export type TendencyBundleSource = {
  bundleId: string;
  playerSlug?: string;
};

export type TendencyCardResolver = (playerSlug: string) => {
  tendencies: Record<string, number>;
} | null | undefined;

export function collectTendenciesByBundle({
  sources,
  fieldToBundle,
  lookup,
  cardForPlayer,
}: {
  sources: TendencyBundleSource[];
  fieldToBundle: Record<string, string>;
  lookup?: TendencyLookup | null;
  cardForPlayer?: TendencyCardResolver;
}): Record<string, number> {
  const sourceByBundle = new Map(sources.map((source) => [source.bundleId, source.playerSlug]));
  // Cache the card per player slug so multi-slot lookups reuse one object.
  const cardCache = new Map<string, ReturnType<TendencyCardResolver>>();
  const resolveCard = (playerSlug: string | undefined) => {
    if (!playerSlug) return undefined;
    if (!cardCache.has(playerSlug)) cardCache.set(playerSlug, cardForPlayer?.(playerSlug));
    return cardCache.get(playerSlug);
  };
  const tendencies: Record<string, number> = {};

  for (const [field, bundleId] of Object.entries(fieldToBundle)) {
    const playerSlug = sourceByBundle.get(bundleId);
    if (!playerSlug) continue;
    const card = resolveCard(playerSlug);
    if (card?.tendencies && typeof card.tendencies[field] === "number") {
      tendencies[field] = card.tendencies[field];
      continue;
    }
    if (!lookup) continue;
    const value = lookup.get(playerSlug, field);
    if (typeof value === "number") tendencies[field] = value;
  }

  return tendencies;
}

export function createTendencyLookup(table: TendencyTable): TendencyLookup {
  const slugIndex = new Map(table.slugs.map((slug, index) => [slug, index]));
  const fieldIndex = new Map(table.fields.map((field, index) => [field, index]));

  return {
    available: table.slugs.length > 0 && table.fields.length > 0,
    get(playerSlug, field) {
      const rowIndex = slugIndex.get(playerSlug);
      const columnIndex = fieldIndex.get(field);
      if (rowIndex === undefined || columnIndex === undefined) return undefined;
      const value = table.rows[rowIndex]?.[columnIndex];
      return typeof value === "number" ? value : undefined;
    },
    countFor(playerSlug) {
      const rowIndex = slugIndex.get(playerSlug);
      if (rowIndex === undefined) return 0;
      return table.rows[rowIndex]?.reduce<number>(
        (count, value) => count + (typeof value === "number" ? 1 : 0),
        0,
      ) ?? 0;
    },
  };
}
