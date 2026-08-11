import assert from "node:assert/strict";
import { createRookieCardLookup, hasRookieCard } from "../src/rookieCards.ts";
import index from "../src/data/rookieCardIndex.min.json" with { type: "json" };
import rosterCatalog from "../src/data/versions/2k27-play-now/rosterCatalog.json" with { type: "json" };

const lookup = createRookieCardLookup(index);
const currentPlayers = rosterCatalog.teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players.map((player) => ({ ...player, team: team.name })));

const missing = currentPlayers
  .filter((player) => !hasRookieCard(lookup, player.name))
  .map((player) => player.name)
  .sort();

assert.deepEqual(
  missing,
  ["AJ Dybantsa", "Caleb Wilson", "Darryn Peterson", "Mikel Brown Jr."].sort(),
  "Only 2026 rookie placeholders should be unavailable for random generation until DB2K cards exist",
);
assert.equal(currentPlayers.length, 463);
assert.equal(currentPlayers.length - missing.length, 459);

console.log(`rookie source eligibility OK: selectable=${currentPlayers.length - missing.length}, unavailable=${missing.length}`);
