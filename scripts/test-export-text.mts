#!/usr/bin/env -S node --experimental-strip-types
/**
 * Export-text contract tests (public-beta audit 2026-08-11):
 *   1. self-pick mode with card pseudo-sources: [模板] must resolve names
 *      (never "--") — previously only playersById was passed.
 *   2. single-card build: primary record uses the GENERATED name/body, the
 *      card's raw vitals live in a separate [来源卡资料] appendix.
 *   3. mixed custom + player locks: manual slots read "手动设置".
 *   4. copy text and download text come from the same builder (single source).
 */
import assert from "node:assert/strict";
import { createExportText, type TendencyLoadState } from "../src/exportText.ts";
import { bundles, type createResult, type Evaluation, type LockState } from "../src/createResult.ts";
import type { PlayerSource } from "../src/domain.ts";

const tendencyState: TendencyLoadState = "ready";

function makeSource(id: string, name: string): PlayerSource {
  return {
    id,
    name,
    slug: id,
    rosterCategory: "current",
    rosterTeam: "Test",
    isEstimated: false,
    badges: [],
    badgesKnown: true,
    overall: 80,
    potential: 85,
    team: "Test",
    position: "SG",
    archetype: null,
    height: "6'6\"",
    weight: 95,
    wingspan: "6'9\"",
    shooting: 80, athleticism: 80, playmaking: 80, defense: 80, inside: 80,
    detailed: {},
  };
}

function makeResult(overrides: Partial<ReturnType<typeof createResult>> = {}): ReturnType<typeof createResult> {
  const initialAttrs: Record<string, number> = {
    "Close Shot": 85, "Mid-Range Shot": 82, "Three-Point Shot": 78, "Free Throw": 80,
    "Offensive Consistency": 81, "Shot IQ": 79, Speed: 86, Strength: 74, Agility: 84,
    Vertical: 82, Hustle: 88, Stamina: 90, "Overall Durability": 85, "Ball Handle": 80,
    "Speed with Ball": 78, "Pass Accuracy": 79, "Pass Vision": 76, "Pass IQ": 80,
    Block: 75, Steal: 78, "Pass Perception": 77, "Interior Defense": 70,
    "Perimeter Defense": 79, "Defensive Consistency": 76, "Help Defense IQ": 75,
    Layup: 84, "Driving Dunk": 80, "Standing Dunk": 74, "Post Hook": 68, "Post Fade": 65,
    "Post Control": 70, "Draw Foul": 82, Hands: 83, "Offensive Rebound": 72,
    "Defensive Rebound": 78, Intangibles: 50, Potential: 92,
    "Head Durability": 82, "Neck Durability": 83, "Back Durability": 84,
    "Left Shoulder Durability": 82, "Right Shoulder Durability": 83,
    "Left Elbow Durability": 84, "Right Elbow Durability": 83,
    "Left Hip Durability": 82, "Right Hip Durability": 83,
    "Left Knee Durability": 81, "Right Knee Durability": 82,
    "Left Ankle Durability": 80, "Right Ankle Durability": 81,
    "Left Foot Durability": 82, "Right Foot Durability": 83,
  };
  return {
    age: 19,
    position: "SG",
    secondary: "SF",
    hand: "右手",
    dunkHand: "右手",
    height: 193, weight: 90, wingspan: 49, shoulder: 49, neck: 50, torso: 50,
    potential: 92, potentialMin: 87, potentialMax: 97,
    growthGap: 12, progressSpeed: 3.1, boom: 40, normal: 35, bust: 25,
    peakStart: 24, peakEnd: 31,
    peakOverall: 88, peakAttrs: { ...initialAttrs },
    initialAttrs,
    initialStrength: 82,
    baseOverall: 82,
    overallMean: 76,
    intangibles: 50,
    peakBadges: [], badges: [],
    card: null,
    initialOverallTarget: 82,
    initialOverallConstraintApplied: false,
    initialOverallConstraintReachable: true,
    badgesEstimated: true,
    rookieTier: "Star",
    hotZones: { underBasket: "Hot", midLeft: "Neutral", threeCenter: "Cold" },
    tendencies: { "Spot Up Three": 80, "Drive to Basket": 70 },
    ...overrides,
  } as unknown as ReturnType<typeof createResult>;
}

