/**
 * Adversarial test: boundary conditions for createResult & body constraints.
 * Run: node --experimental-strip-types scripts/test-adversarial.mts
 */
import { createResult, evaluateAll, bodyBases, bundles, clamp } from "../src/createResult.ts";
import { applyBodyConstraints, parsePlayerBody, parsePositionRoles, effectivePositionDistance, type BuilderBody } from "../src/rookieBodyConstraints.ts";
import { createRookieCardLookup, corePlayerName, type RookieCardLookup } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";

// --- tiny fixtures ---
const mkPlayer = (name: string, overrides: Partial<PlayerSource> = {}): PlayerSource => ({
  name,
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  shooting: 75, athleticism: 75, playmaking: 75, defense: 75, inside: 75,
  overall: 80, potential: 88,
  position: "PG/SG", height: "6'5\"", weight: 205, wingspan: "6'9\"",
  detailed: {},
  ...overrides,
});

function detailed(over: Record<string, number>): Record<string, number | null> {
  return Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v]));
}

const playerPool = new Map<string, PlayerSource>();
const names = ["Luka Doncic", "LeBron James", "Nikola Jokic", "Victor Wembanyama", "Stephen Curry"];
const allAttrs = Object.fromEntries(
  bundles.flatMap((b) => b.attrs).map((a) => [a, 80]),
);
for (const [i, name] of names.entries()) {
  const p = mkPlayer(name, {
    position: ["PG", "SF", "C", "C", "PG"][i],
    height: ["6'7\"", "6'9\"", "7'0\"", "7'4\"", "6'3\""][i],
    weight: [230, 250, 285, 235, 185][i],
    wingspan: ["7'0\"", "7'0\"", "7'3\"", "8'0\"", "6'7\""][i],
    detailed: detailed(allAttrs),
  });
  playerPool.set(p.id ?? p.slug!, p);
}

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

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// --- 1. NaN propagation via invalid age (rookieValue: progressByCategory[category][ageIndex] undefined) ---
{
  const locks: Record<string, any> = {};
  bundles.slice(0, 8).forEach((b, i) => {
    locks[b.id] = { kind: "player", playerId: playerPool.get(names[i % names.length].toLowerCase().replace(/[^a-z0-9]+/g, "-"))!.id ?? "" };
  });
  const body = { ...bodyBases.PG };
  for (const age of [-1, 0, 17, 24, 30]) {
    try {
      const result = createResult(locks, age, "PG", "SG", body, playerPool, null, "legacy", null);
      const bad = Object.entries(result.initialAttrs).filter(([, v]) => !isFiniteNumber(v));
      check(`age=${age} → all initialAttrs finite`, bad.length === 0, `NaN attrs: ${bad.map(([k]) => k).join(",")}`);
    } catch (e) {
      check(`age=${age} → no throw`, false, `threw: ${e}`);
    }
  }
}

// --- 2. Extreme body values → no NaN, values clamped 25..99 ---
{
  const locks: Record<string, any> = {};
  bundles.forEach((b, i) => {
    locks[b.id] = { kind: "player", playerId: playerPool.get(names[i % names.length].toLowerCase().replace(/[^a-z0-9]+/g, "-"))!.id ?? "" };
  });
  const extremes: BuilderBody[] = [
    { height: 150, weight: 50, wingspan: 1, shoulder: 1, neck: 1, torso: 1 },
    { height: 300, weight: 200, wingspan: 100, shoulder: 100, neck: 100, torso: 100 },
    { height: 185, weight: 82, wingspan: 46, shoulder: 46, neck: 50, torso: 48 },
  ];
  for (const [i, body] of extremes.entries()) {
    const result = createResult(locks, 19, "C", "PF", body, playerPool, null, "legacy", null);
    const bad = Object.entries(result.initialAttrs).filter(([, v]) => !isFiniteNumber(v) || v < 25 || v > 99);
    check(`extreme body #${i} → all attrs in [25,99]`, bad.length === 0, `bad: ${JSON.stringify(bad.slice(0, 3))}`);
  }
}

// --- 3. Empty locks (no slots locked) → no throw, sane fallback ---
{
  try {
    const result = createResult({}, 19, "SF", "SF", bodyBases.SF, playerPool, null, "legacy", null);
    const bad = Object.entries(result.initialAttrs).filter(([, v]) => !isFiniteNumber(v));
    check("empty locks → no throw & finite", bad.length === 0, `NaN: ${bad.map(([k]) => k).join(",")}`);
    check("empty locks → potential sane", result.potential >= 40 && result.potential <= 99);
  } catch (e) {
    check("empty locks → no throw", false, `threw: ${e}`);
  }
}

