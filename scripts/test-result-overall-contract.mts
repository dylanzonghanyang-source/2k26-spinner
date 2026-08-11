#!/usr/bin/env -S node --experimental-strip-types
/**
 * OVR/attributes contract: the reported OVR (initialStrength/baseOverall) must
 * ALWAYS equal estimateGameOverall(final initialAttrs, position, badges,
 * overallMean, "rookie"). Regression for the audit finding where Intangibles
 * was written AFTER the OVR constraint (647/1190 cards disagreed; e.g. Mitch
 * Richmond showed 77 while final attributes recompute to 80).
 *
 * Scenarios:
 *   1. full scan: every rookie card whose player is in the 2K26 roster, built
 *      single-card (all slots on that player) with body constraint toggled.
 *   2. Mitch Richmond anchor (Intangibles 98).
 *   3. mixed multi-card build + custom-lock build.
 *   4. skipBody (body constraint off).
 */
import assert from "node:assert/strict";
import {
  bodyBases,
  bundles,
  createResult,
  type LockState,
  type Position,
} from "../src/createResult.ts";
import { estimateGameOverall } from "../src/rookieOverall.ts";
import { corePlayerName, loadRookieCards, lookupRookieCard } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };

type CatalogPlayer = { id: string; name: string; position: string | null; height: string | null; overall: number | null; potential?: number | null };
type CatalogTeam = { id: string; name: string; category: string; players: CatalogPlayer[] };
type DetailedPlayer = {
  slug: string; potential?: number | null; height?: string | null; weight?: number | null;
  wingspan?: string | null; shooting: number | null; athleticism: number | null;
  playmaking: number | null; defense: number | null; inside: number | null;
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

const cards = await loadRookieCards();
const tendencyLookup = createTendencyLookup(tendencies26 as TendencyTable);

function playerLock(playerId: string): LockState {
  return Object.fromEntries(bundles.map((bundle) => [bundle.id, { kind: "player", playerId } as const]));
}

function assertOverallContract(result: Awaited<ReturnType<typeof createResult>>, label: string) {
  const recomputed = estimateGameOverall(
    result.initialAttrs,
    result.position as Position,
    result.badges,
    result.overallMean,
    "rookie",
  );
  assert.equal(
    recomputed,
    result.initialStrength,
    `${label}: reported OVR (initialStrength) must match final attributes (got ${result.initialStrength}, recomputed ${recomputed})`,
  );
  assert.equal(
    result.baseOverall,
    result.initialStrength,
    `${label}: baseOverall must equal initialStrength`,
  );
  // The exported record must carry the same Intangibles that the OVR saw.
  assert.equal(
    result.initialAttrs.Intangibles,
    result.intangibles,
    `${label}: initialAttrs.Intangibles must equal the reported intangibles`,
  );
}

// ---- 1. full scan over every card whose player exists in the 2K26 roster ----
const bodyBasesArray = Object.values(bodyBases);
let scanned = 0;
let withCardLock = 0;
const missing: string[] = [];
for (const [key, card] of cards) {
  void key;
  const source = [...players.values()].find((p) => corePlayerName(p.name) === corePlayerName(card.name));
  if (!source) {
    missing.push(card.name);
    continue;
  }
  const body = bodyBasesArray[scanned % bodyBasesArray.length];
  const position = (["PG", "SG", "SF", "PF", "C"] as Position[])[scanned % 5];
  const secondary = position === "C" ? "PF" : (["PG", "SG", "SF", "PF", "C"] as Position[])[(scanned + 1) % 5];
  const skipBody = scanned % 2 === 1;
  const result = createResult(playerLock(source.id!), 19, position, secondary, body, players, tendencyLookup, "2k26", cards, { skipBody });
  assertOverallContract(result, `${card.name} single-card scan`);
  if (lookupRookieCard(cards, source.name)) withCardLock++;
  scanned++;
}
assert.ok(scanned >= 450, `expected >=450 scanned single-card builds, saw ${scanned}`);
console.log(`full scan: ${scanned} single-card builds, ${withCardLock} with rookie-card locks, ${missing.length} cards without a 2K26 roster player (skipped)`);

// ---- 2. high-Intangibles anchor (audit case: Mitch Richmond 98; find a
// current-roster card with Intangibles >= 90 and verify inheritance) ----
{
  const high = [...players.values()].find((p) => {
    const card = lookupRookieCard(cards, p.name);
    return card && typeof card.detailed?.Intangibles === "number" && card.detailed.Intangibles >= 90;
  });
  assert.ok(high, "expected a 2K26-roster card with Intangibles >= 90");
  const highCard = lookupRookieCard(cards, high.name);
  assert.ok(highCard, "high-Intangibles card must resolve");
  const expected = highCard.detailed?.Intangibles;
  assert.ok(typeof expected === "number" && expected >= 90, "anchor card must carry Intangibles >= 90");
  const result = createResult(playerLock(high.id!), 21, "SG", "SF", bodyBases.SG, players, tendencyLookup, "2k26", cards);
  assertOverallContract(result, `${high.name} high-Intangibles`);
  assert.equal(result.intangibles, expected, `${high.name} must inherit Intangibles ${expected} from card`);
  assert.equal(result.initialAttrs.Intangibles, expected, "final attributes must keep the inherited Intangibles");
  console.log(`high-Intangibles anchor: ${high.name} (Intangibles ${expected}) — audit case Richmond 98 reproduced`);
}

// ---- 2b. no-card build falls back to Intangibles 50 ----
{
  const cardless = [...players.values()].find((p) => !lookupRookieCard(cards, p.name));
  assert.ok(cardless, "expected a roster player without a rookie card");
  const result = createResult(playerLock(cardless.id!), 19, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  assertOverallContract(result, `${cardless.name} no-card`);
  assert.equal(result.intangibles, 50, "no-card build must fall back to Intangibles 50");
}

// ---- 3. mixed multi-card build ----
{
  const sources = [...players.values()].filter((p) => lookupRookieCard(cards, p.name)).slice(0, 16);
  assert.ok(sources.length >= 16, "need >=16 carded players for the multi-card build");
  const locks: LockState = {};
  bundles.forEach((bundle, index) => {
    locks[bundle.id] = { kind: "player", playerId: sources[index % sources.length].id! };
  });
  const result = createResult(locks, 20, "SF", "PF", bodyBases.SF, players, tendencyLookup, "2k26", cards);
  assertOverallContract(result, "mixed multi-card");
}

// ---- 4. custom-lock build (hard locks, no cards) ----
{
  const locks: LockState = {};
  for (const bundle of bundles) {
    locks[bundle.id] = {
      kind: "custom",
      values: Object.fromEntries(bundle.attrs.map((attr) => [attr, 70])),
    };
  }
  const result = createResult(locks, 19, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  assertOverallContract(result, "custom locks");
}

// ---- 5. low-Intangibles card (fallback 50 path) ----
{
  const low = [...players.values()].find((p) => {
    const card = lookupRookieCard(cards, p.name);
    return card && typeof card.detailed?.Intangibles === "number" && card.detailed.Intangibles <= 55;
  });
  assert.ok(low, "expected a card with low Intangibles");
  const card = lookupRookieCard(cards, low.name);
  assert.ok(card, "low card must resolve");
  const result = createResult(playerLock(low.id!), 19, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  assertOverallContract(result, `${low.name} low-Intangibles (${card.detailed?.Intangibles})`);
}

console.log(`✅ test-result-overall-contract: ${scanned}+ builds all satisfy reported OVR == final-attributes OVR`);
