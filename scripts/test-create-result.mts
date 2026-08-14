#!/usr/bin/env -S node --experimental-strip-types
/**
 * Production-path integration tests for src/createResult.ts.
 *
 * These exercise the REAL combination pipeline (16 slot locks + body + age +
 * rookie cards + badges + OVR) with REAL versioned data, covering regressions
 * that unit-level helper tests cannot see:
 *   1. singleCard OVR must require EVERY non-potential slot on the same card
 *   2. a card used only for the potential slot must not hijack OVR/full record
 *   3. manually locked Overall Durability must survive generation
 *   4. source body data must actually flow into body-mismatch adjustments
 */
import assert from "node:assert/strict";
import {
  bodyBases,
  bundles,
  cardSourceBody,
  createResult,
  evaluate,
  evaluateAll,
  evaluateAllPreview,
  type LockState,
  type Position,
  type SlotInput,
} from "../src/createResult.ts";
import { createRookieCardLookup, loadRookieCards, lookupRookieCard } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };

type CatalogPlayer = {
  id: string;
  name: string;
  position: string | null;
  height: string | null;
  overall: number | null;
  potential?: number | null;
};
type CatalogTeam = { id: string; name: string; category: string; players: CatalogPlayer[] };
type DetailedPlayer = {
  slug: string;
  potential?: number | null;
  height?: string | null;
  weight?: number | null;
  wingspan?: string | null;
  shooting: number | null;
  athleticism: number | null;
  playmaking: number | null;
  defense: number | null;
  inside: number | null;
  detailed: Record<string, number | null>;
};

const detailedBySlug = new Map<string, DetailedPlayer>(
  (players26 as DetailedPlayer[]).map((player) => [player.slug, player]),
);

function buildSource(player: CatalogPlayer): PlayerSource {
  const detailed = detailedBySlug.get(player.id);
  return {
    id: `test:${player.id}`,
    name: player.name,
    slug: player.id,
    rosterCategory: "current",
    rosterTeam: "Test",
    isEstimated: !detailed,
    badges: (badges26 as Record<string, PlayerSource["badges"]>)[player.id] ?? [],
    badgesKnown: Object.hasOwn(badges26 as Record<string, unknown>, player.id),
    overall: player.overall ?? 72,
    potential: player.potential ?? detailed?.potential ?? null,
    team: "Test",
    position: player.position,
    archetype: null,
    height: player.height ?? detailed?.height ?? null,
    weight: detailed?.weight ?? null,
    wingspan: detailed?.wingspan ?? null,
    shooting: detailed?.shooting ?? 60,
    athleticism: detailed?.athleticism ?? 60,
    playmaking: detailed?.playmaking ?? 60,
    defense: detailed?.defense ?? 60,
    inside: detailed?.inside ?? 60,
    detailed: detailed?.detailed ?? {},
  };
}

const currentPlayers: CatalogPlayer[] = (roster26 as { teams: CatalogTeam[] }).teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players);
const players = new Map<string, PlayerSource>(currentPlayers.map((player) => [
  `test:${player.id}`,
  buildSource(player),
]));

const luka = players.get("test:luka-doncic");
assert.ok(luka, "Luka Doncic must exist in the 2K26 roster");
assert.ok(luka.id, "Luka source must carry an id");
const lukaId: string = luka.id;
const wemby = players.get("test:victor-wembanyama");
assert.ok(wemby, "Victor Wembanyama must exist in the 2K26 roster");
assert.ok(wemby.id, "Wembanyama source must carry an id");
const wembyId: string = wemby.id;

// Find a current player WITHOUT a rookie card for the negative cases.
// Prefer a player with real detailed attributes: an estimated-only player
// (all-70 fallback) can make the 12×95 + 3×player mixed build land BELOW the
// potential/age target, which would skip the constraint and fail test 2b.
const cards = await loadRookieCards();
const cardless = currentPlayers.find(
  (player) => !lookupRookieCard(cards, player.name) && detailedBySlug.has(player.id),
) ?? currentPlayers.find((player) => !lookupRookieCard(cards, player.name));
assert.ok(cardless, "expected at least one current player without a rookie card");
const cardlessSource = players.get(`test:${cardless.id}`);
assert.ok(cardlessSource, "cardless source must exist");
assert.ok(cardlessSource.id, "cardless source must carry an id");
const cardlessId: string = cardlessSource.id;

const tendencyLookup = createTendencyLookup(tendencies26 as TendencyTable);
const body = bodyBases.PG;
const position: Position = "PG";
const secondary: Position = "SG";
const age = 19;
const lukaCard = cards.get("luka doncic");
assert.ok(lukaCard, "Luka rookie card must exist in the split index");
assert.equal(typeof lukaCard.overall, "number", "Luka rookie card must carry a UI-confirmed overall");
const lukaCardOverall = lukaCard.overall as number;

