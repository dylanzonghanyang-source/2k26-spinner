#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import {
  buildBadgesByBundle,
  collectBadgesByBundle,
  downgradeBadgesForRookie,
  type PlayerBadgeLike,
} from "../src/badges.ts";
import { badgeBundleMap } from "../src/components/badgeBundleMap.ts";

const curryBadges: PlayerBadgeLike[] = [
  { name: "Deadeye", category: "shooting", tier: "HOF" },
  { name: "Limitless Range", category: "shooting", tier: "HOF" },
  { name: "Dimer", category: "playmaking", tier: "Gold" },
  { name: "Handles For Days", category: "playmaking", tier: "Gold" },
];
const giannisBadges: PlayerBadgeLike[] = [
  { name: "Physical Finisher", category: "inside", tier: "HOF" },
  { name: "Posterizer", category: "inside", tier: "Gold" },
  { name: "Dimer", category: "playmaking", tier: "Silver" },
];
const athleteBadges: PlayerBadgeLike[] = [
  { name: "Aerial Wizard", category: "athleticism", tier: "Gold" },
];
const midShooterBadges: PlayerBadgeLike[] = [
  { name: "Deadeye", category: "shooting", tier: "Gold" },
  { name: "Set Shot Specialist", category: "shooting", tier: "HOF" },
];
const byPlayer = new Map([
  ["stephen-curry", curryBadges],
  ["giannis-antetokounmpo", giannisBadges],
  ["elite-athlete", athleteBadges],
  ["mid-shooter", midShooterBadges],
  ["known-zero", []],
]);

const inherited = collectBadgesByBundle({
  sources: [
    { bundleId: "three", playerId: "stephen-curry" },
    { bundleId: "face", playerId: "giannis-antetokounmpo" },
    { bundleId: "handle", playerId: undefined },
  ],
  badgeToBundle: badgeBundleMap,
  badgesForPlayer: (playerId) => byPlayer.get(playerId),
});

const names = inherited.map((badge) => badge.name);
assert(names.includes("Deadeye"), "three slot must inherit Deadeye from Curry");
assert(names.includes("Limitless Range"), "three slot must inherit Limitless Range from Curry");
assert(names.includes("Physical Finisher"), "face slot must inherit Physical Finisher from Giannis");
assert(!names.includes("Dimer"), "Dimer belongs to passing slot, not three/face");
assert(!names.includes("Handles For Days"), "handle slot has no source, so nothing inherited");
assert.equal(
  inherited.find((badge) => badge.name === "Physical Finisher")?.tier,
  "HOF",
  "inherited tier must be preserved",
);

// Aliased export spellings must normalize to canonical names before slot mapping.
const aliasedBadges: PlayerBadgeLike[] = [
  { name: "Strong Handles", category: "playmaking", tier: "Gold" },
  { name: "Off Ball Pest", category: "defense", tier: "Silver" },
];
const byAliased = new Map([["alias-player", aliasedBadges]]);
const aliased = collectBadgesByBundle({
  sources: [
    { bundleId: "handle", playerId: "alias-player" },
    { bundleId: "perimeter", playerId: "alias-player" },
  ],
  badgeToBundle: badgeBundleMap,
  badgesForPlayer: (playerId) => byAliased.get(playerId),
});
assert(
  aliased.some((badge) => badge.name === "Strong Handle"),
  "Strong Handles must normalize to Strong Handle and reach the handle slot",
);
assert(
  !aliased.some((badge) => badge.name === "Strong Handles"),
  "aliased spelling must not survive normalization",
);
assert(
  aliased.some((badge) => badge.name === "Off-Ball Pest"),
  "Off Ball Pest must normalize to Off-Ball Pest and reach the perimeter slot",
);

const sharedShooting = collectBadgesByBundle({
  sources: [
    { bundleId: "three", playerId: "stephen-curry" },
    { bundleId: "mid", playerId: "mid-shooter" },
  ],
  badgeToBundle: badgeBundleMap,
  badgesForPlayer: (playerId) => byPlayer.get(playerId),
});
assert.equal(sharedShooting.find((badge) => badge.name === "Deadeye")?.tier, "HOF", "shared Deadeye must keep the highest tier across three/mid");
assert.equal(sharedShooting.find((badge) => badge.name === "Set Shot Specialist")?.tier, "HOF", "shared Set Shot Specialist must inherit from mid");

// Same badge name from two slot sources must keep the highest tier.
const mixed = collectBadgesByBundle({
  sources: [
    { bundleId: "passing", playerId: "stephen-curry" },
    { bundleId: "passing", playerId: "giannis-antetokounmpo" },
  ],
  badgeToBundle: badgeBundleMap,
  badgesForPlayer: (playerId) => byPlayer.get(playerId),
});
const dimer = mixed.find((badge) => badge.name === "Dimer");
assert(dimer?.tier === "Gold", "duplicate badge must keep highest tier (Gold over Silver)");

const withFallback = buildBadgesByBundle({
  sources: [
    { bundleId: "dunk", playerId: "elite-athlete" },
    { bundleId: "handle", playerId: "unknown-player" },
    { bundleId: "rebound", playerId: "known-zero" },
  ],
  badgeToBundle: badgeBundleMap,
  badgesForPlayer: (playerId) => byPlayer.get(playerId),
  profileKnown: (playerId) => byPlayer.has(playerId),
  fallbackBadges: [
    { name: "Handles For Days", category: "playmaking", tier: "Gold" },
    { name: "Rebound Chaser", category: "rebounding", tier: "Gold" },
  ],
});
// Slot Semantics V2 (2026-08-14): Aerial Wizard moved athletic → dunk + rebound,
// so a dunk-slot source still inherits it.
assert(withFallback.badges.some((badge) => badge.name === "Aerial Wizard"), "dunk slot must inherit dunk-owned badges (Aerial Wizard)");
assert(withFallback.badges.some((badge) => badge.name === "Handles For Days"), "unknown profile must use slot fallback");
assert(!withFallback.badges.some((badge) => badge.name === "Rebound Chaser"), "known zero-badge profile must not be replaced by fallback");
assert.equal(withFallback.estimated, true, "using fallback must mark badges estimated");

const sampleBadges: PlayerBadgeLike[] = [
  { name: "A", category: "shooting", tier: "Legendary" },
  { name: "B", category: "shooting", tier: "HOF" },
  { name: "C", category: "shooting", tier: "Gold" },
  { name: "D", category: "shooting", tier: "Silver" },
  { name: "E", category: "shooting", tier: "Bronze" },
  { name: "F", category: "shooting", tier: "Gold" },
  { name: "G", category: "shooting", tier: "Gold" },
  { name: "H", category: "shooting", tier: "Gold" },
];
assert.deepEqual(downgradeBadgesForRookie(sampleBadges, "rotation").map((badge) => badge.tier), ["Gold", "Silver", "Bronze"]);
assert.deepEqual(downgradeBadgesForRookie(sampleBadges, "lottery").map((badge) => badge.tier), ["HOF", "Gold", "Silver", "Silver", "Silver"]);
assert.equal(downgradeBadgesForRookie(sampleBadges, "generational").length, 7, "generational rookie limit must be seven");

console.log(`badge inheritance OK: ${inherited.map((badge) => `${badge.name}:${badge.tier}`).join(", ")}`);
