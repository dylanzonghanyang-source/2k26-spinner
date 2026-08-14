# Stage 6B.2 — Finalization 交付报告

日期：2026-08-14 · 状态：**完成，STOP FOR REVIEW（不切 UI、不删 legacy estimator、不迁移 Growth Controller、不再研究 morphology/V3-F）**

---

## 1. 文档历史修正（任务 1）✅

`rookie-overall-stage6b1-control-audit.md` 与总报告新增「历史两阶段」章节，明确消除歧义：

> **阶段 1 — Single-value post-6B policy（neutral 50 单值）— FAIL**
> trigger flip **299/10000 (3.0%)** · non-Int atomic diff **1302/10000 (13.0%)** · growth diff **4014/10000 (40.1%)**
> **neutral 50 单值 policy 本身 NOT control invariant**（经 legacy estimator → originalOverall → trigger → offset → atomics → growth 传播）
>
> **阶段 2 — Dual Intangibles final architecture — PASS**
> trigger flip **0** · non-Int atomic diff **0** · growth diff **0**

不再存在「neutral50 单值 policy 本身 control invariant」的错误印象。analyze 脚本同步输出两阶段。

## 2. FINAL ARCHITECTURE shadow 重跑（任务 2）✅

**真实生产语义**：control = legacy + controlIntangiblesLegacy（Potential-donor）；display = V3-E + displayIntangibles Final Policy。live delta = **A→D**（此前 -1.213 是 B→D，estimator-only）。

| 批次 | n | mean | std | min/max | Δ=0 | Δ≤1 | Δ≤2 | Δ≥3 |
|---|---|---|---|---|---|---|---|---|
| official | 664 | -0.28 | 1.33 | -5/5 | 31.5% | 75.5% | 94.3% | 5.7% |
| snapshot | 1374 | -0.29 | 1.67 | -6/7 | 26.6% | 67.5% | 86.2% | 13.8% |
| **synthetic** | 10000 | **-1.69** | 1.99 | -10/5 | 15.1% | 42.6% | 66.0% | 34.0% |
| fixture | 5 | -1.40 | 1.20 | -3/0 | 40.0% | 40.0% | 80.0% | 20.0% |

A/B/C/D 分解（synthetic）：
| 组合 | 含义 | mean |
|---|---|---|
| A→B | policy 在 legacy 上 | -0.473 |
| A→C | estimator（control 固定） | -0.847 |
| C→D | policy 在 v3e 上 | -0.838 |
| B→D | estimator（display 固定） | -1.213（= Stage 6B 原 -1.213 ✓ 对上） |
| **A→D** | **live display-control delta** | **-1.685** |

**特别确认**：Stage 6B 原 synthetic -1.213 = B→D（estimator-only 效应）；dual architecture 当前 live delta = A→D = **-1.685**（含 policy 效应 -0.473）。

position/control-band（official）：80-84 band Δ≥2 占 78.1%——**高 legacy-control OVR band 中 legacy 相对 V3-E 存在系统性偏高**（legacy 对高属性组合估值更激进）；85+ 才属于无 official label 支撑的 extrapolation 区间（official 标签上限 84）。

## 3. 变量隔离强化（任务 3）✅

**已重构为不可变双 record**（createResult.ts:930-961）：

```ts
const controlAttrs = { ...initialAttrs, Intangibles: controlIntangibles };   // constraint + baseOverall + growthGap 专用
const rookieOverallConstraint = constrainRookieInitialAttributes({ values: controlAttrs, ... });
const baseOverall = calibratedOverall(controlAttrs, ...);                    // ← control consumer 只收 control record
const displayAttrs = { ...controlAttrs, Intangibles: displayIntangibles };  // ← display consumer 只收 display record
const v3eDisplay = estimateDisplayOverallV3EFromRecord(displayAttrs, ...);
Object.assign(initialAttrs, displayAttrs);                                  // 输出 = display record
```

静态断言确认：
- `values: controlAttrs`（L936）、`calibratedOverall(controlAttrs, ...)`（L954）——growth/constraint API 只接收 control record
- `estimateDisplayOverallV3EFromRecord(displayAttrs, ...)`（L959）、`Object.assign(initialAttrs, displayAttrs)`（L961）——V3-E/output 只接收 display record
- **无残留 `initialAttrs.Intangibles =` 共享切换赋值**
- E1b 断言已更新为双 record 结构（acceptance 全绿）

## 4. Full verify（任务 4）✅ 实际执行并记录

`pnpm run verify` → **VERIFY_EXIT=0，128 个 PASS 标记，0 FAIL**：
- ALL ROOKIE CARD LOOKUP CHECKS PASSED / POTENTIAL RANGE DATA CHECKS PASSED / CONFIG PASS
- F01-F07 body V2 fixtures 全 PASS
- Bundle budget OK（16 chunks ≤ 500kB）
- 补充：acceptance E1-E4 全绿；test-create-result ✅ / test-body-degrade-v2 **24/24** / test-slot-semantics-v2 **58/58** / test-adversarial **52/52**

## 5. STOP FOR REVIEW

**未做**：不切 UI（v3eDisplayOverall 已生成但 UI 未切换）；不删除 legacy estimator；不迁移 Growth Controller；不再研究 morphology / V3-F。

### 交付物
- `src/createResult.ts`：不可变双 record（controlAttrs/displayAttrs）
- `scripts/run-shadow-final.mts` → `reports/rookie-overall-stage6b2-shadow-final.md`（A→D live delta）
- `scripts/analyze-intangibles-control.mts` 更新（两阶段历史）→ `reports/rookie-overall-stage6b1-control-audit.md`
- `scripts/verify-stage6b-acceptance.mts` 更新（双 record 断言）
- 总报告 `rookie-overall-stage6b1.md` 历史段修正

**待审阅**：① live display-control delta（official -0.28 / synthetic -1.69）是否可接受作为 UI 显示切换的预期偏差；② Growth Controller V2 时间线（届时删 legacy control Intangibles 并迁移 control 到新架构）；③ 85+ 标签采集。