function playerLock(playerId: string): LockState {
  return Object.fromEntries(bundles.map((bundle) => [bundle.id, { kind: "player", playerId } as const]));
}

function customLockFor(bundleId: string, values: Record<string, number>): LockState {
  return { [bundleId]: { kind: "custom", values } };
}

// --- 1. singleCard: keep card identity, but OVR follows final generated attrs ---
{
  const result = createResult(playerLock(wembyId), age, position, secondary, body, players, tendencyLookup, "2k26", cards);
  assert.ok(result.card, "all-Wembanyama lock must resolve a single rookie card");
  assert.equal(result.card.slug, "victor-wembanyama");
  assert.equal(result.card.year, 2023);
  assert.notEqual(
    result.baseOverall,
    result.card.overall,
    "single-card builds with a changed target body must not reuse the official card OVR",
  );
  assert.equal(result.initialStrength, result.baseOverall);
}

// --- 2. potential-only card must NOT hijack OVR or the full record ---
{
  const locks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === "potential") {
      locks[bundle.id] = { kind: "player", playerId: luka.id };
      continue;
    }
    locks[bundle.id] = {
      kind: "custom",
      values: Object.fromEntries(bundle.attrs.map((attr) => [attr, 70])),
    };
  }
  const result = createResult(locks, age, position, secondary, body, players, tendencyLookup, "2k26", cards);
  assert.equal(result.card, null, "a card used only for potential must not become the build's card");
  assert.notEqual(result.baseOverall, lukaCardOverall, "model estimate must stand in; card OVR must not leak through");
  assert.equal(result.initialStrength, result.baseOverall);
}

// --- 2b. rookie initial OVR constraint must lower over-target mixed builds ---
// (All-custom locks are hard locks by design; the constraint only adjusts
// player slots whose values are not card-locked.)
{
  const locks: LockState = {};
  const customSlots = new Set(["three", "mid", "face", "post", "dunk", "handle", "passing", "perimeter", "interior", "steal", "block", "rebound"]);
  for (const bundle of bundles) {
    if (bundle.id === "potential") {
      locks[bundle.id] = { kind: "player", playerId: lukaId };
      continue;
    }
    if (customSlots.has(bundle.id)) {
      locks[bundle.id] = {
        kind: "custom",
        values: Object.fromEntries(bundle.attrs.map((attr) => [attr, 99])),
      };
      continue;
    }
    locks[bundle.id] = { kind: "player", playerId: cardlessId };
  }
  const result = createResult(locks, age, position, secondary, body, players, tendencyLookup, "2k26", cards);
  assert.equal(result.card, null);
  assert.ok(result.initialOverallConstraintApplied, "over-target mixed build must be lowered to the potential/age target");
  if (result.initialOverallConstraintReachable) {
    assert.ok(result.initialStrength <= result.initialOverallTarget, "reachable constrained OVR must not exceed the target");
  } else {
    assert.ok(result.initialStrength > result.initialOverallTarget, "unreachable constrained OVR must be explicitly reported");
  }
}

// --- 3. manually locked Overall Durability is a hard lock ---
{
  const locks: LockState = {};
  for (const bundle of bundles) {
    locks[bundle.id] = {
      kind: "custom",
      values: Object.fromEntries(bundle.attrs.map((attr) => [
        attr,
        attr === "Overall Durability" ? 99 : 70,
      ])),
    };
  }
  const result = createResult(locks, age, position, secondary, body, players, tendencyLookup, "2k26", cards);
  assert.equal(result.initialAttrs["Overall Durability"], 99, "manual durability lock must survive generation");
}

// --- 4. source body data flows into V2 body constraints (donor-expanded threshold) ---
{
  const post = bundles.find((bundle) => bundle.id === "post");
  assert.ok(post);
  const target: typeof body = { height: 180, weight: 79, wingspan: 50, shoulder: 50, neck: 50, torso: 50 };
  // Post Hook donor-expanded MIN: base 198, donor 190.5cm → effective 190.5,
  // target 180 → violation 10.5 → severity ~0.624 → ceiling ~86.52 → final 87.
  const smallSource: PlayerSource = {
    ...cardlessSource,
    height: "6'3\"",
    weight: 195,
    wingspan: "6'7\"",
    detailed: { ...cardlessSource.detailed, "Post Hook": 99 },
  };
  const withBody = evaluate(smallSource, post, target);
  assert.notEqual(withBody.values["Post Hook"], 99, "real donor body must expand the structural threshold");
  assert.equal(withBody.values["Post Hook"], 87, "Post Hook donor-expanded (190.5cm) on 180cm target must resolve to 87");
  // Without body fields the source body resolves to null → base threshold 198
  // (no donor expansion) → violation 18 → severity 1 → ceiling 79.
  const noBodySource: PlayerSource = { ...smallSource, weight: null, wingspan: null };
  const withoutBody = evaluate(noBodySource, post, target);
  assert.equal(withoutBody.values["Post Hook"], 79, "missing donor body must fall back to base threshold (198 → 79)");
  assert.notEqual(withoutBody.values["Post Hook"], withBody.values["Post Hook"],
    "donor body presence must change the V2 structural result");
}

