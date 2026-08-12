#!/usr/bin/env -S node --experimental-strip-types
/**
 * Regression test: a merged legacy DB2K snapshot must be convertible one draft
 * class at a time against the official draft-pick reference. Players lacking a
 * confirmed rookie OVR are retained as cards with overall=null rather than
 * being dropped; current-roster/undrafted records mislabeled with the same
 * draftYear are excluded.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const converter = path.join(root, "scripts", "convert-db2k-to-rookiecard.mjs");
const snapshot = path.join(root, "data", "raw", "db2k", "merged-2003-2018-full.json");
const draftPicks = path.join(root, "scripts", "official-draft-picks-1960-2025.json");
const cardsRoot = path.join(root, "src", "data", "rookieCards");

function cardsIn(out: string) {
  return readdirSync(out)
    .filter((file) => file.endsWith(".json") && !["review.json", "capture-manifest.json"].includes(file))
    .map((file) => JSON.parse(readFileSync(path.join(out, file), "utf8")));
}

function convert(year: number, append = false) {
  const out = path.join(cardsRoot, `__test-draft-year-${year}`);
  rmSync(out, { recursive: true, force: true });
  try {
    const args = [converter, "--input", snapshot, "--year", String(year), "--source-draft-year", String(year), "--draft-picks", draftPicks, "--out", out];
    execFileSync(process.execPath, args, { cwd: root, stdio: "pipe" });
    if (append) {
      const existing = cardsIn(out).find((card) => card.slug === "otto-porter");
      assert.ok(existing, "test fixture needs Otto Porter");
      existing.overall = 77;
      existing.detailed["Three-Point Shot"] = 91;
      writeFileSync(path.join(out, "otto-porter.json"), JSON.stringify(existing, null, 2) + "\n");
      writeFileSync(path.join(out, "review.json"), "{\"sentinel\":\"preserve\"}\n");
      writeFileSync(path.join(out, "capture-manifest.json"), "{\"sentinel\":\"preserve\"}\n");
      execFileSync(process.execPath, [...args, "--append"], { cwd: root, stdio: "pipe" });
    }
    return {
      cards: cardsIn(out),
      review: readFileSync(path.join(out, "review.json"), "utf8"),
      manifest: readFileSync(path.join(out, "capture-manifest.json"), "utf8"),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const draft2013 = convert(2013);
assert.equal(draft2013.cards.length, 24, "2013 conversion retains every official 2013 draftee present in the merged snapshot");
assert.ok(draft2013.cards.every((card) => card.draftYear === 2013), "2013 conversion must set target draft year on every card");
assert.ok(draft2013.cards.some((card) => card.slug === "otto-porter" && card.overall === null && card.vitals.draftPick === 3), "2013 Otto Porter stays collectable without OVR and receives official pick #3");
assert.ok(!draft2013.cards.some((card) => card.slug === "seth-curry"), "2013 must exclude undrafted Seth Curry despite the source's draft-year marker");
assert.ok(!draft2013.cards.some((card) => card.slug === "matthew-dellavedova"), "2013 must exclude undrafted Matthew Dellavedova despite the source's draft-year marker");
const draft2006 = convert(2006);
const shawneWilliams = draft2006.cards.find((card) => card.slug === "shawne-williams");
assert.deepEqual(
  shawneWilliams?.potential,
  { current: 74, min: 65, max: 74 },
  "converter must expand an inconsistent potential range without altering current",
);
assert.equal(shawneWilliams?.dataQuality?.potentialRangeCorrected, true, "corrected potential range must be marked");

const draft2017 = convert(2017);
assert.equal(draft2017.cards.length, 23, "2017 conversion retains every official 2017 draftee present in the merged snapshot");
assert.ok(draft2017.cards.some((card) => card.slug === "markelle-fultz" && card.overall === null && card.vitals.draftPick === 1), "2017 No. 1 pick Markelle Fultz remains present without OVR");
assert.ok(!draft2017.cards.some((card) => card.slug === "chris-boucher"), "2017 must exclude undrafted Chris Boucher despite the source's draft-year marker");
assert.ok(!draft2017.cards.some((card) => card.slug === "luke-kornet"), "2017 must exclude undrafted Luke Kornet despite the source's draft-year marker");

const append2013 = convert(2013, true);
const preservedOtto = append2013.cards.find((card) => card.slug === "otto-porter");
assert.equal(preservedOtto?.overall, 77, "--append must retain an existing confirmed OVR");
assert.equal(preservedOtto?.detailed["Three-Point Shot"], 91, "--append must retain existing card attributes");
assert.equal(append2013.review, "{\"sentinel\":\"preserve\"}\n", "--append must retain existing review metadata");
assert.equal(append2013.manifest, "{\"sentinel\":\"preserve\"}\n", "--append must retain existing capture metadata");

console.log("✅ test-convert-db2k-draft-year: official filtering preserves null-OVR draftees, excludes false year markers, and append preserves existing cards and metadata");
