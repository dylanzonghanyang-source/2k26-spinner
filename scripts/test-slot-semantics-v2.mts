/**
 * Slot Semantics V2 — presentation acceptance tests (spec PART E).
 * Run: node --experimental-strip-types scripts/test-slot-semantics-v2.mts
 *
 * Stage 1 scope: pure computeSlotDisplay / effectiveWeightsFor.
 * (Stage 2/3 assertions for tendency/badge migration and UI integration
 * are appended in later stages.)
 */
import {
  computeSlotDisplay,
  effectiveWeightsFor,
  type SlotDisplayInput,
} from "../src/slotPresentation.ts";
import {
  FIXED_WEIGHT_SLOT_WEIGHTS,
  POSITION_AWARE_SLOT_WEIGHTS,
  SECONDARY_POSITION_SHARE,
  SINGLE_ATOMIC_SLOT_ATTRS,
  SLOT_POSITIONS,
  isPositionAwareSlot,
  type SlotId,
  type SlotPosition,
} from "../src/slotPresentationProfiles.ts";
import { bundles } from "../src/createResult.ts";

let failures = 0;
let checks = 0;
function check(label: string, condition: boolean, detail = "") {
  checks++;
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const EPS = 1e-9;

// ── fixtures ────────────────────────────────────────────────────
const POSITIONS: SlotPosition[] = [...SLOT_POSITIONS];

const slotOf = (id: string): SlotId => id as SlotId;

// ── E1.1 Body V2 final atomic 不受 presentation 影响 ────────────
// computeSlotDisplay 是纯只读函数：输入对象不被修改，无全局状态。
{
  const atomic = { "Driving Dunk": 90, "Standing Dunk": 50 };
  const snapshot = JSON.stringify(atomic);
  computeSlotDisplay({ slot: "dunk", finalAtomicValues: atomic, primaryPosition: "PG" });
  check("E1.1 presentation 不修改输入 atomic（纯函数）", JSON.stringify(atomic) === snapshot);
}

// ── E1.2 six single-atomic slots = atomic 值（全位置）──────────
{
  const atomic = {
    "Three-Point Shot": 90,
    "Perimeter Defense": 77,
    "Interior Defense": 55,
    Block: 61,
    Strength: 88,
    Potential: 80,
  };
  let allPass = true;
  const details: string[] = [];
  for (const [slot, attr] of Object.entries(SINGLE_ATOMIC_SLOT_ATTRS)) {
    for (const position of POSITIONS) {
      const r = computeSlotDisplay({
        slot: slotOf(slot),
        finalAtomicValues: { [attr]: atomic[attr] },
        primaryPosition: position,
      });
      if (r.score !== atomic[attr]) {
        allPass = false;
        details.push(`${slot}@${position}=${r.score} want ${atomic[attr]}`);
      }
    }
  }
  check("E1.2 六个单原子槽全位置 == 对应 atomic", allPass, details.join(", "));
}

// ── E1.3 fixed-weight slots 全位置 score 相同 ──────────────────
{
  const atomic = {
    "Mid-Range Shot": 80,
    "Free Throw": 70,
    "Pass Accuracy": 90,
    "Pass IQ": 80,
    "Pass Vision": 70,
    Steal: 60,
    "Pass Perception": 88,
    "Offensive Rebound": 75,
    "Defensive Rebound": 65,
    "Offensive Consistency": 70,
    "Defensive Consistency": 60,
    "Shot IQ": 90,
    "Help Defense IQ": 50,
    "Overall Durability": 80,
  };
  let allSame = true;
  const details: string[] = [];
  for (const slot of Object.keys(FIXED_WEIGHT_SLOT_WEIGHTS) as SlotId[]) {
    const scores = POSITIONS.map((p) => computeSlotDisplay({ slot, finalAtomicValues: atomic, primaryPosition: p }).score);
    if (new Set(scores).size !== 1) {
      allSame = false;
      details.push(`${slot}: ${scores.join("/")}`);
    }
  }
  check("E1.3 fixed-weight slots 全位置同分", allSame, details.join(", "));
}

// ── E1.4 五个 position-aware 槽使用精确权重 ───────────────────
{
  const values = {
    "Driving Dunk": 90,
    "Standing Dunk": 50,
    Layup: 80,
    "Close Shot": 60,
    "Draw Foul": 70,
    Hands: 50,
    "Post Fade": 75,
    "Post Hook": 65,
    "Post Control": 55,
    "Ball Handle": 85,
    "Speed with Ball": 70,
    Speed: 90,
    Agility: 80,
    Vertical: 70,
    Stamina: 60,
    Hustle: 50,
  };
  let allPass = true;
  const details: string[] = [];
  for (const [slot, byPosition] of Object.entries(POSITION_AWARE_SLOT_WEIGHTS)) {
    for (const position of POSITIONS) {
      const weights = byPosition[position];
      const expectedRaw = Object.entries(weights).reduce((s, [attr, w]) => s + values[attr] * w, 0);
      const expected = Math.round(expectedRaw);
      const r = computeSlotDisplay({ slot: slotOf(slot), finalAtomicValues: values, primaryPosition: position });
      if (Math.abs(r.score - expected) > 0.5 || Math.abs(r.rawWeightedScore - expectedRaw) > 1e-9) {
        allPass = false;
        details.push(`${slot}@${position}=${r.score}/${r.rawWeightedScore} want ${expected}/${expectedRaw}`);
      }
    }
  }
  check("E1.4 position-aware 槽精确权重", allPass, details.join(", "));
}

// ── E1.5 每组权重 sum == 1 ────────────────────────────────────
{
  let allOne = true;
  const details: string[] = [];
  const sumWeights = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
  for (const [slot, byPosition] of Object.entries(POSITION_AWARE_SLOT_WEIGHTS)) {
    for (const position of POSITIONS) {
      const sum = sumWeights(byPosition[position]);
      if (Math.abs(sum - 1) > 1e-12) {
        allOne = false;
        details.push(`${slot}@${position}=${sum}`);
      }
    }
  }
  for (const [slot, weights] of Object.entries(FIXED_WEIGHT_SLOT_WEIGHTS)) {
    const sum = sumWeights(weights);
    if (Math.abs(sum - 1) > 1e-12) {
      allOne = false;
      details.push(`fixed:${slot}=${sum}`);
    }
  }
  check("E1.5 所有权重 sum==1（epsilon<=1e-12）", allOne, details.join(", "));
}

// ── E1.6 secondary position 严格 75/25 混合 ───────────────────
{
  const r = computeSlotDisplay({
    slot: "dunk",
    finalAtomicValues: { "Driving Dunk": 90, "Standing Dunk": 50 },
    primaryPosition: "SG",
    secondaryPosition: "SF",
  });
  const expectedWeightDD = 0.8 * (1 - SECONDARY_POSITION_SHARE) + 0.7 * SECONDARY_POSITION_SHARE;
  const expectedWeightSD = 0.2 * (1 - SECONDARY_POSITION_SHARE) + 0.3 * SECONDARY_POSITION_SHARE;
  const expectedRaw = 90 * expectedWeightDD + 50 * expectedWeightSD;
  const expected = Math.round(expectedRaw);
  check(
    "E1.6 SG/SF secondary 75/25 混合",
    r.score === expected &&
      Math.abs(r.rawWeightedScore - expectedRaw) < 1e-9 &&
      Math.abs(r.effectiveWeights["Driving Dunk"] - expectedWeightDD) < 1e-9 &&
      Math.abs(r.effectiveWeights["Standing Dunk"] - expectedWeightSD) < 1e-9,
    `score=${r.score} want ${expected} | wDD=${r.effectiveWeights["Driving Dunk"]} want ${expectedWeightDD}`,
  );
  // 相同 secondary == primary → 100% primary
  const same = computeSlotDisplay({
    slot: "dunk",
    finalAtomicValues: { "Driving Dunk": 90, "Standing Dunk": 50 },
    primaryPosition: "PG",
    secondaryPosition: "PG",
  });
  check("E1.6b secondary==primary 时 100% primary", same.score === 84, `score=${same.score}`);
  // 缺失 secondary → 100% primary
  const none = computeSlotDisplay({
    slot: "dunk",
    finalAtomicValues: { "Driving Dunk": 90, "Standing Dunk": 50 },
    primaryPosition: "C",
    secondaryPosition: null,
  });
  check("E1.6c secondary 缺失 → 100% primary", none.score === 66, `score=${none.score}`);
}

// ── E1.7 仅最终 round，中间不 round ───────────────────────────
{
  const r = computeSlotDisplay({
    slot: "dunk",
    finalAtomicValues: { "Driving Dunk": 91, "Standing Dunk": 50 },
    primaryPosition: "PG",
  });
  // raw = 91*0.85 + 50*0.15 = 77.35 + 7.5 = 84.85 → round 85
  // 若中途 round 每个乘积：round(77.35)=77 + round(7.5)=8 → 85（相同，但
  // 用 0.5 边界验证更严格）
  const r2 = computeSlotDisplay({
    slot: "handle",
    finalAtomicValues: { "Ball Handle": 60, "Speed with Ball": 60 },
    primaryPosition: "PG",
  });
  check(
    "E1.7 rawWeightedScore 保留浮点、仅 score 一次 round",
    Math.abs(r.rawWeightedScore - 84.85) < 1e-9 && r.score === 85 && r2.score === 60,
    `raw=${r.rawWeightedScore} score=${r.score}`,
  );
}

// ── E1.8 slot score 不可成为 Body V2 输入 ─────────────────────
{
  const r = computeSlotDisplay({ slot: "dunk", finalAtomicValues: { "Driving Dunk": 90, "Standing Dunk": 50 }, primaryPosition: "PG" });
  // Body V2 的输入是 finalAtomicValues；presentation 模块不 import Body V2
  // 模块、不调用 evaluateAtomic。这里验证模块级隔离：computeSlotDisplay
  // 只返回 score/weights，不产生任何可被 Body V2 消费的副作用。
  check("E1.8 presentation 输出不含 Body V2 可写路径（无回写 API）", Object.keys(r).length === 4);
}

// ── E1.9 slot score 不可成为 OVR 输入 ─────────────────────────
{
  // computeSlotDisplay 不 import rookieOverall / estimateGameOverall。
  // 通过 module graph 静态检查：presentation 模块唯一依赖是
  // slotPresentationProfiles.ts（配置纯数据）。
  // 这里用运行时行为验证：无 badges/position-model 相关输出。
  const r = computeSlotDisplay({ slot: "passing", finalAtomicValues: { "Pass Accuracy": 90, "Pass IQ": 80, "Pass Vision": 70 }, primaryPosition: "PG" });
  check("E1.9 OVR 相关性：输出只有 score/weights（无 OVR 字段）", r.score === 81 && !("overall" in r));
}

// ── E1.10 provisional 只影响 metadata，不改变 numeric score ──
{
  const base = {
    slot: "dunk" as SlotId,
    finalAtomicValues: { "Driving Dunk": 90, "Standing Dunk": 50 },
    primaryPosition: "PG" as SlotPosition,
  };
  const normal = computeSlotDisplay(base);
  const provisional = computeSlotDisplay({ ...base, supportIncomplete: true });
  check(
    "E1.10 provisional 不改 score / rawWeightedScore",
    provisional.score === normal.score &&
      provisional.rawWeightedScore === normal.rawWeightedScore &&
      provisional.provisional === true &&
      normal.provisional === false,
    `normal=${normal.score}/${normal.provisional} prov=${provisional.score}/${provisional.provisional}`,
  );
}

// ── 固定锚点（spec E1）────────────────────────────────────────
{
  const dunkValues = { "Driving Dunk": 90, "Standing Dunk": 50 };
  const anchors: Array<[SlotPosition, number]> = [
    ["PG", 84], ["SG", 82], ["SF", 78], ["PF", 72], ["C", 66],
  ];
  for (const [position, want] of anchors) {
    const r = computeSlotDisplay({ slot: "dunk", finalAtomicValues: dunkValues, primaryPosition: position });
    check(`anchor Dunk@${position}`, r.score === want, `score=${r.score}`);
  }
  // SG/SF secondary anchor: weights 0.775/0.225 → round(90*0.775+50*0.225)=81
  const sgSf = computeSlotDisplay({
    slot: "dunk",
    finalAtomicValues: dunkValues,
    primaryPosition: "SG",
    secondaryPosition: "SF",
  });
  check("anchor Dunk SG/SF secondary", sgSf.score === 81, `score=${sgSf.score}`);
  // Single atomic invariance: Three-Point Shot=90 全位置 90
  const threeAll = POSITIONS.every((p) =>
    computeSlotDisplay({ slot: "three", finalAtomicValues: { "Three-Point Shot": 90 }, primaryPosition: p }).score === 90);
  check("anchor Three-Point Shot 全位置 90", threeAll);
  // Passing invariance: 90/80/70 → 81 全位置
  const passingAll = POSITIONS.every((p) =>
    computeSlotDisplay({ slot: "passing", finalAtomicValues: { "Pass Accuracy": 90, "Pass IQ": 80, "Pass Vision": 70 }, primaryPosition: p }).score === 81);
  check("anchor Passing 全位置 81", passingAll);
}

// ── 16 槽覆盖：bundles 全槽都有 presentation 定义 ─────────────
{
  const defined = new Set<SlotId>([
    ...Object.keys(SINGLE_ATOMIC_SLOT_ATTRS) as SlotId[],
    ...Object.keys(FIXED_WEIGHT_SLOT_WEIGHTS) as SlotId[],
    ...Object.keys(POSITION_AWARE_SLOT_WEIGHTS) as SlotId[],
  ]);
  const missing = bundles.filter((b) => !defined.has(b.id as SlotId)).map((b) => b.id);
  check("16 槽全部有 presentation 定义", missing.length === 0 && defined.size === 16, `missing=${missing.join(",")} size=${defined.size}`);
}

// ── effectiveWeightsFor 不读其他槽 / 不读 OVR / 不读 Body trace ──
{
  const w = effectiveWeightsFor({ slot: "athletic", finalAtomicValues: {}, primaryPosition: "PF", secondaryPosition: "C" });
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  check("athletic PF/C 混合权重 sum==1", Math.abs(sum - 1) < EPS, `sum=${sum}`);
  const sf = effectiveWeightsFor({ slot: "face", finalAtomicValues: {}, primaryPosition: "SF" });
  check("face SF 单 primary 权重", Math.abs(sf.Layup - 0.38) < EPS && Math.abs(sf["Close Shot"] - 0.27) < EPS);
}

// ── 浮点边界：0.5 邻近值必须按数学值 round ──────────────────
{
  // 97*0.85 + 50*0.15 = 89.95（IEEE 754 下为 89.9499999...）→ 必须 round 90
  const r = computeSlotDisplay({
    slot: "dunk",
    finalAtomicValues: { "Driving Dunk": 97, "Standing Dunk": 50 },
    primaryPosition: "PG",
  });
  check("float boundary: 89.95 → 90（epsilon 补偿）", r.score === 90, `score=${r.score} raw=${r.rawWeightedScore}`);
}

// ── isPositionAwareSlot 覆盖 ──────────────────────────────────
{
  const pa = ["face", "post", "dunk", "handle", "athletic"];
  const notPa = ["three", "mid", "passing", "perimeter", "interior", "steal", "block", "rebound", "strength", "stability", "potential"];
  const okPa = pa.every((s) => isPositionAwareSlot(s as SlotId));
  const okNot = notPa.every((s) => !isPositionAwareSlot(s as SlotId));
  check("position-aware 槽位枚举正确", okPa && okNot);
}

// ══════════════════════════════════════════════════════════════
// Stage 2 — tendency / badge ownership migration (spec C/D/E2/E3)
// ══════════════════════════════════════════════════════════════
import { tendencyBundleMap } from "../src/components/tendencyBundleMap.ts";
import { badgeBundleMap } from "../src/components/badgeBundleMap.ts";
import tendencyProfilesData from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };

