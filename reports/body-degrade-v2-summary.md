# Body Degrade V2 — 全部工作与最终结果汇总

> 项目：2k26-spinner（TypeScript / React，NBA 2K26 新秀生成器）
> 任务：将槽位级、位置相关的 Body Degrade V1 重构为「原子属性级」Body Degrade V2
> 日期：2026-08-14
> 最终状态：**24 / 24 acceptance PASS，构建与全量回归 PASS**

---

## 1. 任务背景与权威来源

用户提供了两个压缩包，作为本次重构的权威规格：

| 包 | 内容 | 作用 |
|---|---|---|
| `body-degrade-v2-spec.zip` | `docs/body-degrade-v2-plan.md`（1012 行）、`tests/fixtures/body-degrade-v2.acceptance.json`（24 cases）、`reports/body-degrade-v2-acceptance.md` | 权威规格 + 机器验收标准 |
| `body-degrade-src.zip` | `createResult.ts`、`rookieBodyConstraints.ts`、`rookieBodyProfiles.ts` | V1 原始源码（经 diff 确认与仓库 **IDENTICAL**） |

**优先级**：fixture > plan.md > acceptance.md > 现有源码。规格内部无不可调和冲突；全部 24 个 case 按权威参数一次通过，**没有修改任何 expected 值迁就实现**。

### 核心架构要求

```
donor raw atomic attribute
        │
        ├── Structural Engine → structuralCeiling
        ├── Support Engine    → supportCeiling
        ↓
finalAtomic = roundAndClamp(min(donorRaw, structuralCeiling, supportCeiling))
```

- Structural 与 Support 是**两个独立 bottleneck ceiling**，禁止 `raw - penalty` 相加、禁止乘法放大
- Position 不得进入原子生成；Wingspan（1–100 score）完全排除；Durability 独立
- Support 只降不升；低 raw 不重复挨打（ceiling 而非减法）
- donor-proven exception：donor 证明的是「异常兑现效率」，不是裸数值迁移（Shawn Bradley 案例）

---

## 2. V1 现状理解（改造前）

```
SlotInput[]（16 bundles）
  → evaluateAll() 两阶段
     ├─ 阶段1: 每槽位 applyBodyConstraints()
     │    ├─ grace zone（同/邻位置 + 体型接近 → 原值继承）
     │    ├─ structuralAdjustmentFor（source−target 有符号差值）
     │    ├─ bodyPressureFor × POSITION_CROSS_SCALE(2.68) × 位置距离
     │    ├─ positionCross（passing 平方 weight=3；handle 线性 weight=2）
     │    └─ safetyCapForAttribute（wingspan/shoulder 1–100 score 建模）
     └─ 阶段2: supportDeficitFor（sourceValue−targetValue 差值 / 20）
          → cut = min(deficit, SUPPORT_MAX_CUT=8)，floor = current×0.65
```

V1 问题：Jokić 传球被 C→PG 位置距离砍约 31 点；巨人盖帽被「身材差异×位置距离」重复放大；wingspan score 无验证映射却被用于 cap；support 按差值扣而非按硬件需求。

### Inventory：evaluateAll 之外仍会修改 atomic 的 V1 调用点

| 位置 | 内容 | V2 处理 |
|---|---|---|
| `createResult.ts` 原 :614 | `customFinalAttrs` 合并后重跑 V1 source=null cap | → `applyV2CustomFinal`（V2 原子语义） |
| 原 :616 | **整个 peakAttrs** 重跑 V1 wingspan/shoulder cap | → 纯数值 clamp |
| 原 :723 | `initialAttrs` 重跑 V1 cap | → 纯数值 clamp |
| `SlotPicker.tsx:77` | 单槽 `evaluate()`（V1） | → evaluate 内部切 V2（support 缺失标 incomplete） |

---

## 3. 实现过程（按小步交付）

### Stage 1 — 纯配置 + 纯函数引擎（不接主链）