function allPlayerLock(playerId: string): LockState {
  return Object.fromEntries(bundles.map((b) => [b.id, { kind: "player", playerId } as const]));
}

const evaluations: Record<string, Evaluation> = Object.fromEntries(
  bundles.map((bundle, index) => [bundle.id, {
    raw: 80,
    adjusted: 75 + (index % 4),
    bodyAdjustment: -5 + (index % 4),
    bodyAdjustments: {},
    bodyCaps: {},
    values: Object.fromEntries(bundle.attrs.map((attr) => [attr, 75 + (index % 4)])),
  } as Evaluation]),
);
const cardVitals = {
  firstName: "Zion", lastName: "Williamson", nickname: "Zanos",
  jerseyNumber: 1, birthYear: 2000, birthMonth: 7, birthDay: 6,
  dominantHand: "Right", dominantDunkHand: "Right", yearsPro: 1,
  peakStartAge: 26, peakEndAge: 32,
  heightInches: 78, weightLb: 285, wingspanCm: 211,
  shoulderLength: 55, neckLength: 50, trunkLength: 52,
  playType1: "Slash", playType2: "Post", playType3: "Mid", playType4: "Three",
  playInitiator: false, forceNonStarter: "No",
  playForWinner: 80, financialSecurity: 60, loyalty: 70,
  boomPercent: 50, averagePercent: 30, bustPercent: 50,
};

const zionCard = {
  slug: "zion-williamson",
  year: 2019,
  name: "Zion Williamson",
  position: "PF",
  overall: 79,
  height: 78,
  detailed: { "Close Shot": 85, Intangibles: 50 },
  tendencies: {},
  badges: [],
  personalityBadges: [{ name: "flashy", tier: "Silver" }],
  potential: { current: 94, min: 90, max: 99 },
  dataQuality: null,
  vitals: cardVitals,
  durability: { "Overall Durability": 85 },
  hotZones: { underBasket: "Hot" },
} as const;

const cardResult = makeResult({
  card: zionCard as unknown as NonNullable<ReturnType<typeof createResult>["card"]>,
  hand: "右手",
  dunkHand: "右手",
  height: 201, weight: 100, wingspan: 55, shoulder: 54, neck: 51, torso: 54,
  intangibles: 50,
});

