# Stage 5.2 — Synthetic Intangibles Ownership Experiment

日期：2026-08-14 · profiles: 300（固定 16 槽 atomic，主体卡来自官方 664，stability/potential donor 独立随机替换）
OVR 估算模型：V3-E 全量（Stage 5.1，monotonic hierarchical）

## 0. 语义声明

**Intangibles = 2K 的 Overall Adjustment / designer calibration**（createResult.ts:914 注释「综评补偿」，xlsx 字段「综评补偿」）；
**Potential = 未来上限**（潜力，growth 子系统使用）。
两者**不是同一概念**：Potential donor 提供 Intangibles 是当前实现的隐式耦合（I3），语义上站不住。

## 1. 三策略总体统计

| 策略 | Intangibles 来源 | mean OVR | min | max | std |
|---|---|---|---|---|---|
| I1 | 固定 50 | 72.69 | 64 | 84 | 3.41 |
| I2 | Stability donor | 73.19 | 65 | 86 | 3.57 |
| I3 | Potential donor（当前生产） | 73.14 | 64 | 85 | 3.55 |

## 2. OVR delta 分布（I2−I1 / I3−I1）

| 对比 | mean Δ | std Δ | min Δ | max Δ | >0 占比 | =0 占比 | <0 占比 |
|---|---|---|---|---|---|---|---|
| I2−I1 | 0.500 | 1.271 | -2 | 4 | 45.0% | 34.3% | 20.7% |
| I3−I1 | 0.453 | 1.236 | -2 | 4 | 44.7% | 33.0% | 22.3% |
| I3−I2 | -0.047 | 1.779 | -5 | 5 | 38.3% | 23.0% | 38.7% |

## 3. Potential donor change → 当前 OVR 影响（I3）

V3-E 的 Intangibles slope（每 position，见 Stage 5.1 §6）与 I3 的 Int 分布共同决定影响。
Intangibles 实际值分布（I3）：

| Intangibles 值 | 频次 | 占比 |
|---|---|---|
| 25 | 14 | 4.7% |
| 29 | 1 | 0.3% |
| 30 | 12 | 4.0% |
| 35 | 10 | 3.3% |
| 40 | 34 | 11.3% |
| 45 | 10 | 3.3% |
| 46 | 2 | 0.7% |
| 47 | 1 | 0.3% |
| 48 | 1 | 0.3% |
| 50 | 55 | 18.3% |
| 55 | 13 | 4.3% |
| 56 | 1 | 0.3% |
| 57 | 1 | 0.3% |
| 60 | 36 | 12.0% |
| 61 | 1 | 0.3% |
| 65 | 9 | 3.0% |
| 66 | 1 | 0.3% |
| 67 | 3 | 1.0% |
| 68 | 1 | 0.3% |
| 70 | 32 | 10.7% |
| 73 | 1 | 0.3% |
| 74 | 1 | 0.3% |
| 75 | 6 | 2.0% |
| 76 | 1 | 0.3% |
| 77 | 1 | 0.3% |
| 78 | 3 | 1.0% |
| 79 | 1 | 0.3% |
| 80 | 21 | 7.0% |
| 82 | 1 | 0.3% |
| 85 | 6 | 2.0% |
| 86 | 1 | 0.3% |
| 90 | 4 | 1.3% |
| 92 | 1 | 0.3% |
| 95 | 5 | 1.7% |
| 98 | 9 | 3.0% |

## 4. Stability donor change → 当前 OVR 影响（I2）

同上（I2 的 Int 分布）：

| Intangibles 值 | 频次 | 占比 |
|---|---|---|
| 25 | 13 | 4.3% |
| 29 | 1 | 0.3% |
| 30 | 12 | 4.0% |
| 35 | 8 | 2.7% |
| 36 | 1 | 0.3% |
| 38 | 1 | 0.3% |
| 40 | 34 | 11.3% |
| 45 | 8 | 2.7% |
| 47 | 1 | 0.3% |
| 48 | 1 | 0.3% |
| 50 | 57 | 19.0% |
| 52 | 1 | 0.3% |
| 55 | 16 | 5.3% |
| 57 | 1 | 0.3% |
| 60 | 38 | 12.7% |
| 62 | 1 | 0.3% |
| 65 | 5 | 1.7% |
| 66 | 1 | 0.3% |
| 67 | 1 | 0.3% |
| 69 | 1 | 0.3% |
| 70 | 27 | 9.0% |
| 73 | 1 | 0.3% |
| 75 | 9 | 3.0% |
| 76 | 1 | 0.3% |
| 77 | 2 | 0.7% |
| 78 | 2 | 0.7% |
| 80 | 21 | 7.0% |
| 81 | 2 | 0.7% |
| 82 | 1 | 0.3% |
| 85 | 10 | 3.3% |
| 89 | 1 | 0.3% |
| 90 | 4 | 1.3% |
| 92 | 1 | 0.3% |
| 95 | 4 | 1.3% |
| 98 | 12 | 4.0% |

## 5. 极端案例（I3 vs I1 差异最大前 10）

| id | position | I1 OVR | I3 OVR | Δ | I3 Int | main card |
|---|---|---|---|---|---|---|
| 117 | PG | 69 | 73 | +4 | 98 | Patrick Mills |
| 168 | C | 72 | 76 | +4 | 98 | Clint Capela |
| 269 | SG | 71 | 75 | +4 | 98 | Lonnie Walker IV |
| 6 | SG | 66 | 69 | +3 | 98 | Dahntay Jones |
| 25 | C | 69 | 72 | +3 | 85 | Zaza Pachulia |
| 26 | C | 73 | 76 | +3 | 80 | Anderson Varejao |
| 66 | PG | 75 | 78 | +3 | 98 | Rajon Rondo |
| 116 | PG | 73 | 76 | +3 | 90 | Jrue Holiday |
| 162 | PG | 68 | 71 | +3 | 95 | Seth Curry |
| 164 | SG | 69 | 72 | +3 | 92 | Tim Hardaway Jr. |

## 6. fallback=50 占比和影响

- 官方 664 卡中 detailed.Intangibles 缺失（走 fallback 50）：0 张（0.0%）
- 有值卡：664 张
- fallback 影响：OVR 由 V3-E Intangibles slope（0.04-0.07/单位）× 与真实值差距决定；若真实 Int 70 → fallback 50，降幅约 1.2 OVR 分

## 7. 结论与建议

1. **I3（Potential donor）语义问题确认**：Potential 是未来上限，与 OVR 校准无关；用它继承 Intangibles 会让「潜力槽选谁」隐式改变当前 OVR
2. **I2（Stability owner）语义更合理**：Stability 槽承载 consistency/IQ 类校准属性，与 Intangibles（designer calibration）同族
3. **I1（Neutral 50）最干净但损失信息**：官方卡 Intangibles 是真实校准值，全 50 会丢失 2K 的校准意图
4. **推荐方向**（待审阅）：I2 或 I2+I1 混合（stability 有 donor 用 donor，无则 50）；不推荐 I3
5. **不改生产**：实验仅统计，createResult.ts:921 保持现状直到审阅决策