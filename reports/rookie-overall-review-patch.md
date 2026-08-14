# Stage 5 Review Patch — 汇总报告（Final Sync 版）

日期：2026-08-14 · 状态：全部 Review Patch 项完成，**STOP FOR REVIEW，不切 production**
本文件数字由 `reports/rookie-overall-v3-canonical.json` 自动同步生成（不手工修数字）

---

## 1. Identity universe 统一（Review Patch #1）

详见 `reports/rookie-overall-review-patch-identity.md`。要点：

| 层级 | 数量 | 说明 |
|---|---|---|
| 文件条目 | 1800 | 全部 .json |
| unique slug | 1797 | 3 组同 slug 多文件（bobby-jones / mike-dunleavy / reggie-williams） |
| unique coreName | 1797 | 与 slug 1:1（无变体） |
| **canonical（权威）** | **1797** | coreName 首见 = 最早年份正式卡 |

- **交叉表 1799 vs 1797**：1799 是旧审计中间产物；权威口径 = canonical 1797
- **NO_OVR 87 vs 85**：87 = 旧判据（卡文件 raw）；85 = 新判据（override 覆盖后 effective OVR）——差异 2 张已解析
- **ESTIMATED 集合算术**：gap-set 475 ∪ override-set 523，intersection 1（bobby-jones），union = 997 = canonical ESTIMATED ✓（训练缺口 522 = override-only 未 materialize）

最终分类（canonical 1797）：**OFFICIAL 664 / ESTIMATED 997 / AMBIGUOUS 51 / NO_OVR 85**，sum=1797 ✓

## 2. Ablation 报告修正（Review Patch #2）

- §6.8 标签数字修正：`OFFICIAL 664 + ESTIMATED 475 + AMBIGUOUS 51 = 1190`（此前误写 665/48/2）
- 全部报告统一使用最终判据（override.source=user-ui-confirmed）

## 3. V3-B 主诊断模型（Review Patch #3）

V3-D 降为 secondary comparison。V3-B 最终结果（canonical）：

### 总体

| 模型 | n | Exact | ±1 | ±2 | MAE | RMSE | bias |
|---|---|---|---|---|---|---|---|
| V3-B | 664 | 36.0% | 78.2% | 94.3% | 0.971 | 1.471 | -0.002 |
| V3-D (secondary) | 664 | 36.4% | 77.9% | 94.0% | 0.980 | 1.512 | -0.005 |
| Deployed Production | 664 | 24.1% | 60.5% | 83.1% | 1.435 | 1.948 | 0.011 |
| Production-Architecture OOF | 664 | 24.8% | 62.8% | 83.6% | 1.417 | 1.970 | 0.002 |

### V3-B position breakdown（canonical）

| position | n | Exact | ±1 | MAE | RMSE |
|---|---|---|---|---|---|
| PG | 118 | 26.3% | 66.9% | 1.347 | 2.019 |
| SG | 182 | 48.9% | 88.5% | 0.654 | 1.003 |
| SF | 127 | 28.3% | 73.2% | 1.142 | 1.624 |
| PF | 125 | 42.4% | 81.6% | 0.768 | 1.081 |
| C | 112 | 26.8% | 75.0% | 1.125 | 1.615 |

（position n sum = 664 = officialN ✓）

## 4. Production baseline 审计（Review Patch #4）

| baseline | MAE | 语义 |
|---|---|---|
| **Deployed Production** | 1.435 | 线上模型原样（1190 全量训练，含 475 ESTIMATED），仅描述产品行为，非公平 baseline |
| **Production-Architecture OOF** | **1.417** | 与 V3 完全相同的 official-only folds，每 fold 重训生产架构（每 position 独立 Ridge）——**公平架构对比** |
| **V3-B** | **0.971** | unified position-interaction + Intangibles |

结论：V3-B vs Production-Architecture OOF 差距 -0.446 MAE 来自**架构 + Intangibles 特征**，非数据清洗本身。

## 5. Grouped-by-era 方向不对称（Review Patch #5，canonical）

