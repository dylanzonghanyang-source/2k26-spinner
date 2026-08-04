#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyBodyConstraints,
  parsePlayerBody,
  strengthCapForBody,
  type BuilderBody,
  type SourceBody,
} from "../src/rookieBodyConstraints.ts";

const target = (height: number, weight: number, wingspan = 50, shoulder = 50): BuilderBody => ({
  height,
  weight,
  wingspan,
  shoulder,
  neck: 50,
  torso: 50,
});

const source: SourceBody = { height: 198, weight: 98, wingspan: 208 };

{
  const parsed = parsePlayerBody({ height: "6'6\"", weight: 220, wingspan: "7'0\"" });
  assert(parsed, "valid player body must parse");
  assert.equal(Math.round(parsed.height), 198, "feet/inches height must convert to cm");
  assert.equal(Math.round(parsed.weight), 100, "source weight in pounds must convert to kg");
  assert.equal(Math.round(parsed.wingspan), 213, "feet/inches wingspan must convert to cm");
}

{
  const outlierValues = {
    "Pass Accuracy": 96,
    "Pass Vision": 95,
    "Ball Handle": 87,
    Block: 80,
    Strength: 90,
  };
  const ownBody = target(source.height, source.weight, 50, 50);
  const result = applyBodyConstraints(outlierValues, ownBody, source);
  assert.equal(result.values["Pass Accuracy"], 96, "passing must never receive a body or position stereotype penalty");
  assert.equal(result.values["Pass Vision"], 95, "passing vision must remain intact");
  assert.equal(result.values["Ball Handle"], 87, "high-handle big must survive at its proven source body");
  assert.equal(result.values.Block, 80, "high-block outlier must survive at its proven source body");
  assert.equal(result.values.Strength, 90, "valid source strength must survive when target weight supports it");
}

{
  const values = {
    Strength: 90,
    Speed: 90,
    Agility: 90,
    "Ball Handle": 90,
    "Speed with Ball": 90,
    Block: 90,
    "Interior Defense": 90,
    "Offensive Rebound": 90,
    "Defensive Rebound": 90,
    "Standing Dunk": 90,
  };
  const baseline = applyBodyConstraints(values, target(198, 98), source).values;
  const tall = applyBodyConstraints(values, target(208, 98), source).values;
  const heavy = applyBodyConstraints(values, target(198, 113), source).values;

  for (const attr of ["Block", "Interior Defense", "Offensive Rebound", "Defensive Rebound", "Standing Dunk"] as const) {
    assert(tall[attr] >= baseline[attr], `${attr} must not decrease when target height increases`);
  }
  for (const attr of ["Speed", "Agility", "Ball Handle", "Speed with Ball"] as const) {
    assert(tall[attr] <= baseline[attr], `${attr} must not increase when target height increases`);
  }
  for (const attr of ["Strength", "Interior Defense", "Offensive Rebound", "Defensive Rebound", "Standing Dunk"] as const) {
    assert(heavy[attr] >= baseline[attr], `${attr} must not decrease when target weight increases`);
  }
  for (const attr of ["Speed", "Agility", "Ball Handle", "Speed with Ball"] as const) {
    assert(heavy[attr] <= baseline[attr], `${attr} must not increase when target weight increases`);
  }
}

{
  const mismatch = applyBodyConstraints(
    { Agility: 90, "Ball Handle": 90, "Speed with Ball": 90, Speed: 90 },
    target(220, 128, 65, 65),
    { height: 198, weight: 98, wingspan: 208 },
  ).values;
  assert(mismatch.Agility <= 80, "large height/weight mismatch must strongly reduce agility");
  assert(mismatch["Ball Handle"] <= 80, "large height/weight mismatch must strongly reduce ball handle");
  assert(mismatch["Speed with Ball"] <= 80, "large height/weight mismatch must strongly reduce speed with ball");
  assert(mismatch.Speed <= 82, "large height/weight mismatch must strongly reduce speed");
}

{
  const lightBody = target(185, 72, 50, 45);
  const cap = strengthCapForBody(lightBody);
  const playerValue = applyBodyConstraints({ Strength: 99 }, lightBody, { height: 185, weight: 100, wingspan: 195 });
  const customValue = applyBodyConstraints({ Strength: 99 }, lightBody, null);
  assert(playerValue.values.Strength <= cap, "player source cannot bypass the target weight strength cap");
  assert(customValue.values.Strength <= cap, "custom strength cannot bypass the target weight strength cap");
  assert(cap < 80, "72kg target must not support elite 80+ strength");
}

{
  const hugeBody = target(220, 125, 65, 65);
  const result = applyBodyConstraints({
    "Three-Point Shot": 94,
    "Pass Accuracy": 96,
    "Offensive Consistency": 95,
    Potential: 97,
  }, hugeBody, source);
  assert.deepEqual(result.values, {
    "Three-Point Shot": 94,
    "Pass Accuracy": 96,
    "Offensive Consistency": 95,
    Potential: 97,
  }, "non-body-sensitive attributes must remain byte-for-byte unchanged");
}

{
  const extremeSmall = applyBodyConstraints({ Block: 99, "Defensive Rebound": 99, "Interior Defense": 99 }, target(160, 55, 30, 35), null);
  assert(extremeSmall.values.Block < 75, "extremely short custom body must not retain 99 Block");
  assert(extremeSmall.values["Defensive Rebound"] < 75, "extremely short custom body must not retain 99 rebound");
  assert(extremeSmall.values["Interior Defense"] < 75, "extremely small custom body must not retain 99 interior defense");
}

{
  const builderSource = readFileSync(new URL("../src/components/RookieBuilder.tsx", import.meta.url), "utf8");
  assert(!builderSource.includes("getPenaltyRateForPosition"), "production builder must not penalize attributes by source position");
  assert(!builderSource.includes("getSourcePenaltyRate"), "production builder must not retain source-position penalty plumbing");
  assert(!builderSource.includes("getSecondaryMismatchPenalty"), "secondary-position labels must not apply static bundle penalties");
  assert(!builderSource.includes("来源位置衰减"), "UI/export must not claim a source-position penalty");
  assert(!builderSource.includes("非常规次要位置衰减"), "UI/export must not claim a secondary-position penalty");
  assert(!builderSource.includes("enforceBodyStrengthCap"), "peak/rookie paths must not retain the old strength-only cap helper");
  assert(!builderSource.includes("enforceBodyPhysicalCaps"), "peak/rookie paths must not retain the old physical cap helper");
  assert(
    builderSource.match(/applyBodyConstraints/g)?.length && (builderSource.match(/applyBodyConstraints/g)?.length ?? 0) >= 6,
    "preview, custom, peak and rookie paths must all use the unified body constraint function",
  );

  for (const legacyTerm of [
    "PotentialRange",
    "configuredPotential",
    "inferredPotentialRange",
    "resolveOverallCalibration",
    "calibrateAttributesToOverall",
    "readiness",
    "巅峰综评区间",
    "新秀综评区间",
  ]) {
    assert(!builderSource.includes(legacyTerm), `legacy specified-potential term must be removed: ${legacyTerm}`);
  }
}

console.log("rookie body constraints OK");
