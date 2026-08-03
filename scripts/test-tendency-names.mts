#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tendencyBundleMap } from "../src/components/tendencyBundleMap.ts";
import { getTendencyNameCN, tendencyNameCN } from "../src/tendencyNames.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const table = JSON.parse(fs.readFileSync(path.join(root, "src", "data", "tendencyProfiles.min.json"), "utf8"));
const fields = table.fields as string[];

assert.equal(fields.length, 96, "expected 96 ATD tendency fields");
assert.equal(Object.keys(tendencyNameCN).length, 96, "Chinese map must cover exactly 96 fields");

for (const field of fields) {
  assert(tendencyNameCN[field], `missing Chinese name for ${field}`);
  assert.notEqual(getTendencyNameCN(field), field, `${field} must not fall back to English`);
  assert(!/[A-Za-z]{4,}/.test(getTendencyNameCN(field)), `Chinese label for ${field} looks English: ${getTendencyNameCN(field)}`);
}

for (const field of Object.keys(tendencyNameCN)) {
  assert(fields.includes(field), `Chinese map has unknown field ${field}`);
}

for (const field of Object.keys(tendencyBundleMap)) {
  assert(fields.includes(field), `bundle map has field not in table: ${field}`);
}

assert(!("Iso vs Poor Defender" in tendencyBundleMap), "stale Iso vs Poor Defender must be removed from active bundle map");
assert.equal(getTendencyNameCN("Shot Three"), "三分投篮");
assert.equal(getTendencyNameCN("Spot Up Drive"), "切入定点投");
assert.equal(getTendencyNameCN("Crash"), "冲抢进攻篮板");
assert.equal(getTendencyNameCN("Touches"), "球感");
assert.equal(getTendencyNameCN("Hard Foul"), "强硬犯规");

console.log(`tendency Chinese names OK: ${fields.length} fields`);
