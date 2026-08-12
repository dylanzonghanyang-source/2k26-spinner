import assert from "node:assert/strict";
import { cardSourcesFromLocks, cardToPlayerSource, filterResolvableLocks } from "../src/rookieCardSource.ts";
import { createRookieCardLookup } from "../src/rookieCards.ts";
import index from "../src/data/rookieCardIndex.min.json" with { type: "json" };

const lookup = createRookieCardLookup(index);
const cards = [...lookup.values()];
assert.ok(cards.length > 1000, "fixture should cover the full rookie card index");

let checked = 0;
for (const card of cards) {
  const source = cardToPlayerSource(card);
  assert.equal(source.position, card.position ?? "", `${card.name} position must survive card adapter`);
  assert.equal(source.id, `card:${card.slug}`);
  assert.equal(source.slug, card.slug);
  checked += 1;
}

assert.equal(checked, cards.length);

// Manual-mode locks persist only `card:<slug>` ids. A fresh page must rebuild
// those pseudo sources from the loaded card index before evaluating the draft.
{
  const first = cards[0];
  const second = cards[1];
  const restored = cardSourcesFromLocks({
    three: { kind: "player", playerId: `card:${first.slug}` },
    mid: { kind: "player", playerId: `card:${second.slug}` },
    custom: { kind: "custom", values: { ignored: 88 } },
    missing: { kind: "player", playerId: "card:not-in-index" },
  }, lookup);
  assert.equal(restored.size, 2, "only resolvable card lock IDs are rebuilt");
  assert.equal(restored.get(`card:${first.slug}`)?.name, first.name);
  assert.equal(restored.get(`card:${second.slug}`)?.name, second.name);
}

// Saved locks may outlive a roster update. Only sources resolvable from the
// current roster or card index may remain locked after restore.
{
  const first = cards[0];
  const rosterPlayer = { id: "roster:live", name: "Live Player" };
  const locks = {
    three: { kind: "player" as const, playerId: "roster:live" },
    mid: { kind: "player" as const, playerId: `card:${first.slug}` },
    face: { kind: "player" as const, playerId: "roster:removed" },
    custom: { kind: "custom" as const, values: { "Three-Point Shot": 88 } },
  };
  const resolved = filterResolvableLocks(locks, new Map([["roster:live", rosterPlayer as never]]), lookup);
  assert.deepEqual(Object.keys(resolved).sort(), ["custom", "mid", "three"], "stale player lock is removed before completion accounting");
}

console.log(`cardToPlayerSource position checks OK: ${checked} cards`);
