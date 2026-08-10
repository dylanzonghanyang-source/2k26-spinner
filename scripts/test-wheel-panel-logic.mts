/**
 * Tests for wheel panel logic (src/wheelPanelLogic.ts).
 * Run: node --experimental-strip-types scripts/test-wheel-panel-logic.mts
 */
import {
  filterWheelPlayers,
  parseLabels,
  playerWheelLabel,
  validateNumberRange,
} from "../src/wheelPanelLogic.ts";
import type { PlayerSource } from "../src/domain.ts";

let failures = 0;
let checks = 0;
function check(label: string, condition: boolean, detail = "") {
  checks++;
  if (!condition) {
    failures++;
    console.log(`❌ FAIL: ${label} ${detail}`);
  } else {
    console.log(`✅ pass: ${label}`);
  }
}

// --- parseLabels ---
check("labels: trims + drops empties", JSON.stringify(parseLabels("  a  \n\n b \n  ")) === JSON.stringify(["a", "b"]));
check("labels: dedupes keeping first", JSON.stringify(parseLabels("x\ny\nx")) === JSON.stringify(["x", "y"]));
check("labels: empty input", parseLabels("").length === 0);
check("labels: limit applied", parseLabels("1\n2\n3\n4\n5", 3).length === 3);
check("labels: null input safe", parseLabels(null as unknown as string).length === 0);

// --- validateNumberRange ---
check("numbers: valid 1..60", validateNumberRange("1", "60").error === null);
check("numbers: 61 exceeds limit", validateNumberRange("1", "61").error !== null);
check("numbers: min >= max rejected", validateNumberRange("10", "10").error !== null);
check("numbers: reversed rejected", validateNumberRange("20", "5").error !== null);
check("numbers: non-integer rejected", validateNumberRange("abc", "5").error !== null);
check("numbers: parsed values", JSON.stringify(validateNumberRange("3", "7")) === JSON.stringify({ min: 3, max: 7, error: null }));
check("numbers: exact limit ok", validateNumberRange("10", "69").error === null, validateNumberRange("10", "69").error ?? "");

// --- filterWheelPlayers ---
const mk = (name: string, team: string, overrides: Partial<PlayerSource> = {}): PlayerSource => ({
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  shooting: 70, athleticism: 70, playmaking: 70, defense: 70, inside: 70,
  overall: 80, position: "PG", detailed: {},
  ...overrides,
});
const teams = [
  { id: "LAL", name: "Lakers", players: [mk("LeBron James", "LAL"), mk("Luka Doncic", "LAL")] },
  { id: "SAS", name: "Spurs", players: [mk("Victor Wembanyama", "SAS"), mk("De'Aaron Fox", "SAS")] },
];
{
  const all = filterWheelPlayers(teams, { selectedTeamIds: null, query: "" });
  check("players: all teams", all.total === 4 && !all.truncated);
  const lal = filterWheelPlayers(teams, { selectedTeamIds: ["LAL"], query: "" });
  check("players: single team", lal.total === 2);
  const search = filterWheelPlayers(teams, { selectedTeamIds: null, query: "wembanyama" });
  check("players: search english", search.total === 1 && search.players[0].name === "Victor Wembanyama", JSON.stringify(search.players.map((p) => p.name)));
  const searchCN = filterWheelPlayers(teams, { selectedTeamIds: null, query: "詹姆斯" });
  check("players: search chinese", searchCN.total === 1 && searchCN.players[0].name === "LeBron James");
  const limited = filterWheelPlayers(teams, { selectedTeamIds: null, query: "" }, 3);
  check("players: limit truncates", limited.truncated && limited.players.length === 3);
  const empty = filterWheelPlayers([], { selectedTeamIds: null, query: "" });
  check("players: no teams", empty.total === 0);
}

// --- playerWheelLabel ---
{
  const label = playerWheelLabel(mk("LeBron James", "LAL", { overall: 97 }));
  check("label: CN name + OVR", label.includes("97"), label);
  const noOvr = playerWheelLabel(mk("Test Player", "LAL", { overall: null }));
  check("label: no OVR falls back to name", noOvr.includes("Test Player") || noOvr.includes("测试"), noOvr);
}

console.log(`\n===== wheel-panel-logic: ${checks - failures}/${checks} passed, ${failures} failed =====`);
process.exit(failures > 0 ? 1 : 0);
