# Stage 6A — OVR Production Blast-Radius Audit

日期：2026-08-14 · 状态：**审计完成，未修改任何代码，STOP FOR REVIEW**

---

## 1. Estimator 调用点全量清单

搜索范围：`src/` + `scripts/` 全部 `.ts/.tsx/.mts/.mjs`。核心函数：
- `estimateGameOverall(values, position, badges, fallbackValue, version)` — `src/rookieOverall.ts:70`（唯一低层 estimator）
- `calibratedOverall(...)` — `src/createResult.ts:600`（createResult 内部包装，转发 estimateGameOverall）
- `initialOverallForPotential(potential)` — `src/rookieInitialOverall.ts:44`（target OVR 公式，不调 estimator）
- `constrainRookieInitialAttributes({...})` — `src/rookieInitialOverall.ts:55`（**循环调用 estimator**）

### 1.1 生产路径（src/）

| # | 位置 | 调用 | 分类 | 说明 |
|---|---|---|---|---|
| C1 | `createResult.ts:811` | `calibratedOverall(peakAttrs, position, peakBadges, mean, overallVersion)` | **CONTROL_LOOP** | `sourcePeakOverall` 进入 potential 解析（L819-824：无卡时 `potential = round(sourcePeakOverall)`）→ 影响 growth/potential/constraint target |
| C2 | `createResult.ts:926-941` | `constrainRookieInitialAttributes({ estimateOverall: calibratedOverall(...) })` | **CONTROL_LOOP** | 见 §2 详析 |
| C3 | `createResult.ts:945` | `calibratedOverall(initialAttrs, position, badges, mean, initialOverallVersion)` | **CONTROL_LOOP**（间接） | `baseOverall`/`initialStrength` → L957 `growthGap = potential − initialStrength` → 影响 peakStart/成长速度/巅峰窗口（L974-982） |
| C4 | `rookieOverall.ts:70` | 定义本身 | — | 读取 `src/data/rookieOverallModel*.json`（4 版本），非负系数 |

### 1.2 数据管线（scripts/）

| # | 位置 | 调用 | 分类 | 说明 |
|---|---|---|---|---|
| D1 | `convert-gap-snapshot.mjs:285` | `estimateGameOverall(detailed, pos, badges, age, "2k26")` | READ_ONLY（数据） | 生成 gap 卡 `overallSource=model-estimated-gap` 的估算值；写入卡文件后进入数据宇宙 |
| D2 | `convert-no-card-batch.mjs:330` | `estimateGameOverall(card.detailed, posKey, badgesForModel, 65, "rookie")` | READ_ONLY（数据） | no-card 系列 OVR 估算 |
| D3 | `estimate-missing-ovr.mts` | 不 import estimator；直接用 `rookieOverallModel-rookie.json` 系数计算 | READ_ONLY（数据） | 写 overrides `estimated: true` |

### 1.3 测试（scripts/）

| # | 位置 | 分类 | 说明 |
|---|---|---|---|
| T1 | `test-rookie-initial-overall.mts:44/56/73` | READ_ONLY | constraint 行为断言 |
| T2 | `test-result-overall-contract.mts:90` | READ_ONLY | 结果 OVR 与 attributes 一致性契约 |
| T3 | `test-badge-ovr-model.mts` | READ_ONLY | badge 单调性断言 |
| T4 | `test-rookie-overall-calibration.mjs` | READ_ONLY | 版本模型校准 |
| T5 | `test-slot-semantics-v2.mts:242` | READ_ONLY | 注释确认 computeSlotDisplay 不依赖 estimator |

### 1.4 UI（src/components/）

无直接 estimator 调用。结果页显示 `result.initialStrength` / `result.baseOverall` / `result.intangibles`（`RookieBuilder.tsx:1911-1912`）——均为 createResult 返回值，**READ_ONLY 显示**。

---

## 2. constrainRookieInitialAttributes 详析（最高风险点）