// E2.1/E2.2 — 96 tendencies 全部存在，总 assignment 仍为 96，每字段恰一 owner
{
  const atdFields = (tendencyProfilesData as { fields: string[] }).fields;
  const mapped = Object.keys(tendencyBundleMap);
  const missing = atdFields.filter((f) => !mapped.includes(f));
  const extra = mapped.filter((f) => !atdFields.includes(f));
  const counts: Record<string, number> = {};
  for (const owner of Object.values(tendencyBundleMap)) counts[owner] = (counts[owner] ?? 0) + 1;
  check("E2.1 ATD 96 字段全部有 owner", missing.length === 0, `missing=${missing.join(",")}`);
  check("E2.2a map 无 ATD 之外字段", extra.length === 0, `extra=${extra.join(",")}`);
  check("E2.2b 总 assignment = 96", mapped.length === 96, `mapped=${mapped.length}`);
  check("E2.2c 每字段恰一 owner（Record 天然单值）", new Set(mapped).size === mapped.length);
  check("E2.2d 无 Iso vs Poor Defender / Contest Shot 伪造值",
    !mapped.includes("Iso vs Poor Defender") && !mapped.includes("ContestShot") && !mapped.includes("Contest Shot"));
}

// E2.3 — 六个冻结迁移全部正确
{
  const get = (f: string) => tendencyBundleMap[f];
  const ok =
    get("Alley-Oop") === "dunk" &&
    get("Putback") === "rebound" &&
    get("Iso vs Elite Defender") === "handle" &&
    get("Iso vs Good Defender") === "handle" &&
    get("Iso vs Average Defender") === "handle" &&
    get("Transition Spot Up vs Cut to the Basket") === "stability";
  check("E2.3 六个冻结迁移正确", ok);
}

