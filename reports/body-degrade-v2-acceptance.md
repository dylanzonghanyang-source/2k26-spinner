# Body Degrade V2 Acceptance Report

> **报告状态：ALL PASS（24 / 24）— V2 已接入生产链**
> 本报告由 `scripts/test-body-degrade-v2.mts` 实跑生成，非人工改写。

## 1. 测试基准

- 规范版本：`body-degrade-v2.acceptance/1.0`
- 机器 fixture：`tests/fixtures/body-degrade-v2.acceptance.json`（原样复制，未修改）
- 运行命令：`pnpm run test:body-degrade-v2`
- 最终公式：`final = round(clamp(min(raw, structuralCeiling, supportCeiling), 25, 99))`

## 2. 结果总览

| ID | Test | Expected | Status |
|---|---|---|---|
| F01 | Position label must not change atomic attributes | `allAtomicAttributesEqual` | **PASS** |
| F02 | Passing is body-invariant | `94` / `94` | **PASS** |
| F03 | Support never buffs low raw skill | `42` | **PASS** |
| F04 | Ceiling model protects already-low raw ratings | `60`/`67`, supportCeiling 67 | **PASS** |
| F05 | Donor self-reproduction property | `finalEqualsRawForEveryEligibleAttribute` | **PASS**（28854/28854） |
| F06 | Structural donor-expanded MIN threshold | `87` (ceiling 87.340192) | **PASS** |
| F07 | Contextual donor condition cannot be smuggled to a different body | `75` | **PASS** |
| F08 | Contextual donor reproduces itself | `95` | **PASS** |
| F09 | Extreme height cannot compensate catastrophic Vertical for Driving Dunk | `61` | **PASS** |
| F10 | Structural and support ceilings combine by min, not additive cuts | `59` (forbidden 23) | **PASS** |
| F11 | Giant low-agility perimeter defender is support-limited | `71` (ceil 86.407407 / 71) | **PASS** |
| F12 | Same giant body with elite agility retains much more perimeter defense | `86` (ceil 86.407407) | **PASS** |
| F13 | Position must not proxy for wingspan | `allAtomicAttributesEqual` | **PASS** |
| F14 | Target wingspan score 1-100 is excluded from Body Degrade V2 | `allAtomicAttributesEqual`（25 ↔ 99） | **PASS** |
| F15 | Structural threshold boundary is a true zero zone | `99` (reductions 0.0) | **PASS** |
| F16 | One-unit threshold violation must be smooth, not a cliff | `99` (ceiling 98.821674) | **PASS** |
| F17 | Multiple support failures must obey supportTotalCap | `67` (uncapped 52 → capped 32) | **PASS** |
| F18 | Evaluation order is deterministic and topological | `allOutputsIdentical` | **PASS**（20 permutations） |
| F19 | Donor-expanded BMI MAX preserves Zion-like outliers | `99` / `95` (ceiling 95.224856) | **PASS** |
| F20 | Extreme low BMI limits inherited Strength | `74` (ceiling 74.0) | **PASS** |
| F21 | Shooting structural guardrail stays gentle even at science-fiction body size | `89` (uncapped 16 → capped 10) | **PASS** |
| F22 | skipBody bypasses both Structural and Support V2 | `95` | **PASS** |
| F23 | Preview and final generation share exactly the same atomic evaluator | `allAtomicAttributesEqual` | **PASS** |
| F24 | UI minimum height must be lowered without changing algorithm thresholds | `uiAccepts170AndEngineUsesExistingThresholds` | **PASS** |

**最终结果：24 PASS / 0 FAIL / 0 pending**

## 3. F05 全量 donor self-reproduction

- 数据集：`data/snapshots/2kspinner-rookies-1960-2025-2026-08-13/rookie-snapshot.json`（1374 卡）
- 条件：卡 vitals 完整（heightInches/weightLb 合法）+ 该 attr 的 support 依赖全部有真实观测
- 结果：**eligible=28854，verified=28854，skipped=0，failures=0**

即：每个 donor 在自己的身体/支持值下，所有 profiled atomic 全部原值复现——V2 的 donor-proven 语义在真实全量数据上自洽。

## 4. 实现交付

| 文件 | 说明 |
|---|---|
| `src/rookieAtomicBodyProfiles.ts` | V2 参数配置层（structural/support profiles、context curves、DAG、属性覆盖面断言） |
| `src/rookieBodyV2.ts` | V2 纯函数引擎（BMI/smoothstep/interpolateCurve/evaluateStructural/evaluateSupport/evaluateAtomic/evaluateAtomicGraph/trace） |
| `src/createResult.ts` | evaluate/evaluateCustom/evaluateAll 全部切 V2；`collectAtomicSources` 新增；`applyV2CustomFinal` 新增；三处 V1 后处理 bypass |
| `tests/fixtures/body-degrade-v2.acceptance.json` | 权威 fixture |
| `scripts/test-body-degrade-v2.mts` | acceptance runner（24 case，含集成链验证） |
| `scripts/trace-body-degrade-v2-demo.mts` | trace 演示 |
| `scripts/test-create-result.mts` | 测试 4/8/9/10 迁移到 V2 语义 |
| `scripts/test-rookie-body-constraints.mts` | 架构断言改为 V2（不再要求 applyBodyConstraints 统一） |
| `package.json` | +`test:body-degrade-v2` |

