#!/usr/bin/env -S node --experimental-strip-types
/**
 * Body Degrade V2 — acceptance runner。
 *
 * 读取权威 fixture（tests/fixtures/body-degrade-v2.acceptance.json），
 * 逐 case 执行并输出 PASS / FAIL。FAIL 必须输出完整 trace。
 *
 * Stage 1 范围：纯引擎 atomic cases（evaluateAtomic 直连）+ 配置完整性断言。
 * 集成类 case（F01/F13/F14/F18/F23 依赖 createResult 链，F05 依赖全量数据，
 * F24 依赖 UI）在 Stage 4/5 接入，本 runner 已预留 dispatch 结构。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assertProfileCoverage,
  allAtomicAttrs,
  passthroughAttrs,
  profiledAttrs,
  structuralProfiles,
  supportProfiles,
  contextCurves,
} from "../src/rookieAtomicBodyProfiles.ts";
import {
  atomicProfileFor,
  evaluateAtomic,
  assertV2Config,
  type AtomicEvaluationInput,
  type AtomicEvaluationResult,
  type BodyV2,
} from "../src/rookieBodyV2.ts";
import {
  applyV2CustomFinal,
  bundles,
  createResult,
  evaluateAll,
  evaluateAllPreview,
  type LockState,
  type Position,
  type SlotInput,
} from "../src/createResult.ts";
import { loadRookieCards } from "../src/rookieCards.ts";
import type { PlayerSource } from "../src/domain.ts";
import players26 from "../src/data/versions/2k26/players.json" with { type: "json" };
import roster26 from "../src/data/versions/2k26/rosterCatalog.json" with { type: "json" };
import badges26 from "../src/data/versions/2k26/badges.json" with { type: "json" };
import { createTendencyLookup, type TendencyTable } from "../src/tendencies.ts";
import tendencies26 from "../src/data/versions/2k26/tendencyProfiles.min.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "../tests/fixtures/body-degrade-v2.acceptance.json"), "utf8"),
);

type FixtureCase = {
  id: string;
  title: string;
  kind: string;
  inputs: Record<string, any>;
  expected: Record<string, any>;
};

const FLOAT_EPS = 1e-6;

// ─────────────────────────────────────────────────────────────────────────────
// 断言工具
// ─────────────────────────────────────────────────────────────────────────────

function checkFloat(label: string, actual: number, expected: number, failures: string[]) {
  if (typeof expected !== "number") return;
  if (Math.abs(actual - expected) > FLOAT_EPS) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function checkInt(label: string, actual: number, expected: number, failures: string[]) {
  if (typeof expected !== "number") return;
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
  }
}

function traceSummary(result: AtomicEvaluationResult): string {
  const lines: string[] = [];
  lines.push(`  raw=${result.raw}`);
  for (const t of result.structuralTrace) {
    lines.push(
      `  [structural ${t.key}] base=${t.baseThresholdOrRequirement} eff=${t.effectiveThresholdOrRequirement} ` +
        `target=${t.targetValue} src=${t.sourceValue ?? "-"} viol=${t.violationOrDeficit} ` +
        `sev=${t.severity} red=${t.ceilingReduction}`,
    );
  }
  lines.push(`  structural: uncapped=${result.uncappedStructuralReduction} capped=${result.cappedStructuralReduction} ceiling=${result.structuralCeiling}`);
  for (const t of result.supportTrace) {
    lines.push(
      `  [support ${t.key}] base=${t.baseThresholdOrRequirement} eff=${t.effectiveThresholdOrRequirement} ` +
        `target=${t.targetValue} src=${t.sourceValue ?? "-"} deficit=${t.violationOrDeficit} ` +
        `sev=${t.severity} red=${t.ceilingReduction}`,
    );
  }
  lines.push(`  support: uncapped=${result.uncappedSupportReduction} capped=${result.cappedSupportReduction} ceiling=${result.supportCeiling}`);
  lines.push(`  finalBeforeRound=${result.finalBeforeRound} final=${result.final}`);
  if (result.incomplete.length) lines.push(`  incomplete=${result.incomplete.join(", ")}`);
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// 输入构造（fixture inputs → AtomicEvaluationInput）
// ─────────────────────────────────────────────────────────────────────────────

function bodyFrom(o: any) {
  return { heightCm: o.heightCm, weightKg: o.weightKg };
}

function buildInput(
  attr: string,
  raw: number,
  src: Record<string, any>,
  variant: Record<string, any> | null,
): AtomicEvaluationInput {
  const targetBody = variant?.targetBody ?? src.targetBody;
  const targetBodies = src.targetBodies;
  const body = targetBodies ? targetBodies[0] : targetBody;
  return {
    attr,
    raw,
    targetBody: bodyFrom(body),
    donorBody: src.sourceBody ? bodyFrom(src.sourceBody) : null,
    donorObservedSupports: src.sourceSupports ?? {},
    finalizedTargetSupports: variant?.targetFinalSupports ?? src.targetFinalSupports ?? {},
    skipBody: src.skipBody === true || variant?.skipBody === true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 各 case 执行器
// ─────────────────────────────────────────────────────────────────────────────

function runAtomic(c: FixtureCase): { pass: boolean; detail: string } {
  const result = evaluateAtomic(buildInput(c.inputs.attribute, c.inputs.raw, c.inputs, null));
  const failures: string[] = [];
  checkInt("final", result.final, c.expected.final, failures);
  if (c.expected.finalBeforeRound !== undefined) {
    checkFloat("finalBeforeRound", result.finalBeforeRound, c.expected.finalBeforeRound, failures);
  }
  if (c.expected.structuralCeiling !== undefined) {
    checkFloat("structuralCeiling", result.structuralCeiling, c.expected.structuralCeiling, failures);
  }
  if (c.expected.supportCeiling !== undefined) {
    checkFloat("supportCeiling", result.supportCeiling, c.expected.supportCeiling, failures);
  }
  if (c.expected.structuralReduction !== undefined) {
    checkFloat("structuralReduction", result.cappedStructuralReduction, c.expected.structuralReduction, failures);
  }
  if (c.expected.supportReduction !== undefined) {
    checkFloat("supportReduction", result.cappedSupportReduction, c.expected.supportReduction, failures);
  }
  if (c.expected.uncappedStructuralReduction !== undefined) {
    checkFloat("uncappedStructuralReduction", result.uncappedStructuralReduction, c.expected.uncappedStructuralReduction, failures);
  }
  if (c.expected.cappedStructuralReduction !== undefined) {
    checkFloat("cappedStructuralReduction", result.cappedStructuralReduction, c.expected.cappedStructuralReduction, failures);
  }
  if (c.expected.uncappedSupportReduction !== undefined) {
    checkFloat("uncappedSupportReduction", result.uncappedSupportReduction, c.expected.uncappedSupportReduction, failures);
  }
  if (c.expected.cappedSupportReduction !== undefined) {
    checkFloat("cappedSupportReduction", result.cappedSupportReduction, c.expected.cappedSupportReduction, failures);
  }
  // F10: 禁止的 additive 错误路径必须确实产生 fixture 记录的 forbidden 值，
  // 证明正确路径（min of ceilings）没有被 additive 污染。
  if (c.expected.forbiddenAdditiveResult !== undefined) {
    const additive = result.raw - (99 - result.structuralCeiling) - (99 - result.supportCeiling);
    checkFloat("forbiddenAdditiveResult(错误路径应等于此值)", additive, c.expected.forbiddenAdditiveResult, failures);
  }
  return failures.length === 0
    ? { pass: true, detail: `final=${result.final}` }
    : { pass: false, detail: failures.join("\n") + "\n" + traceSummary(result) };
}

function runVariants(c: FixtureCase): { pass: boolean; detail: string } {
  const failures: string[] = [];
  const details: string[] = [];
  const inputs = c.inputs;
  const attr = inputs.attribute;

  // 多 variant（各自带 body / supports / raw）
  if (inputs.variants) {
    const expectedByVariant = c.expected.finalByVariant ?? [];
    inputs.variants.forEach((variant: any, i: number) => {
      const raw = variant.raw ?? inputs.raw;
      const input = buildInput(attr, raw, inputs, variant);
      const result = evaluateAtomic(input);
      const exp = expectedByVariant[i];
      if (exp !== undefined) {
        checkInt(`variant[${i}].final`, result.final, exp, failures);
        details.push(`v${i}: raw=${raw} final=${result.final}`);
      } else {
        details.push(`v${i}: raw=${raw} final=${result.final}`);
      }
      // 逐 variant 的 ceilings
      const ceilings = c.expected.ceilingsByVariant;
      if (ceilings?.[i] !== undefined) {
        checkFloat(`variant[${i}].structuralCeiling`, result.structuralCeiling, ceilings[i].structuralCeiling, failures);
      }
    });
  }

  // rawVariants（同一输入，不同 raw）
  if (inputs.rawVariants) {
    const expectedByRaw = c.expected.finalByRaw ?? [];
    inputs.rawVariants.forEach((raw: number, i: number) => {
      const input = buildInput(attr, raw, inputs, null);
      const result = evaluateAtomic(input);
      const exp = expectedByRaw[i];
      if (exp !== undefined) {
        checkInt(`raw[${i}].final`, result.final, exp, failures);
        details.push(`raw[${i}]: raw=${raw} final=${result.final}`);
      }
    });
    // 同一输入图下 support ceiling 必须与 raw 无关
    if (c.expected.supportCeiling !== undefined) {
      const probe = evaluateAtomic(buildInput(attr, inputs.rawVariants[0], inputs, null));
      checkFloat("supportCeiling", probe.supportCeiling, c.expected.supportCeiling, failures);
      details.push(`supportCeiling=${probe.supportCeiling}`);
    }
    if (c.expected.structuralCeiling !== undefined) {
      const probe = evaluateAtomic(buildInput(attr, inputs.rawVariants[0], inputs, null));
      checkFloat("structuralCeiling", probe.structuralCeiling, c.expected.structuralCeiling, failures);
    }
  }

  // targetBodies（同一输入，多个 target body）
  if (inputs.targetBodies) {
    const expectedByVariant = c.expected.finalByVariant ?? [];
    inputs.targetBodies.forEach((body: any, i: number) => {
      const input = buildInput(attr, inputs.raw, { ...inputs, targetBodies: undefined, targetBody: body }, null);
      const result = evaluateAtomic(input);
      const exp = expectedByVariant[i];
      if (exp !== undefined) checkInt(`body[${i}].final`, result.final, exp, failures);
      details.push(`body[${i}]: h=${body.heightCm} w=${body.weightKg} final=${result.final}`);
      if (i === 1 && c.expected.secondStructuralCeiling !== undefined) {
        checkFloat("secondStructuralCeiling", result.structuralCeiling, c.expected.secondStructuralCeiling, failures);
      }
    });
  }

  return failures.length === 0
    ? { pass: true, detail: details.join(" | ") }
    : { pass: false, detail: failures.join("\n") };
}

// ─────────────────────────────────────────────────────────────────────────────
// 配置完整性断言（修正点 3）
// ─────────────────────────────────────────────────────────────────────────────

function runConfigChecks(): { pass: boolean; detail: string } {
  const failures = assertProfileCoverage();
  if (failures.length) return { pass: false, detail: failures.join("\n") };

  const checks: string[] = [];
  checks.push(`allAtomicAttrs=${allAtomicAttrs.length}`);
  checks.push(`profiledAttrs=${profiledAttrs.length} (structural=${Object.keys(structuralProfiles).length}, support=${Object.keys(supportProfiles).length})`);
  checks.push(`passthroughAttrs=${passthroughAttrs.length}`);
  checks.push(`curves=${Object.keys(contextCurves).length}`);

  // 已知 passthrough 名单抽查（spec：Passing / mental / Free Throw / Close Shot）
  const mustPassthrough = [
    "Pass Accuracy", "Pass IQ", "Pass Vision",
    "Free Throw", "Close Shot", "Draw Foul", "Hands",
    "Offensive Consistency", "Defensive Consistency", "Shot IQ", "Help Defense IQ",
    "Hustle", "Pass Perception",
  ];
  const missing = mustPassthrough.filter((a) => !passthroughAttrs.includes(a));
  if (missing.length) {
    return { pass: false, detail: `期望 passthrough 但不在列表: ${missing.join(", ")}` };
  }
  return { pass: true, detail: checks.join(" | ") };
}

// ─────────────────────────────────────────────────────────────────────────────
// 集成类 case（Stage 4：真实 createResult / evaluateAll 链）
// ─────────────────────────────────────────────────────────────────────────────

type CatalogPlayer = {
  id: string;
  name: string;
  position: string | null;
  height: string | null;
  overall: number | null;
  potential?: number | null;
};
type CatalogTeam = { id: string; name: string; category: string; players: CatalogPlayer[] };
type DetailedPlayer = { slug: string; detailed: Record<string, number> };

async function buildIntegrationContext() {
  const detailedBySlug = new Map<string, Record<string, number>>();
  for (const team of (roster26 as { teams: CatalogTeam[] }).teams) {
    for (const player of team.players) {
      const raw = (players26 as DetailedPlayer[]).find((p) => p.slug === player.id);
      if (raw?.detailed) detailedBySlug.set(player.id, raw.detailed);
    }
  }
  const players = new Map<string, PlayerSource>();
  for (const team of (roster26 as { teams: CatalogTeam[] }).teams) {
    for (const player of team.players) {
      const detailed = detailedBySlug.get(player.id);
      players.set(`test:${player.id}`, {
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
      } as PlayerSource);
    }
  }
  const cards = await loadRookieCards();
  const tendencyLookup = createTendencyLookup(tendencies26 as TendencyTable);
  return { players, cards, tendencyLookup };
}

const bodyFor = (height: number, weight: number) => ({
  height, weight, wingspan: 50, shoulder: 50, neck: 50, torso: 50,
});

/** 完整锁定一个球员（除 potential 外全部槽位），返回 LockState。 */
function lockAll(locks: LockState, playerId: string): LockState {
  const next = { ...locks };
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    next[bundle.id] = { kind: "player", playerId };
  }
  return next;
}

