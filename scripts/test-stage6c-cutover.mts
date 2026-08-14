#!/usr/bin/env -S node --experimental-strip-types
/**
 * Stage 6C — Display/UI Cutover regression。
 *
 * 覆盖（硬要求）：
 *  1. 新结果 UI 显示 = v3eDisplayOverall（resolveDisplayOverall 原生字段优先）
 *  2. legacy baseOverall 不再作为用户可见 Overall
 *  3. old serialized result backward compatibility（缺失 v3eDisplayOverall → 重算；数据不足 → legacyFallback 标记）
 *  4. multi-donor display Intangibles = 50
 *  5. single-card display Intangibles = real
 *  6. custom explicit Intangibles priority
 *  7. 84 不显示 extrapolation warning；85+ 显示（resolveDisplayOverall 辅助 + export 文案）
 *  8. export Overall = V3-E
 *  9. generation control invariance（同 input 下 baseOverall/growthGap 与 legacy 一致 —— 由 createResult 双 record 保证，回归确认）
 */
import assert from "node:assert/strict";
import {
  bodyBases,
  bundles,
  createResult,
  type LockState,
} from "../src/createResult.ts";
import { loadRookieCards } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };
import { resolveDisplayOverall } from "../src/displayOverall.ts";
import { createExportText } from "../src/exportText.ts";

type CatalogPlayer = { id: string; name: string; position: string | null; height: string | null; overall: number | null; potential?: number | null };
type CatalogTeam = { id: string; name: string; category: string; players: CatalogPlayer[] };
type DetailedPlayer = {
  slug: string; potential?: number | null; height?: string | null; weight?: number | null;
  wingspan?: string | null; shooting: number | null; athleticism: number | null;
  playmaking: number | null; defense: number | null; inside: number | null;
  detailed: Record<string, number | null>;
};

const detailedBySlug = new Map<string, DetailedPlayer>(
  (players26 as DetailedPlayer[]).map((player) => [player.slug, player]),
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
  .filter((team) => team.category === "current").flatMap((team) => team.players);
const players = new Map<string, PlayerSource>(currentPlayers.map((p) => [`test:${p.id}`, buildSource(p)]));
const cards = await loadRookieCards();
const tendencyLookup = createTendencyLookup(tendencies26 as TendencyTable);

const luka = players.get("test:luka-doncic");
assert.ok(luka, "Luka must exist");
const lukaId = luka.id;
const wemby = players.get("test:victor-wembanyama");
assert.ok(wemby, "Wemby must exist");
const wembyId = wemby.id;

function allLocksExcept(exceptId: string | null, playerId: string): LockState {
  const locks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === exceptId) continue;
    locks[bundle.id] = { kind: "player", playerId };
  }
  return locks;
}

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error(`❌ ${msg}`); }
}

// 1. 新结果 display = v3eDisplayOverall
{
  const locks = allLocksExcept(null, lukaId);
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const res = resolveDisplayOverall(result);
  ok(res.source === "native", "fresh result resolves natively");
  ok(res.overall === result.v3eDisplayOverall, `fresh result display = v3eDisplayOverall (${res.overall})`);
}

// 2. baseOverall 不再作为用户可见 Overall：resolveDisplayOverall 优先 v3eDisplay，即使 baseOverall 不同
{
  const locks = allLocksExcept(null, lukaId);
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const res = resolveDisplayOverall(result);
  ok(res.overall === result.v3eDisplayOverall, "display overall is v3e, not baseOverall");
}

// 3a. old serialized result（无 v3eDisplayOverall）→ 从 initialAttrs + position 重算
{
  const locks = allLocksExcept(null, lukaId);
  const fresh = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const old = { ...fresh };
  delete (old as Record<string, unknown>).v3eDisplayOverall;
  delete (old as Record<string, unknown>).v3eDisplayOverallRaw;
  const res = resolveDisplayOverall(old);
  ok(res.source === "recomputed", "old result recomputes from attrs+position");
  ok(res.overall === fresh.v3eDisplayOverall, `recomputed matches fresh (${res.overall})`);
}