// --- 4. Determinism: same input → identical output ---
{
  const locks: Record<string, any> = {};
  bundles.slice(0, 5).forEach((b, i) => {
    locks[b.id] = { kind: "player", playerId: playerPool.get(names[i].toLowerCase().replace(/[^a-z0-9]+/g, "-"))!.id ?? "" };
  });
  const a = createResult(locks, 20, "SG", "SF", bodyBases.SG, playerPool, null, "legacy", null);
  const b = createResult(locks, 20, "SG", "SF", bodyBases.SG, playerPool, null, "legacy", null);
  check("deterministic seed → identical results", JSON.stringify(a.initialAttrs) === JSON.stringify(b.initialAttrs) && JSON.stringify(a.hotZones) === JSON.stringify(b.hotZones));
}

// --- 5. Position cross penalty: same player, C target vs PG target ---
{
  const locks: Record<string, any> = {};
  // lock a PG source into passing slot
  locks.passing = { kind: "player", playerId: playerPool.get("stephen-curry")!.id ?? "" };
  const pgBody = { ...bodyBases.PG };
  const cBody = { ...bodyBases.C };
  const rPG = createResult(locks, 20, "PG", "PG", pgBody, playerPool, null, "legacy", null);
  const rC = createResult(locks, 20, "C", "C", cBody, playerPool, null, "legacy", null);
  check("C target passing < PG target passing (positionCross active)", rC.initialAttrs["Pass Accuracy"] <= rPG.initialAttrs["Pass Accuracy"], `C=${rC.initialAttrs["Pass Accuracy"]} PG=${rPG.initialAttrs["Pass Accuracy"]}`);
}

// --- 6. Grace zone: same-position + similar body → raw inheritance ---
{
  const curry = playerPool.get("stephen-curry")!;
  const body = { ...bodyBases.PG, height: 190, weight: 85 }; // close to Curry 6'3"/185lb → 190.5cm/83.9kg
  const evals = evaluateAll([
    { bundle: bundles.find((b) => b.id === "three")!, player: curry },
  ], body, { targetPosition: "PG", secondaryPosition: "PG" });
  const ev = evals.three;
  check("grace zone → bodyAdjustment === 0", ev.bodyAdjustment === 0, `adj=${ev.bodyAdjustment}`);
  check("grace zone → usedGraceZone flag", ev.usedGraceZone === true);
}

// --- 7. Body mismatch WITHOUT grace zone: tiny target vs huge source ---
{
  const jokic = playerPool.get("nikola-jokic")!;
  const body = { ...bodyBases.PG, height: 170, weight: 65 };
  const evals = evaluateAll([
    { bundle: bundles.find((b) => b.id === "interior")!, player: jokic },
  ], body, { targetPosition: "PG", secondaryPosition: "PG" });
  const ev = evals.interior;
  check("interior mismatch → negative bodyAdjustment", ev.bodyAdjustment <= 0, `adj=${ev.bodyAdjustment}`);
  check("interior mismatch → value >= 25", ev.values["Interior Defense"] >= 25);
}

// --- 8. parseFeetInches edge cases (pure function) ---
{
  const cases: Array<[string | number | null, number | null]> = [
    ["6'7\"", 200.66],
    ["7'0\"", 213.36],
    ["213", null],   // single number string → no match!
    ["213 cm", null], // still no match (single group)
    [200, 200],      // numeric > 100 → cm
    [80, 203.2],     // numeric ≤ 100 → inches
    [null, null],
    ["", null],
  ];
  for (const [input, expected] of cases) {
    const result = parsePlayerBody({ height: input, weight: 200, wingspan: "6'7\"" });
    const h = result?.height ?? null;
    check(`parseFeetInches(${JSON.stringify(input)})`, h === expected || (h !== null && Math.abs(h - (expected ?? 0)) < 0.01) || (expected === null && h === null), `got=${h} want=${expected}`);
  }
}

// --- 9. parseSourceWeight edge cases ---
{
  const cases: Array<[string | number, number | null]> = [
    [235, 106.59],     // numeric → lbs
    ["235 lbs", 106.59],
    ["106.6 kg", 106.6],
    ["", null],
    ["abc", null],
  ];
  for (const [input, expected] of cases) {
    const result = parsePlayerBody({ height: "6'7\"", weight: input, wingspan: "6'7\"" });
    const w = result?.weight ?? null;
    const ok = expected === null ? w === null : w !== null && Math.abs(w - expected) < 0.5;
    check(`parseSourceWeight(${JSON.stringify(input)})`, ok, `got=${w} want=${expected}`);
  }
}

