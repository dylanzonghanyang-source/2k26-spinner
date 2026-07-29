import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd());
const rawDirectory = path.resolve(root, process.argv[2] ?? "data/2kratings");
const outputPath = path.resolve(root, process.argv[3] ?? "src/data/players.json");

const files = (await readdir(rawDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort((left, right) => left.localeCompare(right));

if (files.length === 0) {
  throw new Error(`No raw player JSON files found in ${rawDirectory}`);
}

const players = [];
for (const fileName of files) {
  const raw = JSON.parse(await readFile(path.join(rawDirectory, fileName), "utf8"));
  if (!raw?.slug) {
    console.warn(`Skipping ${fileName}: missing slug`);
    continue;
  }

  const attributes = raw.attributes ?? {};
  const detailed = raw.detailedAttributes ?? raw.detailed ?? {};
  players.push({
    name: raw.name ?? raw.slug.replace(/-/g, " "),
    slug: raw.slug,
    overall: numberOrNull(raw.overall),
    team: raw.team ?? null,
    position: raw.position ?? null,
    archetype: raw.archetype ?? null,
    height: raw.height ?? null,
    weight: numberOrNull(raw.weight),
    wingspan: raw.wingspan ?? null,
    shooting: numberOrNull(attributes.shooting),
    athleticism: numberOrNull(attributes.athleticism),
    playmaking: numberOrNull(attributes.playmaking),
    defense: numberOrNull(attributes.defense),
    inside: numberOrNull(attributes.inside),
    detailed: Object.fromEntries(
      Object.entries(detailed)
        .filter(([, value]) => Number.isFinite(value))
        .map(([key, value]) => [key, Math.round(value)]),
    ),
  });
}

players.sort((left, right) => left.slug.localeCompare(right.slug));
await writeFile(outputPath, `${JSON.stringify(players, null, 2)}\n`, "utf8");
console.log(`Wrote ${players.length} players to ${path.relative(root, outputPath)}`);

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
