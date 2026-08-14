#!/usr/bin/env -S node --experimental-strip-types
/**
 * Stage 6C.1 — Legacy Save Semantics Audit。
 *
 * 目标：同一 old result 若具备足够 provenance，resolve/recompute 必须等于
 * 用当前 Final Policy 对同一 final atomics 重新计算的 V3-E display OVR；
 * 不修改 old attributes / potential / growth。
 *
 * Fixtures：
 *  F1 old single-card save：stored Intangibles = real card Intangibles
 *     → recomputed 应使用 real Intangibles
 *  F2 old multi-donor save：Potential donor Int ≠ 50，stored = potential value
 *     → 无 donor provenance → legacyFallback（不猜测 50）
 *  F3 old multi-donor save：stored == 50 → recompute with 50（安全，任何场景 Final=50）
 *  F4 old custom explicit save：stored = custom 88，single-card 卡 real ≠ 88
 *     → 无法证明 custom（无 locks）→ legacyFallback（不猜测保留）
 *  F5 old custom explicit 且 == card real：S3 可证明 → recompute 保留
 *  F6 无足够 provenance（缺 attrs / 缺 position / stored ≠ 50 无 card）
 *     → legacyFallback 明确标记
 */
import assert from "node:assert/strict";
import { bodyBases, bundles, createResult, type LockState } from "../src/createResult.ts";
import { loadRookieCards } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };
import { resolveDisplayOverall } from "../src/displayOverall.ts";
import { estimateDisplayOverallV3EFromRecord } from "../src/rookieOverallV3E.ts";

type CatalogPlayer = { id: string; name: string; position: string | null; height: string | null; overall: number | null; potential?: number | null };
type CatalogTeam = { id: string; name: string; category: string; players: CatalogPlayer[] };
type DetailedPlayer = {
  slug: string; potential?: number | null; height?: string | null; weight?: number | null;
  wingspan?: string | null; shooting: number | null; athleticism: number | null;
  playmaking: number | null; defense: number | null; inside: number | null;
  detailed: Record<string, number | null>;
};
const detailedBySlug = new Map<string, DetailedPlayer>(
  (players26 as DetailedPlayer[]).map((p) => [p.slug, p]),
);
function buildSource(player: CatalogPlayer): PlayerSource {
  const detailed = detailedBySlug.get(player.id);
  return {
    id: `test:${player.id}`, name: player.name, slug: player.id,
    rosterCategory: "current", rosterTeam: "Test", isEstimated: !detailed,
    badges: (badges26 as Record<string, PlayerSource["badges"]>)[player.id] ?? [],
    badgesKnown: Object.hasOwn(badges26 as Record<string, unknown>, player.id),
    overall: player.overall ?? 72, potential: player.potential ?? detailed?.potential ?? null,
    team: "Test", position: player.position, archetype: null,
    height: player.height ?? detailed?.height ?? null, weight: detailed?.weight ?? null,
    wingspan: detailed?.wingspan ?? null,
    shooting: detailed?.shooting ?? 60, athleticism: detailed?.athleticism ?? 60,
    playmaking: detailed?.playmaking ?? 60, defense: detailed?.defense ?? 60,
    inside: detailed?.inside ?? 60, detailed: detailed?.detailed ?? {},
  };
}
const currentPlayers: CatalogPlayer[] = (roster26 as { teams: CatalogTeam[] }).teams
  .filter((t) => t.category === "current").flatMap((t) => t.players);
const players = new Map<string, PlayerSource>(currentPlayers.map((p) => [`test:${p.id}`, buildSource(p)]));
const cards = await loadRookieCards();
const tendencyLookup = createTendencyLookup(tendencies26 as TendencyTable);

const luka = players.get("test:luka-doncic");
assert.ok(luka);
const lukaId = luka.id;
const wemby = players.get("test:victor-wembanyama");
assert.ok(wemby);
const wembyId = wemby.id;
const lukaCard = cards.get("luka doncic") as { detailed?: Record<string, number> } | undefined;
assert.ok(lukaCard, "luka card must exist");

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error(`❌ ${msg}`); }
}

function allLocksExcept(exceptId: string | null, playerId: string): LockState {
  const locks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === exceptId) continue;
    locks[bundle.id] = { kind: "player", playerId };
  }
  return locks;
}

// 参考：Final Policy 重算（当前 createResult 的输出就是权威）
const freshSingle = createResult(allLocksExcept(null, lukaId), 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);

// F1. old single-card save：stored Int = real card Int → S3 可证明 → recompute 匹配 fresh
{
  const old = { ...freshSingle };
  delete (old as Record<string, unknown>).v3eDisplayOverall;
  delete (old as Record<string, unknown>).v3eDisplayOverallRaw;
  const storedInt = old.initialAttrs["Intangibles"];
  const cardInt = old.card?.detailed?.["Intangibles"];
  ok(typeof storedInt === "number" && typeof cardInt === "number" && storedInt === cardInt,
    "F1 fixture 前提：single-card stored Int == card real Int");
  const res = resolveDisplayOverall(old);
  ok(res.source === "recomputed", "F1: single-card old save recomputes (S3)");
  ok(res.overall === freshSingle.v3eDisplayOverall,
    `F1: recomputed === fresh Final Policy (${res.overall} vs ${freshSingle.v3eDisplayOverall})`);
}