// E2.4 — 预期局部结果：face 13 / dunk 4 / rebound 2 / handle 24 / stability 4 / passing 4
{
  const counts: Record<string, number> = {};
  for (const owner of Object.values(tendencyBundleMap)) counts[owner] = (counts[owner] ?? 0) + 1;
  const want: Record<string, number> = { face: 13, dunk: 4, rebound: 2, handle: 24, stability: 4, passing: 4 };
  const ok = Object.entries(want).every(([slot, n]) => counts[slot] === n);
  check("E2.4 迁移后局部计数正确",
    ok,
    `face=${counts.face}(13) dunk=${counts.dunk}(4) rebound=${counts.rebound}(2) handle=${counts.handle}(24) stability=${counts.stability}(4) passing=${counts.passing}(4)`);
}

// E2.5 — Roll vs Pop 本轮仍由 Passing owner
{
  check("E2.5 Roll vs Pop 仍属 passing", tendencyBundleMap["Roll vs Pop"] === "passing");
}

// E3.1/E3.2 — badge unique=40, assignments=48（基线 45 + 净 3）
{
  const assignCount = (b: string | string[]) => (Array.isArray(b) ? b.length : 1);
  const assignments = Object.entries(badgeBundleMap).reduce((s, [, v]) => s + assignCount(v), 0);
  const unique = Object.keys(badgeBundleMap).length;
  check("E3.1 unique badges = 40", unique === 40, `unique=${unique}`);
  check("E3.2 assignments = 48", assignments === 48, `assignments=${assignments}`);
}

