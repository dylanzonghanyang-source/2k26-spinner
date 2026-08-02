export type TendencyCell = number | null;

export type TendencyTable = {
  slugs: string[];
  fields: string[];
  rows: TendencyCell[][];
};

export type TendencyLookup = {
  get(playerSlug: string, field: string): number | undefined;
  countFor(playerSlug: string): number;
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

export const loadTendencyLookup = createTendencyLoader(
  () => import("./data/tendencyProfiles.min.json") as Promise<TendencyTableModule>,
);

export type TendencyBundleSource = {
  bundleId: string;
  playerSlug?: string;
};

export function collectTendenciesByBundle({
  sources,
  fieldToBundle,
  lookup,
}: {
  sources: TendencyBundleSource[];
  fieldToBundle: Record<string, string>;
  lookup: TendencyLookup;
}): Record<string, number> {
  const sourceByBundle = new Map(sources.map((source) => [source.bundleId, source.playerSlug]));
  const tendencies: Record<string, number> = {};

  for (const [field, bundleId] of Object.entries(fieldToBundle)) {
    const playerSlug = sourceByBundle.get(bundleId);
    if (!playerSlug) continue;
    const value = lookup.get(playerSlug, field);
    if (typeof value === "number") tendencies[field] = value;
  }

  return tendencies;
}

export function createTendencyLookup(table: TendencyTable): TendencyLookup {
  const slugIndex = new Map(table.slugs.map((slug, index) => [slug, index]));
  const fieldIndex = new Map(table.fields.map((field, index) => [field, index]));

  return {
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
