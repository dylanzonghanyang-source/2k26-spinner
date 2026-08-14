# Stage 5.1 — V3-E Monotonic Hierarchical Position Model

日期：2026-08-14 · official samples: **664**（与 V3-B 完全相同）
模型：OVR_p = intercept_p + Σβ[p,j]·attr[j] + βInt[p]·Intangibles，β[p,j]>=0（j<34）
Hierarchical：λ1=100（per-position ridge）+ λ2=200（向 global 收缩）· 坐标下降 20000 次 · 非负投影在优化循环内
Intangibles slope 不约束（单独报告）

## 1. 总体对比（同一 official-only 664 / 5-fold）

| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |
|---|---|---|---|---|---|---|---|
| V3-B (unconstrained) | 664 | 36.0% | 78.2% | 94.3% | 0.971 | 1.471 | -0.002 |
| V3-E (monotonic) | 664 | 39.9% | 85.4% | 95.8% | 0.828 | 1.302 | 0.000 |
| Δ (E−B) | | 3.9% | 7.2% | 1.5% | -0.143 | -0.169 | 0.002 |

注：允许 V3-E 为换取单调性出现小幅 MAE 退化，不以 MAE 唯一决定胜负。

## 2. 按 position

| position | model | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| PG | V3-B | 118 | 26.3% | 66.9% | 1.347 | 2.019 |
| PG | V3-E | 118 | 36.4% | 83.1% | 0.975 | 1.644 |
| SG | V3-B | 182 | 48.9% | 88.5% | 0.654 | 1.003 |
| SG | V3-E | 182 | 48.9% | 89.0% | 0.648 | 0.994 |
| SF | V3-B | 127 | 28.3% | 73.2% | 1.142 | 1.624 |
| SF | V3-E | 127 | 35.4% | 83.5% | 0.945 | 1.485 |
| PF | V3-B | 125 | 42.4% | 81.6% | 0.768 | 1.081 |
| PF | V3-E | 125 | 44.0% | 85.6% | 0.720 | 1.035 |
| C | V3-B | 112 | 26.8% | 75.0% | 1.125 | 1.615 |
| C | V3-E | 112 | 29.5% | 83.9% | 0.955 | 1.379 |

## 3. 按 OVR band（V3-E）

⚠️ 85+ 为 extrapolation region（官方样本 0），不报告 accuracy。

| band | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|
| <70 | 184 | 45.1% | 88.6% | 0.804 | 1.543 |
| 70-79 | 455 | 38.9% | 86.2% | 0.798 | 1.147 |
| 80-84 | 25 | 20.0% | 48.0% | 1.560 | 1.887 |

## 4. grouped-by-era holdout

| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| old→new | V3-B | 165→499 | 27.3% | 62.7% | 1.417 | 2.049 |
| old→new | V3-E | 165→499 | 31.3% | 77.0% | 1.036 | 1.516 |
| new→old | V3-B | 499→165 | 26.1% | 63.0% | 1.448 | 2.038 |
| new→old | V3-E | 499→165 | 30.3% | 70.9% | 1.230 | 1.753 |

## 5. Top 20 absolute errors（V3-E）

| name | position | overall | pred | err |
|---|---|---|---|---|
| Reed Sheppard | PG | 63 | 74 | 11 |
| Jaxson Hayes | C | 65 | 73 | 8 |
| Justin Edwards | SF | 67 | 75 | 8 |
| Reggie Williams | SF | 70 | 77 | 7 |
| Blake Wesley | PG | 65 | 71 | 6 |
| Brandon Rush | SG | 72 | 68 | -4 |
| Deron Williams | PG | 75 | 72 | -3 |
| Kon Knueppel | SG | 75 | 72 | -3 |
| Zion Williamson | SF | 81 | 78 | -3 |
| Kristaps Porzingis | C | 80 | 77 | -3 |
| Giannis Antetokounmpo | SF | 77 | 74 | -3 |
| Adou Thiero | SF | 70 | 67 | -3 |
| Channing Frye | PF | 74 | 71 | -3 |
| Deni Avdija | PF | 76 | 73 | -3 |
| Rajon Rondo | PG | 76 | 73 | -3 |
| LaMelo Ball | PG | 80 | 77 | -3 |
| Matisse Thybulle | SG | 76 | 73 | -3 |
| Kyle Korver | SF | 74 | 71 | -3 |
| Kobe Brown | SF | 67 | 70 | 3 |
| Kirk Hinrich | PG | 76 | 73 | -3 |

## 6. Acceptance 验证

**A1. 34 能力属性 × 5 position effective slope >= 0：✅ 通过**
**A2. synthetic +1 monotonic（170 组合）：✅ 0 failure**

### Intangibles slope（未约束，观察）

| position | Intangibles slope |
|---|---|
| PG | 0.066 |
| SG | 0.069 |
| SF | 0.044 |
| PF | 0.062 |
| C | 0.072 |

## 7. 结论

1. V3-B vs V3-E MAE：0.971 vs 0.828（Δ -0.143）
2. 单调性收益：170 个能力属性 slope 全部 >= 0，synthetic +1 0 failure（V3-B 有 27 个负 slope）
3. Intangibles slope 表现：见上表（正值说明 Intangibles 提升 OVR，负值需关注）
4. 是否替代 V3-B：**等待审阅**（MAE 退化幅度 vs 单调性收益权衡）
