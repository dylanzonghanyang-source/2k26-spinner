# Morphology Incremental Value Test（最终版）

日期：2026-08-14 · official-only OOF 664（canonical，与 V3-B/V3-E 相同 folds）· residual 用 **raw OOF prediction**（不先 round）
residualRaw = officialOVR − rawPrediction

| 模型 | 特征 |
|---|---|
| M0 | 34 atomic + position（V3-E-NoInt 架构：monotonic hierarchical） |
| M1 | M0 + Height + Weight + BMI + source real Wingspan + Height z + Wingspan z (position-relative) |
| M2 | M1 + 预注册 12 个 interaction（见下，不允许事后添加） |

预注册 interactions：Height×CloseShot, Height×StandingDunk, Height×Block, Height×OREB, Height×DREB, Wingspan×Block, Wingspan×Steal, Wingspan×OREB, Wingspan×DREB, Wingspan×Perimeter, BMI×Strength, BMI×Interior（“Weight/BMI”预注册解释为 BMI，避免与 Weight 主效应共线）

## 1. 总体（raw OOF）

| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |
|---|---|---|---|---|---|---|---|
| M0 | 664 | 27.4% | 71.4% | 88.7% | 1.253 | 1.716 | 0.011 |
| M1 | 664 | 28.2% | 70.6% | 89.0% | 1.257 | 1.715 | 0.009 |
| M2 | 664 | 27.6% | 70.8% | 88.4% | 1.259 | 1.715 | 0.010 |
| Δ M1−M0 | | 0.8% | -0.8% | 0.3% | 0.004 | -0.001 | -0.001 |
| Δ M2−M0 | | 0.2% | -0.6% | -0.3% | 0.006 | -0.001 | -0.000 |

## 2. fold-level 增量稳定性（Δ MAE per fold）

| fold | n | M0 MAE | M1 MAE | M2 MAE | Δ M1−M0 | Δ M2−M0 |
|---|---|---|---|---|---|---|
| 0 | 137 | 1.259 | 1.254 | 1.251 | -0.005 | -0.008 |
| 1 | 141 | 1.333 | 1.340 | 1.334 | 0.007 | 0.001 |
| 2 | 120 | 1.260 | 1.278 | 1.307 | 0.018 | 0.047 |
| 3 | 143 | 1.159 | 1.161 | 1.160 | 0.001 | 0.000 |
| 4 | 123 | 1.257 | 1.258 | 1.251 | 0.001 | -0.006 |
| mean | | 1.253 | 1.257 | 1.259 | 0.004 ± 0.008 | 0.007 ± 0.020 |

判定：|mean Δ| < 0.05 或 fold 间符号不一致 → 增量不稳定，**不声称 morphology 有价值**。

## 3. 按 position（raw OOF）

| position | model | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| PG | M0 | 118 | 28.8% | 69.5% | 1.344 | 1.966 |
| PG | M1 | 118 | 31.4% | 69.5% | 1.338 | 1.949 |
| PG | M2 | 118 | 33.1% | 66.9% | 1.340 | 1.964 |
| SG | M0 | 182 | 30.2% | 73.6% | 1.141 | 1.488 |
| SG | M1 | 182 | 31.9% | 73.6% | 1.143 | 1.490 |
| SG | M2 | 182 | 31.3% | 73.1% | 1.152 | 1.499 |
| SF | M0 | 127 | 26.0% | 75.6% | 1.245 | 1.664 |
| SF | M1 | 127 | 24.4% | 74.0% | 1.252 | 1.669 |
| SF | M2 | 127 | 25.2% | 74.0% | 1.237 | 1.650 |
| PF | M0 | 125 | 22.4% | 69.6% | 1.223 | 1.538 |
| PF | M1 | 125 | 23.2% | 68.0% | 1.221 | 1.537 |
| PF | M2 | 125 | 23.2% | 71.2% | 1.240 | 1.556 |
| C | M0 | 112 | 28.6% | 67.0% | 1.383 | 2.002 |
| C | M1 | 112 | 28.6% | 66.1% | 1.403 | 2.010 |
| C | M2 | 112 | 23.2% | 67.0% | 1.395 | 1.984 |

## 4. 按 OVR band（raw OOF）

