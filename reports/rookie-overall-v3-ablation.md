# OVR V3 Ablation — official-only

日期：2026-08-14 · official samples: **664**（排除 ESTIMATED 997 / AMBIGUOUS 51 / NO_OVR 85）
CV: 5-fold grouped by card identity（同一球员不跨 train/test）· Ridge λ=100 · position one-hot + position×attr interactions

## 1. 总体对比（同一 official-only CV）

| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |
|---|---|---|---|---|---|---|---|
| V3-A (34+pos) | 664 | 25.2% | 63.0% | 83.3% | 1.413 | 1.960 | 0.006 |
| V3-B (+Intangibles) | 664 | 36.0% | 78.2% | 94.3% | 0.971 | 1.471 | -0.002 |
| V3-C (+Durability) | 664 | 25.8% | 63.9% | 83.4% | 1.411 | 1.984 | 0.005 |
| V3-D (+both) | 664 | 36.4% | 77.9% | 94.0% | 0.980 | 1.512 | -0.005 |
| Production (current) | 664 | 24.1% | 60.5% | 83.1% | 1.435 | 1.948 | 0.011 |
| Production-Architecture OOF | 664 | 24.8% | 62.8% | 83.6% | 1.417 | 1.970 | 0.002 |

**baseline 语义说明（Review Patch）**：
- `Production (current)` = **Deployed Production**：线上模型原样（rookieOverallModel-rookie.json，用 1190 张全量训练过），此处仅描述现有产品行为，**不是**公平 CV baseline（其训练集含 475 张 ESTIMATED 且分割不同）
- `Production-Architecture OOF` = **架构公平对比**：与 V3 完全相同的 official-only folds，每 fold 重新训练现有 production 架构（每 position 独立 Ridge，34 attrs），用于回答「V3 的提升来自架构还是数据清洗」

## 2. 按 position（V3-B 主诊断 + Production-Architecture OOF + Deployed）

| position | model | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| PG | V3-B | 118 | 26.3% | 66.9% | 1.347 | 2.019 |
| PG | ProdArch-OOF | 118 | 23.7% | 56.8% | 1.678 | 2.429 |
| PG | Deployed | 118 | 30.5% | 64.4% | 1.364 | 2.061 |
| SG | V3-B | 182 | 48.9% | 88.5% | 0.654 | 1.003 |
| SG | ProdArch-OOF | 182 | 28.6% | 69.2% | 1.203 | 1.639 |
| SG | Deployed | 182 | 19.8% | 59.3% | 1.505 | 1.930 |
| SF | V3-B | 127 | 28.3% | 73.2% | 1.142 | 1.624 |
| SF | ProdArch-OOF | 127 | 24.4% | 62.2% | 1.386 | 1.853 |
| SF | Deployed | 127 | 26.0% | 68.5% | 1.291 | 1.801 |
| PF | V3-B | 125 | 42.4% | 81.6% | 0.768 | 1.081 |
| PF | ProdArch-OOF | 125 | 27.2% | 66.4% | 1.296 | 1.744 |
| PF | Deployed | 125 | 22.4% | 54.4% | 1.520 | 1.956 |
| C | V3-B | 112 | 26.8% | 75.0% | 1.125 | 1.615 |
| C | ProdArch-OOF | 112 | 17.9% | 55.4% | 1.661 | 2.268 |
| C | Deployed | 112 | 24.1% | 56.3% | 1.464 | 2.004 |

## 3. 按 OVR band（V3-B 主诊断）

⚠️ **85+ 为 extrapolation/out-of-support region**：官方标签上限 84，85+ 样本数 = 0。
不得报告 85+ accuracy；<85 的 CV 良好不得作为 production switch 的理由。

| band | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|
| 70-79 | 455 | 34.9% | 78.0% | 0.943 | 1.327 |
| 80-84 | 25 | 24.0% | 48.0% | 1.760 | 2.227 |
| <70 | 184 | 40.2% | 82.6% | 0.935 | 1.668 |

### 3b. 80-84 逐样本诊断（V3-B）

| name | position | overall | pred | err |
|---|---|---|---|---|
| Ben Simmons | SG | 80 | 79 | -1 |
| Chris Bosh | PF | 80 | 80 | 0 |
| Dwyane Wade | SG | 80 | 80 | 0 |
| Franz Wagner | SF | 80 | 79 | -1 |
| John Wall | PG | 80 | 78 | -2 |
| Karl-Anthony Towns | C | 80 | 81 | 1 |
| Kristaps Porzingis | C | 80 | 76 | -4 |
| LaMarcus Aldridge | PF | 80 | 78 | -2 |
| LaMelo Ball | PG | 80 | 76 | -4 |
| Nikola Jokic | C | 80 | 77 | -3 |
| Rudy Gay | SF | 80 | 77 | -3 |
| Chris Paul | PG | 81 | 78 | -3 |
| Derrick Rose | PG | 81 | 78 | -3 |
| Kevin Durant | SF | 81 | 81 | 0 |
| Luka Doncic | SF | 81 | 80 | -1 |
| Zion Williamson | SF | 81 | 79 | -2 |
| Carmelo Anthony | SF | 82 | 79 | -3 |
| Cooper Flagg | SF | 82 | 82 | 0 |
| Kawhi Leonard | SF | 82 | 82 | 0 |
| Stephen Curry | PG | 82 | 78 | -4 |
| Anthony Davis | PF | 83 | 85 | 2 |
| Evan Mobley | C | 83 | 83 | 0 |
| Scottie Barnes | SF | 83 | 86 | 3 |
| LeBron James | SF | 84 | 83 | -1 |
| Victor Wembanyama | C | 84 | 85 | 1 |