// --- 5. every locked non-potential player resolves an evaluation (full lock sanity) ---
{
  const result = createResult(playerLock(lukaId), age, position, secondary, body, players, tendencyLookup, "2k26", cards);
  for (const attr of ["Three-Point Shot", "Mid-Range Shot", "Ball Handle"]) {
    assert(typeof result.initialAttrs[attr] === "number", `${attr} must be a number`);
  }
}

// --- 6. card badges carry categories so the joint OVR model prices them ---
{
  const result = createResult(playerLock(lukaId), age, position, secondary, body, players, tendencyLookup, "2k26", cards);
  const modelCategories = new Set(["shooting", "playmaking", "inside", "defense", "rebounding", "athleticism"]);
  assert(result.badges.length > 0, "Luka's rookie card must contribute badges");
  for (const badge of result.badges) {
    assert(
      badge.category !== undefined && modelCategories.has(badge.category),
      `${badge.name} must carry an OVR-model category (got ${badge.category})`,
    );
  }
}

console.log("createResult production-path OK: single-card OVR, potential-only card isolation, durability lock, body wiring");

// --- 13. rookie card 槽位：最终 initialAttrs 与 card-aware 预览完全一致 ---
{
  const wemby = currentPlayers.find((player) => player.name.includes("Wembanyama"));
  assert.ok(wemby, "expected Wemby in the current roster");
  const wembySource = players.get(`test:${wemby.id}`);
  assert.ok(wembySource, "Wemby source must resolve");
  assert.ok(wembySource.id, "Wemby source must carry an id");
  const wembyId: string = wembySource.id as string;
  const wembyCard = lookupRookieCard(cards, wemby.name);
  assert.ok(wembyCard, "Wemby rookie card must resolve");
  const block = bundles.find((bundle) => bundle.id === "block");
  const athletic = bundles.find((bundle) => bundle.id === "athletic");
  const strength = bundles.find((bundle) => bundle.id === "strength");
  assert.ok(block && athletic && strength);
  const pgBody: typeof body = { height: 180, weight: 82, wingspan: 46, shoulder: 46, neck: 50, torso: 48 };
  // UI 预览路径（card-aware，两阶段）
  const preview = evaluateAll([
    { bundle: block, player: wembySource, card: wembyCard },
    { bundle: athletic, player: wembySource, card: wembyCard },
    { bundle: strength, player: wembySource, card: wembyCard },
  ], pgBody, { targetPosition: "PG", secondaryPosition: "SG" });
  const previewBlock = preview.block?.values.Block;
  assert.equal(typeof previewBlock, "number", "preview block must resolve");
  // 最终生成路径（rookie 模式，全部槽位锁定 Wemby）
  const result = createResult(playerLock(wembyId), age, position, secondary, pgBody, players, tendencyLookup, "2k26", cards);
  assert.equal(
    result.initialAttrs.Block,
    previewBlock,
    "final initialAttrs.Block must equal the card-aware preview (no 37-vs-77 divergence)",
  );
}

// --- 14. 支持依赖 strict：来源缺失真实 Strength → 不扣分并标记 supportIncomplete ---
{
  const interior = bundles.find((bundle) => bundle.id === "interior");
  const strength = bundles.find((bundle) => bundle.id === "strength");
  assert.ok(interior && strength);
  const { Strength: _omitted, ...detailedWithoutStrength } = luka.detailed;
  const noStrengthSource: PlayerSource = { ...luka, detailed: detailedWithoutStrength };
  const baseBody = bodyBases.PG;
  const out = evaluateAll([
    { bundle: interior, player: noStrengthSource },
    { bundle: strength, player: null, customValues: { Strength: 40 } },
  ], baseBody, { targetPosition: "PG", secondaryPosition: "SG" });
  assert.ok(out.interior, "interior evaluation must resolve");
  assert.ok(out.interior.supportIncomplete, "missing source Strength must be reported");
  assert.ok(out.interior.supportIncomplete?.missing.includes("Strength"), "missing list must name Strength");
  assert.deepEqual(out.interior.supportAdjustments ?? {}, {}, "no fabricated support cut without observed Strength");
}

