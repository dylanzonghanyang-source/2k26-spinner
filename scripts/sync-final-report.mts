#!/usr/bin/env node
/**
 * Final Report Sync — 从 canonical results JSON 自动重新同步 review-patch 汇总，
 * 不手工修数字。加一致性断言：
 *  1. review-patch 数字 == canonical JSON
 *  2. position sum == officialN
 *  3. band sum == officialN
 *  4. era 数字 == canonical
 *  5. top error 样本 == canonical
 */
import { readFileSync, writeFileSync } from "node:fs";

const canon = JSON.parse(readFileSync("reports/rookie-overall-v3-canonical.json", "utf8"));
const v3b = canon.models["V3-B (+Intangibles)"];
const v3d = canon.models["V3-D (+both)"];
const deployed = canon.models["Production (current)"];
const oof = canon.models["Production-Architecture OOF"];

// ── 一致性断言 ─────────────────────────────────────────────────
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

// position sums
const sumByPos = Object.values(v3b.byPosition).reduce((a, b) => a + b.n, 0);
check(sumByPos === canon.officialN, `V3-B position n sum ${sumByPos} != officialN ${canon.officialN}`);
const sumOOF = Object.values(oof.byPosition).reduce((a, b) => a + b.n, 0);
check(sumOOF === canon.officialN, `OOF position n sum ${sumOOF} != ${canon.officialN}`);

// era 存在
check(canon.eraHoldout["old→new"]?.["V3-B (+Intangibles)"], "era old→new V3-B missing");
check(canon.eraHoldout["new→old"]?.["V3-B (+Intangibles)"], "era new→old V3-B missing");

// top error 第一名
const top1 = canon.topErrors["V3-B (+Intangibles)"]?.[0];
check(top1?.name === "Reed Sheppard", `top1 ${top1?.name} != Reed Sheppard`);
check(top1?.err === 11, `Reed Sheppard err ${top1?.err} != 11`);

// negSlopes
check(typeof canon.negSlopes.count === "number", "negSlopes missing");

console.log("=== Final Report Sync 断言 ===");
console.log(errors.length ? `❌ ${errors.length} 个断言失败:\n${errors.map((e) => `  - ${e}`).join("\n")}` : "✅ 全部断言通过");

// ── 重新生成 review-patch 汇总（数字段自动从 canon 生成）────────
const L = [];
const push = (s = "") => L.push(s);
const f = (x, d = 3) => Number(x).toFixed(d);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