（80-84 band 共 25 张，为官方 OVR 最高区间，全部列出）

## 4. Production-Architecture OOF 按 position（= 原 5 独立 Ridge 诊断）

| position | n | MAE | RMSE |
|---|---|---|---|
| PG | 118 | 1.678 | 2.429 |
| SG | 182 | 1.203 | 1.639 |
| SF | 127 | 1.386 | 1.853 |
| PF | 125 | 1.296 | 1.744 |
| C | 112 | 1.661 | 2.268 |

## 4b. grouped-by-era holdout（F5 要求，方向不对称说明）

按 draftYear 分两段：old = 2003-2013（train），new = 2014-2025（test），再反向。
仅对 V3-B 与 Deployed Production 比较（V3-B 为总体最佳）。
| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| old→new | V3-B | train 165 → test 499 | 27.3% | 62.7% | 1.417 | 2.049 |
| old→new | Deployed | train 165 → test 499 | 25.9% | 64.7% | 1.335 | 1.860 |
| new→old | V3-B | train 499 → test 165 | 26.1% | 63.0% | 1.448 | 2.038 |
| new→old | Deployed | train 499 → test 165 | 18.8% | 47.9% | 1.739 | 2.192 |

**方向不对称（Review Patch 修正）**：
- **old→new（2003-2013 训练 → 2014-2025 测试）**：Deployed 优于 V3-B（见上表 MAE）——旧 era 数据训练时，V3-B 依赖的 Intangibles 分布变化导致泛化受损；**不得表述为“V3-B 跨 era 整体仍优于 Production”**
- **new→old（2014-2025 训练 → 2003-2013 测试）**：V3-B 优于 Deployed
- 结论：V3-B 的优势**依赖现代 era 数据**；向旧 era 外推时优势消失甚至反转。此不对称必须如实报告，作为 production switch 的负面证据

## 5. 最大绝对误差 Top 20（V3-B）

| name | position | overall | pred | err |
|---|---|---|---|---|
| Reed Sheppard | PG | 63 | 74 | 11 |
| Jaxson Hayes | C | 65 | 74 | 9 |
| Justin Edwards | SF | 67 | 75 | 8 |
| Deron Williams | PG | 75 | 69 | -6 |
| Blake Wesley | PG | 65 | 71 | 6 |
| Reggie Williams | SF | 70 | 76 | 6 |
| Mario Chalmers | PG | 71 | 66 | -5 |
| Kirk Hinrich | PG | 76 | 71 | -5 |
| Brandon Rush | SG | 72 | 68 | -4 |
| Kristaps Porzingis | C | 80 | 76 | -4 |
| LaMelo Ball | PG | 80 | 76 | -4 |
| Stephen Curry | PG | 82 | 78 | -4 |
| Khaman Maluach | C | 74 | 70 | -4 |
| Chris Paul | PG | 81 | 78 | -3 |
| Dennis Schroder | PG | 74 | 77 | 3 |
| Alperen Sengun | C | 76 | 79 | 3 |
| Kon Knueppel | SG | 75 | 72 | -3 |
| Anderson Varejao | C | 72 | 69 | -3 |
| Luol Deng | SF | 77 | 80 | 3 |
| Channing Frye | PF | 74 | 71 | -3 |

## 5b. V3-B effective slopes（position × feature）与 monotonicity audit

V3-B 结构：pred = intercept + Σ base·attr + Σ onehot·1[pos] + Σ inter·1[pos]·attr。
某 position 下 attr 的 **effective slope** = base + interaction（one-hot 仅进 intercept，不进属性斜率）。
全量 664 训练一次，仅诊断。

### 5b-1. 每 position 有效系数（绝对值最大 10 个）

**PG**：Help Defense IQ=0.101 · Ball Handle=0.085 · Layup=0.070 · Intangibles=0.061 · Speed=0.059 · Pass Accuracy=0.057 · Shot IQ=0.054 · Draw Foul=0.053 · Standing Dunk=0.052 · Pass IQ=0.047

**SG**：Layup=0.088 · Intangibles=0.069 · Ball Handle=0.063 · Shot IQ=0.057 · Mid-Range Shot=0.049 · Offensive Consistency=0.049 · Speed=0.042 · Draw Foul=0.040 · Three-Point Shot=0.036 · Close Shot=0.034