// --- 15. cardSourceBody 单位换算（英寸→cm、磅→kg） ---
{
  const wemby = currentPlayers.find((player) => player.name.includes("Wembanyama"));
  assert.ok(wemby);
  const wembyCard = lookupRookieCard(cards, wemby.name);
  assert.ok(wembyCard);
  const body = cardSourceBody(wembyCard);
  assert.ok(body, "card vitals must yield a source body");
  assert.ok(body.height > 210 && body.height < 235, `height must be cm (got ${body.height})`);
  assert.ok(body.weight > 85 && body.weight < 125, `weight must be kg (got ${body.weight})`);
  assert.ok(body.wingspan > 200, `wingspan must be cm (got ${body.wingspan})`);
}

// --- 12. attrToSlot 与 bundles 定义保持一致（防止手写映射漂移） ---
{
  const { attrToSlot, bodyTransferProfiles } = await import("../src/rookieBodyProfiles.ts");
  for (const bundle of bundles) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(bodyTransferProfiles, bundle.id),
      `every bundle must have a body transfer profile: ${bundle.id}`,
    );
    for (const attr of bundle.attrs) {
      assert.equal(
        attrToSlot[attr],
        bundle.id,
        `${attr} must map to its own bundle ${bundle.id} in attrToSlot`,
      );
    }
  }
  const mappedAttrs = new Set(Object.keys(attrToSlot));
  for (const bundle of bundles) {
    for (const attr of bundle.attrs) {
      assert.ok(mappedAttrs.has(attr), `${attr} must exist in attrToSlot`);
    }
  }
}

// ============ 新功能：两阶段评估 + 位置交叉 + 支持依赖 ============

// --- 7. 位置交叉：同一来源/目标身材，目标主位置 C→PG 时 Block 单调不增 ---
{
  const block = bundles.find((bundle) => bundle.id === "block");
  assert.ok(block);
  const bigTarget: typeof body = { height: 205, weight: 105, wingspan: 55, shoulder: 55, neck: 50, torso: 50 };
  const asCenter = evaluate(luka, block, bigTarget, null, { targetPosition: "C", secondaryPosition: "PF" });
  const asGuard = evaluate(luka, block, bigTarget, null, { targetPosition: "PG", secondaryPosition: "SG" });
  assert.ok(asGuard.positionDistance !== null && asCenter.positionDistance !== null, "position distance must resolve");
  assert.ok(asCenter.positionDistance! > asGuard.positionDistance!, "C target must be farther from Luka (PG) than PG target");
  assert.ok(asGuard.values.Block >= asCenter.values.Block, "far position must not produce a higher Block than a close position");
}

// --- 8. V2 support：目标 Final Strength 低 → Interior Defense support ceiling 被压低 ---
{
  const interior = bundles.find((bundle) => bundle.id === "interior");
  const strength = bundles.find((bundle) => bundle.id === "strength");
  assert.ok(interior && strength);
  const baseBody = bodyBases.PG;
  const withLowStrength = evaluateAll([
    { bundle: interior, player: luka },
    { bundle: strength, player: null, customValues: { Strength: 40 } },
  ], baseBody, { targetPosition: "PG", secondaryPosition: "SG" });
  const withoutStrengthSlot = evaluateAll([
    { bundle: interior, player: luka },
  ], baseBody, { targetPosition: "PG", secondaryPosition: "SG" });
  // V2：target Final Strength 参与 support ceiling（req 65 − donor exception）。
  // Strength 槽缺失 → target support 缺失 → 该 dependency 跳过（不猜）。
  const capWith = withLowStrength.interior?.bodyCaps["Interior Defense"];
  const capWithout = withoutStrengthSlot.interior?.bodyCaps["Interior Defense"];
  assert.ok(typeof capWith === "number", "low target strength must lower the V2 support ceiling");
  assert.ok(typeof capWithout === "number" && capWithout > capWith,
    "missing strength slot must leave a higher (or no) ceiling than a low one");
}

