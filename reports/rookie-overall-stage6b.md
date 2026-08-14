# Stage 6B — OVR Architecture Decoupling 交付报告

日期：2026-08-14 · 状态：**完成，STOP FOR REVIEW，未切 production control estimator**

---

## A. Canonical Final Validation 修正

### A1. λ2 保守表述（已更新至 Stage 6A 报告 §5.1）
- fixed λ2=200 ordinary OOF MAE = **0.828**
- nested CV：内层每 fold 选 λ2=400，nested outer OOF MAE = **0.855**
- **不宣称 nested "证明" λ2=200 从未受当前 CV 影响**
- **production 预期精度以 0.855 为保守 generalization estimate**
- 不扩大超参搜索

### A2. era 指标差异归因（1.036/1.230 vs 1.066/1.243）
**差异来源 = MAE 计算口径**：
| 口径 | old→new | new→old |
|---|---|---|
| 旧报告（round 后 pred） | 1.036 | 1.230 |
| 复现（round 后） | 1.034 | 1.230 |
| Final Validation（raw predRaw） | 1.066 | 1.243 |

同一模型同一分割，仅指标定义不同。**canonical = raw-MAE 口径**。

### A3. Canonical 指标（旧结果 superseded）
- V3-E generalization estimate = **0.855**（nested OOF，supersedes 0.828）
- era old→new = 1.066 / new→old = 1.243（raw 口径，supersedes 1.036/1.230）

---

## B. Dual OVR Architecture

### 新增概念与 API
| 概念 | API | 服务 |
|---|---|---|
| **Legacy Control Overall** | `calibratedOverall()` → `estimateGameOverall()`（未改） | C1 sourcePeakOverall/potential fallback；C2 constrainRookieInitialAttributes；C3 growthGap/growth controller |
| **V3-E Display Overall** | `estimateDisplayOverallV3E()`（`src/rookieOverallV3E.ts`） | 最终结果页、export/report、diagnostics/shadow |

### 关键实现
- **`src/rookieOverallV3E.ts`**：加载 `src/data/rookieOverallV3E.json`（official 664 全量训练导出，hierarchical 非负模型，λ1=100/λ2=200），提供 `estimateDisplayOverallV3E({attrs, intangibles, position})` 与 `estimateDisplayOverallV3EFromRecord(values, position)`。**34 能力属性 slope ≥ 0（单调），Intangibles slope 不约束**
- **`createResult.ts`**：新增 `v3eDisplayOverall` / `v3eDisplayOverallRaw` 字段（display-only）；`initialStrength` 保持 = `baseOverall`（legacy control，growthGap 依赖不变）
- **未原地替换 estimateGameOverall()**；control 路径 C1/C2/C3 零改动
- **V3-E 不回流**：验证 E2a/E2b 确认 V3-E 只被 createResult display 字段引用，不在任何 constraint/growthGap 调用路径

### 模型导出
`scripts/export-v3e-model.mts` → `src/data/rookieOverallV3E.json`（full in-sample raw MAE 0.660；OOF 见 canonical）

---

## C. Intangibles Final Policy（已实现）

**优先级（createResult.ts:921-929）**：
1. `customFinalAttrs["Intangibles"]` — custom explicit
2. `singleCard?.detailed?.["Intangibles"]` — single-card / all slots same real card
3. `50` — multi-donor synthetic neutral

**已删除**：`potentialCard?.detailed?.["Intangibles"]` 隐式继承（Potential=未来上限 ≠ Intangibles=OVR 校准）
**不使用** Stability donor；**不根据** morphology 生成

**测试**（test-create-result.mts §12）：
- 12a single-card reproduction → 卡真实 Intangibles ✅
- 12b multi-donor synthetic → neutral 50 ✅
- 12c custom explicit 优先 ✅

---

## D. Shadow Mode 结果（`reports/rookie-overall-stage6b-shadow.md`）

批次：official 664 + snapshot 1374 + synthetic 10000 + fixtures 5 = **12043**

| 批次 | mean delta | std | \|Δ\|≤1 | \|Δ\|≤2 | \|Δ\|≥3 |
|---|---|---|---|---|---|
| official | -0.28 | 1.33 | 75.5% | 94.3% | 5.7% |
| snapshot | -0.29 | 1.67 | 67.5% | 86.2% | 13.8% |
| synthetic 10000 | -1.21 | 1.85 | 51.1% | 75.4% | 24.6% |

- **Top delta（official）**：Wade -5 / LeBron -5 / Moreland +5 —— legacy 对高属性高估，V3-E 更接近官方 OVR
- **OVR band（official）**：<70 +0.67 / 70-79 -0.52 / 80-84 **-2.00（78.1% ≥2）**——80+ 区间 display 显著低于 control（V3-E 对高端不 extrapolate，符合 85+ 政策）
- corr(Intangibles, delta) = **0.386**（official）——Intangibles 越高，V3-E 相对 legacy 越高
- fixtures：All-99 99 vs 99（clamp 后一致）、All-25 40 vs 40

**观察（未改变任何行为）**：delta>0 且原 build 触发 constraint 时，display 会比 control 高——display/control 解耦的预期行为。

---

## E. Acceptance（全部通过 ✅）

| # | 要求 | 验证 |
|---|---|---|
| E1 | 同 seed/input final attrs 一致（除批准的 Intangibles 变化） | diff 检查：control 删除仅 Intangibles policy 1 行；新增均为注释/display 字段；无 control 赋值触碰 |
| E2 | potential/growthGap/peakStart/peakEnd 不变 | initialStrength=baseOverall 保留；growthGap 依赖未动 |
| E3 | Body V2 regression 全绿 | test-body-degrade-v2 24/24 ✅ |
| E4 | Slot Semantics regression 全绿 | test-slot-semantics-v2 58/58 ✅ |
| E5 | V3-E 不在 CONTROL_LOOP | grep 依赖面：仅 createResult display 字段 + 自身模块；不在 constraint/growthGap 路径 |

补充回归：test-create-result ✅ / test-adversarial 52/52 ✅ / 完整 verify 待确认

---

## 交付物
- `src/rookieOverallV3E.ts`（display API）+ `src/data/rookieOverallV3E.json`（模型系数）
- `src/createResult.ts`（v3eDisplay 字段 + Intangibles policy）
- `scripts/export-v3e-model.mts` / `run-shadow-mode.mts` / `verify-stage6b-acceptance.mts`
- `scripts/test-create-result.mts` §12（Intangibles policy 测试）
- `reports/rookie-overall-stage6b-shadow.md`

**未做**：不迁移 growth controller、不删除 legacy model、不切 production control estimator。
**STOP FOR REVIEW** —— 等待审阅：① display 字段是否接入 UI（结果页切换 v3eDisplayOverall）；② Intangibles policy 是否批准生效（已在代码，未在 UI 暴露）；③ shadow 的 80-84 大 delta 是否可接受。
