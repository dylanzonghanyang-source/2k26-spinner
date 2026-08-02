#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function readBundleChunks(directory) {
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith(".js"))
    .sort()
    .map((file) => ({
      file,
      bytes: fs.statSync(path.join(directory, file)).size,
    }));
}

export function findOversizedChunks(directory, maxBytes) {
  return readBundleChunks(directory).filter((chunk) => chunk.bytes > maxBytes);
}

function run() {
  const directory = path.resolve(process.cwd(), process.argv[2] ?? "dist/assets");
  const maxBytes = Number(process.env.BUNDLE_MAX_BYTES ?? 500_000);
  if (!fs.existsSync(directory)) {
    console.error(`Bundle assets directory not found: ${directory}`);
    process.exit(1);
  }

  const chunks = readBundleChunks(directory);
  for (const chunk of chunks) {
    console.log(`${chunk.file}: ${(chunk.bytes / 1000).toFixed(1)}kB`);
  }

  const oversized = chunks.filter((chunk) => chunk.bytes > maxBytes);
  if (oversized.length > 0) {
    console.error(`Bundle budget exceeded (${maxBytes / 1000}kB): ${oversized.map((chunk) => chunk.file).join(", ")}`);
    process.exit(1);
  }

  console.log(`Bundle budget OK: ${chunks.length} JavaScript chunks ≤ ${maxBytes / 1000}kB`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) run();
