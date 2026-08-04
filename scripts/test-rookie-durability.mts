#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DURABILITY_ATTRIBUTES,
  generateDurabilityAttributes,
  generateRookieDurability,
} from "../src/rookieDurability.ts";

function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], position: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * position)] ?? 0;
}

const bodyParts = DURABILITY_ATTRIBUTES.filter((attribute) => attribute !== "Overall Durability");
const pairedParts = [
  ["Left Shoulder Durability", "Right Shoulder Durability"],
  ["Left Elbow Durability", "Right Elbow Durability"],
  ["Left Hip Durability", "Right Hip Durability"],
  ["Left Knee Durability", "Right Knee Durability"],
  ["Left Ankle Durability", "Right Ankle Durability"],
  ["Left Foot Durability", "Right Foot Durability"],
] as const;

{
  const values = generateDurabilityAttributes(82, makeRandom(1));
  assert.deepEqual(Object.keys(values).sort(), [...DURABILITY_ATTRIBUTES].sort(), "all durability attributes must be generated");
  assert.equal(average(Object.values(values)), values["Overall Durability"], "the 16-item durability mean must equal Overall Durability");
  for (const [left, right] of pairedParts) {
    assert(Math.abs(values[left] - values[right]) <= 1, `${left}/${right} must differ by at most one point`);
  }
}

{
  const normalBody = generateRookieDurability(80, 0, makeRandom(42));
  const stressedBody = generateRookieDurability(80, 8, makeRandom(42));
  const strongerSource = generateRookieDurability(90, 0, makeRandom(42));
  assert(stressedBody["Overall Durability"] < normalBody["Overall Durability"], "body stress must lower the calibrated mean");
  assert(strongerSource["Overall Durability"] > normalBody["Overall Durability"], "a more durable source must raise the calibrated mean");
}

const players = JSON.parse(readFileSync(new URL("../src/data/versions/2k26/players.json", import.meta.url), "utf8"));
const sourceValues = players
  .map((player: { detailed?: Record<string, number | null> }) => player.detailed?.["Overall Durability"])
  .filter((value: number | null | undefined): value is number => typeof value === "number");
assert.equal(sourceValues.length, 495, "2K26 durability fixture coverage changed unexpectedly");

const generatedOverall = sourceValues.map((source, index) => (
  generateRookieDurability(source, 0, makeRandom(index + 1))["Overall Durability"]
));
const generatedMean = average(generatedOverall);
assert(generatedMean >= 81 && generatedMean <= 83, `rookie durability mean regressed to ${generatedMean.toFixed(2)}`);
assert(percentile(generatedOverall, 0.05) >= 79, "rookie durability p5 must not fall back to the high 60s");
assert(percentile(generatedOverall, 0.95) <= 86, "rookie durability p95 must remain bounded");

for (const source of sourceValues.slice(0, 25)) {
  const values = generateRookieDurability(source, 0, makeRandom(source));
  assert.equal(average(Object.values(values)), values["Overall Durability"], "generated durability must remain exactly balanced");
  for (const attribute of bodyParts) {
    assert(values[attribute] >= 25 && values[attribute] <= 99, `${attribute} must stay in the game rating range`);
  }
}

console.log(JSON.stringify({
  status: "passed",
  sourceCount: sourceValues.length,
  generatedMean,
  generatedP5: percentile(generatedOverall, 0.05),
  generatedMedian: percentile(generatedOverall, 0.5),
  generatedP95: percentile(generatedOverall, 0.95),
}, null, 2));