| band | model | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| <70 | M0 | 184 | 26.6% | 78.8% | 1.215 | 1.860 |
| <70 | M1 | 184 | 28.3% | 78.8% | 1.221 | 1.857 |
| <70 | M2 | 184 | 29.3% | 78.8% | 1.226 | 1.858 |
| 70-79 | M0 | 455 | 28.6% | 69.9% | 1.223 | 1.581 |
| 70-79 | M1 | 455 | 29.0% | 68.6% | 1.227 | 1.584 |
| 70-79 | M2 | 455 | 27.5% | 69.2% | 1.228 | 1.585 |
| 80-84 | M0 | 25 | 12.0% | 44.0% | 2.084 | 2.691 |
| 80-84 | M1 | 25 | 12.0% | 48.0% | 2.063 | 2.664 |
| 80-84 | M2 | 25 | 16.0% | 40.0% | 2.072 | 2.644 |

## 5. grouped-by-era holdout

| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| old→new | M0 | 165→499 | 19.4% | 57.7% | 1.546 | 2.043 |
| old→new | M1 | 165→499 | 19.4% | 58.5% | 1.543 | 2.038 |
| old→new | M2 | 165→499 | 18.8% | 58.1% | 1.535 | 2.024 |
| new→old | M0 | 499→165 | 18.2% | 58.8% | 1.547 | 1.990 |
| new→old | M1 | 499→165 | 18.2% | 60.6% | 1.538 | 1.986 |
| new→old | M2 | 499→165 | 20.6% | 60.6% | 1.532 | 1.965 |

## 6. Matched comparison（z-scored nearest-neighbor）

方法：34 属性 z-score（全体 664 上标准化）→ 同 position 内最近邻（1-NN）配对 → 只保留属性距离 ≤ position 内中位数的 matched 对 → 按 body 差异分组比较 Int/residualRaw。

matched 对总数：22674（属性距离 ≤ position 中位数）

| body 差异组 | n | mean attrD | mean bodyD (cm) | mean |ΔInt| | mean |ΔresidualRaw| |
|---|---|---|---|---|---|
| 低 body 差异（下 1/3） | 7558 | 5.5 | 4.5 | 3.16 | 0.10 |
| 高 body 差异（上 1/3） | 7558 | 5.6 | 18.9 | 3.51 | 0.11 |

若 高 body 差异组 的 |ΔInt| / |ΔresidualRaw| 显著高于低组 → morphology 有独立信息；否则无。

### 高 body 差异 matched 对 top 12

| 对 | pos | Δattr (z) | Δbody (cm) | Int A/B | resRaw A/B |
|---|---|---|---|---|---|
| J.J. Barea vs Ben Saraf | PG | 6.1 | 53 | 70/45 | 0.9/-0.3 |
| Travis Diener vs Egor Demin | PG | 6.1 | 47 | 80/60 | -0.3/1.4 |
| Al Horford vs Victor Wembanyama | C | 6.6 | 46 | 40/98 | -2.0/2.5 |
| J.J. Barea vs Jordan Goodwin | PG | 6.3 | 46 | 70/50 | 0.9/-1.3 |
| J.J. Barea vs Tony Wroten | PG | 6.1 | 46 | 70/40 | 0.9/-2.8 |
| Drew Eubanks vs Zach Edey | C | 5.8 | 45 | 50/60 | -0.9/-1.4 |
| Ed Davis vs Zach Edey | C | 7.4 | 44 | 40/60 | 0.1/-1.4 |
| Micah Potter vs Zach Edey | C | 7.1 | 44 | 90/60 | 2.1/-1.4 |
| Joel Anthony vs Zach Edey | C | 6.9 | 44 | 98/60 | 3.4/-1.4 |
| Kyle Filipowski vs Zach Edey | C | 6.2 | 43 | 50/60 | -1.4/-1.4 |
| Travis Diener vs Ben Saraf | PG | 4.5 | 43 | 80/45 | -0.3/-0.3 |
| Onyeka Okongwu vs Victor Wembanyama | C | 6.9 | 43 | 50/98 | 0.6/2.5 |

## 7. 结论

- M1−M0 与 M2−M0 的增量改善：见 §1/§2（fold-level 稳定性判定）
- **不因 0.01 MAE 改善声称 morphology 有价值**；判断标准 = 增量是否跨 fold 稳定且幅度 > 噪声
- source wingspan 为真实 cm 仅用于本研究；**target Create Player wingspan 是 opaque 1-100，无验证映射，不 invent conversion**