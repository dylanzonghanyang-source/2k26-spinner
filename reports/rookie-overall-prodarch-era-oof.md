# Final Validation — Production-Architecture grouped-by-era OOF

与 V3-E era holdout 完全相同的分割（old=2003-2013 / new=2014-2025）；
ProdArch-OOF = 生产架构（per-position 独立 Ridge 34 attrs）在**每个 era train split 内重新训练**，
不使用 Deployed 线上模型（其训练分布为 1190 全量含 ESTIMATED）。

| 方向 | 模型 | 样本 | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|---|
| old→new | ProdArch-OOF | 165→499 | 15.6% | 46.8% | 2.375 | 3.304 |
| old→new | V3-E | 165→499 | 31.7% | 76.8% | 1.066 | 1.505 |
| new→old | ProdArch-OOF | 499→165 | 18.8% | 57.6% | 1.769 | 2.309 |
| new→old | V3-E | 499→165 | 30.3% | 70.9% | 1.243 | 1.732 |

结论：V3-E 与同架构（无 interaction、无 Intangibles）的 ProdArch-OOF 对比，
体现 hierarchical + Intangibles 的 era 泛化增益；若两方向均优于 ProdArch-OOF → 架构增益跨 era 稳健。