// ---- 1. self-pick card pseudo-sources must resolve in [模板] ----
{
  const sources = new Map<string, PlayerSource>([
    ["player:1", makeSource("player:1", "Ja Morant")],
    ["card:zion-williamson", makeSource("card:zion-williamson", "Zion Williamson")],
  ]);
  const locks: LockState = {};
  bundles.forEach((bundle, index) => {
    locks[bundle.id] = { kind: "player", playerId: index % 2 === 0 ? "card:zion-williamson" : "player:1" };
  });
  const text = createExportText("测试新秀", cardResult, locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  const templateSection = text.split("[模板]")[1].split("[生成履历]")[0];
  assert.ok(!templateSection.includes("--"), "self-pick card sources must resolve (no -- in templates)");
  assert.ok(templateSection.includes("锡安·威廉姆森"), "card pseudo-source name must appear");
  assert.ok(templateSection.includes("贾·莫兰特"), "roster source name must appear");
  // primary record: generated name/body, not card identity
  assert.ok(text.includes("姓名: 测试新秀"), "primary record must carry the generated name");
  assert.ok(text.includes("身高: 201 cm"), "primary record body must be the generated height");
  assert.ok(!text.split("[来源卡资料]")[0].includes("Zanos"), "card nickname must not leak into the primary record");
}

// ---- 2. single-card build: appendix carries card vitals, primary is generated ----
{
  const sources = new Map<string, PlayerSource>([["card:zion-williamson", makeSource("card:zion-williamson", "Zion Williamson")]]);
  const text = createExportText("生成新秀甲", cardResult, allPlayerLock("card:zion-williamson"), evaluations, sources, tendencyState, "NBA 2K26 数据");
  assert.ok(text.includes("[来源卡资料]"), "single-card build must include the appendix");
  const appendix = text.split("[来源卡资料]")[1];
  assert.ok(appendix.includes("Zion Williamson"), "appendix names the source card");
  assert.ok(appendix.includes("身高: 198 cm"), "appendix shows the card's raw height (78in -> 198cm)");
  assert.ok(appendix.includes("名字: Zion"), "appendix keeps card name fields");
  assert.ok(appendix.includes("成长概率: 50%"), "appendix keeps card growth params");
  // primary record must not reuse card identity
  const primary = text.split("[来源卡资料]")[0];
  assert.ok(primary.includes("姓名: 生成新秀甲"), "primary name is the generated one");
  assert.ok(primary.includes("身高: 201 cm"), "primary body is the generated body");
}

// ---- 3. mixed custom + player locks ----
{
  const sources = new Map<string, PlayerSource>([["player:1", makeSource("player:1", "Luka Doncic")]]);
  const locks: LockState = {};
  bundles.forEach((bundle, index) => {
    if (index === 0) {
      locks[bundle.id] = { kind: "custom", values: Object.fromEntries(bundle.attrs.map((a) => [a, 90])) };
    } else {
      locks[bundle.id] = { kind: "player", playerId: "player:1" };
    }
  });
  const text = createExportText("混合新秀", makeResult(), locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  assert.ok(text.includes("手动设置"), "custom slot must read 手动设置");
  assert.ok(text.includes("卢卡·东契奇"), "player slot resolves");
  assert.ok(!text.split("[模板]")[1].includes("--"), "no unresolved templates");
}

// ---- 4. copy and download use the same builder output ----
{
  const sources = new Map<string, PlayerSource>([["player:1", makeSource("player:1", "Luka Doncic")]]);
  const locks: LockState = allPlayerLock("player:1");
  const first = createExportText("一致性新秀", makeResult(), locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  const second = createExportText("一致性新秀", makeResult(), locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  assert.equal(first, second, "copy text and download text must be byte-identical");
}

// ---- 5. all 16 templates resolve (manual or named) ----
{
  const sources = new Map<string, PlayerSource>([["player:1", makeSource("player:1", "Anthony Edwards")]]);
  const locks: LockState = allPlayerLock("player:1");
  const text = createExportText("全模板", makeResult(), locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  const templateSection = text.split("[模板]")[1].split("[生成履历]")[0];
  const lines = templateSection.trim().split("\n");
  assert.equal(lines.length, bundles.length, "one template line per bundle");
  for (const line of lines) {
    assert.ok(!line.includes(": --"), `unresolved template: ${line}`);
  }
}

// ---- 6. [生成履历] ledger: one line per locked slot with raw → adjusted ----
{
  const sources = new Map<string, PlayerSource>([["player:1", makeSource("player:1", "Anthony Edwards")]]);
  const locks: LockState = allPlayerLock("player:1");
  const text = createExportText("履历新秀", makeResult(), locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  const ledger = text.split("[生成履历]")[1]?.split("[来源卡资料]")[0] ?? "";
  const lines = ledger.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, bundles.length, "one ledger line per locked bundle");
  for (const line of lines) {
    assert.ok(line.includes("｜"), `ledger line uses separator: ${line}`);
    assert.ok(line.includes("→"), `ledger line has raw→adjusted: ${line}`);
  }
  assert.ok(ledger.includes("安东尼·爱德华兹"), "ledger names the source player (Chinese)");
  assert.ok(ledger.includes("Test"), "ledger shows the source team");
}

// ---- 7. mixed custom + player ledger lines ----
{
  const sources = new Map<string, PlayerSource>([["player:1", makeSource("player:1", "Luka Doncic")]]);
  const locks: LockState = {};
  bundles.forEach((bundle, index) => {
    if (index === 0) {
      locks[bundle.id] = { kind: "custom", values: Object.fromEntries(bundle.attrs.map((a) => [a, 90])) };
    } else {
      locks[bundle.id] = { kind: "player", playerId: "player:1" };
    }
  });
  const text = createExportText("混合履历", makeResult(), locks, evaluations, sources, tendencyState, "NBA 2K26 数据");
  const ledger = text.split("[生成履历]")[1]?.split("[来源卡资料]")[0] ?? "";
  assert.ok(ledger.includes("手动设置"), "custom slot ledger line reads 手动设置");
  assert.ok(ledger.includes("卢卡·东契奇"), "player slot ledger line resolves the name");
}

console.log("✅ test-export-text: self-pick resolution, appendix split, custom slots, identical copy/download, 16 templates, ledger all pass");