// F2. old multi-donor save：stored = Potential-donor 值 ≠ 50，无 card → 不猜 → fallback
{
  const multi = createResult({
    three: { kind: "player", playerId: lukaId },
    potential: { kind: "player", playerId: wembyId },
    ...Object.fromEntries(bundles.filter((b) => b.id !== "three" && b.id !== "potential").map((b) => [b.id, { kind: "player", playerId: wembyId }])),
  } as LockState, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  // 构造"旧存档"：无 v3e 字段；stored Int 强制设为 potential donor 值（模拟 pre-6B 语义）
  const old = { ...multi };
  delete (old as Record<string, unknown>).v3eDisplayOverall;
  delete (old as Record<string, unknown>).v3eDisplayOverallRaw;
  const potentialInt = (wemby.detailed?.["Intangibles"] ?? 0);
  ok(potentialInt !== 50, "F2 fixture 前提：Potential donor Int ≠ 50");
  old.initialAttrs = { ...old.initialAttrs, Intangibles: potentialInt };
  old.card = null; // multi-donor：无 singleCard
  const res = resolveDisplayOverall(old);
  ok(res.source === "legacyFallback",
    `F2: multi-donor 无 provenance → legacyFallback（不猜测 50），got source=${res.source}`);
  ok(res.overall === old.initialStrength, "F2: fallback 显示 legacy initialStrength 并标记");
}

// F3. old multi-donor save：stored == 50 → S2 安全 recompute with 50
{
  const old = { ...freshSingle };
  delete (old as Record<string, unknown>).v3eDisplayOverall;
  delete (old as Record<string, unknown>).v3eDisplayOverallRaw;
  old.initialAttrs = { ...old.initialAttrs, Intangibles: 50 };
  old.card = null;
  const res = resolveDisplayOverall(old);
  const expected = estimateDisplayOverallV3EFromRecord(old.initialAttrs, "PG").score;
  ok(res.source === "recomputed" && res.overall === expected,
    `F3: stored=50 → S2 recompute with 50 (${res.overall})`);
}

// F4. old custom explicit save：stored = 88，single-card real ≠ 88 → 无法证明 → fallback
{
  const customLocks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    customLocks[bundle.id] = { kind: "player", playerId: lukaId };
  }
  customLocks["passing"] = { kind: "custom", values: { Intangibles: 88 } };
  const customResult = createResult(customLocks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const cardReal = customResult.card?.detailed?.["Intangibles"];
  ok(customResult.intangibles === 88 && cardReal !== 88,
    "F4 fixture 前提：stored=88（custom），card real ≠ 88（或无 card real）");
  const old = { ...customResult };
  delete (old as Record<string, unknown>).v3eDisplayOverall;
  delete (old as Record<string, unknown>).v3eDisplayOverallRaw;
  const res = resolveDisplayOverall(old);
  ok(res.source === "legacyFallback",
    `F4: custom 无法与 potential 污染区分（无 locks provenance）→ legacyFallback（不猜），got ${res.source}`);
}

// F5. custom explicit 且 == card real：S3 可证明 → recompute 保留
{
  const cardReal = freshSingle.card?.detailed?.["Intangibles"];
  if (typeof cardReal === "number") {
    const customLocks: LockState = {};
    for (const bundle of bundles) {
      if (bundle.id === "potential") continue;
      customLocks[bundle.id] = { kind: "player", playerId: lukaId };
    }
    customLocks["passing"] = { kind: "custom", values: { Intangibles: cardReal } };
    const customResult = createResult(customLocks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
    const old = { ...customResult };
    delete (old as Record<string, unknown>).v3eDisplayOverall;
    delete (old as Record<string, unknown>).v3eDisplayOverallRaw;
    const res = resolveDisplayOverall(old);
    ok(res.source === "recomputed" && res.overall === customResult.v3eDisplayOverall,
      `F5: custom == card real → S3 recompute 保留 (${res.overall})`);
  } else {
    ok(true, "F5: skip（card 无 real Intangibles）");
  }
}

// F6. 无足够 provenance → legacyFallback
{
  const noAttrs = resolveDisplayOverall({ position: "PG", initialStrength: 74, initialAttrs: null } as never);
  ok(noAttrs.source === "legacyFallback" && noAttrs.overall === 74, "F6a: 无 attrs → fallback");
  const noPos = resolveDisplayOverall({ initialAttrs: { Intangibles: 60 }, initialStrength: 76 } as never);
  ok(noPos.source === "legacyFallback", "F6b: 无 position → fallback");
  const weird = resolveDisplayOverall({
    position: "PG", initialStrength: 70,
    initialAttrs: { ThreePointShot: 90, Intangibles: 60 },
    card: null,
  } as never);
  ok(weird.source === "legacyFallback", "F6c: stored≠50 无 card → fallback（不猜）");
}

// 不修改 old attributes/growth/potential：resolve 是纯函数（不改入参）
{
  const old = { ...freshSingle };
  delete (old as Record<string, unknown>).v3eDisplayOverall;
  const snapshot = JSON.stringify(old);
  resolveDisplayOverall(old);
  ok(JSON.stringify(old) === snapshot, "resolve 不修改 old result（纯函数）");
}

console.log(`stage6c1-legacy-save: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