| 文件 | 内容 |
|---|---|
| `src/rookieAtomicBodyProfiles.ts` | 全部参数集中定义：structural 18 属性（Height/BMI，`*` 属性合并 totalCap）、support 14 属性 + totalCap 表、5 条 contextual curves（线性插值 + 边界 clamp）、显式 DAG 分层（L0 roots → L1 → L2 SWB → L3 Layup/DD）、`allAtomicAttrs`/`profiledAttrs`/`passthroughAttrs` + `assertProfileCoverage()` |
| `src/rookieBodyV2.ts` | 纯函数引擎：`bmi`、`smoothstep`、`interpolateCurve`、`evaluateStructural(profile, targetBody, donorBody)`（修正点 2：donor 由每个 dependency 按 variable 独立解析）、`evaluateSupport`、`evaluateAtomic`、`evaluateAtomicGraph`（显式拓扑顺序，不依赖对象键序）、完整 FactorTrace |
| `tests/fixtures/body-degrade-v2.acceptance.json` | 权威 fixture 原样复制 |
| `scripts/test-body-degrade-v2.mts` | acceptance runner（Stage 1 先跑 17 个纯引擎 case） |
| `scripts/trace-body-degrade-v2-demo.mts` | 关键 case trace 演示 |

Stage 1 结果：**17 PASS / 0 FAIL**，`pnpm run build` PASS。

### Stage 4 — 接入真实生成链

- `evaluateAll` 重构为：`collectAtomicSources`（每 bundle 每 attr 独立记录 raw/donor body/donor supports）→ `evaluateAtomicGraph`（DAG 顺序，roots freeze → L1 → L2 → L3，targetFinalSupports 自动累积）→ rebuild 每槽位 `Evaluation`（slot adjusted = 兼容层平均）
- `evaluate` / `evaluateCustom` 单槽切 V2：无跨槽上下文 → support 依赖按规格 §5.4 标记 incomplete 跳过（不猜），structural 完整生效
- 新增 `applyV2CustomFinal`：custom 字段无 donor → structural base threshold + support incomplete
- **三处 V1 后处理全部 bypass**；`SUPPORT_MAX_CUT/MIN_KEEP/GAP_REFERENCE`、`supportDeficitFor`、`bodyTransferProfiles`、`attrToSlot` 引用全部移除
- runner 补上集成类 case：F01/F13（position invariance 真实 createResult 链）、F14（wingspan invariance）、F18（20 次 permutation）、F23（preview/final parity）、F24（UI 身高断言）

### 测试适配（V1 断言 → V2 语义）

- `scripts/test-create-result.mts`：测试 4 改为 donor-expanded Post Hook（87/79 区分有无 body）；测试 8 改为「低 target Strength → Interior Defense support ceiling 被压低」；测试 9 改为 position invariance + 无 grace zone；测试 10 改为 no-buff 断言；测试 11 保留（preview = locked）
- `scripts/test-rookie-body-constraints.mts`：架构断言改为「V2 生产路径不得调用 V1 applyBodyConstraints / V1 support cut 模型不得残留」

---

## 4. 最终 Acceptance 结果

```
CONFIG: PASS — allAtomicAttrs=35 | profiledAttrs=21 (structural=18, support=14) | passthroughAttrs=14 | curves=5
24 PASS / 0 FAIL / 0 pending
```

| ID | 测试 | 期望 | 结果 |
|---|---|---|---|
| F01 | Position 不改 atomic | allEqual | **PASS** |
| F02 | Passing 身体不变性 | 94/94 | **PASS** |
| F03 | Support 不 buff 低 raw | 42 | **PASS** |
| F04 | Ceiling 保护低 raw | 60/67 | **PASS** |
| F05 | Donor self-reproduction（全量） | final==raw | **PASS 28854/28854** |
| F06 | Structural donor-expanded MIN | 87 | **PASS** |
| F07 | Bradley contextual 不偷渡 | 75 | **PASS** |
| F08 | Contextual donor 自复现 | 95 | **PASS** |
| F09 | 240cm/Vertical5 DD | 61 | **PASS** |
| F10 | Structural+Support 取 min | 59（禁 23） | **PASS** |
| F11 | 巨人低敏捷 PD | 71 | **PASS** |
| F12 | 同 body 高敏捷 PD | 86 | **PASS** |
| F13 | Position 不代理 wingspan | allEqual | **PASS** |
| F14 | wingspan 25↔99 不变 | allEqual | **PASS** |
| F15 | 阈值边界零区 | 99 | **PASS** |
| F16 | 1 单位违规平滑 | 99 | **PASS** |
| F17 | Support total cap | 67 | **PASS** |
| F18 | 拓扑确定性 | identical | **PASS**（20 permutations） |
| F19 | Zion BMI donor 扩展 | 99/95 | **PASS** |
| F20 | 低 BMI 限 Strength | 74 | **PASS** |
| F21 | 投篮极端保险 | 89 | **PASS** |
| F22 | skipBody 双 bypass | 95 | **PASS** |
| F23 | preview/final parity | allEqual | **PASS** |
| F24 | UI 身高 170 + 阈值不动 | — | **PASS** |