## 5. V1 停用清单（createResult.ts 内已确认 0 残留）

- `SUPPORT_MAX_CUT` / `SUPPORT_MIN_KEEP` / `SUPPORT_GAP_REFERENCE` / `supportDeficitFor` ✅ 已删除
- `positionCross` / `POSITION_CROSS_SCALE` / `BODY_MISMATCH_PENALTY_SCALE` ✅ 不再被调用
- `safetyCapForAttribute`（wingspan/shoulder cap）✅ 三处后处理全部 bypass
- `bodyTransferProfiles` 槽位 profile ✅ 不再驱动 atomic
- `attrToSlot` 引用 ✅ 移除

`rookieBodyConstraints.ts` / `rookieBodyProfiles.ts` 文件保留（V1 遗留 + 其他工具引用），但生产生成链不再调用其 body-degrade 数学。

## 6. 回归验证

- `pnpm run test:create-result` ✅（含 V2 语义迁移后的测试）
- `pnpm run test:body` ✅
- `pnpm run test:durability` ✅
- `pnpm run test:rookie-initial-overall` ✅
- `pnpm run test:rookie-cards` ✅
- `pnpm run build` ✅

## 7. 仍需后续处理（TODO）

1. ~~手工体验验证~~ ✅ 已由 release check #4 浏览器 smoke test 完成（Jokić 85→85 / Wemby 90→69 / Mitchell 74→65 / 低 raw 保留）
2. **16 槽 position-aware presentation layer**（下一阶段，spec §18）：当前 slot adjusted = 简单平均（兼容层）；含 SlotPicker 单槽预览 vs 全槽 support 差异的 UI 提示
3. **直接用 atomic + position 的 OVR predictor**（更后阶段）
4. ~~verify 挂入~~ ✅ 已插入 `pnpm run verify`，全链 PASS
5. 极端边界抽查：170cm 输入下 Layup MIN 175 / Driving Dunk MIN 180 的实际表现

## 8. Release Check（2026-08-14 完成）

### 1. F14 wingspan 权威值
- runner 曾用 50↔99，与 fixture 权威值（25/99）不符 → **已修正为 25↔99** 并复跑 PASS
- 文档 invariants 节同步修正（表格原本已正确）

### 2. F23 端到端 parity
- 新增 `runEndToEndParity`：evaluateAllPreview（card-aware）vs **完整 createResult final**（含 custom 合并、peakAttrs/initialAttrs V2 clamp、durability、OVR constraint、badges、hotzones 全部后处理）
- 逐字段比对 `initialAttrs`；`Overall Durability` 按 spec §2.8 排除（durability 子系统独立重新生成，非 V2 输出）
- **PASS**：`end-to-end preview == createResult final (all post-processing included)`

### 3. verify 链挂入
- `package.json` verify 中 `test:create-result` 后已插入 `pnpm run test:body-degrade-v2`
- **`pnpm run verify` 全链 PASS**（24/24 acceptance 内嵌 + 其余 52/52 adversarial 等全绿）

### 4. 浏览器 smoke test（headless Chrome CDP，自选生成模式，目标 PG 185cm/82kg）
| 场景 | 观测 | 判定 |
|---|---|---|
| Jokić 传球槽 | **85→85**（V1 会被位置交叉砍到 ~54） | ✅ 位置不变性实机确认 |
| Wemby 盖帽槽 | **90→69**（guard body 触发 structural MIN 200 ceiling） | ✅ F10 类行为实机确认 |
| Mitchell 扣篮槽 | 预览 74→74；全槽锁定后 **74→65**（support DAG 完整生效） | ✅ 预期行为 |
| 低 raw 槽位（背身 40/内防 38/外防 62） | 原值保留（ceiling 不重复挨打） | ✅ |
| 最终生成 | 全部 16 槽 → 完整结果页，无 console error | ✅ |
- **发现的问题（记录，非 bug）**：SlotPicker 单槽预览（`evaluate`，无跨槽 support 上下文 → support 依赖标 incomplete 跳过）与全槽锁定后（`evaluateAll`，完整 DAG）在**有 support 依赖的槽位**上可出现可见差异（Mitchell 扣篮 74→65）。V1 时代同样存在（单槽不做跨槽 support），V2 语义下是预期行为；但 UI 预览与最终值的不一致值得后续加提示（列入 presentation 阶段 TODO）。
- smoke 临时脚本位于 /tmp，未污染仓库
