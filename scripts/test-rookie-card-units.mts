import assert from "node:assert/strict";
import { createRookieCardLookup, corePlayerName, type RookieCard } from "../src/rookieCards.ts";
import { cardSourceBody } from "../src/createResult.ts";
import index from "../src/data/rookieCardIndex.min.json" with { type: "json" };

const lookup = createRookieCardLookup(index);

let checked = 0;
for (const [key, card] of lookup) {
  const top = card.vitals ? undefined : undefined; // top-level `height` isn't in the lookup shape; validate vitals only
  void top;
  const h = card.vitals?.heightInches;
  assert.ok(
    typeof h === "number" && Number.isFinite(h),
    `${key}: vitals.heightInches must be a finite number (got ${h})`,
  );
  assert.ok(
    h >= 60 && h <= 100,
    `${key}: vitals.heightInches ${h} must be in plausible inch range 60–100 (cm value leaked in?)`,
  );
  checked++;
}

assert.ok(checked >= 1190, `expected >=1190 indexed cards with valid heights, saw ${checked}`);

// Direct file-level checks: top-level card.height must match vitals.heightInches.
// The lookup shape omits top-level height, so read the source files directly.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_ROOT = path.join(__dirname, "..", "src", "data", "rookieCards");
let fileChecked = 0;
for (const year of readdirSync(CARDS_ROOT)) {
  const yearDir = path.join(CARDS_ROOT, year);
  if (!path.basename(yearDir).match(/^\d{4}$/)) continue;
  for (const f of readdirSync(yearDir)) {
    if (!f.endsWith(".json")) continue;
    const card = JSON.parse(readFileSync(path.join(yearDir, f), "utf8")) as RookieCard;
    if (typeof card.slug !== "string" || !card.vitals) continue; // non-card files (e.g. capture-manifest.json)
    assert.ok(
      typeof card.height === "number" && Number.isFinite(card.height) && card.height >= 60 && card.height <= 100,
      `${year}/${f}: top-level height ${card.height} must be inches in 60–100`,
    );
    assert.equal(
      card.height,
      card.vitals?.heightInches,
      `${year}/${f}: top-level height must equal vitals.heightInches`,
    );
    fileChecked++;
  }
}
assert.ok(fileChecked >= 1190, `expected >=1190 card files checked, saw ${fileChecked}`);

// Regression anchors from the 83-card cm leak.
const hansen = lookup.get(corePlayerName("Hansen Yang"));
assert.ok(hansen, "Hansen Yang card exists");
assert.equal(hansen.vitals?.heightInches, 85, "Hansen Yang: 215cm → 85in (7'1\"), not 17 feet");

// Source body must come out ~208cm for Julian Champagnie (was ~528cm).
const champagnie = lookup.get(corePlayerName("Julian Champagnie"));
assert.ok(champagnie, "Julian Champagnie card exists");
const body = cardSourceBody(champagnie);
assert.ok(body, "Champagnie source body resolves");
assert.ok(Math.abs(body.height - 208.28) < 1.5, `Champagnie source body ~208cm, got ${body.height}`);

// Defensive contract: a cm value leaked into heightInches must NOT produce a giant body.
const badCard = {
  ...champagnie,
  vitals: { ...champagnie.vitals, heightInches: 205, weightLb: 220 },
};
assert.equal(cardSourceBody(badCard), null, "out-of-range heightInches (cm leak) must return null body");

console.log(`✅ test-rookie-card-units: ${checked} indexed + ${fileChecked} file heights valid, anchors pass`);
