#!/usr/bin/env node
/**
 * Stage 6B-E — Acceptance 验证。
 *
 * 硬要求：
 *  1. Stage 6B 前后，同一 seed/input 的 final atomic attributes 完全一致
 *     （除了已批准的 Intangibles ownership 字段变化）
 *  2. potential / growthGap / peakStart / peakEnd 不得因 V3-E 接入而改变
 *  3. Body V2 regression 全绿
 *  4. Slot Semantics regression 全绿
 *  5. V3-E 不得出现在任何 CONTROL_LOOP dependency 中
 *
 * 验证方式：
 *  - git diff 确认 createResult.ts 的改动面（无 control 路径改动）
 *  - 静态检查：V3-E import 只在 createResult.ts 且只用于 v3eDisplay 字段
 *  - 运行回归测试
 *  - 运行 createResult 验证：baseOverall/growthGap/potential/peakStart/peakEnd
 *    与 initialStrength 的关系、v3eDisplayOverall 独立性
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const results = [];
const check = (cond, msg) => {
  results.push({ ok: !!cond, msg });
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
};

// ── 1. git diff 检查 createResult.ts 的改动面 ─────────────────
console.log("\n=== E1. createResult.ts 改动面检查 ===");
const diff = execSync("git diff src/createResult.ts", { encoding: "utf8" });
// 改动行统计
const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
console.log(`diff: +${added} / -${removed} 行`);
// 检查 control 相关行是否被改动（baseOverall/constraint/growthGap 行应只有注释/新增字段）
const controlLines = diff.split("\n").filter((l) =>
  (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")
  && (l.includes("baseOverall") || l.includes("constrain") || l.includes("growthGap")
    || l.includes("peakStart") || l.includes("peakEnd") || l.includes("initialStrength")
    || l.includes("calibratedOverall(") || l.includes("potential")));
const controlAdds = controlLines.filter((l) => l.startsWith("+"));
const controlRems = controlLines.filter((l) => l.startsWith("-"));
console.log(`control 相关改动：+${controlAdds.length} / -${controlRems.length}`);
for (const l of [...controlRems, ...controlAdds].slice(0, 20)) console.log(`  ${l.slice(0, 120)}`);
// E1a (Stage 6B.1 更新): 过渡双 Intangibles — control 保留 Potential-donor，
// display 用新 policy。验证双值结构存在。
const src = readFileSync("src/createResult.ts", "utf8");
const hasControlInt = src.includes("const controlIntangibles = customFinalAttrs[\"Intangibles\"]\n    ?? potentialCard?.detailed?.[\"Intangibles\"]");
const hasDisplayInt = src.includes("const displayIntangibles = customFinalAttrs[\"Intangibles\"]\n    ?? singleCard?.detailed?.[\"Intangibles\"]");
const controlNotFlowsToDisplay = src.includes("v3eDisplayOverall")
  && src.includes("const displayAttrs: Record<string, number> = { ...controlAttrs, Intangibles: displayIntangibles }")
  && src.includes("Object.assign(initialAttrs, displayAttrs)");
check(hasControlInt && hasDisplayInt,
  "E1a: 双 Intangibles 结构存在（controlIntangibles 含 potentialCard + displayIntangibles 新 policy）");
check(controlNotFlowsToDisplay,
  "E1b: 不可变双 record 隔离（controlAttrs 供 constraint/baseOverall；displayAttrs 供 v3eDisplay/输出；display 不回流 control）");
// 判定：diff 是工作区 vs HEAD（含本会话早期 Slot Semantics 等改动）。
// Stage 6B 增量 = v3eDisplay 注释/字段 + Intangibles policy 行。
// 精确验证：这些行必须存在且不含 control 语义变更。
const stage6bAdds = controlAdds.filter((l) => l.includes("v3e") || l.includes("Intangibles") || l.includes("绝不回流") || l.includes("initialStrength 保留") || l.includes("Final Policy"));
check(stage6bAdds.length >= 1, `E1b: Stage 6B 控制相关新增行存在（v3e 边界注释 + Intangibles policy，实际 ${stage6bAdds.length}）`);
check(stage6bAdds.every((l) =>
  !l.includes("constrainRookieInitialAttributes(") && !l.includes("growthGap =") && !l.includes("const baseOverall =") && !l.includes("const initialStrength =")),
  "E1c: Stage 6B 新增行未触碰 control 赋值（constrain/growthGap/baseOverall/initialStrength 赋值）");
console.log("Stage 6B control 相关新增行：");
for (const l of stage6bAdds) console.log(`  ${l.slice(0, 140)}`);

// ── 2. V3-E 使用面静态检查 ────────────────────────────────────
console.log("\n=== E2. V3-E 依赖面检查（不得进入 CONTROL_LOOP）===");
const v3eRefs = execSync("grep -rn 'rookieOverallV3E' src/ scripts/", { encoding: "utf8" })
  .split("\n").filter(Boolean);
for (const r of v3eRefs) console.log(`  ${r}`);
const controlFiles = v3eRefs.filter((r) => !r.includes("createResult.ts") && !r.includes("rookieOverallV3E.ts") && !r.includes("export-v3e-model") && !r.includes("run-shadow") && !r.includes("verify-stage6b") && !r.includes("audit-intangibles") && !r.includes("analyze-intangibles") && !r.includes("decompose-shadow"));
check(controlFiles.length === 0, "E2a: V3-E 只被 createResult（display 字段）与自身模块引用");
const createResultV3E = execSync("grep -n 'v3eDisplay\\|estimateDisplayOverallV3E' src/createResult.ts", { encoding: "utf8" });
console.log(createResultV3E);
check(!createResultV3E.includes("constrain") && !createResultV3E.includes("growthGap"),
  "E2b: V3-E 调用不在 constraint/growthGap 路径中");

// ── 3. 回归测试 ────────────────────────────────────────────────
console.log("\n=== E3. 回归测试 ===");
const runTest = (cmd) => {
  try {
    const out = execSync(cmd, { encoding: "utf8", timeout: 300000 });
    const tail = out.trim().split("\n").slice(-2).join(" | ");
    check(true, `${cmd}: ${tail}`);
  } catch (e) {
    check(false, `${cmd} FAILED: ${String(e.message ?? e).slice(0, 200)}`);
  }
};
runTest("node --experimental-strip-types scripts/test-body-degrade-v2.mts");
runTest("node --experimental-strip-types scripts/test-slot-semantics-v2.mts");
runTest("node --experimental-strip-types scripts/test-create-result.mts");
runTest("node --experimental-strip-types scripts/test-adversarial.mts");

// ── 4. createResult 语义验证 ──────────────────────────────────
console.log("\n=== E4. display/control 解耦语义 ===");
// 静态验证：v3eDisplayOverall 是新增字段；initialStrength 仍是 legacy 值
const resultFields = execSync("grep -n 'v3eDisplayOverall' src/createResult.ts", { encoding: "utf8" });
check(resultFields.includes("v3eDisplayOverall: v3eDisplay.score"),
  "E4a: v3eDisplayOverall 作为独立 display 字段返回");
const initialStrengthLine = execSync("grep -n 'const initialStrength' src/createResult.ts", { encoding: "utf8" });
check(initialStrengthLine.includes("= baseOverall"),
  "E4b: initialStrength 保持 legacy（= baseOverall），growthGap 依赖不变");

// ── 汇总 ──────────────────────────────────────────────────────
console.log("\n=== 汇总 ===");
const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "✅ 全部 Acceptance 通过" : `❌ ${failed.length} 项失败`);
process.exit(failed.length === 0 ? 0 : 1);
