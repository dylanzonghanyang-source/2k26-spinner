#!/usr/bin/env -S node --experimental-strip-types
/**
 * UI Bugfix — Slot Selection / Repeated Donor Audit。
 *
 * 根因：applyBundleLockTransaction (src/createResult.ts) 无条件拒绝
 * 同一 playerId 重复锁定（usedPlayerIds guard），custom/self-build 与
 * challenge 共用同一事务层 → Repro A（Deron Williams 2005 背身+力量）
 * / Repro B（D'Angelo Russell 2015 抢断+盖帽）失败。
 *
 * 修复：事务层增加 allowDuplicateDonor 参数；custom 模式（isManualSelection）
 * 传 true，challenge 模式保持默认 false（原玩法限制不变）。
 */
import assert from "node:assert/strict";
import { applyBundleLockTransaction, bundles, evaluateAll } from "../src/createResult.ts";
import { loadRookieCards, lookupRookieCard } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };

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

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error(`❌ ${msg}`); }
}

// 找测试卡：Deron Williams 2005（post 槽可用）与 D'Angelo Russell 2015
const deron = lookupRookieCard(cards, "Deron Williams");
assert.ok(deron, "Deron Williams card exists");
const dlo = lookupRookieCard(cards, "D'Angelo Russell");
assert.ok(dlo, "D'Angelo Russell card exists");
const deronId = `card:${deron.slug}`;
const dloId = `card:${dlo.slug}`;
const post = bundles.find((b) => b.id === "post")!;
const strength = bundles.find((b) => b.id === "strength")!;
const steal = bundles.find((b) => b.id === "steal")!;
const block = bundles.find((b) => b.id === "block")!;
const three = bundles.find((b) => b.id === "three")!;
const dunk = bundles.find((b) => b.id === "dunk")!;

// ── 1. 事务层：custom 模式允许同卡多槽 ──
{
  const t1 = applyBundleLockTransaction({}, "post", { kind: "player", playerId: deronId }, new Set(), true);
  ok(t1.accepted, "T1: post 锁定 accepted (custom)");
  const t2 = applyBundleLockTransaction(t1.next, "strength", { kind: "player", playerId: deronId }, t1.usedPlayerIds, true);
  ok(t2.accepted, "T2: strength 同卡 accepted (custom, duplicate donor allowed)");
  ok(t2.next.post?.kind === "player" && t2.next.post.playerId === deronId, "T2: post 槽保持");
  ok(t2.next.strength?.kind === "player" && t2.next.strength.playerId === deronId, "T2: strength 槽写入");
  const t3 = applyBundleLockTransaction(t2.next, "block", { kind: "player", playerId: dloId }, t2.usedPlayerIds, true);
  ok(t3.accepted, "T3: block 另一卡 accepted");
  const t4 = applyBundleLockTransaction(t3.next, "steal", { kind: "player", playerId: dloId }, t3.usedPlayerIds, true);
  ok(t4.accepted, "T4: steal 同卡 accepted (Repro B 场景)");
}

// ── 2. 事务层：challenge 模式保持拒绝重复 ──
{
  const t1 = applyBundleLockTransaction({}, "post", { kind: "player", playerId: deronId }, new Set(), false);
  const t2 = applyBundleLockTransaction(t1.next, "strength", { kind: "player", playerId: deronId }, t1.usedPlayerIds, false);
  ok(!t2.accepted, "T5: challenge 模式重复 donor 拒绝");
  ok(t2.next === t1.next, "T5: 拒绝时状态不变（同引用）");
  const t3 = applyBundleLockTransaction(t1.next, "strength", { kind: "player", playerId: dloId }, t1.usedPlayerIds, false);
  ok(t3.accepted, "T6: challenge 模式不同卡 accepted");
  // 默认参数（省略第 5 参）保持旧行为
  const d1 = applyBundleLockTransaction({}, "post", { kind: "player", playerId: deronId }, new Set());
  const d2 = applyBundleLockTransaction(d1.next, "strength", { kind: "player", playerId: deronId }, d1.usedPlayerIds);
  ok(!d2.accepted, "T7: 默认参数 = challenge 语义（拒绝重复）");
}