**机制**（`src/rookieInitialOverall.ts:55-124`）：
1. `targetOverall = initialOverallForPotential(potential)`（L70）——不依赖 estimator
2. `originalOverall = estimateOverall(originalValues, badges)`（L72）——**estimator 第一次调用**
3. 若 `originalOverall <= targetOverall` → 不修改（L74-84）
4. 否则对 offset ∈ [-1, -30] 逐级搜索（L104-113）：每级 `evaluateAtOffset(offset)` 对**所有未锁定属性**统一加 offset（clamp 25-99），重新调 estimator 计算候选 OVR
5. 选择「可行（OVR ≤ target）且最接近 target」或「不可行时最低 OVR」的 offset（L107-113）
6. 返回 best.values 由调用方 `Object.assign(initialAttrs, ...)`（createResult.ts:942）

**直接替换 estimator 的 blast radius**：
- estimator 变化 → `originalOverall` 变化 → 触发/不触发下调的**边界移动**
- estimator 变化 → offset 搜索的**每一级评估结果变化** → 选中的 offset 可能不同 → **最终 atomic attributes 整体平移量不同**
- 由于是「统一 offset」机制，形状保持但整体水平改变：**生成卡的所有未锁定属性同时受影响**
- 锁定值（custom + cardLockedValues + Intangibles）不变（L90 跳过）

**依赖链**：estimator → (L72, L97) → constraint offset → initialAttrs → (L942) → baseOverall (L945) → growthGap (L957) → peakStart/yearsToPeak/peakDuration (L974-982) → growth 轨迹 → potential 相关展示。

---

## 3. Dependency Graph

```
estimateGameOverall (rookieOverall.ts:70)
 ├─ calibratedOverall (createResult.ts:600)
 │   ├─ [C1] createResult.ts:811 sourcePeakOverall ──→ potential 解析 ──→ potential ──→ targetOverall / growthGap
 │   ├─ [C2] createResult.ts:934 constraint.estimateOverall
 │   │       └─ constrainRookieInitialAttributes (rookieInitialOverall.ts:55)
 │   │           ├─ L72 originalOverall（触发判定）
 │   │           └─ L97 offset 搜索（30 次循环评估）→ offset → 全部未锁定 attributes 平移
 │   └─ [C3] createResult.ts:945 baseOverall = initialStrength ──→ growthGap ──→ peakStart/yearsToPeak/peakDuration ──→ growth 轨迹
 ├─ [D1] convert-gap-snapshot.mjs:285 → 数据宇宙（model-estimated-gap 标签）
 └─ [D2] convert-no-card-batch.mjs:330 → no-card OVR
[estimator 数据源] rookieOverallModel{,-2k26,-2k27,-rookie}.json
```

## 4. Blast-Radius 总结

| 影响面 | READ_ONLY | CONTROL_LOOP | 备注 |
|---|---|---|---|
| 结果页 OVR 显示 | ✅ | | 随 estimator 变，无副作用 |
| 生成卡 attributes | | ✅ **C2 直接** | constraint offset 平移全部未锁定属性 |
| potential / growth 轨迹 | | ✅ **C1/C3 间接** | potential fallback、growthGap、巅峰窗口 |
| 数据管线（gap/no-card 估算） | ✅ | | 仅影响未来数据标签；已入库卡不变 |
| 导出/报告 | ✅ | | — |

**结论**：替换 estimator 的最小安全面 = 显示 + 数据管线；**最大风险面 = 生成卡 final attributes 整体平移**（经 C2 constraint 循环）与 **growth 轨迹改变**（经 C1/C3）。任何 production switch 必须：
1. 先 diff 新旧 estimator 在全部 664 official 样本上的 `originalOverall` 与 constraint 触发率
2. 验证 offset 分布变化对 final attributes 的 Δ 分布
3. growthGap 变化对 peakStart/yearsToPeak 的影响（已冻结 V3-E 为唯一 candidate，morphology 不进入）

