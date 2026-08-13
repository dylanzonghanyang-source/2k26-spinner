#!/usr/bin/env -S node --experimental-strip-types
/**
 * Regression contract for the all-era draft-class audit.
 * The audit must distinguish: official draftees missing a card (safe append
 * candidates), official picks missing from retained snapshots, and source rows
 * that are not official draftees of their marked class.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audit = path.join(root, "scripts", "audit-draft-class-coverage.mts");
const out = mkdtempSync(path.join(os.tmpdir(), "2k-draft-audit-"));

try {
  execFileSync(process.execPath, ["--experimental-strip-types", audit, "--out", out], {
    cwd: root,
    stdio: "pipe",
  });
  const summary = JSON.parse(readFileSync(path.join(out, "summary-by-year.json"), "utf8"));
  const byYear = new Map(summary.years.map((row: { year: number }) => [row.year, row]));

  const y2013 = byYear.get(2013) as Record<string, number | boolean>;
  assert.equal(y2013.sourceSnapshotAvailable, true, "2013 merged snapshot is registered");
  assert.equal(y2013.sourceOfficialDraftees, 25, "2013 has 25 official draftees in retained source data (merged + all-found)");
  assert.equal(y2013.sourceDrafteesMissingCard, 15, "2013 source draftees missing cards are reportable append candidates");

  const y2017 = byYear.get(2017) as Record<string, number | boolean>;
  assert.equal(y2017.sourceSnapshotAvailable, true, "2017 merged snapshot is registered");
  assert.equal(y2017.sourceOfficialDraftees, 23, "2017 retains Fultz and other official draftees");
  assert.equal(y2017.sourceDrafteesMissingCard, 3, "2017 exposes Fultz, Čančar and Monte Morris as missing cards");
  assert.equal(y2017.sourceNotOfficialDraft, 8, "2017 source's false draft-year records are not counted as draftees");

  const y1960 = byYear.get(1960) as Record<string, number | boolean>;
  assert.equal(y1960.sourceSnapshotAvailable, true, "all-found merged capture registers pre-2003 eras");
  assert.equal(y1960.sourceDrafteesMissingCard, 2, "1960 new cards are exposed as needing rookie OVR");

  const y2024 = byYear.get(2024) as Record<string, number | boolean>;
  const y2025 = byYear.get(2025) as Record<string, number | boolean>;
  assert.equal(y2024.sourceSnapshotAvailable, true, "unnamed snapshot (2) is identified as 2024");
  assert.equal(y2025.sourceSnapshotAvailable, true, "unnamed snapshot (1) is identified as 2025");

  const noSnapshot = readFileSync(path.join(out, "official-draftees-missing-snapshot.csv"), "utf8");
  assert.ok(noSnapshot.includes("1960,"), "audit lists official draftees for years whose raw source snapshot is not retained");
  assert.ok(noSnapshot.includes("2013,1,Anthony Bennett"), "audit identifies an official pick missing from the 2013 source snapshot");

  console.log("✅ test-draft-class-audit: all-era source coverage and candidate classifications pass");
} finally {
  rmSync(out, { recursive: true, force: true });
}
