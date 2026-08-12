import assert from "node:assert/strict";
import { bundles } from "../src/createResult.ts";
import {
  DRAFT_STORAGE_KEY,
  DRAFT_VERSION,
  clearDraft,
  loadDraft,
  normalizeBuilderDifficulty,
  normalizeSwitchesLeft,
  saveDraft,
  SWITCH_LIMIT_BY_DIFFICULTY,
  type RookieDraft,
} from "../src/draftStore.ts";

const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  },
};

const baseDraft = (): RookieDraft => ({
  version: DRAFT_VERSION,
  savedAt: Date.now(),
  firstName: "Aiden",
  lastName: "Parker",
  position: "PG",
  secondaryPosition: "SG",
  secondaryEnabled: true,
  age: 19,
  body: { height: 188, weight: 85, wingspan: 50, shoulder: 50, neck: 50, torso: 50 },
  settingsLocked: true,
  manualFinalize: false,
  locks: { three: { kind: "player", playerId: "player:1" } },
  switchesLeft: 3,
  manualSetupDone: false,
  skipBodyConstraints: false,
  difficulty: "standard",
  selectionMode: "random",
  round: { teamId: "team:1", offset: 0, playerOrder: ["player:1"] },
  status: "锁定中",
});

// 1. Valid current draft round-trips unchanged.
{
  saveDraft(baseDraft());
  const loaded = loadDraft();
  assert.equal(loaded?.difficulty, "standard");
  assert.equal(loaded?.switchesLeft, 3);
  console.log("✅ valid draft round-trip");
}

// 2. Old drafts without a difficulty migrate deterministically to standard.
{
  const old = baseDraft();
  delete old.difficulty;
  old.switchesLeft = 999;
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(old));
  const loaded = loadDraft();
  assert.equal(loaded?.difficulty, "standard");
  assert.equal(loaded?.selectionMode, "random", "legacy draft defaults to random mode");
  assert.equal(loaded?.switchesLeft, SWITCH_LIMIT_BY_DIFFICULTY.standard);
  console.log("✅ legacy difficulty defaults and caps budget");
}

// 3. Corrupt preset/budget cannot create negative, fractional, or unlimited switches.
{
  for (const [difficulty, switchesLeft, expectedDifficulty, expectedSwitches] of [
    ["cheat", 999, "standard", 3],
    ["ironman", 1, "ironman", 0],
    ["hard", -1, "hard", 1],
    ["relaxed", 2.5, "relaxed", 5],
  ] as const) {
    const draft = baseDraft();
    (draft as { difficulty?: unknown }).difficulty = difficulty;
    (draft as { switchesLeft: unknown }).switchesLeft = switchesLeft;
    memory.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    const loaded = loadDraft();
    assert.equal(loaded?.difficulty, expectedDifficulty, `${difficulty} normalizes`);
    assert.equal(loaded?.switchesLeft, expectedSwitches, `${difficulty}/${switchesLeft} budget normalizes`);
  }
  console.log("✅ corrupt difficulty and switch budgets normalize safely");
}

// 4. Pure helpers have the same boundary semantics as persisted drafts.
{
  assert.equal(normalizeBuilderDifficulty("relaxed"), "relaxed");
  assert.equal(normalizeBuilderDifficulty(null), "standard");
  assert.equal(normalizeSwitchesLeft(5, "hard"), 1);
  assert.equal(normalizeSwitchesLeft(0, "ironman"), 0);
  assert.equal(normalizeSwitchesLeft(Number.NaN, "relaxed"), 5);
  console.log("✅ helper boundaries");
}

// 5. Malformed round/locks are normalized before the builder can read them.
{
  const draft = baseDraft();
  (draft as { round: unknown }).round = { teamId: 9, offset: -1, playerOrder: "not-an-array" };
  (draft as { locks: unknown }).locks = {
    three: { kind: "player", playerId: "player:1" },
    nullLock: null,
    invalidPlayer: { kind: "player", playerId: 123 },
    invalidCustom: { kind: "custom", values: null },
    incompleteCustom: { kind: "custom", values: { "Three Point Shot": 88 } },
  };
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  const loaded = loadDraft();
  assert.equal(loaded?.round, null, "invalid round falls back to no selected team");
  assert.deepEqual(loaded?.locks, { three: { kind: "player", playerId: "player:1" } }, "invalid/unknown lock entries are discarded");
  console.log("✅ malformed round and locks normalize safely");
}

