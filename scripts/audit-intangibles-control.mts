#!/usr/bin/env -S node --experimental-strip-types
/**
 * Stage 6B.1 — Intangibles Control-Side Effect Audit。
 *
 * 同一 deterministic 10000 multi-donor synthetic cases，分别跑：
 *   - pre-6B：Intangibles = custom > potentialCard > singleCard > 50（旧 policy）
 *   - post-6B：Intangibles = custom > singleCard > 50（新 policy，删 potentialCard）
 *
 * 通过环境变量 POLICY=pre|post 选择运行，输出完整控制链字段到 JSON，
 * 由 analyze 脚本对比。
 *
 * 对比字段：
 *   resolvedIntangibles
 *   constraint: originalOverall / triggered / offset（通过 constraint 结果）
 *   final non-Int atomic attributes
 *   baseOverall / initialStrength
 *   potential / growthGap / progressSpeed / yearsToPeak / peakStart / peakEnd
 *   boom / normal / bust
 */
import { writeFileSync } from "node:fs";
import {
  bodyBases,
  bundles,
  createResult,
  type LockState,
  type Position,
} from "../src/createResult.ts";
import { loadRookieCards } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };

type CatalogPlayer = {
  id: string;
  name: string;
  position: string | null;
  height: string | null;
  overall: number | null;
  potential?: number | null;
};
type CatalogTeam = { id: string; name: string; category: string; players: CatalogPlayer[] };
type DetailedPlayer = {
  slug: string;
  potential?: number | null;
  height?: string | null;
  weight?: number | null;
  wingspan?: string | null;
  shooting: number | null;
  athleticism: number | null;
  playmaking: number | null;
  defense: number | null;
  inside: number | null;
  detailed: Record<string, number | null>;
};

const policy = process.env.POLICY ?? "post";
const detailedBySlug = new Map<string, DetailedPlayer>(
  (players26 as DetailedPlayer[]).map((player) => [player.slug, player]),
);

function buildSource(player: CatalogPlayer): PlayerSource {
  const detailed = detailedBySlug.get(player.id);
  return {
    id: `test:${player.id}`,
    name: player.name,
    slug: player.id,
    rosterCategory: "current",
    rosterTeam: "Test",
    isEstimated: !detailed,
    badges: (badges26 as Record<string, PlayerSource["badges"]>)[player.id] ?? [],
    badgesKnown: Object.hasOwn(badges26 as Record<string, unknown>, player.id),
    overall: player.overall ?? 72,
    potential: player.potential ?? detailed?.potential ?? null,
    team: "Test",
    position: player.position,
    archetype: null,
    height: player.height ?? detailed?.height ?? null,
    weight: detailed?.weight ?? null,
    wingspan: detailed?.wingspan ?? null,
    shooting: detailed?.shooting ?? 60,
    athleticism: detailed?.athleticism ?? 60,
    playmaking: detailed?.playmaking ?? 60,
    defense: detailed?.defense ?? 60,
    inside: detailed?.inside ?? 60,
    detailed: detailed?.detailed ?? {},
  };
}

const currentPlayers: CatalogPlayer[] = (roster26 as { teams: CatalogTeam[] }).teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players);
const players = new Map<string, PlayerSource>(currentPlayers.map((player) => [
  `test:${player.id}`,
  buildSource(player),
]));
const allIds = [...players.keys()];
const cards = await loadRookieCards();
const tendencyLookup = createTendencyLookup(tendencies26 as TendencyTable);

// deterministic RNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 10000;
const rnd = mulberry32(0x6B2);
const positions: Position[] = ["PG", "SG", "SF", "PF", "C"];
const nonPotentialBundles = bundles.filter((b) => b.id !== "potential");
const results = [];

for (let i = 0; i < N; i++) {
  const locks: LockState = {};
  for (const bundle of bundles) {
    const id = allIds[Math.floor(rnd() * allIds.length)];
    locks[bundle.id] = { kind: "player", playerId: id };
  }
  const position = positions[Math.floor(rnd() * positions.length)];
  const secondary = positions[Math.floor(rnd() * positions.length)];
  const body = { ...bodyBases[position] };
  body.height = 170 + Math.floor(rnd() * 60);
  body.weight = 60 + Math.floor(rnd() * 60);
  body.wingspan = Math.floor(rnd() * 100) + 1;
  body.shoulder = Math.floor(rnd() * 100) + 1;
  body.neck = Math.floor(rnd() * 100) + 1;
  body.torso = Math.floor(rnd() * 100) + 1;
  const age = 18 + Math.floor(rnd() * 6);

  const result = createResult(locks, age, position, secondary, body, players, tendencyLookup, "2k26", cards);

  const nonIntAttrs: Record<string, number> = {};
  for (const [k, v] of Object.entries(result.initialAttrs)) {
    if (k !== "Intangibles") nonIntAttrs[k] = v;
  }

  results.push({
    i,
    intangibles: result.intangibles,
    constraintTarget: result.initialOverallTarget,
    constraintApplied: result.initialOverallConstraintApplied,
    constraintReachable: result.initialOverallConstraintReachable,
    nonIntAttrs,
    baseOverall: result.baseOverall,
    initialStrength: result.initialStrength,
    potential: result.potential,
    growthGap: result.growthGap,
    progressSpeed: result.progressSpeed,
    yearsToPeak: result.peakStart != null ? Math.max(0, Math.ceil(result.growthGap / result.progressSpeed)) : null,
    peakStart: result.peakStart,
    peakEnd: result.peakEnd,
    boom: result.boom,
    normal: result.normal,
    bust: result.bust,
  });
}

const outFile = `reports/int-control-${policy}.json`;
writeFileSync(outFile, JSON.stringify(results, null, 1));
console.log(`policy=${policy}: ${results.length} cases -> ${outFile}`);
