# Stage 6B-D — Shadow Mode：legacy control vs V3-E display

日期：2026-08-14 · 批次：official 664 / snapshot 1374 / synthetic 10000 / fixtures 5 = 12043
delta = v3eDisplayOverall − legacyControlOverall（display 与 control 解耦后的差异）

## official-single（n=664）

| 指标 | 值 |
|---|---|
| mean delta | -0.28 |
| std delta | 1.33 |
| min / max | -5 / 5 |
| |delta|=0 | 209 (31.5%) |
| |delta|≤1 | 501 (75.5%) |
| |delta|≤2 | 626 (94.3%) |
| |delta|≥3 | 38 (5.7%) |

### Top absolute delta（official-single）

| name | position | legacy | v3e | delta | int | overall |
|---|---|---|---|---|---|---|
| Dwyane Wade | SG | 85 | 80 | -5 | 50 | 80 |
| LeBron James | SF | 87 | 82 | -5 | 25 | 84 |
| Eric Moreland | PF | 63 | 68 | +5 | 85 | 68 |
| Ben Simmons | SG | 85 | 80 | -5 | 70 | 80 |
| Brandon Roy | SG | 80 | 76 | -4 | 30 | 76 |
| Dejounte Murray | PG | 79 | 75 | -4 | 40 | 74 |
| Brandon Clarke | PF | 79 | 75 | -4 | 25 | 76 |
| Carmelo Anthony | SF | 84 | 81 | -3 | 80 | 82 |
| Chris Bosh | PF | 82 | 79 | -3 | 25 | 80 |
| Dahntay Jones | SG | 66 | 69 | +3 | 95 | 68 |

## snapshot（n=1374）

| 指标 | 值 |
|---|---|
| mean delta | -0.29 |
| std delta | 1.67 |
| min / max | -6 / 7 |
| |delta|=0 | 365 (26.6%) |
| |delta|≤1 | 927 (67.5%) |
| |delta|≤2 | 1184 (86.2%) |
| |delta|≥3 | 190 (13.8%) |

### Top absolute delta（snapshot）

| name | position | legacy | v3e | delta | int | overall |
|---|---|---|---|---|---|---|
| Matt Fish | PF | 62 | 69 | +7 | 98 | 68 |
| Popeye Jones | PF | 63 | 70 | +7 | 98 | 68 |
| Bernard King | SF | 87 | 81 | -6 | 26 | 82 |
| Magic Johnson | SG | 87 | 81 | -6 | 50 | 84 |
| Tony Massenburg | PF | 62 | 68 | +6 | 80 | 66 |
| Corie Blount | PF | 63 | 69 | +6 | 98 | 69 |
| Rick Barry | SF | 88 | 83 | -5 | 45 | 81 |
| Eddie Mast | PF | 64 | 69 | +5 | 98 | 69 |
| Adrian Dantley | SF | 86 | 81 | -5 | 25 | 80 |
| Alton Lister | PF | 65 | 70 | +5 | 79 | 71 |

## synthetic（n=10000）

| 指标 | 值 |
|---|---|
| mean delta | -1.21 |
| std delta | 1.85 |
| min / max | -9 / 6 |
| |delta|=0 | 1825 (18.3%) |
| |delta|≤1 | 5114 (51.1%) |
| |delta|≤2 | 7536 (75.4%) |
| |delta|≥3 | 2464 (24.6%) |

### Top absolute delta（synthetic）

| name | position | legacy | v3e | delta | int | overall |
|---|---|---|---|---|---|---|
| synth-2365 | C | 88 | 79 | -9 | 50 | -- |
| synth-7324 | SG | 90 | 81 | -9 | 50 | -- |
| synth-205 | C | 83 | 75 | -8 | 50 | -- |
| synth-2174 | PG | 79 | 71 | -8 | 50 | -- |
| synth-2291 | PG | 77 | 69 | -8 | 50 | -- |
| synth-3550 | PG | 81 | 73 | -8 | 50 | -- |
| synth-3567 | C | 83 | 75 | -8 | 50 | -- |
| synth-8673 | C | 82 | 74 | -8 | 50 | -- |
| synth-9355 | C | 82 | 74 | -8 | 50 | -- |
| synth-9454 | PF | 87 | 79 | -8 | 50 | -- |

## fixture（n=5）

| 指标 | 值 |
|---|---|
| mean delta | -0.20 |
| std delta | 0.75 |
| min / max | -1 / 1 |
| |delta|=0 | 2 (40.0%) |
| |delta|≤1 | 5 (100.0%) |
| |delta|≤2 | 5 (100.0%) |
| |delta|≥3 | 0 (0.0%) |

### Top absolute delta（fixture）

| name | position | legacy | v3e | delta | int | overall |
|---|---|---|---|---|---|---|
| Mitchell dunk-only | PG | 64 | 63 | -1 | 60 | -- |
| Wemby tall | C | 76 | 77 | +1 | 98 | -- |
| Jokic playmaking C | C | 75 | 74 | -1 | 80 | -- |
| All-99 | SF | 99 | 99 | +0 | 99 | -- |
| All-25 | PG | 40 | 40 | +0 | 25 | -- |

## position breakdown（official）

| position | n | mean delta | |delta|≥2 占比 |
|---|---|---|---|
| PG | 118 | -0.42 | 22.0% |
| SG | 182 | -0.26 | 26.4% |
| SF | 127 | -0.15 | 20.5% |
| PF | 125 | -0.18 | 26.4% |
| C | 112 | -0.39 | 26.8% |

## OVR band breakdown（official，legacy 分组）

| band | n | mean delta | |delta|≥2 占比 |
|---|---|---|---|
| <70 | 192 | 0.67 | 20.3% |
| 70-79 | 433 | -0.52 | 21.2% |
| 80-84 | 32 | -2.00 | 78.1% |

## 观察（仅观察，不改变）

- delta 分布与 Intangibles：corr(delta, int) 见下
- corr(Intangibles, delta) = 0.386（official 664）
- legacy constraint trigger / offset 分布：由 createResult 的 constraint 决定；本 shadow 不重放 constraint（见 Stage 6A 审计），仅报告 estimator 层面的 delta
- V3-E 与 constraint 的关系：若 delta>0 且原 build 触发 constraint 下调，则 display 会显示比 control 更高的 OVR —— 属 display/control 解耦的预期行为，不改变生成