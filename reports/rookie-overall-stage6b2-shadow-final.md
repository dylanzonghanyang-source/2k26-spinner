# Stage 6B.2 — FINAL ARCHITECTURE Shadow（A→D）

日期：2026-08-14 · official 664 / snapshot 1374 / synthetic 10000 / fixtures 5

生产语义：control = legacy + controlIntangiblesLegacy（Potential-donor）；display = V3-E + displayIntangibles Final Policy。
live display-control delta = **A→D**（此前 Stage 6B 的 synthetic -1.213 是 B→D，estimator-only 效应）。

| 批次 | mean | std | min/max | Δ=0 | Δ≤1 | Δ≤2 | Δ≥3 |
|---|---|---|---|---|---|---|---|
| official | -0.28 | 1.33 | -5 / 5 | 31.5% | 75.5% | 94.3% | 5.7% |
| snapshot | -0.29 | 1.67 | -6 / 7 | 26.6% | 67.5% | 86.2% | 13.8% |
| synthetic | -1.69 | 1.99 | -10 / 5 | 15.1% | 42.6% | 66.0% | 34.0% |
| fixture | -1.40 | 1.20 | -3 / 0 | 40.0% | 40.0% | 80.0% | 20.0% |

## A/B/C/D 分解（synthetic，10000）

| 组合 | 含义 | mean | std |
|---|---|---|---|
| A→B | legacy: displayInt − controlInt（policy 在 legacy 上） | -0.473 | 0.812 |
| A→C | v3e + controlInt − legacy + controlInt（estimator，control 固定） | -0.847 | 1.925 |
| C→D | v3e: displayInt − controlInt（policy 在 v3e 上） | -0.838 | 1.304 |
| B→D | v3e + displayInt − legacy + displayInt（estimator，display 固定） | -1.213 | 1.850 |
| **A→D** | **live: v3e+displayInt − legacy+controlInt（总 display-control delta）** | **-1.685** | 1.994 |

确认：Stage 6B 原 synthetic -1.213 = B→D（estimator-only）；当前 live delta = A→D。

## position breakdown（official，A→D）

| position | n | mean | Δ≥2 占比 |
|---|---|---|---|
| PG | 118 | -0.42 | 22.0% |
| SG | 182 | -0.26 | 26.4% |
| SF | 127 | -0.15 | 20.5% |
| PF | 125 | -0.18 | 26.4% |
| C | 112 | -0.39 | 26.8% |

## control OVR band breakdown（official，A→D，按 A=legacy+controlInt）

| band | n | mean | Δ≥2 占比 |
|---|---|---|---|
| <70 | 192 | 0.67 | 20.3% |
| 70-79 | 433 | -0.52 | 21.2% |
| 80-84 | 32 | -2.00 | 78.1% |

## Top absolute delta（official，A→D）

| name | pos | control(A) | display(D) | Δ | intC→intD |
|---|---|---|---|---|---|
| Dwyane Wade | SG | 85 | 80 | -5 | 50→50 |
| LeBron James | SF | 87 | 82 | -5 | 25→25 |
| Eric Moreland | PF | 63 | 68 | +5 | 85→85 |
| Ben Simmons | SG | 85 | 80 | -5 | 70→70 |
| Brandon Roy | SG | 80 | 76 | -4 | 30→30 |
| Dejounte Murray | PG | 79 | 75 | -4 | 40→40 |
| Brandon Clarke | PF | 79 | 75 | -4 | 25→25 |
| Carmelo Anthony | SF | 84 | 81 | -3 | 80→80 |
| Chris Bosh | PF | 82 | 79 | -3 | 25→25 |
| Dahntay Jones | SG | 66 | 69 | +3 | 95→95 |
| Anderson Varejao | C | 75 | 72 | -3 | 25→25 |
| Antonio Burks | PG | 68 | 71 | +3 | 85→85 |
| Royal Ivey | SG | 67 | 70 | +3 | 88→88 |
| Andray Blatche | PF | 76 | 73 | -3 | 30→30 |
| Ronnie Brewer | SF | 65 | 68 | +3 | 48→48 |