# Stage 6B.1 — Synthetic Shadow Decomposition

日期：2026-08-14 · 10000 synthetic（同 seed，与 Stage 6B shadow 一致）

| 组合 | 含义 | mean delta | std | |Δ|≤1 | |Δ|≤2 |
|---|---|---|---|---|---|
| A→B | legacy + neutral50 − legacy + oldInt（Intangibles policy 在 legacy 上的影响） | -0.473 | 0.812 | 89.5% | 99.8% |
| A→C | v3e + oldInt − legacy + oldInt（estimator 影响，Intangibles 固定 old） | -0.847 | 1.925 | 54.8% | 78.0% |
| C→D | v3e + neutral50 − v3e + oldInt（Intangibles policy 在 v3e 上的影响） | -0.838 | 1.304 | 65.1% | 89.1% |
| B→D | v3e + neutral50 − legacy + neutral50（estimator 影响，Intangibles 固定 neutral） | -1.213 | 1.850 | 51.1% | 75.4% |
| A→D | current − pre（总 delta，= -1.21 的分解对象） | -1.685 | 1.994 | 42.6% | 66.0% |

## 分解结论

- 总 delta (A→D) = -1.685
- estimator 效应（B→D，Intangibles 固定 neutral）：-1.213
- estimator 效应（A→C，Intangibles 固定 old）：-0.847
- policy 效应（A→B，legacy 上）：-0.473
- policy 效应（C→D，v3e 上）：-0.838

注：A→B ≠ 0 说明 Intangibles policy 本身改变 legacy 估算（这是 Stage 6B.1 control audit 的根源）；
过渡双 Intangibles 后，control 用 old、display 用 new，A→B 仅在 display/export 层面可见。