**SF**：Stamina=0.077 · Layup=0.073 · Three-Point Shot=0.072 · Shot IQ=0.065 · Speed=0.063 · Draw Foul=0.052 · Ball Handle=0.049 · Pass Perception=0.044 · Intangibles=0.043 · Help Defense IQ=0.042

**PF**：Intangibles=0.064 · Help Defense IQ=0.063 · Stamina=0.063 · Shot IQ=0.059 · Strength=0.056 · Defensive Rebound=0.056 · Speed=0.049 · Post Fade=0.048 · Vertical=0.047 · Close Shot=0.045

**C**：Stamina=0.097 · Intangibles=0.071 · Close Shot=0.058 · Standing Dunk=0.058 · Defensive Rebound=0.056 · Speed=0.046 · Perimeter Defense=0.042 · Shot IQ=0.042 · Interior Defense=0.041 · Draw Foul=0.038

### 5b-2. monotonicity audit（负 effective slope）

负 effective slope 总数：**27**（34 attrs + Intangibles 中，未自动修正，仅报告）

| position | feature | effective coef |
|---|---|---|
| PG | Perimeter Defense | -0.0383 |
| PF | Speed with Ball | -0.0352 |
| SF | Speed with Ball | -0.0317 |
| PG | Defensive Rebound | -0.0259 |
| SG | Speed with Ball | -0.0253 |
| SF | Post Control | -0.0232 |
| PG | Free Throw | -0.0223 |
| PG | Stamina | -0.0176 |
| PF | Post Control | -0.0174 |
| PG | Post Control | -0.0163 |
| C | Hustle | -0.0159 |
| SF | Pass Accuracy | -0.0157 |
| PG | Interior Defense | -0.0154 |
| PG | Post Hook | -0.0141 |
| PG | Driving Dunk | -0.0127 |
| SF | Offensive Rebound | -0.0120 |
| PF | Hustle | -0.0120 |
| PF | Pass Accuracy | -0.0119 |
| SF | Hustle | -0.0115 |
| C | Agility | -0.0113 |
| C | Ball Handle | -0.0107 |
| SF | Steal | -0.0087 |
| SF | Driving Dunk | -0.0059 |
| PF | Standing Dunk | -0.0044 |
| SF | Agility | -0.0037 |
| C | Steal | -0.0027 |
| SG | Defensive Rebound | -0.0005 |

⚠️ 负 slope 意味着该 position 下该属性**增加可能导致预测 OVR 下降**，违反单调性直觉。
原因待查：可能为特征共线 / 小样本噪声 / 标签与属性错位。**不自动修正**，先报告（Review Patch 要求）；
synthetic +1 实测已证明至少部分负 slope 真实存在，monotonicity blocker 保持有效（Stage 5.1 V3-E 解决）。

## 6. 结论（F8 十问 + Review Patch 修正）

1. A/B/C/D 总体最好：B（MAE 0.971）
2. 85+ / 各 position 最稳：85+ 无官方样本（extrapolation，不报告）；position 见第 2 节（V3-B 主诊断）
3. Overall Adjustment (Intangibles) 增益：A→B MAE 1.413→0.971（0.441）
4. Overall Durability 增益：A→C MAE 1.413→1.411（0.002）
5. 增益是否值得 synthetic 语义复杂度：见审阅（需解释 synthetic Intangibles/Durability 来源；见 §9）
6. interaction Ridge vs 独立 Ridge：主模型 = unified regularized position-interaction（V3-B）；Production-Architecture OOF（每 position 独立 Ridge）见第 4 节，仅为架构公平对比
7. grouped-by-era holdout：**方向不对称**——old→new 中 Deployed 优于 V3-B；new→old 中 V3-B 优于 Deployed（见 4b 修正说明）。不得概括为“V3-B 跨 era 整体仍优于 Production”
8. 标签污染：production 训练集混入 475 张 ESTIMATED（训练 1190 = OFFICIAL 664 + ESTIMATED 475 + AMBIGUOUS 51；本实验已排除）。[Review Patch 修正：此前误写 665/48/2]
9. 当前生产模型 vs V3 同集比较：Deployed MAE 1.435 vs V3-B MAE 0.971（0.464）；Production-Architecture OOF MAE 1.417（架构公平对比）
10. 是否建议替换：**不建议自动切换**。理由：(a) 85+ 无官方样本，生产会 extrapolate；(b) V3-B 依赖 synthetic Intangibles 语义需确认；(c) era 外推方向不对称；(d) 等待审阅

## 7. 训练输入声明

- official-only：✅（ESTIMATED/AMBIGUOUS/NO_OVR 全部排除；canonical identity universe 1797 中的 OFFICIAL 664）
- Potential 进入模型：❌ 否
- 16 slot score 进入模型：❌ 否
- tendencies/badges/hot zones/body 进入模型：❌ 否
- donor identity / player name / draft year 作为 feature：❌ 否