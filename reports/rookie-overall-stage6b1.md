# Stage 6B.1 — Intangibles Control-Side Effect Audit

日期：2026-08-14 · 状态：**审计完成 + 过渡双 Intangibles 已实现，STOP FOR REVIEW**

> **历史两阶段（不得混淆）**：
> - **Single-value post-6B policy（neutral 50 单值）— FAIL**：trigger flip 299/10000 (3.0%)、non-Int atomic diff 1302/10000 (13.0%)、growth diff 4014/10000 (40.1%)。neutral 50 单值 policy 本身 **NOT control invariant**。
> - **Dual Intangibles final architecture — PASS**：trigger flip 0、non-Int atomic diff 0、growth diff 0。control 链与 pre-6B 完全一致。

---

---

## 1. 审计方法

- **pre-6B baseline**：临时恢复 `potentialCard?.detailed?.["Intangibles"]` 继承行跑 10000 cases
- **post-6B 当前实现**：`POLICY=pre|post` 环境变量驱动同一 `audit-intangibles-control.mts`，相同 seed/input/donors/body
- 每 case 对比：resolved Intangibles、constraint trigger、非-Int final atomics、baseOverall/initialStrength、potential、growthGap、progressSpeed、peakStart/peakEnd、boom/normal/bust

## 2. 结果（初版 post-6B，单值 policy）

| 指标 | 数量 | 占比 |
|---|---|---|
| Intangibles 解析不同 | 7578 | 75.8% |
| **constraint trigger 翻转** | **299** | **3.0%** |
| **非-Int atomic diff** | **1302** | **13.0%** |
| **growth 字段 diff** | **4014** | **40.1%** |

**硬判据触发：FALL** —— 确认用户判断：Intangibles 作为 legacy estimator 输入，改变 → originalOverall → constraint trigger → offset → 未锁定 atomics → baseOverall/growthGap/growth timeline。

## 3. 过渡双 Intangibles（已实现）

```ts
// control（仅供 legacy CONTROL_LOOP，保持旧 Potential-donor 行为）
const controlIntangibles = customFinalAttrs["Intangibles"]
  ?? potentialCard?.detailed?.["Intangibles"]
  ?? singleCard?.detailed?.["Intangibles"]
  ?? 50;
// display（最终输出 + V3-E display，Final Policy）
const displayIntangibles = customFinalAttrs["Intangibles"]
  ?? singleCard?.detailed?.["Intangibles"]
  ?? 50;
```

- `initialAttrs.Intangibles = controlIntangibles` → constraint（locked 用 control）→ `baseOverall`/`initialStrength`（growthGap 依赖）全程 control 值
- **control 链结束后**才 `initialAttrs.Intangibles = displayIntangibles`（输出字段）
- `v3eDisplayOverall` 用 display 值计算（`{...initialAttrs, Intangibles: displayIntangibles}`）
- **display 不回流 control**；等 Growth Controller V2 再删 legacy control Intangibles

## 4. 重跑结果（过渡双值后）

| 指标 | 数量 | 占比 |
|---|---|---|
| Intangibles 解析不同（display 层） | 7578 | 75.8%（预期，display policy 生效） |
| **constraint trigger 翻转** | **0** | **0.0%** ✅ |
| **非-Int atomic diff** | **0** | **0.0%** ✅ |
| **growth 字段 diff** | **0** | **0.0%** ✅ |

**control invariance 恢复**：所有非-Int atomic / potential / growth 字段与 pre-6B 完全一致。

## 5. Synthetic Shadow Decomposition（A/B/C/D）

| 组合 | 含义 | mean delta |
|---|---|---|
| A→B | legacy + neutral50 − legacy + oldInt | **-0.473**（policy 在 legacy 上） |
| A→C | v3e + oldInt − legacy + oldInt | -0.847（estimator，old 固定） |
| C→D | v3e + neutral50 − v3e + oldInt | -0.838（policy 在 v3e 上） |
| B→D | v3e + neutral50 − legacy + neutral50 | **-1.213**（estimator，neutral 固定） |
| A→D | current − pre 总 delta | -1.685 |

**关键确认**：Stage 6B shadow 的 synthetic mean delta **-1.21 = B→D（estimator 效应）**，不是 policy 效应。总 delta -1.685 分解：estimator 主导（-1.213/-0.847），policy 在 legacy 上贡献 -0.473（即 control audit 的根源，已由过渡方案隔离到 display 层）。

## 6. Acceptance（重跑全绿 ✅）

- E1：双 Intangibles 结构存在 + display 不回流 control（baseOverall/growthGap 用 control 值）
- E2：V3-E 仅 display 引用，不在 constraint/growthGap 路径
- E3：Body V2 24/24 ✅
- E4：Slot Semantics 58/58 ✅
- 补充：test-create-result ✅ / adversarial 52/52 ✅ / 完整 verify 见下

## 交付物

- `scripts/audit-intangibles-control.mts`（POLICY=pre|post 双跑）+ `analyze-intangibles-control.mts`（对比）
- `scripts/decompose-shadow-synthetic.mts` + `reports/rookie-overall-stage6b1-shadow-decomposition.md`
- `reports/rookie-overall-stage6b1-control-audit.md` + `reports/int-control-{pre,post}.json`
- `src/createResult.ts` 过渡双 Intangibles（control/display 分离）
- `verify-stage6b-acceptance.mts` 更新（双值结构断言）

**STOP FOR REVIEW** —— Growth Controller V2 前保持双 Intangibles；display policy 已生效（custom > single-card > 50），control 保持旧行为。
