import type { PlayerSource } from "./domain.ts";
import type { LockState } from "./createResult.ts";
import type { RookieCard, RookieCardLookup } from "./rookieCards.ts";

/** Rookie card → PlayerSource adapter for manual slot selection. */
export function cardToPlayerSource(card: RookieCard): PlayerSource {
  const avg = (keys: string[], fallback = 75) => {
    const values = keys
      .map((key) => card.detailed[key])
      .filter((value): value is number => typeof value === "number");
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : fallback;
  };

  return {
    id: `card:${card.slug}`,
    name: card.name,
    slug: card.slug,
    position: card.position ?? "",
    overall: card.overall ?? null,
    shooting: avg(["Three-Point Shot", "Mid-Range Shot", "Free Throw", "Offensive Consistency", "Shot IQ"]),
    athleticism: avg(["Speed", "Strength", "Agility", "Vertical", "Hustle", "Stamina"]),
    playmaking: avg(["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass IQ", "Pass Vision"]),
    defense: avg(["Block", "Steal", "Pass Perception", "Interior Defense", "Perimeter Defense", "Defensive Consistency", "Help Defense IQ"]),
    inside: avg(["Layup", "Driving Dunk", "Standing Dunk", "Post Hook", "Post Fade", "Post Control", "Draw Foul", "Hands", "Offensive Rebound", "Defensive Rebound"]),
    detailed: card.detailed,
    badges: [],
    badgesKnown: true,
  };
}

/**
 * Rebuild manual-mode pseudo sources after a persisted draft is restored.
 * Drafts deliberately store only stable `card:<slug>` lock IDs; the transient
 * map used while picking is recreated from the already-loaded rookie card index.
 */
export function cardSourcesFromLocks(locks: LockState, rookieCards: RookieCardLookup | null): Map<string, PlayerSource> {
  const sources = new Map<string, PlayerSource>();
  if (!rookieCards) return sources;
  const cardsBySlug = new Map([...rookieCards.values()].map((card) => [card.slug, card]));
  for (const lock of Object.values(locks)) {
    if (lock.kind !== "player" || !lock.playerId.startsWith("card:")) continue;
    const slug = lock.playerId.slice("card:".length);
    const card = cardsBySlug.get(slug);
    if (card) sources.set(lock.playerId, cardToPlayerSource(card));
  }
  return sources;
}

/**
 * Persisted roster IDs can disappear after a roster update. Keep only locks
 * that the current source catalog can still evaluate; otherwise a stale ID can
 * falsely make the UI look 16/16 complete while createResult has no values.
 */
export function filterResolvableLocks(
  locks: LockState,
  rosterSources: ReadonlyMap<string, PlayerSource>,
  rookieCards: RookieCardLookup | null,
): LockState {
  const cardSources = cardSourcesFromLocks(locks, rookieCards);
  const resolved: LockState = {};
  for (const [bundleId, lock] of Object.entries(locks)) {
    if (lock.kind === "custom" || rosterSources.has(lock.playerId) || cardSources.has(lock.playerId)) {
      resolved[bundleId] = lock;
    }
  }
  return resolved;
}