// 6. A custom slot must retain the editor's full bundle contract; partial data
// must not silently make evaluateCustom() invent missing values at 75.
{
  const draft = baseDraft();
  (draft as { locks: unknown }).locks = {
    three: { kind: "custom", values: { "Three Point Shot": 88 } },
  };
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  const loaded = loadDraft();
  assert.deepEqual(loaded?.locks, {}, "partial custom lock is discarded instead of default-filling fields");
  console.log("✅ incomplete custom locks are discarded");
}

// 7. Complete custom locks retain only the bundle's real fields; unrelated
// persisted keys never bleed into a result after restore.
{
  const draft = baseDraft();
  const three = bundles.find((bundle) => bundle.id === "three");
  assert.ok(three, "three bundle exists");
  const threeBundle = three!;
  const values = Object.fromEntries(threeBundle.attrs.map((attr) => [attr, 88]));
  (draft as { locks: unknown }).locks = {
    three: { kind: "custom", values: { ...values, injected: 99 } },
  };
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  const loaded = loadDraft();
  assert.deepEqual(loaded?.locks, { three: { kind: "custom", values } }, "complete custom lock survives but unknown fields are stripped");
  console.log("✅ complete custom locks retain only bundle fields");
}

// 8. Potential is intentionally not user-customizable; malformed storage cannot
// bypass that UI rule during recovery.
{
  const draft = baseDraft();
  const potential = bundles.find((bundle) => bundle.id === "potential");
  assert.ok(potential, "potential bundle exists");
  (draft as { locks: unknown }).locks = {
    potential: { kind: "custom", values: Object.fromEntries(potential!.attrs.map((attr) => [attr, 88])) },
  };
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  const loaded = loadDraft();
  assert.deepEqual(loaded?.locks, {}, "custom potential lock is discarded");
  console.log("✅ custom potential locks are discarded");
}

// 9. Draft selection mode restores manual flows and normalizes legacy/corrupt values.
{
  const manual = baseDraft();
  manual.selectionMode = "manual";
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(manual));
  assert.equal(loadDraft()?.selectionMode, "manual", "manual draft mode survives restore");

  const corrupt = baseDraft();
  (corrupt as { selectionMode?: unknown }).selectionMode = "unsupported";
  memory.set(DRAFT_STORAGE_KEY, JSON.stringify(corrupt));
  assert.equal(loadDraft()?.selectionMode, "random", "invalid draft mode falls back safely");
  console.log("✅ draft selection mode normalizes safely");
}

// 10. Completed-result snapshot round-trips; malformed snapshots are dropped.
{
  const withSnapshot = baseDraft();
  withSnapshot.locks = Object.fromEntries(bundles.map((b) => [b.id, { kind: "player", playerId: "player:1" } as const]));
  withSnapshot.resultSnapshot = {
    resultJson: JSON.stringify({
      initialAttrs: { "Three-Point Shot": 88, Speed: 90 },
      tendencies: { "Spot Up Three": 80 },
      hotZones: { underBasket: "Hot" },
      badges: [{ name: "Deadeye", tier: "Gold" }],
      peakBadges: [],
      initialStrength: 82,
      potential: 92,
      card: null,
    }),
    status: "已完成",
  };
  saveDraft(withSnapshot);
  const loaded = loadDraft();
  assert.ok(loaded?.resultSnapshot, "snapshot must survive the round-trip");
  assert.equal(loaded?.resultSnapshot?.status, "已完成");
  const parsed = JSON.parse(loaded!.resultSnapshot!.resultJson) as { initialAttrs: Record<string, number> };
  assert.equal(parsed.initialAttrs["Three-Point Shot"], 88);
  console.log("✅ completed-result snapshot round-trip");
}

// 11. Corrupt / truncated snapshots are dropped without failing the draft.
{
  const bad = baseDraft();
  bad.resultSnapshot = { resultJson: "{\"initialAttrs\":", status: "已完成" };
  saveDraft(bad);
  const loaded = loadDraft();
  assert.ok(loaded, "draft itself must still load");
  assert.equal(loaded?.resultSnapshot, null, "malformed snapshot must be dropped");
  const nonJson = baseDraft();
  nonJson.resultSnapshot = { resultJson: "not json at all but quite long xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", status: "已完成" };
  saveDraft(nonJson);
  assert.equal(loadDraft()?.resultSnapshot, null, "non-JSON snapshot must be dropped");
  console.log("✅ malformed snapshots are dropped safely");
}

clearDraft();
console.log("\nALL DRAFT-STORE CHECKS PASSED");