**本阶段不修改代码。** 已冻结决策记录：V3-E 唯一 production candidate；morphology 不进入 OVR；synthetic Intangibles 顺序 = custom explicit > single-card real > multi-donor neutral 50（删除 Potential donor 方向，但 audit 完成前不改生产）；85+ 保持 extrapolation 标记。

---

## 5. Final Validation 结果（附）

### 5.1 V3-E λ2 provenance + nested CV

- λ1=100：继承链 `train-rookie-card-ovr.mts ridge=100`（历史硬编码）→ V3-B → V3-E ✅ 有 provenance
- **λ2=200：无独立 provenance（V3-E 引入时直接选定）→ 执行小型 nested CV 验证**
- 结果（保守表述，Stage 6B-A 修正）：
  - fixed λ2=200 ordinary OOF MAE = **0.828**
  - nested CV：内层 3-fold 每 fold 均选 **λ2=400**（inner MAE 0.890-0.961），nested outer OOF MAE = **0.855**
- **判定（保守）**：nested 内层未选中 λ2=200，说明若 λ2 曾受当前 CV 影响则内层应倾向其他值；但**不宣称 nested 结果"证明"λ2=200 从未受当前 CV 影响**（普通 OOF 与 nested 协议不同，无法排除任何历史调参痕迹）
- **production 预期精度以 nested outer OOF 0.855 作为更保守的 generalization estimate**（而非 0.828）
- **不继续扩大超参搜索**（λ1/λ2/网格保持现状）

### 5.2 Production-Architecture grouped-by-era OOF（补充）

| 方向 | ProdArch-OOF（era 内重训） | V3-E（raw MAE） |
|---|---|---|
| old→new | 2.375 | **1.066** |
| new→old | 1.769 | **1.243** |

V3-E 在两个 era 方向均大幅优于同架构 ProdArch-OOF → **hierarchical + Intangibles 的 era 泛化增益稳健**（此前 Deployed 对比受 1190 全量训练分布干扰，本补充消除该混淆）。

### 5.2b era 指标差异归因（Stage 6B-A）

旧 V3-E 报告（`rookie-overall-v3e.md`）era MAE 1.036/1.230 vs Final Validation 1.066/1.243 的差异来源：

| 口径 | old→new | new→old |
|---|---|---|
| 旧报告（round 后 pred 算 MAE） | 1.036 | 1.230 |
| 本验证（round 后复现） | 1.034 | 1.230 |
| Final Validation（raw predRaw 算 MAE） | 1.066 | 1.243 |

**差异来源 = MAE 计算口径**：旧报告用 `Math.round(clamp(raw))` 后的整数 pred 算 MAE（含 clamp 到 [40,99] 的截断，误差略小）；Final Validation 用 raw 连续值 predRaw 算 MAE（更保守、无 round 信息损失）。两者是同一模型同一分割，仅指标定义不同。**canonical 指标选定为 raw-MAE 口径**（与 Morphology Incremental Test / nested CV 一致）。

### 5.2c Canonical 指标（最终选定，旧结果 superseded）

| 指标 | 值 | 状态 |
|---|---|---|
| V3-E ordinary OOF MAE（raw） | 0.828 | 保留参考；**superseded by nested 0.855 作为 generalization estimate** |
| V3-E nested outer OOF MAE（λ2 由内层选择） | **0.855** | **canonical generalization estimate（production 预期精度）** |
| V3-E era old→new MAE（raw） | 1.066 | canonical |
| V3-E era new→old MAE（raw） | 1.243 | canonical |
| V3-E era 1.036/1.230（round 口径） | — | **superseded**（口径不一致） |
| V3-E 总 MAE 0.971/0.828 等 CV 数字 | — | 保留（CV 协议内有效） |

### 5.3 Morphology matched comparison 文档/实现一致性

- 文档原称「1-NN nearest-neighbor」，实现实为 **all-pairs + position 中位数阈值**（O(n²)）
- 已修正文档对齐实现（`test-morphology-incremental.mts` §6），标注 Final Validation 修正；**Morphology Research CLOSED，不新增模型**，结论不变（M2 无增量价值）
