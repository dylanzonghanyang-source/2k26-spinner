import assert from "node:assert/strict";
import { cardToPlayerSource } from "../src/rookieCardSource.ts";
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
console.log(`cardToPlayerSource position checks OK: ${checked} cards`);