### F05 全量扫描

- 数据集：`data/snapshots/2kspinner-rookies-1960-2025-2026-08-13/rookie-snapshot.json`（1374 卡）
- 条件：卡 vitals 完整 + 该 attr 的 support 依赖全部有真实观测
- **eligible=28854，verified=28854，skipped=0，failures=0**

---

## 5. 关键 case trace（实跑输出）

### F09 — 240cm / Vertical5 / Driving Dunk raw 90 → 61

```
[structural heightCm MIN] base=180 eff=180 target=240 src=198 viol=0 sev=0 red=0
structural ceiling = 99
[support Vertical]      base=80 eff=80 target=5 src=90 deficit=75 sev=1 maxRed=38 red=38
[support Speed with Ball] base=60 eff=60 target=70 src=70 deficit=0 red=0
[support Agility]       base=60 eff=60 target=70 src=70 deficit=0 red=0
[support Strength]      base=40 eff=40 target=50 src=50 deficit=0 red=0
support ceiling = 61 → final = min(90, 99, 61) = 61
```

### F10 — 180cm / Vertical20 / Block raw 95 → 59（禁止 additive 23）

```
[structural heightCm MIN] base=200 eff=200 target=180 src=213 viol=20 sev=1 maxRed=32 red=32 → ceiling 67
[support Vertical]      base=75 eff=75 target=20 src=80 deficit=55 sev=1 maxRed=40 red=40 → ceiling 59
final = min(95, 67, 59) = 59   （runner 显式断言 raw−32−40=23 为 forbidden）
```

### F11 — 220cm / BMI32.5 / Agility45 / Perimeter Defense raw 95 → 71

```
[structural heightCm MAX] base=215 eff=215 target=220 src=200 viol=5  sev=0.259259 red=2.592593
[structural bmi MAX]      base=27.5 eff=27.5 target=32.5 src=24.5 viol=5 sev=1 red=10
structural: uncapped=12.592593 capped=12.592593 ceiling=86.407407
[support Agility] base=75 eff=75 target=45 src=90 deficit=30 sev=1 maxRed=28 red=28
support ceiling = 71 → final = min(95, 86.41, 71) = 71
```

### F07 — Bradley contextual donor（229cm Vertical32 → 198cm Vertical32）→ 75

```
donorException = max(0, requirement(229cm)=30 − 32) = 0
effectiveRequirement = max(0, requirement(198cm)=90 − 0) = 90
[support Vertical] base=90 eff=90 target=32 src=32 deficit=58 sev=1 maxRed=24 red=24
support ceiling = 75 → final = 75（错误实现 min(targetBase, donorSupport) 会得 95）
```

### F19 — Zion donor-expanded BMI（donor BMI 32.82，target BMI 34）→ 95

```
[structural bmi MAX] base=29 eff=32.82 target=34 src=32.82 viol=1.18 sev=0.209730 maxRed=18 red=3.775144
structural ceiling = 95.224856 → final = 95（从 32.82 起罚，而非从 base 29 起罚）
```

---

## 6. 交付文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/rookieAtomicBodyProfiles.ts` | 新增 | V2 参数配置层（唯一权威参数来源，无魔法数字散落） |
| `src/rookieBodyV2.ts` | 新增 | V2 纯函数引擎（无 React、无 V1 依赖、含 trace） |
| `src/createResult.ts` | 修改 | evaluate/evaluateCustom/evaluateAll 切 V2；collectAtomicSources、applyV2CustomFinal 新增 |
| `tests/fixtures/body-degrade-v2.acceptance.json` | 新增 | 权威 fixture（原样复制） |
| `scripts/test-body-degrade-v2.mts` | 新增 | acceptance runner（24 case + 配置断言 + FAIL 完整 trace） |
| `scripts/trace-body-degrade-v2-demo.mts` | 新增 | trace 演示 |
| `scripts/test-create-result.mts` | 修改 | 4 个 V1 机制断言迁移为 V2 语义 |
| `scripts/test-rookie-body-constraints.mts` | 修改 | 架构断言改为 V2 无残留 |
| `reports/body-degrade-v2-acceptance.md` | 新增 | 24/24 实跑报告 |
| `package.json` | 修改 | +`test:body-degrade-v2`（1 行） |