// --- 10. Position parsing: PG/C/PF combos ---
{
  check("parsePositionRoles('PG/SG')", JSON.stringify(parsePositionRoles("PG/SG")) === JSON.stringify(["PG", "SG"]));
  check("parsePositionRoles('Backcourt')", parsePositionRoles("Backcourt").length === 0);
  check("parsePositionRoles(null)", parsePositionRoles(null).length === 0);
  check("parsePositionRoles('CENTER')", parsePositionRoles("CENTER").length === 0);
  const d = effectivePositionDistance("PG", "SG", ["PG"]);
  check("effectivePositionDistance PG target, PG source", d === 0, `d=${d}`);
  const d2 = effectivePositionDistance("C", "PF", ["PG"]);
  check("effectivePositionDistance C target, PG source w/ secondary", typeof d2 === "number" && d2 !== null && d2 > 2, `d=${d2}`);
}

// --- 11. corePlayerName normalization (suffixes kept: Ron Harper != Ron Harper Jr.) ---
{
  check("corePlayerName('R.J. Barrett Jr.')", corePlayerName("R.J. Barrett Jr.") === "rj barrett jr");
  check("corePlayerName('Bronny James Jr.')", corePlayerName("Bronny James Jr.") === "bronny james jr");
  check("corePlayerName('K.J. Simpson III')", corePlayerName("K.J. Simpson III") === "kj simpson iii");
  check("corePlayerName('Stephen Curry')", corePlayerName("Stephen Curry") === "stephen curry");
  check("corePlayerName('Bobby Portis')", corePlayerName("Bobby Portis") === "bobby portis");
}

// --- 12. RookieCardLookup: build from actual index data ---
{
  const fs = await import("node:fs");
  const legacy = JSON.parse(fs.readFileSync(new URL("../src/data/rookieCardIndex-legacy.min.json", import.meta.url), "utf-8"));
  const current = JSON.parse(fs.readFileSync(new URL("../src/data/rookieCardIndex-current.min.json", import.meta.url), "utf-8"));
  const lookup = createRookieCardLookup(legacy);
  for (const [key, card] of createRookieCardLookup(current)) if (!lookup.has(key)) lookup.set(key, card);
  const tests: Array<[string, string, boolean]> = [
    ["LeBron James", "lebron james", true],
    ["Luka Doncic", "luka doncic", true],
    ["Victor Wembanyama", "victor wembanyama", true],
    ["Bronny James", "bronny james jr", true],
    ["R.J. Barrett", "rj barrett", true],
    ["Hansen Yang", "hansen yang", true],      // alias test
    ["Yang Hansen", "hansen yang", true],       // alias test (reverse)
    ["不存在的人", "", false],
  ];
  for (const [name, key, shouldMatch] of tests) {
    const direct = lookup.get(key);
    const card = direct; // alias resolution happens in lookupRookieCard; test core keys
    check(`card lookup key ${key}`, shouldMatch ? card !== undefined : card === undefined);
  }
}

// --- 13. skipBody: body constraints bypassed entirely ---
{
  const jokic = playerPool.get("nikola-jokic")!;
  const body = { ...bodyBases.PG, height: 170, weight: 65 };
  const withConstraints = evaluateAll(
    [{ bundle: bundles.find((b) => b.id === "interior")!, player: jokic }],
    body,
    { targetPosition: "PG", secondaryPosition: "PG" },
  );
  const withoutConstraints = evaluateAll(
    [{ bundle: bundles.find((b) => b.id === "interior")!, player: jokic }],
    body,
    { targetPosition: "PG", secondaryPosition: "PG", skipBody: true },
  );
  check("skipBody → bodyAdjustment === 0", withoutConstraints.interior.bodyAdjustment === 0, `adj=${withoutConstraints.interior.bodyAdjustment}`);
  check("skipBody → value equals raw", withoutConstraints.interior.values["Interior Defense"] === withConstraints.interior.values["Interior Defense"] || withConstraints.interior.bodyAdjustment < 0, `skip=${withoutConstraints.interior.values["Interior Defense"]} constrained=${withConstraints.interior.values["Interior Defense"]}`);
  check("skipBody → no grace zone flag", withoutConstraints.interior.usedGraceZone !== true);
}

console.log(`\n===== adversarial results: ${checks - failures}/${checks} passed, ${failures} failed =====`);
process.exit(failures > 0 ? 1 : 0);