// --- 9. V2 position invariance：同一身体/来源，C↔PG 的 atomic 完全一致 ---
{
  const block = bundles.find((bundle) => bundle.id === "block");
  assert.ok(block);
  const bigTarget: typeof body = { height: 205, weight: 105, wingspan: 55, shoulder: 55, neck: 50, torso: 50 };
  const asCenter = evaluate(luka, block, bigTarget, null, { targetPosition: "C", secondaryPosition: "PF" });
  const asGuard = evaluate(luka, block, bigTarget, null, { targetPosition: "PG", secondaryPosition: "SG" });
  // V2：position 不进入 atomic evaluator → 值必须完全一致（V1 grace zone 已废弃）
  assert.equal(asGuard.values.Block, asCenter.values.Block, "position label must not change atomic Block");
  assert.equal(asGuard.usedGraceZone, false, "V2 has no grace zone");
}

// --- 10. V2 never buffs：所有槽位 final ≤ raw，且调整量与 values 自洽 ---
{
  const interior = bundles.find((bundle) => bundle.id === "interior");
  const strength = bundles.find((bundle) => bundle.id === "strength");
  assert.ok(interior && strength);
  const baseBody = bodyBases.PG;
  const out = evaluateAll([
    { bundle: interior, player: luka },
    { bundle: strength, player: null, customValues: { Strength: 40 } },
  ], baseBody, { targetPosition: "PG", secondaryPosition: "SG" });
  const evaluation = out.interior;
  assert.ok(evaluation);
  for (const attr of interior.attrs) {
    const raw = evaluation.values[attr] - evaluation.bodyAdjustments[attr];
    assert.ok(evaluation.values[attr] <= raw + 1e-9, `${attr} must never exceed its raw (no buff)`);
  }
}

// --- 11. evaluateAllPreview 与锁定后的 evaluateAll 完全一致 ---
{
  const interior = bundles.find((bundle) => bundle.id === "interior");
  const strength = bundles.find((bundle) => bundle.id === "strength");
  const block = bundles.find((bundle) => bundle.id === "block");
  assert.ok(interior && strength && block);
  const baseBody = bodyBases.PG;
  const currentInputs: SlotInput[] = [
    { bundle: strength, player: null, customValues: { Strength: 40 } },
  ];
  const candidate: SlotInput = { bundle: interior, player: luka };
  const preview = evaluateAllPreview(currentInputs, candidate, baseBody, {
    targetPosition: "PG", secondaryPosition: "SG",
  });
  assert.ok(preview, "preview must resolve");
  const locked = evaluateAll([...currentInputs, candidate], baseBody, {
    targetPosition: "PG", secondaryPosition: "SG",
  })[interior.id];
  assert.ok(locked);
  assert.deepEqual(preview.values, locked.values, "preview must equal the locked evaluation");
  assert.deepEqual(preview.supportAdjustments, locked.supportAdjustments, "preview support adjustments must match");
}

// --- 12. Intangibles Final Policy (Stage 6B) ---
// 优先级：custom explicit > single-card real > multi-donor neutral 50。
// Potential donor 继承已删除；不使用 Stability donor；不根据 morphology 生成。
{
  // 12a. single-card reproduction：所有非 potential 槽位同卡 → 继承卡真实 Intangibles
  // （policy 语义是「卡的 detailed.Intangibles」；luka 有 rookie 卡）
  const singleInt = (lukaCard as { detailed?: Record<string, number> }).detailed?.["Intangibles"];
  if (typeof singleInt === "number") {
    const locks: LockState = {};
    for (const bundle of bundles) {
      if (bundle.id === "potential") continue;
      locks[bundle.id] = { kind: "player", playerId: lukaId };
    }
    const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
    assert.equal(result.intangibles, singleInt,
      `single-card build must inherit real Intangibles (${singleInt}) from the card`);
  } else {
    console.warn("  (skip 12a: luka card lacks detailed Intangibles)");
  }

  // 12b. multi-donor synthetic：不同卡混合（无 custom、非 single-card）→ neutral 50
  const locks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === "three") locks[bundle.id] = { kind: "player", playerId: lukaId };
    else if (bundle.id === "mid") locks[bundle.id] = { kind: "player", playerId: cardlessId };
    else if (bundle.id === "potential") locks[bundle.id] = { kind: "player", playerId: lukaId };
    else locks[bundle.id] = { kind: "player", playerId: cardlessId };
  }
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  assert.equal(result.intangibles, 50,
    "multi-donor synthetic build must use neutral Intangibles = 50 (Potential donor inheritance removed)");

  // 12c. custom explicit 优先于一切（single-card 场景下仍生效）
  const customInt = 77;
  const customLocks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    customLocks[bundle.id] = { kind: "player", playerId: lukaId };
  }
  customLocks["passing"] = {
    kind: "custom",
    values: { "Intangibles": customInt },
  };
  const customResult = createResult(customLocks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  assert.equal(customResult.intangibles, customInt,
    "custom explicit Intangibles must win over single-card value");
}