| 方向 | V3-B MAE | Deployed MAE | 胜者 |
|---|---|---|---|
| old→new（2003-13 → 2014-25） | 1.417 | 1.335 | Deployed |
| new→old（2014-25 → 2003-13） | 1.448 | 1.739 | V3-B |

**不得表述为"V3-B 跨 era 整体仍优于 Production"**。V3-B 优势依赖现代 era 数据（Intangibles 分布变化），向旧 era 外推时优势消失/反转。

## 6. Monotonicity audit（Review Patch A.2 修正公式）

修正：effective slope = base + interaction（**one-hot 不再计入属性斜率**，只影响 intercept）。
修正后负 effective slope 总数：**27**（此前含 one-hot 误报 31）

- Synthetic +1 实测已证明至少部分负 slope 真实存在（8 个属性 +1 下降，SF 位置，幅度 <0.03）
- **monotonicity blocker 保持有效**，由 Stage 5.1 V3-E 解决（约束进优化，非后 clamp）
- 负 slope 明细见 ablation §5b-2（全部列出，不自动修正）

## 7. 大残差样本 provenance audit（Review Patch #7）

Top 误差（V3-B，canonical）：

| name | position | overall | pred | err | provenance |
|---|---|---|---|---|---|
| Reed Sheppard | PG | 63 | 74 | +11 | override=user-ui-confirmed ✓ / PG / OVR=63 / Int=60 / Hustle=95,Stamina=93 — 无错位；模型过度奖励 athletic/hustle |
| Jaxson Hayes | C | 65 | 74 | +9 | override ✓ / C / OVR=65 / Int=25 — 无错位；Int 已压低仍 err，attrs 驱动过高 |
| Justin Edwards | SF | 67 | 75 | +8 | override ✓ / SF / OVR=67 / Int=80 — 无错位；高 Int 推高预测 |
| Deron Williams | PG | 75 | 69 | -6 | 无错位 |
| Blake Wesley | PG | 65 | 71 | +6 | override ✓ / PG / OVR=65 / Int=55 — 无错位 |

结论：**全部大残差样本无 identity/OVR/attr 错位**；残差来源为模型权重行为，属模型问题而非数据问题。

## 8. Synthetic Stress Suite（Review Patch #8）

详见 `reports/rookie-overall-v3-synthetic-stress.md`。要点：

- **连续性** ✓（Speed 70→99 平滑递增）
- **单调性**：8 个属性 +1 局部下降（见 §6）
- **position 行为**：中锋型 profile C/PF 77/76 > PG 72 ✓ 合理
- **高能力外推**：全 99/Int 99 → 99（clamp）；全 85/Int 60 → 88；全 90/Int 70 → 93
- **Intangibles 敏感性**：全 70 时 Int 25→99 使 OVR 74→78（约 4 分跨度）
- 明确区分：synthetic feature-space OOD ≠ 官方 85+ 无标签

## 9. Synthetic Intangibles 来源审计（Review Patch #9）

`src/createResult.ts:921-924` 生产路径 Intangibles 来源（优先级）：

```
1. customFinalAttrs["Intangibles"]     → 用户手动设置槽硬锁
2. potentialCard.detailed["Intangibles"] → 潜力来源卡的官方导出值（DB2K 快照）
3. singleCard.detailed["Intangibles"]  → 同卡构建的官方值
4. 默认 50
```

**结论**：生产 Intangibles 不是模型生成、不是 OVR 反推。V3-B 输入语义已存在且确定（官方值或 50 fallback）。
唯一待确认：fallback=50 语义。**确认前不接入 V3-B 生产路径**（见 Stage 5.2）。

## 10. STOP FOR REVIEW 声明

- ✅ Final Report Sync 完成（数字由 canonical JSON 自动同步 + 断言通过）
- ✅ Review Patch 全部 9 项完成
- ❌ **不切换 production OVR model**（85+ 外推、era 不对称、monotonicity 27 负 slope、Intangibles fallback 语义）
- 下一步：Stage 5.1（V3-E monotonic hierarchical）+ Stage 5.2（Intangibles ownership）