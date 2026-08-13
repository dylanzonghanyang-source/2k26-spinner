#!/usr/bin/env -S node --experimental-strip-types
/**
 * Audit NBA draft-class coverage across every supported era (1960–2025).
 *
 * It never mutates rookie cards. It emits collection/review lists that separate:
 * - official draftees present in a retained DB2K source but missing a rookie card
 *   (their source data exists; collect only rookie OVR, then append safely);
 * - official draftees absent from retained source snapshots (collect a snapshot);
 * - source/card entries that do not belong to their directory's official class.
 *
 * Run:
 *   node --experimental-strip-types scripts/audit-draft-class-coverage.mts \
 *     --out data/raw/db2k/audit
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const getArg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outArg = getArg("--out");
if (!outArg) {
  console.error("ERROR: --out is required (for example data/raw/db2k/audit).");
  process.exit(1);
}
const outDir = path.resolve(root, outArg);
const officialPath = path.join(root, "scripts", "official-draft-picks-1960-2025.json");
const cardsRoot = path.join(root, "src", "data", "rookieCards");

if (!existsSync(officialPath)) throw new Error(`Official board fixture missing: ${officialPath}`);
if (!existsSync(cardsRoot)) throw new Error(`Rookie card root missing: ${cardsRoot}`);

const officialFixture = JSON.parse(readFileSync(officialPath, "utf8")) as {
  years: Record<string, Record<string, string>>;
};

type SourceSpec = {
  year: number;
  file: string;
  sourceDraftYear?: number;
};

const sources: SourceSpec[] = [
  // Windows-Hermes merged capture covers every era with real rookie values.
  ...Array.from({ length: 2023 - 1960 + 1 }, (_, index) => ({
    year: 1960 + index,
    file: "data/raw/db2k/merged-all-found.json",
    sourceDraftYear: 1960 + index,
  })),
  // The merged legacy capture has a real DRAFTEDYEAR field; its duplicate
  // standalone captures are included only where they may contain supplements.
  ...Array.from({ length: 16 }, (_, index) => ({
    year: 2003 + index,
    file: "data/raw/db2k/merged-2003-2018-full.json",
    sourceDraftYear: 2003 + index,
  })),
  { year: 2003, file: "data/raw/db2k/2003_draft_class.json", sourceDraftYear: 2003 },
  { year: 2005, file: "data/raw/db2k/2005_draft_class_filtered.json", sourceDraftYear: 2005 },
  { year: 2010, file: "data/raw/db2k/2010_draft_class_filtered.json", sourceDraftYear: 2010 },
  // Single-class snapshots use editor sentinel DRAFTEDYEAR values such as 1900.
  { year: 2018, file: "data/raw/db2k/player_roster_snapshot.json" },
  ...[2019, 2020, 2021, 2022, 2023].map((year) => ({
    year,
    file: `data/raw/db2k/${year}player_roster_snapshot.json`,
  })),
  { year: 2024, file: "data/raw/db2k/player_roster_snapshot(2).json" },
  { year: 2025, file: "data/raw/db2k/player_roster_snapshot(1).json" },
];

const explicitNameAliases: Record<string, string> = {
  "otto porter": "otto porter jr",
  "terry rozier iii": "terry rozier",
  "patrick mills": "patty mills",
  "bobby portis jr": "bobby portis",
  "mickael pietrus": "mickael pietrus",
  "deandre hunter": "deandre hunter",
  "r j barrett": "rj barrett",
  "aj green": "a j green",
  "gg jackson": "gregory jackson ii",
  // 游戏/卡名拼写变体 -> 官方选秀表名（选秀时/标准写法）
  "mohamed bamba": "mo bamba",
  "cameron reddish": "cam reddish",
  "cameron thomas": "cam thomas",
  "nicolas claxton": "nic claxton",
  "nahshon hyland": "bones hyland",
  "kevin knox ii": "kevin knox",
  "robert williams iii": "robert williams",
  "michael sweetney": "mike sweetney",
  "jianlian yi": "yi jianlian",
  "ming yao": "yao ming",
  "zhi zhi wang": "wang zhi zhi",
  "louis williams": "lou williams",
  "kenyon martin jr": "kj martin",
  "johnny r davis": "johnny davis",
  "eddie a johnson": "eddie johnson",
  "cliff t robinson": "cliff robinson",
  "gerald henderson sr": "gerald henderson",
  "walker russell sr": "walker russell",
  "micheal ray richardson": "michael ray richardson",
};

function coreName(raw: string): string {
  return String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function baseName(raw: string): string {
  return coreName(raw).replace(/ (jr|sr|ii|iii|iv|v)$/, "");
}

type OfficialMatcher = {
  byExact: Map<string, number>;
  byBase: Map<string, Set<number>>;
  names: Map<number, string>;
};

function officialMatcher(year: number): OfficialMatcher {
  const board = officialFixture.years[String(year)] ?? {};
  const byExact = new Map<string, number>();
  const byBase = new Map<string, Set<number>>();
  const names = new Map<number, string>();
  for (const [pickRaw, name] of Object.entries(board)) {
    const pick = Number(pickRaw);
    const exact = coreName(name);
    const base = baseName(name);
    byExact.set(exact, pick);
    if (!byBase.has(base)) byBase.set(base, new Set());
    byBase.get(base)!.add(pick);
    names.set(pick, name);
  }
  return { byExact, byBase, names };
}

function resolveOfficial(name: string, matcher: OfficialMatcher): number | null {
  const exact = coreName(name);
  const alias = explicitNameAliases[exact];
  const direct = matcher.byExact.get(exact) ?? (alias ? matcher.byExact.get(coreName(alias)) : undefined);
  if (direct != null) return direct;
  const candidates = matcher.byBase.get(baseName(name));
  return candidates?.size === 1 ? [...candidates][0] : null;
}

function value(record: any, section: string, field: string) {
  return record?.fields?.[`${section}/${field}`]?.display_value;
}

function sourceName(record: any) {
  const first = String(value(record, "Vitals", "FIRSTNAME") ?? "");
  const last = String(value(record, "Vitals", "LASTNAME") ?? "");
  return `${first} ${last}`.trim() || String(record?.label ?? "").trim();
}

function csv(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file: string, headers: string[], rows: Record<string, unknown>[]) {
  const body = [headers.join(","), ...rows.map((row) => headers.map((header) => csv(row[header])).join(","))].join("\n") + "\n";
  writeFileSync(path.join(outDir, file), body, "utf8");
}

mkdirSync(outDir, { recursive: true });

const sourceByYear = new Map<number, { namesByPick: Map<number, Set<string>>; filesByPick: Map<number, Set<string>>; falseRows: Record<string, unknown>[] }>();
for (let year = 1960; year <= 2025; year++) {
  sourceByYear.set(year, { namesByPick: new Map(), filesByPick: new Map(), falseRows: [] });
}

for (const spec of sources) {
  const fullPath = path.join(root, spec.file);
  if (!existsSync(fullPath)) {
    console.warn(`source not retained: ${spec.file}`);
    continue;
  }
  const snapshot = JSON.parse(readFileSync(fullPath, "utf8"));
  const matcher = officialMatcher(spec.year);
  const bucket = sourceByYear.get(spec.year)!;
  for (const record of snapshot.records ?? []) {
    if (spec.sourceDraftYear != null && Number(value(record, "Vitals", "DRAFTEDYEAR")) !== spec.sourceDraftYear) continue;
    const name = sourceName(record);
    if (!name) continue;
    const pick = resolveOfficial(name, matcher);
    if (pick == null) {
      bucket.falseRows.push({
        year: spec.year,
        sourceFile: spec.file,
        player: name,
        sourceDraftPick: value(record, "Vitals", "DRAFTPICKNUMBER") ?? "",
        sourceDraftYear: value(record, "Vitals", "DRAFTEDYEAR") ?? "",
        classification: "not_an_official_draftee_of_target_year",
      });
      continue;
    }
    if (!bucket.namesByPick.has(pick)) bucket.namesByPick.set(pick, new Set());
    bucket.namesByPick.get(pick)!.add(name);
    if (!bucket.filesByPick.has(pick)) bucket.filesByPick.set(pick, new Set());
    bucket.filesByPick.get(pick)!.add(spec.file);
  }
}

const cardsByYear = new Map<number, { byPick: Map<number, any[]>; nonOfficial: Record<string, unknown>[] }>();
for (let year = 1960; year <= 2025; year++) cardsByYear.set(year, { byPick: new Map(), nonOfficial: [] });
for (const dirName of readdirSync(cardsRoot).filter((entry) => /^\d{4}$/.test(entry))) {
  const year = Number(dirName);
  if (year < 1960 || year > 2025) continue;
  const matcher = officialMatcher(year);
  const bucket = cardsByYear.get(year)!;
  for (const file of readdirSync(path.join(cardsRoot, dirName))) {
    if (!file.endsWith(".json") || file === "review.json" || file === "capture-manifest.json") continue;
    const card = JSON.parse(readFileSync(path.join(cardsRoot, dirName, file), "utf8"));
    const pick = resolveOfficial(card.name, matcher);
    if (pick == null) {
      bucket.nonOfficial.push({ year, cardFile: `${dirName}/${file}`, player: card.name, storedDraftPick: card.vitals?.draftPick ?? "", classification: "card_not_resolved_to_official_draft_board" });
      continue;
    }
    if (!bucket.byPick.has(pick)) bucket.byPick.set(pick, []);
    bucket.byPick.get(pick)!.push(card);
  }
}

const sourceMissingCard: Record<string, unknown>[] = [];
const officialMissingSnapshot: Record<string, unknown>[] = [];
const sourceNotOfficial: Record<string, unknown>[] = [];
const cardsNotOfficial: Record<string, unknown>[] = [];
const cardPickMismatches: Record<string, unknown>[] = [];
const summaryYears: Record<string, unknown>[] = [];

for (let year = 1960; year <= 2025; year++) {
  const matcher = officialMatcher(year);
  const officialPicks = [...matcher.names.keys()].sort((a, b) => a - b);
  const source = sourceByYear.get(year)!;
  const cards = cardsByYear.get(year)!;
  const sourceAvailable = sources.some((spec) => spec.year === year && existsSync(path.join(root, spec.file)));
  let missingCardCount = 0;
  let missingSnapshotCount = 0;
  for (const pick of officialPicks) {
    const officialName = matcher.names.get(pick)!;
    const sourceNames = source.namesByPick.get(pick);
    const existingCards = cards.byPick.get(pick) ?? [];
    if (!sourceNames) {
      missingSnapshotCount++;
      officialMissingSnapshot.push({
        year,
        pick,
        player: officialName,
        sourceSnapshotAvailable: sourceAvailable,
        reason: sourceAvailable ? "not_found_in_retained_snapshot" : "no_retained_source_snapshot_for_year",
      });
      continue;
    }
    const hasOverall = existingCards.some((card) => card.overall != null);
    for (const card of existingCards) {
      const storedPick = card.vitals?.draftPick;
      if (typeof storedPick === "number" && storedPick > 0 && storedPick !== pick) {
        cardPickMismatches.push({
          year,
          cardFile: `${year}/${card.slug}.json`,
          player: card.name,
          storedDraftPick: storedPick,
          officialDraftPick: pick,
        });
      }
    }
    if (!hasOverall) {
      missingCardCount++;
      sourceMissingCard.push({
        year,
        pick,
        player: officialName,
        sourcePlayerNames: [...sourceNames].sort().join(" | "),
        sourceFiles: [...(source.filesByPick.get(pick) ?? [])].sort().join(" | "),
        existingCard: existingCards.map((card) => card.name).join(" | "),
        action: existingCards.length ? "collect_rookie_ovr_for_existing_card" : "append_snapshot_card_then_collect_rookie_ovr",
      });
    }
  }
  sourceNotOfficial.push(...source.falseRows);
  cardsNotOfficial.push(...cards.nonOfficial);
  summaryYears.push({
    year,
    officialDraftees: officialPicks.length,
    sourceSnapshotAvailable: sourceAvailable,
    sourceOfficialDraftees: source.namesByPick.size,
    sourceDrafteesMissingCard: missingCardCount,
    officialDrafteesMissingSnapshot: missingSnapshotCount,
    sourceNotOfficialDraft: source.falseRows.length,
    cardsResolvedToOfficial: cards.byPick.size,
    cardsNotOfficialForYear: cards.nonOfficial.length,
  });
}

writeCsv("snapshot-draftees-needing-rookie-ovr.csv", ["year", "pick", "player", "sourcePlayerNames", "sourceFiles", "existingCard", "action"], sourceMissingCard);
writeCsv("official-draftees-missing-snapshot.csv", ["year", "pick", "player", "sourceSnapshotAvailable", "reason"], officialMissingSnapshot);
writeCsv("source-rows-not-official-draftees.csv", ["year", "sourceFile", "player", "sourceDraftPick", "sourceDraftYear", "classification"], sourceNotOfficial);
writeCsv("cards-not-official-for-directory-year.csv", ["year", "cardFile", "player", "storedDraftPick", "classification"], cardsNotOfficial);
writeCsv("card-draft-pick-mismatches.csv", ["year", "cardFile", "player", "storedDraftPick", "officialDraftPick"], cardPickMismatches);
writeCsv("summary-by-year.csv", ["year", "officialDraftees", "sourceSnapshotAvailable", "sourceOfficialDraftees", "sourceDrafteesMissingCard", "officialDrafteesMissingSnapshot", "sourceNotOfficialDraft", "cardsResolvedToOfficial", "cardsNotOfficialForYear"], summaryYears);
writeFileSync(path.join(outDir, "summary-by-year.json"), JSON.stringify({ generatedAt: new Date().toISOString(), years: summaryYears }, null, 2) + "\n", "utf8");

console.log(`Draft audit written to ${outDir}`);
console.log(`official draftees with source data but needing rookie OVR/card: ${sourceMissingCard.length}`);
console.log(`official draftees missing retained source snapshots: ${officialMissingSnapshot.length}`);
console.log(`source rows outside their target official draft: ${sourceNotOfficial.length}`);
console.log(`cards not resolved to official board of directory year: ${cardsNotOfficial.length}`);
console.log(`resolved cards with draft-pick mismatch: ${cardPickMismatches.length}`);