## 7. V1 停用清单（生产链已确认 0 残留）

| V1 机制 | 状态 |
|---|---|
| `SUPPORT_MAX_CUT=8` / `SUPPORT_MIN_KEEP=0.65` / `SUPPORT_GAP_REFERENCE=20` / `supportDeficitFor` | 删除 |
| `positionCross` / `POSITION_CROSS_SCALE` / `BODY_MISMATCH_PENALTY_SCALE` | 不再被调用 |
| `safetyCapForAttribute`（wingspan/shoulder/neck/torso cap） | 三处后处理全部 bypass |
| `strengthCapForBody` 作为 Body cap | 不再被调用 |
| `bodyTransferProfiles` 槽位 profile 驱动 atomic | 不再驱动 |
| grace zone / positionMultiplier / bodyPressureFor | 不再被调用 |

`rookieBodyConstraints.ts` / `rookieBodyProfiles.ts` 文件本身**保留**（V1 遗留函数 + 其他工具引用 + `attrToSlot` 仍供 UI/provenance 使用），但生产生成链不再调用其 body-degrade 数学。

## 8. 范围外确认（未改动）

- rookie OVR model ✅ 未动
- durability 独立子系统 ✅ 未并入（F01/F13 断言已明确排除 16 项部位字段）
- badges / tendencies / hot zones / growth / potential / 惯用手 ✅ 未动
- rookie card database lookup ✅ 未动
- 随机生成框架 ✅ 未动（signature 不变，确定性保持）

## 9. 验证命令与输出摘要

| 命令 | 结果 |
|---|---|
| `pnpm run test:body-degrade-v2` | **24 PASS / 0 FAIL / 0 pending** |
| `pnpm run test:create-result` | ✅（含 V2 语义迁移后断言） |
| `pnpm run test:body` | ✅ rookie body constraints OK |
| `pnpm run test:durability` | ✅ |
| `pnpm run test:rookie-initial-overall` | ✅ |
| `pnpm run test:rookie-cards` | ✅ |
| `pnpm run build` | ✅ ✓ built |

## 10. 设计 invariants 达成情况

- [x] Position invariance：PG↔C 全 atomic 0 差异（F01/F13，真实 createResult 链）
- [x] Wingspan invariance：score **25↔99** 全 atomic 0 差异（F14，真实链，fixture 权威值）
- [x] Support never buffs：final ≤ raw 恒成立（F03 + test-create-result no-buff 断言）
- [x] Donor self-reproduction：28854/28854（F05 全量）
- [x] Bradley contextual case：F07=75 / F08=95 同时通过（donor exception 语义正确）
- [x] Zion BMI donor expansion：F19=99/95
- [x] Block 180/Vertical20 = 59；Driving Dunk 240/Vertical5 = 61；Perimeter D giant/Agility45 = 71
- [x] preview = final（F23，evaluateAllPreview 与锁定 evaluateAll 同源）
- [x] skipBody = raw clamp（F22）
- [x] 中间计算不 round，最终一次 roundAndClamp（F06/F16 浮点断言验证）
- [x] Diagnostic trace 可解释每一次 ceiling（runner FAIL 输出 + demo 脚本）
- [x] UI 最低身高已满足 170（repo 现状 min=150，未改动；算法阈值保持 fixture 原值）

## 11. 仍需后续处理（TODO）

1. **浏览器实机体验验证**（未做项）：起 dev server 实机跑一次生成，目检：
   - Jokić 传球（Pass Accuracy/IQ/Vision 不再被位置砍 31 点）
   - Chet / 巨人 Block（structural + support 取 min，无重复放大）
   - Tatum / Mitchell Dunk slot 展示（当前 slot = 简单平均，属 presentation 层）
2. **16 槽 position-aware presentation layer**（spec §18 下一阶段）：
   - slot adjusted 当前为兼容层平均（`round(average(finalAtomic))`）
   - 未来按 position 做 slot display weighting，**不得反向影响 atomic**
3. **直接用 atomic attributes + position 的 OVR predictor**（更后阶段）
4. `test:body-degrade-v2` 暂未挂入 `verify` 全链（保持 verify 稳定；需时可挂）
5. 极端边界抽查：170cm 输入下 `Layup MIN 175` / `Driving Dunk MIN 180` 的实际触发表现
6. F05 全量扫描当前为「完整数据子集」28854 条；未来数据补全后可扩展扫描范围