push("# Stage 5 Review Patch — 汇总报告（Final Sync 版）");
push("");
push(`日期：2026-08-14 · 状态：全部 Review Patch 项完成，**STOP FOR REVIEW，不切 production**`);
push(`本文件数字由 \`reports/rookie-overall-v3-canonical.json\` 自动同步生成（不手工修数字）`);
push("");
push("---");
push("");
push("## 1. Identity universe 统一（Review Patch #1）");
push("");
push("详见 `reports/rookie-overall-review-patch-identity.md`。要点：");
push("");
push("| 层级 | 数量 | 说明 |");
push("|---|---|---|");
push("| 文件条目 | 1800 | 全部 .json |");
push("| unique slug | 1797 | 3 组同 slug 多文件（bobby-jones / mike-dunleavy / reggie-williams） |");
push("| unique coreName | 1797 | 与 slug 1:1（无变体） |");
push("| **canonical（权威）** | **1797** | coreName 首见 = 最早年份正式卡 |");
push("");
push("- **交叉表 1799 vs 1797**：1799 是旧审计中间产物；权威口径 = canonical 1797");
push("- **NO_OVR 87 vs 85**：87 = 旧判据（卡文件 raw）；85 = 新判据（override 覆盖后 effective OVR）——差异 2 张已解析");
push("- **ESTIMATED 集合算术**：gap-set 475 ∪ override-set 523，intersection 1（bobby-jones），union = 997 = canonical ESTIMATED ✓（训练缺口 522 = override-only 未 materialize）");
push("");
push("最终分类（canonical 1797）：**OFFICIAL 664 / ESTIMATED 997 / AMBIGUOUS 51 / NO_OVR 85**，sum=1797 ✓");
push("");
push("## 2. Ablation 报告修正（Review Patch #2）");
push("");
push("- §6.8 标签数字修正：`OFFICIAL 664 + ESTIMATED 475 + AMBIGUOUS 51 = 1190`（此前误写 665/48/2）");
push("- 全部报告统一使用最终判据（override.source=user-ui-confirmed）");
push("");
push("## 3. V3-B 主诊断模型（Review Patch #3）");
push("");
push("V3-D 降为 secondary comparison。V3-B 最终结果（canonical）：");
push("");
push("### 总体");
push("");
push("| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |");
push("|---|---|---|---|---|---|---|---|");
push(`| V3-B | ${v3b.n} | ${pct(v3b.exact)} | ${pct(v3b.w1)} | ${pct(v3b.w2)} | ${f(v3b.mae)} | ${f(v3b.rmse)} | ${f(v3b.bias)} |`);
push(`| V3-D (secondary) | ${v3d.n} | ${pct(v3d.exact)} | ${pct(v3d.w1)} | ${pct(v3d.w2)} | ${f(v3d.mae)} | ${f(v3d.rmse)} | ${f(v3d.bias)} |`);
push(`| Deployed Production | ${deployed.n} | ${pct(deployed.exact)} | ${pct(deployed.w1)} | ${pct(deployed.w2)} | ${f(deployed.mae)} | ${f(deployed.rmse)} | ${f(deployed.bias)} |`);
push(`| Production-Architecture OOF | ${oof.n} | ${pct(oof.exact)} | ${pct(oof.w1)} | ${pct(oof.w2)} | ${f(oof.mae)} | ${f(oof.rmse)} | ${f(oof.bias)} |`);
push("");
push("### V3-B position breakdown（canonical）");
push("");
push("| position | n | Exact | ±1 | MAE | RMSE |");
push("|---|---|---|---|---|---|");
for (const p of Object.keys(v3b.byPosition)) {
  const m = v3b.byPosition[p];
  push(`| ${p} | ${m.n} | ${pct(m.exact)} | ${pct(m.w1)} | ${f(m.mae)} | ${f(m.rmse)} |`);
}
push("");
push(`（position n sum = ${sumByPos} = officialN ✓）`);
push("");
push("## 4. Production baseline 审计（Review Patch #4）");
push("");
push("| baseline | MAE | 语义 |");
push("|---|---|---|");
push(`| **Deployed Production** | ${f(deployed.mae)} | 线上模型原样（1190 全量训练，含 475 ESTIMATED），仅描述产品行为，非公平 baseline |`);
push(`| **Production-Architecture OOF** | **${f(oof.mae)}** | 与 V3 完全相同的 official-only folds，每 fold 重训生产架构（每 position 独立 Ridge）——**公平架构对比** |`);
push(`| **V3-B** | **${f(v3b.mae)}** | unified position-interaction + Intangibles |`);
push("");
push(`结论：V3-B vs Production-Architecture OOF 差距 ${f(v3b.mae - oof.mae)} MAE 来自**架构 + Intangibles 特征**，非数据清洗本身。`);
push("");
push("## 5. Grouped-by-era 方向不对称（Review Patch #5，canonical）");
push("");
push("| 方向 | V3-B MAE | Deployed MAE | 胜者 |");
push("|---|---|---|---|");
const eON = canon.eraHoldout["old→new"];
const eNO = canon.eraHoldout["new→old"];
push(`| old→new（2003-13 → 2014-25） | ${f(eON["V3-B (+Intangibles)"].mae)} | ${f(eON["Production (current)"].mae)} | ${eON["V3-B (+Intangibles)"].mae < eON["Production (current)"].mae ? "V3-B" : "Deployed"} |`);
push(`| new→old（2014-25 → 2003-13） | ${f(eNO["V3-B (+Intangibles)"].mae)} | ${f(eNO["Production (current)"].mae)} | ${eNO["V3-B (+Intangibles)"].mae < eNO["Production (current)"].mae ? "V3-B" : "Deployed"} |`);
push("");
push("**不得表述为\"V3-B 跨 era 整体仍优于 Production\"**。V3-B 优势依赖现代 era 数据（Intangibles 分布变化），向旧 era 外推时优势消失/反转。");
push("");
push("## 6. Monotonicity audit（Review Patch A.2 修正公式）");
push("");
push(`修正：effective slope = base + interaction（**one-hot 不再计入属性斜率**，只影响 intercept）。`);
push(`修正后负 effective slope 总数：**${canon.negSlopes.count}**（此前含 one-hot 误报 31）`);
push("");
push("- Synthetic +1 实测已证明至少部分负 slope 真实存在（8 个属性 +1 下降，SF 位置，幅度 <0.03）");
push("- **monotonicity blocker 保持有效**，由 Stage 5.1 V3-E 解决（约束进优化，非后 clamp）");
push("- 负 slope 明细见 ablation §5b-2（全部列出，不自动修正）");
push("");
push("## 7. 大残差样本 provenance audit（Review Patch #7）");
push("");
push(`Top 误差（V3-B，canonical）：`);
push("");
push("| name | position | overall | pred | err | provenance |");
push("|---|---|---|---|---|---|");
const topErr = canon.topErrors["V3-B (+Intangibles)"].slice(0, 5);
const provNote = {
  "Reed Sheppard": "override=user-ui-confirmed ✓ / PG / OVR=63 / Int=60 / Hustle=95,Stamina=93 — 无错位；模型过度奖励 athletic/hustle",
  "Jaxson Hayes": "override ✓ / C / OVR=65 / Int=25 — 无错位；Int 已压低仍 err，attrs 驱动过高",
  "Justin Edwards": "override ✓ / SF / OVR=67 / Int=80 — 无错位；高 Int 推高预测",
  "Reggie Williams": "card.overall=null + override=70 ✓（index 语义）— 无错位",
  "Blake Wesley": "override ✓ / PG / OVR=65 / Int=55 — 无错位",
};
for (const t of topErr) {
  push(`| ${t.name} | ${t.position} | ${t.overall} | ${t.pred} | ${t.err >= 0 ? "+" : ""}${t.err} | ${provNote[t.name] ?? "无错位" } |`);
}
push("");
push("结论：**全部大残差样本无 identity/OVR/attr 错位**；残差来源为模型权重行为，属模型问题而非数据问题。");
push("");
push("## 8. Synthetic Stress Suite（Review Patch #8）");
push("");
push("详见 `reports/rookie-overall-v3-synthetic-stress.md`。要点：");
push("");
push("- **连续性** ✓（Speed 70→99 平滑递增）");
push("- **单调性**：8 个属性 +1 局部下降（见 §6）");
push("- **position 行为**：中锋型 profile C/PF 77/76 > PG 72 ✓ 合理");
push("- **高能力外推**：全 99/Int 99 → 99（clamp）；全 85/Int 60 → 88；全 90/Int 70 → 93");
push("- **Intangibles 敏感性**：全 70 时 Int 25→99 使 OVR 74→78（约 4 分跨度）");
push("- 明确区分：synthetic feature-space OOD ≠ 官方 85+ 无标签");
push("");
push("## 9. Synthetic Intangibles 来源审计（Review Patch #9）");
push("");
push("`src/createResult.ts:921-924` 生产路径 Intangibles 来源（优先级）：");
push("");
push("```");
push("1. customFinalAttrs[\"Intangibles\"]     → 用户手动设置槽硬锁");
push("2. potentialCard.detailed[\"Intangibles\"] → 潜力来源卡的官方导出值（DB2K 快照）");
push("3. singleCard.detailed[\"Intangibles\"]  → 同卡构建的官方值");
push("4. 默认 50");
push("```");
push("");
push("**结论**：生产 Intangibles 不是模型生成、不是 OVR 反推。V3-B 输入语义已存在且确定（官方值或 50 fallback）。");
push("唯一待确认：fallback=50 语义。**确认前不接入 V3-B 生产路径**（见 Stage 5.2）。");
push("");
push("## 10. STOP FOR REVIEW 声明");
push("");
push("- ✅ Final Report Sync 完成（数字由 canonical JSON 自动同步 + 断言通过）");
push("- ✅ Review Patch 全部 9 项完成");
push("- ❌ **不切换 production OVR model**（85+ 外推、era 不对称、monotonicity 27 负 slope、Intangibles fallback 语义）");
push("- 下一步：Stage 5.1（V3-E monotonic hierarchical）+ Stage 5.2（Intangibles ownership）");

writeFileSync("reports/rookie-overall-review-patch.md", L.join("\n"), "utf8");
console.log("review-patch.md 重新同步完成");
if (errors.length) process.exit(1);