// E3.3/E3.4 — Lightning Launch 不再来自 Athletic；Aerial Wizard 不再来自 Athletic
{
  const ll = badgeBundleMap["Lightning Launch"];
  const aw = badgeBundleMap["Aerial Wizard"];
  const inList = (v: string | string[], slot: string) => (Array.isArray(v) ? v.includes(slot) : v === slot);
  check("E3.3a Lightning Launch 属 handle", inList(ll, "handle"));
  check("E3.3b Lightning Launch 不再属 athletic", !inList(ll, "athletic"));
  check("E3.4a Aerial Wizard 属 dunk", inList(aw, "dunk"));
  check("E3.4b Aerial Wizard 属 rebound", inList(aw, "rebound"));
  check("E3.4c Aerial Wizard 不再属 athletic", !inList(aw, "athletic"));
}

// E3.5 — Immovable Enforcer / Brick Wall 保留 interior + 新增 strength
{
  const ie = badgeBundleMap["Immovable Enforcer"];
  const bw = badgeBundleMap["Brick Wall"];
  const inList = (v: string | string[], slot: string) => (Array.isArray(v) ? v.includes(slot) : v === slot);
  check("E3.5a Immovable Enforcer 保留 interior", inList(ie, "interior"));
  check("E3.5b Immovable Enforcer 新增 strength", inList(ie, "strength"));
  check("E3.5c Brick Wall 保留 interior", inList(bw, "interior"));
  check("E3.5d Brick Wall 新增 strength", inList(bw, "strength"));
}

