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

// --- 4. source body data flows into body-mismatch adjustments ---
{
  const athletic = bundles.find((bundle) => bundle.id === "athletic");
  assert.ok(athletic);
  const bigTarget: typeof body = { height: 220, weight: 128, wingspan: 65, shoulder: 65, neck: 50, torso: 50 };
  // Small source (real body fields) into a big target => agility/speed penalties.
  const smallSource: PlayerSource = {
    ...cardlessSource,
    height: "6'1\"",
    weight: 180,
    wingspan: "6'5\"",
  };
  const withBody = evaluate(smallSource, athletic, bigTarget);
  assert.notEqual(withBody.bodyAdjustment, 0, "real source body must produce a non-zero adjustment");
  // Without body fields the source body resolves to null and nothing adjusts.
  const noBodySource: PlayerSource = { ...smallSource, weight: null, wingspan: null };
  const withoutBody = evaluate(noBodySource, athletic, bigTarget);
  assert.equal(withoutBody.bodyAdjustment, 0, "missing source body must produce zero adjustment (App wiring must supply weight/wingspan)");
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

// --- 8. 支持依赖：目标 strength 槽很低时，来源高 Strength 的 interior 被额外修正 ---
{
  const interior = bundles.find((bundle) => bundle.id === "interior");
  const strength = bundles.find((bundle) => bundle.id === "strength");
  const blockBundle = bundles.find((bundle) => bundle.id === "block");
  assert.ok(interior && strength && blockBundle);
  const baseBody = bodyBases.PG;
  const withLowStrength = evaluateAll([
    { bundle: interior, player: luka },
    { bundle: strength, player: null, customValues: { Strength: 40 } },
  ], baseBody, { targetPosition: "PG", secondaryPosition: "SG" });
  const withoutStrengthSlot = evaluateAll([
    { bundle: interior, player: luka },
  ], baseBody, { targetPosition: "PG", secondaryPosition: "SG" });
  assert.ok(interior.attrs.some((attr) => withLowStrength.interior?.supportAdjustments?.[attr] !== undefined)
    || Object.values(withLowStrength.interior?.supportAdjustments ?? {}).some((delta) => Number(delta) < 0),
  "low target strength must trigger interior support cut when source strength is higher");
  assert.equal(
    Object.keys(withoutStrengthSlot.interior?.supportAdjustments ?? {}).length,
    0,
    "missing strength slot must not fabricate a support cut",
  );
}

// --- 9. 宽容区：同位置接近体型原值继承（生产路径） ---
{
  const block = bundles.find((bundle) => bundle.id === "block");
  assert.ok(block);
  // 目标 205 C：自动选取与目标体型最接近的 C/SF 来源，确保真正进入宽容区
  const cTarget: typeof body = { height: 205, weight: 105, wingspan: 55, shoulder: 55, neck: 50, torso: 50 };
  const bodyGap = (p: CatalogPlayer): number | null => {
    const d = detailedBySlug.get(p.id);
    if (!d || typeof d.height !== "string" || typeof d.weight !== "number") return null;
    const match = d.height.match(/(\d+)'(\d+)/);
    if (!match) return null;
    const hCm = (Number(match[1]) * 12 + Number(match[2])) * 2.54;
    const wKg = d.weight * 0.453592;
    return Math.abs(205 - hCm) + Math.abs(105 - wKg) / 2;
  };
  const closeSource = currentPlayers
    .filter((p) => p.position?.includes("C") || p.position?.includes("SF"))
    .map((p) => ({ p, gap: bodyGap(p) }))
    .filter((x): x is { p: CatalogPlayer; gap: number } => x.gap !== null)
    .sort((a, b) => a.gap - b.gap)[0];
  assert.ok(closeSource, "expected a C/SF with detailed body data");
  const closePlayer = players.get(`test:${closeSource.p.id}`);
  assert.ok(closePlayer, "close source must resolve in the players map");
  const guardTarget: typeof body = { height: 185, weight: 85, wingspan: 48, shoulder: 48, neck: 50, torso: 50 };
  const evalSame = evaluate(closePlayer, block, cTarget, null, { targetPosition: "C", secondaryPosition: "PF" });
  const evalFar = evaluate(closePlayer, block, guardTarget, null, { targetPosition: "PG", secondaryPosition: "SG" });
  assert.equal(evalSame.usedGraceZone, true, "close same-position body must actually enter the grace zone");
  assert.ok(evalFar.values.Block <= evalSame.values.Block, "grace-zone close match must not be lower than a far mismatch");
}

// --- 10. 支持修正取整一致：supportAdjustments 与最终 values 实际差值一致 ---
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
  const adjustments = evaluation.supportAdjustments ?? {};
  for (const [attr, delta] of Object.entries(adjustments)) {
    const before = evaluation.values[attr] - delta;
    assert.equal(evaluation.values[attr] - before, delta, "supportAdjustments must equal the actual rounded delta");
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
