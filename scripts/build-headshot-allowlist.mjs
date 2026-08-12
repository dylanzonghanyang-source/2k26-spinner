#!/usr/bin/env node
/**
 * Build the headshot allowlist for the proxy from the committed data files.
 *
 * The proxy must only fetch headshots the app actually references, so
 * arbitrary ids/slugs cannot be used to make it fetch any upstream URL.
 *
 * Output: deploy/headshot-allowlist.json
 *   nbaIds:      numeric NBA headshot ids (from playerHeadshots.json +
 *                playerPresentation.headshotIds)
 *   historicalSlugs: basketball-reference slugs (from playerHeadshotFallbacks.json)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "src", "data");

const playerHeadshots = JSON.parse(fs.readFileSync(path.join(DATA, "playerHeadshots.json"), "utf8"));
const playerHeadshotFallbacks = JSON.parse(fs.readFileSync(path.join(DATA, "playerHeadshotFallbacks.json"), "utf8"));
let presentationHeadshotIds = {};
try {
  presentationHeadshotIds = JSON.parse(fs.readFileSync(path.join(DATA, "playerPresentation.json"), "utf8")).headshotIds ?? {};
} catch {
  // optional file
}

const nbaIds = new Set();
for (const [name, id] of Object.entries({ ...presentationHeadshotIds, ...playerHeadshots })) {
  void name;
  if (typeof id === "string" && /^\d{4,10}$/.test(id)) nbaIds.add(id);
}

const historicalSlugs = new Set();
for (const [name, slug] of Object.entries(playerHeadshotFallbacks)) {
  void name;
  if (typeof slug === "string" && /^[a-z0-9]+$/.test(slug)) historicalSlugs.add(slug);
}

const allowlist = {
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  nbaIds: [...nbaIds].sort(),
  historicalSlugs: [...historicalSlugs].sort(),
};

const out = path.join(ROOT, "deploy", "headshot-allowlist.json");
fs.writeFileSync(out, JSON.stringify(allowlist, null, 2) + "\n", "utf8");
console.log(`allowlist: ${allowlist.nbaIds.length} nba ids, ${allowlist.historicalSlugs.length} historical slugs -> ${path.relative(ROOT, out)}`);