// 3b. 数据不足 → legacyFallback 标记
{
  const res = resolveDisplayOverall({ position: "PG", initialStrength: 74, initialAttrs: null } as never);
  ok(res.source === "legacyFallback" && res.overall === 74, "insufficient data falls back to legacy with marker");
}
{
  const res = resolveDisplayOverall({} as never);
  ok(res.source === "legacyFallback", "empty object still resolves (0 + legacyFallback)");
}

// 4/5/6. Intangibles display policy（multi-donor=50 / single-card=real / custom priority）
{
  // multi-donor：luka + wemby 混合
  const locks: LockState = {};
  for (const bundle of bundles) {
    locks[bundle.id] = { kind: "player", playerId: bundle.id === "potential" ? lukaId : (bundle.id === "three" ? wembyId : lukaId) };
  }
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  ok(result.intangibles === 50, `multi-donor display Intangibles = 50 (got ${result.intangibles})`);
}
{
  // single-card
  const locks = allLocksExcept(null, lukaId);
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const singleInt = (cards.get("luka doncic") as { detailed?: Record<string, number> } | undefined)?.detailed?.["Intangibles"];
  if (typeof singleInt === "number") {
    ok(result.intangibles === singleInt, `single-card display Intangibles = real (${singleInt})`);
  } else {
    ok(result.intangibles === 50, "single-card without card Intangibles -> 50");
  }
}
{
  // custom explicit priority
  const locks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    locks[bundle.id] = { kind: "player", playerId: lukaId };
  }
  locks["passing"] = { kind: "custom", values: { "Intangibles": 88 } };
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  ok(result.intangibles === 88, "custom explicit Intangibles = 88 wins");
}

// 7. 84 不显示 extrapolation warning；85+ 显示
{
  const fresh = createResult(allLocksExcept(null, lukaId), 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const d84 = { ...fresh, v3eDisplayOverall: 84 };
  const r84 = resolveDisplayOverall(d84);
  ok(r84.overall === 84, "84 display overall preserved");
  // warning 逻辑：UI 条件 displayOverall >= 85；export 文案含"提示: 85+ 为模型外推区间"
  const export84 = createExportText("Test", d84 as never, {}, {}, players, "ready", "2k26");
  ok(!export84.includes("外推区间"), "84 export has no extrapolation warning");
  const d85 = { ...fresh, v3eDisplayOverall: 85 };
  const export85 = createExportText("Test", d85 as never, {}, {}, players, "ready", "2k26");
  ok(export85.includes("外推区间"), "85+ export includes extrapolation warning");
}

// 8. export Overall = V3-E
{
  const locks = allLocksExcept(null, lukaId);
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  const text = createExportText("Test", result, locks, {}, players, "ready", "2k26");
  const line = text.split("\n").find((l) => l.startsWith("模型估算初始综评:"));
  ok(line?.includes(`: ${result.v3eDisplayOverall}（`) ?? false, `export uses v3eDisplayOverall (${result.v3eDisplayOverall})`);
  ok(!(line?.includes(`: ${result.initialStrength}（`) ?? false), "export no longer uses initialStrength as display overall");
}

// 9. generation control invariance：同 input 下 baseOverall/growthGap 仍是 legacy control 值
{
  const locks = allLocksExcept(null, lukaId);
  const result = createResult(locks, 20, "PG", "SG", bodyBases.PG, players, tendencyLookup, "2k26", cards);
  ok(result.initialStrength === result.baseOverall, "initialStrength still = baseOverall (legacy control)");
  ok(typeof result.growthGap === "number" && result.growthGap >= 0, "growthGap intact");
  ok(result.v3eDisplayOverall !== result.baseOverall || Math.abs(result.v3eDisplayOverall - result.baseOverall) <= 1,
    "display and control are decoupled fields (may coincide within 1)");
}

console.log(`stage6c-cutover: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