// ── 3. 同一卡连续 3 个槽，独立保存 ──
{
  let state: ReturnType<typeof applyBundleLockTransaction> | null = null;
  for (const bundleId of ["post", "strength", "dunk"]) {
    state = applyBundleLockTransaction(state?.next ?? {}, bundleId, { kind: "player", playerId: deronId }, state?.usedPlayerIds ?? new Set(), true);
    ok(state.accepted, `T8: ${bundleId} 同卡第 N 槽 accepted`);
  }
  const locks = state!.next as Record<string, { kind: "player"; playerId: string }>;
  ok(locks.post.playerId === deronId && locks.strength.playerId === deronId && locks.dunk.playerId === deronId,
    "T9: 三个槽各自保存同一 donor");
  // 删除其中一个（模拟 unlockBundle 的 stillUsed 逻辑）
  const withoutDunk = { ...locks };
  delete withoutDunk.dunk;
  const stillUsed = Object.values(withoutDunk).some((l) => l.kind === "player" && l.playerId === deronId);
  ok(stillUsed, "T10: 删除 dunk 后 post/strength 仍使用该 donor → usedPlayerIds 保留");
  // 替换一个槽：不修改同 donor 其他槽
  const replaced = { ...withoutDunk, post: { kind: "player", playerId: dloId } };
  ok(replaced.strength.playerId === deronId, "T11: 替换 post 后 strength 槽不受影响");
  ok(replaced.dunk === undefined, "T11: 替换 post 后 dunk 仍是删除状态");
}

// ── 4. evaluateAll 分别读取对应 bundle（同卡跨槽无串扰） ──
{
  // DLo 在 roster 且有多张卡；Deron 只有卡不在 roster → 用 DLo 验证同卡跨槽
  const dloSource = players.get("test:dangelo-russell") ?? null;
  const inputs = [
    { bundle: steal, player: dloSource, card: dlo },
    { bundle: block, player: dloSource, card: dlo },
  ];
  const evals = evaluateAll(inputs, { height: 200, weight: 95 } as never, { skipBody: true } as never);
  const stealEval = evals.steal;
  const blockEval = evals.block;
  ok(stealEval?.values["Steal"] != null, "T12: steal 槽继承 Steal");
  ok(blockEval?.values["Block"] != null, "T13: block 槽继承 Block");
  // 同卡不同 bundle 不应互相污染
  ok(stealEval?.values["Block"] == null, "T14: steal 槽不含 Block（无串扰）");
  ok(blockEval?.values["Steal"] == null, "T15: block 槽不含 Steal（无串扰）");
}

// ── 5. 完整 locks → evaluateAll → createResult 路径（同卡多槽） ──
{
  const locks = {
    post: { kind: "player", playerId: deronId },
    strength: { kind: "player", playerId: deronId },
    steal: { kind: "player", playerId: dloId },
    block: { kind: "player", playerId: dloId },
  } as const;
  // 从 locks 恢复 usedPlayerIds（draft restore 逻辑的 Set 去重）
  const used = new Set(Object.values(locks).filter((l): l is { kind: "player"; playerId: string } => l.kind === "player").map((l) => l.playerId));
  ok(used.size === 2, "T16: 恢复的 usedPlayerIds 去重（2 个 donor, 4 个槽）");
  // 再次提交同一 donor 到新槽（custom）仍 accepted
  const t = applyBundleLockTransaction(locks as never, "three", { kind: "player", playerId: deronId }, used, true);
  ok(t.accepted && t.next.three.playerId === deronId, "T17: 恢复后同卡新槽 accepted");
}

// ── 6. custom vs challenge 语义对比（isManualSelection 开关） ──
{
  const customMode = true;
  const challengeMode = false;
  const s1 = applyBundleLockTransaction({}, "steal", { kind: "player", playerId: dloId }, new Set(), customMode);
  const s2 = applyBundleLockTransaction(s1.next, "block", { kind: "player", playerId: dloId }, s1.usedPlayerIds, customMode);
  ok(s2.accepted, "T18: custom 模式 DLo steal+block 成功（Repro B）");
  const c1 = applyBundleLockTransaction({}, "steal", { kind: "player", playerId: dloId }, new Set(), challengeMode);
  const c2 = applyBundleLockTransaction(c1.next, "block", { kind: "player", playerId: dloId }, c1.usedPlayerIds, challengeMode);
  ok(!c2.accepted, "T19: challenge 模式 DLo steal+block 拒绝（原语义）");
}

// ── 7. 不同 donor 不受影响（模式无关） ──
{
  const t1 = applyBundleLockTransaction({}, "post", { kind: "player", playerId: deronId }, new Set(), true);
  const t2 = applyBundleLockTransaction(t1.next, "three", { kind: "player", playerId: dloId }, t1.usedPlayerIds, true);
  ok(t2.accepted && t2.next.three.playerId === dloId, "T20: custom 模式不同卡跨槽正常");
}

console.log(`duplicate-donor: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
