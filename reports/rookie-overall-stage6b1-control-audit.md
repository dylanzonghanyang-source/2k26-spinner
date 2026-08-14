# Stage 6B.1 — Intangibles Control-Side Effect Audit

日期：2026-08-14 · 10000 deterministic multi-donor synthetic cases（相同 seed/input/donors/body）

## 0. 历史两阶段（重要：不得混淆）

### 阶段 1 — Single-value post-6B policy（neutral 50 单值，无双值隔离）— **FAIL**

| 指标 | 数量 | 占比 |
|---|---|---|
| Intangibles 解析不同 | 7578 | 75.8% |
| constraint trigger 翻转 | 299 | 3.0% |
| 非-Int atomic diff | 1302 | 13.0% |
| growth 字段 diff | 4014 | 40.1% |

**结论：neutral 50 单值 policy 本身 NOT control invariant。** Intangibles 作为 legacy estimator 输入，
改变会经 originalOverall → constraint trigger → offset → 未锁定 atomics → growth 链传播。
这是引入过渡双 Intangibles 的直接原因。

### 阶段 2 — Dual Intangibles final architecture（control 保留 Potential-donor；display 用 Final Policy）— **PASS**

| 指标 | 数量 | 占比 |
|---|---|---|
| Intangibles 解析不同（display 层） | 7578 | 75.8%（预期，display policy 生效） |
| constraint trigger 翻转 | 0 | 0.0% |
| 非-Int atomic diff | 0 | 0.0% |
| growth 字段 diff | 0 | 0.0% |

**结论：Dual Intangibles 架构下 control 链与 pre-6B 完全一致。**

---

pre-6B = Potential-donor Intangibles 继承；post-6B = 当前代码（dual）

## 1. 总体统计

| 指标 | 数量 | 占比 |
|---|---|---|
| Intangibles 解析不同 | 7578 | 75.8% |
| constraint trigger 翻转 | 0 | 0.0% |
| 非-Int atomic diff（offset 代理） | 0 | 0.0% |
| growth 字段 diff | 0 | 0.0% |
| constraint 触发（pre） | 1642 | 16.4% |
| constraint 触发（post） | 1642 | 16.4% |

## 2. 硬判据判定（final architecture 重跑）

**非-Int atomic 或 growth 字段因 policy 改变（dual 架构下）：否**
- atomicDiff=0 · growthDiff=0
- 阶段 1（单值）已 FAIL 并采用过渡双 Intangibles；本表为阶段 2（dual）结果

## 3. Top affected cases（前 15，按 |baseOverall diff| 或 atomic/growth 变化）

| case | Int pre→post | trigger pre→post | baseOverall pre→post | atomic | growth | growthGap pre→post | peakStart pre→post | potential pre→post |
|---|---|---|---|---|---|---|---|---|

## 4. 结论（阶段 2 = dual architecture）

- **PASS：dual 架构下 policy 改变未影响任何 control 字段（本 10000 样本内）**
- 阶段 1（single-value neutral 50）已证 FAIL（299/1302/4014），不可回退
- offset 未直接暴露于 createResult 返回；以非-Int atomic diff 作为 offset-change 代理（offset 为唯一全局调整量，非 Int atomic 变化 ⇔ offset 变化）