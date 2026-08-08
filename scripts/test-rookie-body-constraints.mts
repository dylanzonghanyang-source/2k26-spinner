#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyBodyConstraints,
  parsePlayerBody,
  strengthCapForBody,
  parsePositionRoles,
  distanceToSourceRoles,
  effectivePositionDistance,
  graceZonePositionClass,
  disadvantage,
  type BuilderBody,
  type SourceBody,
} from "../src/rookieBodyConstraints.ts";
import {
  bodyTransferProfiles,
  attrToSlot,
  profileForAttribute,
} from "../src/rookieBodyProfiles.ts";

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

  // The unified body constraint pipeline lives in the domain module
  // (src/createResult.ts) plus the builder's evaluate()/evaluateCustom()
  // preview paths; count across both files.
  const createResultSource = readFileSync(new URL("../src/createResult.ts", import.meta.url), "utf8");
  const constraintUsages = (builderSource.match(/applyBodyConstraints/g)?.length ?? 0)
    + (createResultSource.match(/applyBodyConstraints/g)?.length ?? 0);
  assert(
    constraintUsages >= 6,
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

// ============ 新功能：有符号差值 + 槽位方向 + 位置距离 + 宽容区 ============

// 1. 有符号差值：190 目标 ← 210 来源 → heightDelta = -20（不直接使用 190/210）
{
  const targetBody = target(190, 85);
  const sourceBody: SourceBody = { height: 210, weight: 105, wingspan: 220 };
  // 盖帽 higher：目标矮 20cm → 有惩罚；惩罚大小取决于 20cm 差，而非 190 本身
  const block = applyBodyConstraints({ Block: 95 }, targetBody, sourceBody, {
    targetPosition: "PG",
    sourcePosition: "C",
  }).values.Block;
  const tallerSameGap = applyBodyConstraints({ Block: 95 }, target(200, 85), sourceBody, {
    targetPosition: "PG",
    sourcePosition: "C",
  }).values.Block;
  assert.ok(block < 95, "shorter target must lose block");
  assert.ok(tallerSameGap > block, "10cm taller target with same 10cm gap must lose less");
}

// 2. 方向：Block higher（矮→罚），Handle lower（矮→不罚、高→罚）
// 注意：Block 还有目标侧安全 cap（200cm → 88），用例必须避开 cap 干扰。
{
  const shortTarget = target(180, 82);
  const tallTarget = target(200, 90);
  const sourceBody: SourceBody = { height: 190, weight: 86, wingspan: 200 };
  const blockShort = applyBodyConstraints({ Block: 80 }, shortTarget, sourceBody, {
    targetPosition: "PG", sourcePosition: "C",
  }).values.Block;
  const blockTall = applyBodyConstraints({ Block: 80 }, tallTarget, sourceBody, {
    targetPosition: "PG", sourcePosition: "C",
  }).values.Block;
  assert.ok(blockShort < 80, "block: shorter target must be penalized (higher preference)");
  assert.equal(blockTall, 80, "block: taller target must not be penalized by body delta (cap is separate)");

  const handleShort = applyBodyConstraints({ "Ball Handle": 90, "Speed with Ball": 90 }, shortTarget, sourceBody, {
    targetPosition: "PG", sourcePosition: "C",
  }).values["Ball Handle"];
  const handleTall = applyBodyConstraints({ "Ball Handle": 90, "Speed with Ball": 90 }, tallTarget, sourceBody, {
    targetPosition: "PG", sourcePosition: "C",
  }).values["Ball Handle"];
  assert.equal(handleShort, 90, "handle: shorter target must NOT be penalized (lower preference)");
  assert.ok(handleTall < 90, "handle: taller target must be penalized (lower preference)");
}

// 3. 16 槽位 profile 完整性 + 权重合法性
{
  const slotIds = ["three", "mid", "face", "post", "dunk", "handle", "passing", "perimeter", "interior", "steal", "block", "rebound", "athletic", "strength", "stability", "potential"];
  for (const slot of slotIds) {
    const profile = bodyTransferProfiles[slot];
    assert.ok(profile, `slot ${slot} must have a profile`);
    const sum = profile.height.weight + profile.weight.weight;
    assert.ok(Math.abs(sum - 1) < 1e-9 || (profile.height.weight === 0 && profile.weight.weight === 0),
      `slot ${slot} H/W weights must sum to 1 or be fully neutral`);
  }
  // 所有属性都能解析到 profile
  for (const attr of Object.keys(attrToSlot)) {
    const profile = profileForAttribute(attr);
    assert.ok(profile, `attr ${attr} must resolve a profile`);
  }
}

// 4. 宽容区：同位置接近体型原值继承；远位置不豁免
{
  const samePos = applyBodyConstraints({ Block: 95, "Interior Defense": 95 }, target(205, 105), { height: 215, weight: 115, wingspan: 225 }, {
    targetPosition: "C", secondaryPosition: "PF", sourcePosition: "C",
  });
  assert.equal(samePos.values.Block, 95, "same-position close body must keep 95 block");
  assert.equal(samePos.values["Interior Defense"], 95, "same-position close body must keep 95 interior");

  const farPos = applyBodyConstraints({ Block: 95 }, target(205, 105), { height: 215, weight: 115, wingspan: 225 }, {
    targetPosition: "PG", secondaryPosition: "SG", sourcePosition: "C",
  });
  assert.ok(farPos.values.Block < 95, "far position must NOT enter grace zone");

  // 主位置相同但体型差距大：仍受惩罚
  const samePosBigGap = applyBodyConstraints({ Block: 95 }, target(180, 80), { height: 220, weight: 120, wingspan: 230 }, {
    targetPosition: "C", sourcePosition: "C",
  });
  assert.ok(samePosBigGap.values.Block < 95, "same position with huge body gap must still be penalized");
}

// 5. 位置本身不扣分：身高体重完全相同，C → PG
// Block 用 80 避开 200cm 目标的安全 cap（88），单独验证位置标签无影响。
{
  const sourceBody: SourceBody = { height: 200, weight: 100, wingspan: 210 };
  const sameBody = applyBodyConstraints({ Block: 80, "Ball Handle": 95 }, target(200, 100), sourceBody, {
    targetPosition: "PG", secondaryPosition: "SG", sourcePosition: "C",
  });
  assert.equal(sameBody.values.Block, 80, "identical body must not lose block from position label alone");
  assert.equal(sameBody.values["Ball Handle"], 95, "identical body must not lose handle from position label alone");
}

// 6. 42 验收夹具：180/82 PG ← 220/120 C，Block 95 → 42
{
  const result = applyBodyConstraints({ Block: 95 }, target(180, 82), { height: 220, weight: 120, wingspan: 230 }, {
    targetPosition: "PG", sourcePosition: "C",
  });
  assert.equal(result.values.Block, 42, "calibration fixture must land at 42 (primary-only distance 4)");
}

// 7. 位置解析与有效距离
{
  assert.deepEqual(parsePositionRoles("PF/C"), ["PF", "C"], "PF/C must parse to both roles");
  assert.deepEqual(parsePositionRoles("C/PF"), ["C", "PF"], "C/PF must parse to both roles");
  assert.deepEqual(parsePositionRoles("Backcourt"), [], "Backcourt must not parse");
  assert.equal(distanceToSourceRoles("PG", parsePositionRoles("PF/C")), 3, "PG to PF/C nearest role distance 3");
  assert.equal(effectivePositionDistance("PG", "SG", parsePositionRoles("C")), 3.8, "PG/SG vs C = 3.8");
  assert.equal(effectivePositionDistance("PF", "C", parsePositionRoles("C")), 0.8, "PF/C vs C = 0.8");
  assert.equal(effectivePositionDistance("C", "PF", parsePositionRoles("C")), 0.2, "C/PF vs C = 0.2");
  assert.equal(effectivePositionDistance("PG", "C", parsePositionRoles("C")), 3.2, "PG/C vs C = 3.2");
  assert.equal(graceZonePositionClass(4, 3.2), "none", "far primary must not enter grace zone");
  assert.equal(graceZonePositionClass(0, 0.2), "same", "C/PF vs C is same-position grace");
  assert.equal(graceZonePositionClass(1, 0.8), "adjacent", "PF/C vs C is adjacent grace");
  assert.equal(disadvantage(-20, "higher"), 20, "higher preference penalizes shorter target");
  assert.equal(disadvantage(-20, "lower"), 0, "lower preference does not penalize shorter target");
  assert.equal(disadvantage(20, "lower"), 20, "lower preference penalizes taller target");
}

// 8. 篮板属性级覆盖：DReb 体重 higher（卡位），OReb 体重 neutral（弹跳）
{
  const sourceBody: SourceBody = { height: 210, weight: 115, wingspan: 220 };
  const lightTarget = target(200, 85);
  const dReb = applyBodyConstraints({ "Defensive Rebound": 90, "Offensive Rebound": 90 }, lightTarget, sourceBody, {
    targetPosition: "PF", sourcePosition: "C",
  });
  assert.ok(dReb.values["Defensive Rebound"] < 90, "DReb: lighter target loses some boxing-out value");
  assert.ok(dReb.values["Offensive Rebound"] >= dReb.values["Defensive Rebound"],
    "OReb must not be penalized harder than DReb for lighter body (vertical can compensate)");
}

// 9. 支持依赖在 profile 数据中存在（行为在 createResult 两阶段测试中覆盖）
{
  const interior = profileForAttribute("Interior Defense");
  const dunk = profileForAttribute("Driving Dunk");
  const perimeter = profileForAttribute("Perimeter Defense");
  assert.ok(interior.support?.some((dep) => dep.attr === "Strength"), "interior must depend on Strength");
  assert.ok(dunk.support?.some((dep) => dep.attr === "Vertical"), "dunk must depend on Vertical");
  assert.ok(perimeter.support?.some((dep) => dep.attr === "Speed"), "perimeter must depend on Speed");
  const oReb = profileForAttribute("Offensive Rebound");
  const dReb = profileForAttribute("Defensive Rebound");
  assert.ok(oReb.support?.some((dep) => dep.attr === "Vertical" && dep.weight >= 0.6), "OReb must weight Vertical heavily");
  assert.ok(dReb.support?.some((dep) => dep.attr === "Strength" && dep.weight >= 0.6), "DReb must weight Strength heavily");
}

// 10. sensitivity 与 H/W weight 必须真正影响结构惩罚
{
  const targetBody = target(180, 82);
  const sourceBody: SourceBody = { height: 220, weight: 120, wingspan: 230 };
  const opts = { targetPosition: "PG" as const, sourcePosition: "C" as const };
  const blockProfile = bodyTransferProfiles.block;
  const originalSensitivity = blockProfile.sensitivity;
  const originalHWeight = blockProfile.height.weight;
  try {
    const baseline = applyBodyConstraints({ Block: 95 }, targetBody, sourceBody, opts).values.Block;
    blockProfile.sensitivity = originalSensitivity * 0.5;
    const halfSensitivity = applyBodyConstraints({ Block: 95 }, targetBody, sourceBody, opts).values.Block;
    assert.ok(halfSensitivity > baseline, "halving sensitivity must reduce the structural penalty");
    blockProfile.sensitivity = originalSensitivity;
    blockProfile.height.weight = 0.1;
    blockProfile.weight.weight = 0.9;
    const reweighted = applyBodyConstraints({ Block: 95 }, targetBody, sourceBody, opts).values.Block;
    assert.notEqual(reweighted, baseline, "changing H/W weights must change the output");
  } finally {
    blockProfile.sensitivity = originalSensitivity;
    blockProfile.height.weight = originalHWeight;
    blockProfile.weight.weight = 1 - originalHWeight;
  }
  // 恢复后行为不变
  assert.equal(
    applyBodyConstraints({ Block: 95 }, targetBody, sourceBody, opts).values.Block,
    42,
    "restored profile must still land the 42 fixture",
  );
}

// 11. 来源容量豁免：目标身体不低于来源时，同体型高值不被目标 cap 压低
{
  const sameBodyTarget = target(200, 100);
  const sameBodySource: SourceBody = { height: 200, weight: 100, wingspan: 210 };
  const result = applyBodyConstraints({ Block: 95 }, sameBodyTarget, sameBodySource, {
    targetPosition: "PG", secondaryPosition: "SG", sourcePosition: "C",
  });
  assert.equal(result.values.Block, 95, "same-body high block must survive (capacity exemption, not cap 88)");
  // 目标明显更矮时仍受 cap 约束
  const shorterTarget = applyBodyConstraints({ Block: 95 }, target(180, 82), sameBodySource, {
    targetPosition: "PG", sourcePosition: "C",
  });
  assert.ok(shorterTarget.values.Block <= 77, "shorter target must still be capped");
}