// E3.6 — Pogo Stick 仍为 Block only
{
  check("E3.6 Pogo Stick 仍 block only", badgeBundleMap["Pogo Stick"] === "block");
}

// E3.8 — Athletic badge count = 0
{
  const athleticBadges = Object.entries(badgeBundleMap).filter(([, v]) => (Array.isArray(v) ? v.includes("athletic") : v === "athletic"));
  check("E3.8 Athletic badge count = 0", athleticBadges.length === 0, `athletic badges=${athleticBadges.map(([k]) => k).join(",")}`);
}

// ══════════════════════════════════════════════════════════════
// Stage 3 — createResult 集成 + displayScore/OVR fallback 解耦
// ══════════════════════════════════════════════════════════════
import { evaluate, evaluateAll, bundles as resultBundles, bodyBases, type Position } from "../src/createResult.ts";

// 构造带完整 detailed 的测试球员
function mkDetailedPlayer(name: string, pos: string, over: Record<string, number>) {
  return {
    name,
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    shooting: 75, athleticism: 75, playmaking: 75, defense: 75, inside: 75,
    overall: 80, potential: 88,
    position: pos,
    height: "6'6\"", weight: 210, wingspan: "6'10\"",
    detailed: { ...Object.fromEntries(resultBundles.flatMap((b) => b.attrs).map((a) => [a, 70])), ...over },
  };
}

