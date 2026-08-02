#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "src", "data");
const allowedTiers = new Set(["Bronze", "Silver", "Gold", "HOF", "Legendary"]);
const allowedCategories = new Set(["shooting", "athleticism", "playmaking", "defense", "inside", "general", "rebounding"]);

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
}

function validateProfiles(profiles, expectedCount, label) {
  assert.equal(Object.keys(profiles).length, expectedCount, `${label} known-profile count`);
  for (const [slug, badges] of Object.entries(profiles)) {
    assert(Array.isArray(badges), `${label}:${slug} must be an array (including true zero-badge players)`);
    assert.equal(new Set(badges.map((badge) => badge.name)).size, badges.length, `${label}:${slug} badge names must be unique`);
    for (const badge of badges) {
      assert.equal(typeof badge.name, "string");
      assert(allowedTiers.has(badge.tier), `${label}:${slug} invalid tier ${badge.tier}`);
      assert(allowedCategories.has(badge.category), `${label}:${slug} invalid category ${badge.category}`);
    }
  }
}

const profiles2k26 = load("badgeProfiles.2k26.json");
const gameExportOverrides2k26 = load("badgeProfiles.2k26.game-export.json");
const profiles2k27 = load("badgeProfiles.2k27.json");
const metadata = load("badgeProfiles.meta.json");
assert.equal(fs.existsSync(path.join(dataDir, "badgeProfiles.json")), false, "mixed unversioned badgeProfiles.json must not exist");

validateProfiles(profiles2k26, 496, "2K26");
validateProfiles(gameExportOverrides2k26, 63, "2K26 game exports");
validateProfiles(profiles2k27, 515, "2K27");
for (const [slug, badges] of Object.entries(gameExportOverrides2k26)) {
  assert.deepEqual(profiles2k26[slug], badges, `2K26 game export must override scraped snapshot for ${slug}`);
}
assert((profiles2k26["nikola-jokic"] ?? []).length > 0, "2K26 Jokic should have badges");
assert((profiles2k27["nikola-jokic"] ?? []).length > 0, "2K27 Jokic should have badges");
assert(Object.values(profiles2k27).some((badges) => badges.length === 0), "2K27 must preserve explicit zero-badge profiles");
assert.equal(metadata["2K26"].knownProfiles, 496);
assert.equal(metadata["2K26"].gameExportOverrides, 63);
assert.equal(metadata["2K27"].knownProfiles, 515);
assert.equal(metadata["2K27"].unmatchedSlugs.length, 7);

console.log(`versioned badge profiles OK: 2K26=${Object.keys(profiles2k26).length}, 2K27=${Object.keys(profiles2k27).length}`);