function atomicValuesOf(result: ReturnType<typeof createResult>): Record<string, number> {
  // 只比较 Body Degrade V2 覆盖的 atomic 字段（allAtomicAttrs）。
  // 排除项：
  // - durability 16 项部位：独立子系统（spec §2.8），随机 seed 含 position
  // - Potential / Intangibles：OVR/潜力链路（spec §16），其解析依赖 position
  //   weights（sourcePeakOverall），不属于 Body Degrade atomic 范围
  const allowed = new Set<string>(allAtomicAttrs);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(result.initialAttrs)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

/** stable stringify：对象键排序后序列化，消除键序/输入顺序干扰。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

// F01/F13: position invariance — 同一 donors/body，只改 position，atomic 必须全等
async function runPositionInvariance(c: FixtureCase): Promise<{ pass: boolean; detail: string }> {
  const { players, cards, tendencyLookup } = await buildIntegrationContext();
  const luka = players.get("test:luka-doncic") ?? [...players.values()][0];
  assert.ok(luka, "need a player");
  const body = bodyFor(198, 98);
  const lockLuka = lockAll({}, luka.id!);
  const asPG = createResult(lockLuka, 19, "PG", "SG", body, players, tendencyLookup, "2k26", cards);
  const asC = createResult(lockLuka, 19, "C", "PF", body, players, tendencyLookup, "2k26", cards);
  const a = atomicValuesOf(asPG);
  const b = atomicValuesOf(asC);
  const diffs: string[] = [];
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) diffs.push(`${key}: ${a[key]} vs ${b[key]}`);
  }
  return diffs.length === 0
    ? { pass: true, detail: "all atomics equal (PG vs C)" }
    : { pass: false, detail: diffs.join("\n") };
}

// F14: wingspan score invariance — 只改 target wingspan 1–100，atomic 全等
// fixture 权威值：25 ↔ 99（F14 mutations: targetWingspanScore 25 / 99）
async function runWingspanInvariance(c: FixtureCase): Promise<{ pass: boolean; detail: string }> {
  const { players, cards, tendencyLookup } = await buildIntegrationContext();
  const luka = players.get("test:luka-doncic") ?? [...players.values()][0];
  assert.ok(luka, "need a player");
  const lockLuka = lockAll({}, luka.id!);
  const w25 = createResult(
    lockLuka, 19, "PG", "SG",
    { ...bodyFor(198, 98), wingspan: 25 },
    players, tendencyLookup, "2k26", cards,
  );
  const w99 = createResult(
    lockLuka, 19, "PG", "SG",
    { ...bodyFor(198, 98), wingspan: 99 },
    players, tendencyLookup, "2k26", cards,
  );
  const a = atomicValuesOf(w25);
  const b = atomicValuesOf(w99);
  const diffs: string[] = [];
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) diffs.push(`${key}: ${a[key]} vs ${b[key]}`);
  }
  return diffs.length === 0
    ? { pass: true, detail: "all atomics equal (wingspan 25 vs 99)" }
    : { pass: false, detail: diffs.join("\n") };
}

// F18: determinism — 20 次输入顺序 permutation，输出逐位相同
async function runDeterminism(c: FixtureCase): Promise<{ pass: boolean; detail: string }> {
  const { players, cards, tendencyLookup } = await buildIntegrationContext();
  const luka = players.get("test:luka-doncic") ?? [...players.values()][0];
  const wemby = players.get("test:victor-wembanyama") ?? luka;
  assert.ok(luka && wemby, "need players");
  const body = bodyFor(203, 104);
  const baseInputs: SlotInput[] = [];
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    baseInputs.push({ bundle, player: bundle.id === "dunk" ? wemby : luka });
  }
  void cards; void tendencyLookup;
  const reference = evaluateAll(baseInputs, body, { targetPosition: "PG", secondaryPosition: "SG" });
  const refJson = stableStringify(reference);
  for (let i = 0; i < 20; i += 1) {
    const shuffled = [...baseInputs].sort(() => Math.random() - 0.5);
    const run = evaluateAll(shuffled, body, { targetPosition: "PG", secondaryPosition: "SG" });
    if (stableStringify(run) !== refJson) {
      return { pass: false, detail: `permutation ${i} differs from reference` };
    }
  }
  return { pass: true, detail: "20 permutations identical" };
}

// F23: preview/final parity — evaluateAllPreview 与 createResult 真实链一致
async function runPreviewFinalParity(c: FixtureCase): Promise<{ pass: boolean; detail: string }> {
  const { players, cards, tendencyLookup } = await buildIntegrationContext();
  const luka = players.get("test:luka-doncic") ?? [...players.values()][0];
  const wemby = players.get("test:victor-wembanyama") ?? luka;
  assert.ok(luka && wemby, "need players");
  const body = bodyFor(201, 100);
  const inputs: SlotInput[] = [];
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    inputs.push({ bundle, player: bundle.id === "dunk" ? wemby : luka });
  }
  void inputs;
  const final = createResult(lockAll({}, luka.id!), 19, "SF", "PF", body, players, tendencyLookup, "2k26", cards);
  // preview 路径：候选替换一个槽位后 evaluateAllPreview 与锁定 evaluateAll 一致
  const lockedInputs: SlotInput[] = [];
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    if (bundle.id === "dunk") {
      lockedInputs.push({ bundle, player: wemby, card: null });
    } else {
      lockedInputs.push({ bundle, player: luka, card: null });
    }
  }
  const preview = evaluateAllPreview(
    lockedInputs.filter((i) => i.bundle.id !== "dunk"),
    { bundle: bundles.find((b) => b.id === "dunk")!, player: wemby, card: null },
    body,
    { targetPosition: "SF", secondaryPosition: "PF" },
  );
  const locked = evaluateAll(lockedInputs, body, { targetPosition: "SF", secondaryPosition: "PF" });
  const diffs: string[] = [];
  if (!preview) diffs.push("preview did not resolve");
  else if (stableStringify(preview.values) !== stableStringify(locked.dunk?.values)) {
    diffs.push(`preview.values != locked dunk values: ${stableStringify(preview.values)} vs ${stableStringify(locked.dunk?.values)}`);
  }
  return diffs.length === 0
    ? { pass: true, detail: "preview == locked evaluateAll" }
    : { pass: false, detail: diffs.join("\n") };
}

// F23-extra: 端到端 preview → createResult final（含全部后处理）parity
// 同一候选（Wemby 替换 dunk 槽），preview 的 atomic 值必须与完整
// createResult final 的 atomic 值逐字段一致（card-aware，含后处理链）。
async function runEndToEndParity(): Promise<{ pass: boolean; detail: string }> {
  const { players, cards, tendencyLookup } = await buildIntegrationContext();
  const luka = players.get("test:luka-doncic");
  const wemby = players.get("test:victor-wembanyama");
  assert.ok(luka && wemby, "need luka + wemby");
  const lukaCard = cards.get("luka doncic");
  const wembyCard = cards.get("victor wembanyama");
  assert.ok(lukaCard && wembyCard, "need real rookie cards for both");

  const body = bodyFor(198, 98);

  // 1) preview：已有槽位全锁 Luka，dunk 槽候选 Wemby
  const currentInputs: SlotInput[] = [];
  for (const bundle of bundles) {
    if (bundle.id === "potential" || bundle.id === "dunk") continue;
    currentInputs.push({ bundle, player: luka, card: lukaCard });
  }
  const dunkBundle = bundles.find((b) => b.id === "dunk")!;
  const preview = evaluateAllPreview(
    currentInputs,
    { bundle: dunkBundle, player: wemby, card: wembyCard },
    body,
    { targetPosition: "SF", secondaryPosition: "PF" },
  );
  assert.ok(preview, "preview must resolve");

  // 2) final：完整 createResult —— 所有槽位锁定（dunk=Wemby，其余=Luka），
  //    走 createResult 的完整后处理链（custom 合并、peakAttrs/initialAttrs
  //    的 V2 clamp、durability、OVR constraint、badges、hotzones...）。
  const locks: LockState = {};
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    locks[bundle.id] = { kind: "player", playerId: bundle.id === "dunk" ? wemby.id! : luka.id! };
  }
  const final = createResult(locks, 19, "SF", "PF", body, players, tendencyLookup, "2k26", cards);

  // 3) 逐 atomic 比对：preview（dunk 槽）vs final initialAttrs（dunk 槽两个 attr）
  //    卡槽位在 final 中走完整 V2 body 约束路径（cardConstrainedValues），
  //    与 preview 的同一 evaluator 输出必须逐字段相等。
  const diffs: string[] = [];
  for (const attr of dunkBundle.attrs) {
    const previewValue = preview.values[attr];
    const finalValue = final.initialAttrs[attr];
    if (previewValue !== finalValue) {
      diffs.push(`${attr}: preview=${previewValue} final=${finalValue}`);
    }
  }
  // 4) 非 dunk 槽位（Luka 卡槽位）同样必须与 evaluateAll(card-aware) 一致
  const lockedInputs: SlotInput[] = [];
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    if (bundle.id === "dunk") lockedInputs.push({ bundle, player: wemby, card: wembyCard });
    else lockedInputs.push({ bundle, player: luka, card: lukaCard });
  }
  const locked = evaluateAll(lockedInputs, body, { targetPosition: "SF", secondaryPosition: "PF" });
  for (const bundle of bundles) {
    if (bundle.id === "potential") continue;
    for (const attr of bundle.attrs) {
      // Overall Durability 由独立 durability 子系统在 createResult 中重新生成
      // （spec §2.8：durability 不并入 V2），preview 的 V2 passthrough 值与
      // final 的 durability 生成值不同是设计内行为，不属于 parity 断言范围。
      if (attr === "Overall Durability") continue;
      const lockedValue = locked[bundle.id]?.values[attr];
      const finalValue = final.initialAttrs[attr];
      if (typeof lockedValue === "number" && lockedValue !== finalValue) {
        diffs.push(`${bundle.id}.${attr}: locked=${lockedValue} final=${finalValue}`);
      }
    }
  }

  return diffs.length === 0
    ? { pass: true, detail: "end-to-end preview == createResult final (all post-processing included)" }
    : { pass: false, detail: diffs.join("\n") };
}

// F05: donor self-reproduction — 全量 rookie snapshot 扫描
// 对每张卡每个有完整 required body/support 观测的 profiled attr：
// target body = donor body、target supports = donor 观测 → final == raw。
async function runDonorReproduction(c: FixtureCase): Promise<{ pass: boolean; detail: string }> {
  const snapshotPath = join(
    __dirname,
    "../data/snapshots/2kspinner-rookies-1960-2025-2026-08-13/rookie-snapshot.json",
  );
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    slug: string;
    name: string;
    vitals?: Record<string, unknown>;
    detailed?: Record<string, number>;
  }[];

  let eligible = 0;
  let verified = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const card of snapshot) {
    const heightInches = card.vitals?.heightInches;
    const weightLb = card.vitals?.weightLb;
    if (typeof heightInches !== "number" || typeof weightLb !== "number") continue;
    if (!Number.isFinite(heightInches) || heightInches < 60 || heightInches > 100) continue;
    const donorBody: BodyV2 = {
      heightCm: heightInches * 2.54,
      weightKg: weightLb * 0.453592,
    };
    const detailed = card.detailed ?? {};

    for (const attr of profiledAttrs) {
      const raw = detailed[attr];
      if (typeof raw !== "number") continue;
      // 该 attr 的 support 依赖必须全部有 donor 观测（target 侧同 donor 必然有）
      const profile = atomicProfileFor(attr);
      const deps = profile?.support?.dependencies ?? [];
      const donorSupports: Record<string, number | undefined> = {};
      let complete = true;
      for (const dep of deps) {
        const v = detailed[dep.supportAttr];
        if (typeof v !== "number") {
          complete = false;
          break;
        }
        donorSupports[dep.supportAttr] = v;
      }
      if (!complete) {
        skipped += 1;
        continue;
      }
      eligible += 1;
      const result = evaluateAtomic({
        attr,
        raw,
        targetBody: donorBody,
        donorBody,
        donorObservedSupports: donorSupports,
        finalizedTargetSupports: donorSupports,
      });
      if (result.final !== raw) {
        failures.push(
          `${card.name} (${card.slug}) ${attr}: raw=${raw} final=${result.final} ` +
          `structural=${result.structuralCeiling.toFixed(3)} support=${result.supportCeiling.toFixed(3)}`,
        );
      } else {
        verified += 1;
      }
    }
  }

  const detail = `eligible=${eligible} verified=${verified} skipped=${skipped} failures=${failures.length}`;
  if (failures.length > 0) {
    const sample = failures.slice(0, 10).join("\n");
    return { pass: false, detail: `${detail}\n${sample}` };
  }
  return { pass: true, detail };
}

// F24: UI 最低身高（repo 现状：已满足 170；算法阈值不动）
function runUiHeightMin(c: FixtureCase): { pass: boolean; detail: string } {
  const builder = readFileSync(
    join(__dirname, "../src/components/RookieBuilder.tsx"),
    "utf8",
  );
  const minOk = /身高[\s\S]{0,120}?min=\{1[5-7]0\}/.test(builder)
    || builder.includes('label="身高" max={300} min={150}');
  if (!minOk) return { pass: false, detail: "RookieBuilder 身高 min 未发现 ≤170 输入范围" };
  // 算法阈值必须保持 fixture 原值：Layup MIN 175 / Driving Dunk MIN 180
  const profiles = readFileSync(join(__dirname, "../src/rookieAtomicBodyProfiles.ts"), "utf8");
  const layupOk = profiles.includes('baseThreshold: 175') && profiles.includes('baseThreshold: 180');
  if (!layupOk) return { pass: false, detail: "算法阈值被改动（Layup 175 / Driving Dunk 180）" };
  return { pass: true, detail: "UI min=150 已满足 accepts170；算法阈值保持 fixture 原值" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const config = runConfigChecks();
  console.log(`CONFIG: ${config.pass ? "PASS" : "FAIL"} — ${config.detail}`);

  const results: { id: string; pass: boolean; detail: string }[] = [];
  const pendingIds = new Set<string>([]);

  for (const c of fixture.cases as FixtureCase[]) {
    if (pendingIds.has(c.id)) {
      results.push({ id: c.id, pass: true, detail: "PENDING" });
      continue;
    }
    let outcome: { pass: boolean; detail: string };
    switch (c.id) {
      case "F01":
      case "F13":
        outcome = await runPositionInvariance(c);
        break;
      case "F05":
        outcome = await runDonorReproduction(c);
        break;
      case "F14":
        outcome = await runWingspanInvariance(c);
        break;
      case "F18":
        outcome = await runDeterminism(c);
        break;
      case "F23":
        outcome = await runPreviewFinalParity(c);
        if (outcome.pass) {
          const e2e = await runEndToEndParity();
          if (!e2e.pass) outcome = e2e;
          else outcome = { pass: true, detail: `${outcome.detail} | ${e2e.detail}` };
        }
        break;
      case "F24":
        outcome = runUiHeightMin(c);
        break;
      default:
        switch (c.kind) {
          case "atomic":
            outcome = runAtomic(c);
            break;
          case "variants":
            outcome = runVariants(c);
            break;
          default:
            outcome = { pass: false, detail: `未知 kind: ${c.kind}` };
        }
    }
    results.push({ id: c.id, pass: outcome.pass, detail: outcome.detail });
  }

  let passCount = 0;
  let failCount = 0;
  let pendingCount = 0;
  console.log("\n=== Body Degrade V2 Acceptance ===");
  for (const r of results) {
    const status = r.pass ? "PASS" : "FAIL";
    if (r.pass && r.detail.startsWith("PENDING")) {
      pendingCount += 1;
      console.log(`${r.id}  SKIP  ${r.detail}`);
      continue;
    }
    if (r.pass) passCount += 1; else failCount += 1;
    console.log(`${r.id}  ${status}  ${r.detail}`);
  }
  console.log(`\n${passCount} PASS / ${failCount} FAIL / ${pendingCount} pending`);
  assert(failCount === 0, `acceptance FAIL count = ${failCount}`);
}

await main();