// H1 回归：displayScore 与 legacy adjusted 解耦
// - adjusted 必须仍是 simple-average（生产 OVR fallback mean 输入）
// - displayScore 是 position-aware 新分
// - 同一输入下，生产 OVR 只依赖 adjusted，不依赖 displayScore
{
  const dunk = resultBundles.find((b) => b.id === "dunk")!;
  // DD=90 SD=50 → adjusted=70 (avg)，displayScore@PG=84 (0.85/0.15)
  const player = mkDetailedPlayer("Test Dunker", "SF", { "Driving Dunk": 90, "Standing Dunk": 50 });
  const ev = evaluate(player, dunk, bodyBases.PG, null, { targetPosition: "PG", secondaryPosition: null });
  check("H1a adjusted 保持 legacy simple-average", ev.adjusted === 70, `adjusted=${ev.adjusted}`);
  check("H1b displayScore 为 position-aware 分", ev.displayScore === 84, `displayScore=${ev.displayScore}`);
  check("H1c adjusted != displayScore（解耦）", ev.adjusted !== ev.displayScore);

  // 固定权重槽：displayScore 与 adjusted 可以不同（passing 90/80/70 → 81 vs 80）
  const passing = resultBundles.find((b) => b.id === "passing")!;
  const pg = mkDetailedPlayer("Test PG", "PG", { "Pass Accuracy": 90, "Pass IQ": 80, "Pass Vision": 70 });
  const pev = evaluate(pg, passing, bodyBases.PG, null, { targetPosition: "PG" });
  check("H1d passing displayScore=81（固定权重）", pev.displayScore === 81, `displayScore=${pev.displayScore}`);
  check("H1e passing adjusted=80（simple avg）", pev.adjusted === 80, `adjusted=${pev.adjusted}`);
}

