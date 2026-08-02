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
const byPlayer = new Map([
  ["stephen-curry", curryBadges],
  ["giannis-antetokounmpo", giannisBadges],
  ["elite-athlete", athleteBadges],
  ["known-zero", []],
]);

const inherited = collectBadgesByBundle({
  sources: [
    { bundleId: "three", playerId: "stephen-curry" },
    { bundleId: "finishing", playerId: "giannis-antetokounmpo" },
    { bundleId: "handle", playerId: undefined },
  ],
  badgeToBundle: badgeBundleMap,
  badgesForPlayer: (playerId) => byPlayer.get(playerId),
});

const names = inherited.map((badge) => badge.name);
assert(names.includes("Deadeye"), "three slot must inherit Deadeye from Curry");
assert(names.includes("Limitless Range"), "three slot must inherit Limitless Range from Curry");
assert(names.includes("Physical Finisher"), "finishing slot must inherit Physical Finisher from Giannis");
assert(!names.includes("Dimer"), "Dimer belongs to passing slot, not three/finishing");
assert(!names.includes("Handles For Days"), "handle slot has no source, so nothing inherited");
assert.equal(
  inherited.find((badge) => badge.name === "Physical Finisher")?.tier,
  "HOF",
  "inherited tier must be preserved",
);

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
    { bundleId: "athletic", playerId: "elite-athlete" },
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
assert(withFallback.badges.some((badge) => badge.name === "Aerial Wizard"), "athletic slot must inherit athletic badges");
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
