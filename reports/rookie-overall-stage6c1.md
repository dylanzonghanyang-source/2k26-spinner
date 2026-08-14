# Stage 6C.1 — Legacy Save Semantics Audit 交付报告

日期：2026-08-14 · 状态：**完成，STOP FOR REVIEW（未修改 V3-E、未迁移 Growth Controller、未重新调整 UI OVR、未重开模型研究）**

---

## 1. 审计：旧存档 V3-E recompute 的 Intangibles 来源 ✅

### 问题确认
原 `resolveDisplayOverall` 对缺失 `v3eDisplayOverall` 的旧结果直接用 `initialAttrs.Intangibles` 重算——**pre-6B 旧存档中该值是 control/Potential-donor 语义**（custom ?? potentialCard ?? singleCard ?? 50），不是 Final display policy（custom ?? singleCard ?? 50）。直接重算会用错 Intangibles。

### 修复：provenance 安全规则（src/displayOverall.ts 重写）

| 分支 | 条件 | 行为 |
|---|---|---|
| S1 native | 有 `v3eDisplayOverall` | 直接用 |
| S2 stored==50 | `initialAttrs.Intangibles == 50` | 用 50 重算（任何场景 Final=50：custom=50 / single real=50 / multi-donor neutral，安全） |
| S3 single-card 可证明 | `result.card` 存在 且 `card.detailed.Intangibles === stored` | 用 stored 重算（证明是 single real 或 custom 同值） |
| **S4 无法证明** | stored≠50 且无 card 匹配 | **legacyFallback，不猜测**（可能是 multi-donor Potential-donor 污染或 custom 覆盖，无法区分） |

**不修改 old attributes / potential / growth**（resolve 是纯函数，测试断言入参不被改）。

### Fixtures 验证（test-stage6c1-legacy-save.mts，14/14 PASS）

| Fixture | 场景 | 结果 |
|---|---|---|
| F1 | old single-card：stored = real card Int | S3 → recomputed，**等于 fresh Final Policy** ✅ |
| F2 | old multi-donor：Potential-donor Int ≠ 50，无 card | S4 → **legacyFallback**（不猜 50，因无 donor provenance）✅ |
| F3 | old multi-donor：stored == 50 | S2 → recomputed with 50 == Final Policy ✅ |
| F4 | old custom explicit：stored=88 ≠ card real | S4 → **legacyFallback**（无 locks provenance，不猜保留）✅ |
| F5 | custom explicit == card real | S3 → recomputed 保留 ✅ |
| F6 | 无足够 provenance（缺 attrs/position/card） | legacyFallback 明确标记 ✅ |

**核心结论**：同一 old result 具备足够 provenance（S2/S3）时，recompute == 当前 Final Policy 对同一 final atomics 的 V3-E display OVR；不足时（S4）明确 legacyFallback，绝不猜测。

## 2. serialized result schema provenance 审计 ✅

createResult 返回字段审计：
- ✅ **含 `card`（singleCard）**：single-card 判定可用（S3 依赖）
- ❌ **不含 locks / cardByBundle / donor identity**：无法区分 multi-donor 与 custom explicit
- ❌ 无 explicit custom Intangibles provenance 标记

**结论：旧 schema 不足以可靠恢复 multi-donor/custom 语义 → S4 不反推、不猜测，走 legacyFallback。** 未来若需完整重算，需在 result schema 增加 donor/source 字段（不属本阶段范围）。

## 3. Full verify（实际执行）✅

`pnpm run verify` → **exit code 0，全链 PASS**：
- **test-stage6c1-legacy-save：14 PASS / 0 FAIL**（新增）
- **test-stage6c-cutover：18 PASS / 0 FAIL**
- **test-body-degrade-v2：24 PASS / 0 FAIL**
- **test-slot-semantics-v2：58/58**
- **test-adversarial：52/52**
- createResult production-path OK · export-text / draft-store / build-profile / entry-progress / result-overall-contract / rookie-card-units 全过
- validate:data / body / badges / overall / versioned-overall / tendencies / rookie-cards / database / routing / rookie-initial-overall / durability / motion / palette 全过
- build PASS · Bundle budget OK

**Stage 6C 报告 verify 缺口已修复**：`reports/rookie-overall-stage6c.md` §6 从"见下方实际执行结果"占位改为实际 exit code 与逐项 PASS/FAIL 记录。

## 4. UI 文案 ✅

85+ warning 保持当前逻辑（主界面简短文案不变）：
- 主界面：`85+ 为模型外推区间`
- **tooltip 扩展**：`85+ 综评属于模型外推区间，准确性尚未得到同等规模的真实标签验证`

## 交付物
- `src/displayOverall.ts`（provenance 安全规则：S1-S4）
- `scripts/test-stage6c1-legacy-save.mts`（14 断言，已挂入 verify）
- `reports/rookie-overall-stage6c.md`（verify 缺口修复）
- `src/components/RookieBuilder.tsx`（85+ tooltip 长文案）

**STOP FOR REVIEW** —— 待审：① S4 legacyFallback 策略是否接受（vs 未来 schema 加 donor provenance）；② 旧存档用户看到的「旧档」标记体验；③ Growth Controller V2 计划。