// H1 回归：createResult 生产 OVR 不因 displayScore 变化而变
// 同一球员/身体/锁槽，只有 position 变化 → displayScore 变但 adjusted 不变
// （固定权重槽），生产 OVR 应一致（无随机因素时）。
{
  const passing = resultBundles.find((b) => b.id === "passing")!;
  const player = mkDetailedPlayer("Test Fixed", "PG", { "Pass Accuracy": 90, "Pass IQ": 80, "Pass Vision": 70 });
  const inputs = [{ bundle: passing, player }];
  const asPG = evaluateAll(inputs, bodyBases.PG, { targetPosition: "PG" });
  const asC = evaluateAll(inputs, bodyBases.PG, { targetPosition: "C" });
  check("H1f 固定槽 displayScore 位置不变", asPG.passing?.displayScore === asC.passing?.displayScore, `PG=${asPG.passing?.displayScore} C=${asC.passing?.displayScore}`);
  check("H1g 固定槽 adjusted 位置不变", asPG.passing?.adjusted === asC.passing?.adjusted);
}

// H2 回归：supportIncomplete 原因分类
// - 单槽 evaluate（无跨槽 DAG）→ target_context_missing → 可 provisional
// - 无 donor 数据 → donor_support_missing → 不可 provisional
{
  // Driving Dunk 有 support 依赖（Agility/Vertical/Strength/Speed with Ball）
  const dunk = resultBundles.find((b) => b.id === "dunk")!;
  // 有完整 donor 的球员：单槽 evaluate 缺跨槽 support → target_context_missing
  const mitchell = mkDetailedPlayer("Test Mitchell", "SG", {
    "Driving Dunk": 90, "Standing Dunk": 70,
    Agility: 90, Vertical: 95, Strength: 60, "Speed with Ball": 80,
  });
  const single = evaluate(mitchell, dunk, bodyBases.PG, null, { targetPosition: "SG" });
  const reasons = single.supportIncomplete?.reasons ?? {};
  const flat = new Set(Object.values(reasons).flat());
  check("H2a 单槽 evaluate 标记 target_context_missing", flat.has("target_context_missing"), JSON.stringify(reasons));
  check("H2b 单槽 evaluate provisional 可显示", flat.has("target_context_missing") && !flat.has("donor_support_missing") && !flat.has("donor_context_missing"));

  // 缺 donor 数据的球员（detailed 空）→ donor_support_missing
  const bare = { ...mkDetailedPlayer("Test Bare", "SF", {}), detailed: {} };
  const bareEval = evaluate(bare, dunk, bodyBases.PG, null, { targetPosition: "SF" });
  const bareReasons = new Set(Object.values(bareEval.supportIncomplete?.reasons ?? {}).flat());
  check("H2c 缺 donor 数据标记 donor_support_missing", bareReasons.has("donor_support_missing"), JSON.stringify(bareEval.supportIncomplete?.reasons));
  check("H2d donor 缺失不可 provisional", !(bareReasons.has("target_context_missing") && !bareReasons.has("donor_support_missing")));

  // evaluateAll 完整 DAG：传入所有 support 源槽位（athletic=Vertical/Agility、
  // handle=Speed with Ball、strength=Strength），support 全部生效 → 无 incomplete
  const athletic = resultBundles.find((b) => b.id === "athletic")!;
  const handle = resultBundles.find((b) => b.id === "handle")!;
  const strength = resultBundles.find((b) => b.id === "strength")!;
  const all = evaluateAll(
    [
      { bundle: dunk, player: mitchell },
      { bundle: athletic, player: mitchell },
      { bundle: handle, player: mitchell },
      { bundle: strength, player: mitchell },
    ],
    bodyBases.PG,
    { targetPosition: "SG" },
  );
  const allIncomplete = all.dunk?.supportIncomplete;
  check("H2e 完整 DAG 无 target_context_missing（support 生效）",
    !(allIncomplete && Object.values(allIncomplete.reasons).flat().includes("target_context_missing")),
    JSON.stringify(allIncomplete?.reasons));
}

console.log(`\nslot-semantics-v2: ${checks - failures}/${checks} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
