/**
 * Tests for the race-safe bundle lock primitive (applyBundleLock).
 *
 * The UI's rapid-click locking used to expand from a stale render closure
 * ({ ...locks, [bundleId]: lock }) and needed a microtask ref to swallow
 * duplicates. The pure function instead composes from the latest committed
 * state; these tests pin the contract that made the ref removable.
 */
import assert from "node:assert/strict";
import { applyBundleLock, bundles, type BundleLock } from "../src/createResult.ts";

const playerLock = (playerId: string): BundleLock => ({ kind: "player", playerId });
const customLock = (value: number): BundleLock => ({ kind: "custom", values: { "Three-Point Shot": value } });

// 1. Locking an empty state returns a state containing the lock.
{
  const next = applyBundleLock({}, "three", playerLock("p1"));
  assert.deepEqual(next, { three: { kind: "player", playerId: "p1" } });
  console.log("applyBundleLock: empty state accepts first lock");
}

// 2. Locking the SAME bundle twice is a no-op returning the identical reference.
{
  const first = applyBundleLock({}, "three", playerLock("p1"));
  const second = applyBundleLock(first, "three", playerLock("p2"));
  assert.equal(second, first, "duplicate lock must return the original reference");
  assert.deepEqual(second.three, { kind: "player", playerId: "p1" }, "original lock must be preserved");
  console.log("applyBundleLock: duplicate bundle lock is idempotent no-op");
}

// 3. Rapid successive locks on DIFFERENT bundles all survive (the race case).
{
  let state: Record<string, BundleLock> = {};
  // Simulate two clicks in the same tick without any re-render in between.
  state = applyBundleLock(state, "three", playerLock("p1"));
  state = applyBundleLock(state, "mid", playerLock("p2"));
  state = applyBundleLock(state, "face", customLock(88));
  assert.deepEqual(Object.keys(state).sort(), ["face", "mid", "three"]);
  assert.equal(state.three.kind, "player");
  assert.equal(state.mid.kind, "player");
  assert.equal(state.face.kind, "custom");
  console.log("applyBundleLock: rapid distinct-bundle commits all compose");
}

// 4. Interleaved duplicate + distinct commits behave correctly.
{
  let state: Record<string, BundleLock> = {};
  state = applyBundleLock(state, "three", playerLock("p1"));
  state = applyBundleLock(state, "three", playerLock("p2")); // ignored
  state = applyBundleLock(state, "dunk", playerLock("p3"));
  assert.equal(state.three.kind === "player" && state.three.playerId === "p1", true);
  assert.equal(state.dunk.kind === "player" && state.dunk.playerId === "p3", true);
  console.log("applyBundleLock: duplicate swallowed without dropping the later distinct commit");
}

// 5. The real bundle id space: locking all 16 slots completes without conflict.
{
  let state: Record<string, BundleLock> = {};
  for (const bundle of bundles) {
    state = applyBundleLock(state, bundle.id, playerLock(`p-${bundle.id}`));
  }
  assert.equal(Object.keys(state).length, bundles.length, "all bundles lockable");
  console.log(`applyBundleLock: all ${bundles.length} bundle ids lock cleanly`);
}

console.log("bundle lock contract OK");
