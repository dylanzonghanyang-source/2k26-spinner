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
  createResult,
  evaluate,
  type LockState,
  type Position,
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

// Find a current player WITHOUT a rookie card for the negative cases.
const cards = await loadRookieCards();
const cardless = currentPlayers.find((player) => !lookupRookieCard(cards, player.name));
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

// --- 1. singleCard: every non-potential slot on the same card -> card OVR ---
{
  const result = createResult(playerLock(lukaId), age, position, secondary, body, "rookie", players, tendencyLookup, "2k26", cards);
  assert.ok(result.card, "all-Luka lock must resolve a single rookie card");
  assert.equal(result.card.slug, "luka-doncic");
  assert.equal(result.card.year, 2018);
  assert.equal(
    result.baseOverall,
    result.card.overall,
    "official Luka rookie card OVR must be used (data-driven, currently user-confirmed 81)",
  );
  assert.equal(result.initialStrength, result.card.overall);
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
  const result = createResult(locks, age, position, secondary, body, "rookie", players, tendencyLookup, "2k26", cards);
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
        values: Object.fromEntries(bundle.attrs.map((attr) => [attr, 95])),
      };
      continue;
    }
    locks[bundle.id] = { kind: "player", playerId: cardlessId };
  }
  const result = createResult(locks, age, position, secondary, body, "rookie", players, tendencyLookup, "2k26", cards);
  assert.equal(result.card, null);
  assert.ok(result.initialOverallConstraintApplied, "over-target mixed build must be lowered to the potential/age target");
  assert.ok(result.initialStrength <= result.initialOverallTarget, "constrained OVR must not exceed the target");
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
  const result = createResult(locks, age, position, secondary, body, "rookie", players, tendencyLookup, "2k26", cards);
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
  const result = createResult(playerLock(lukaId), age, position, secondary, body, "rookie", players, tendencyLookup, "2k26", cards);
  for (const attr of ["Three-Point Shot", "Mid-Range Shot", "Ball Handle"]) {
    assert(typeof result.initialAttrs[attr] === "number", `${attr} must be a number`);
  }
}

// --- 6. card badges carry categories so the joint OVR model prices them ---
{
  const result = createResult(playerLock(lukaId), age, position, secondary, body, "rookie", players, tendencyLookup, "2k26", cards);
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
