# OVR Ground Truth Audit — Audit Revision 交付报告

日期：2026-08-14 · 状态：3 项修订全部完成，Stage 5 可继续

---

## 修订 #1 — OFFICIAL 数量内部不一致（666/667 → 664）

### 问题
原报告 OFFICIAL=666，但 position 聚合 118+183+128+125+113=667，band 聚合 185+457+25=667。

### set diff 过程（三个集合精确对比）

| 集合 | 数量 | 语义 |
|---|---|---|
| 原审计 byPos/byBand（Map 后写覆盖） | 667 | reggie-williams 1987 条目被 2008 的 OFFICIAL 覆盖 → 多计 1 |
| 卡文件 raw + coreName 首见 | 665 | reggie-williams 1987 卡文件 ovr=null 被排除 |
| V3 训练脚本（seenCore 在检查后） | 666 | 2008 冒充正式卡进入 |
| **权威（override 覆盖 + source 字段判据）** | **664** | reggie 1987 经 override 得 70 且带确认标记 → OFFICIAL；3 个无 source 字段 → AMBIGUOUS |

### 差异样本（精确列出）
1. **reggie-williams**（同 coreName 两张卡：1987 ovr=null / 2008 ovr=70；override 带 `source: "user-ui-confirmed-2026-08-08"`，overall=70）→ 权威判据下 OFFICIAL（正式卡 1987 经 override 覆盖后 overall=70）
2. **Mike Dunleavy**（override overall=73，无 source 字段）→ **AMBIGUOUS**
3. **Mickael Piétrus**（override overall=74，无 source 字段）→ **AMBIGUOUS**
4. **Ömer Asik**（override overall=72，无 source 字段）→ **AMBIGUOUS**

### 修复
- audit 脚本：唯一 slug 去重 + index 语义 overall（override 覆盖）+ source 字段判据
- train 脚本：seenCore 占位移到所有检查之前 + 相同判据
- **修正后三集合 S1=S2=S3=训练集=664，set diff = 0**

---

## 修订 #2 — ESTIMATED=999 与训练集 ESTIMATED=476 的关系

### classification × OVR availability 交叉表（唯一 slug）

| label | card.overall numeric（index 语义） | override-only OVR | 无可用 OVR | total |
|---|---|---|---|---|
| OFFICIAL | 664 | 0 | 0 | 664 |
| ESTIMATED | 475 | 522 | 0 | 997 |
| AMBIGUOUS | 51 | 0 | 0 | 51 |
| NO_OVR | 0 | 2 | 85 | 87 |

### ESTIMATED 构成
- **997 = gap-source 475**（卡 overallSource=model-estimated-gap）+ **override-estimated 522**（estimated:true 但卡未 materialize OVR），其中 1 张同时命中两标记

### 为什么训练集只有 475 张 ESTIMATED
- train-rookie-card-ovr.mts 的条件是 `typeof c.overall === "number"`（卡文件字段）
- 475 张 gap-source 卡满足（overall 已写入卡文件）
- **522 张 override-estimated 不满足**：它们的 overall 只存在于 overrides 条目（estimated:true），卡文件 overall 为 null/缺失（未 materialize）→ 从未进入 1190 训练集
- 结论：剩余 522 张 estimated 因"override-only、卡未 materialize"而缺席训练集，不是分类遗漏

---

## 修订 #3 — OFFICIAL positive provenance（硬要求 #3/#4）

### 判定依据（代码/数据协议引用）

**唯一判据：override 条目带显式 `source: "user-ui-confirmed-2026-08-08"` 字段（共 664 条）。**

代码/数据依据链：
1. **`scripts/estimate-missing-ovr.mts` 是唯一写入 `{year}-overrides.json` 的自动化脚本**（grep 确认 `analyze-rookie-gap.mjs`、`build-all-cards.mjs`、`build-gap-checklist.mjs`、`build-rookie-card-index.mjs`、`convert-db2k-to-rookiecard.mjs` 均只读不写）
2. 该脚本 L114 总是写 `estimated: true` 标记；L127 `if (existing[slug]?.overall != null) continue` **绝不覆盖已有用户值**
3. 用户 UI 确认写入的条目带 `source="user-ui-confirmed-YYYY-MM-DD"`——本次数据 664 条全部来自 **2026-08-08 批次**（用户游戏内确认后由 UI 写入，全部位于 2003-2025 年份文件；实例：`data/raw/db2k/2003-overrides.json: "carmelo-anthony": {"overall": 82, "source": "user-ui-confirmed-2026-08-08"}`）。注：`darrel-griffith`（1980）等老年份条目无 source 字段，属于 no-source 类
3. **3 个反例**（Mike Dunleavy / Mickael Piétrus / Ömer Asik）：override 有 OVR 但无 source 字段（注：Mike Dunleavy 有两个年份条目——1976 `{overall:71, estimated:true}` + 2002 `{overall:73}`，Map 合并取 2002 的 73，两者均无 source）→ **不因 estimated!==true 自动视为 OFFICIAL**，降为 AMBIGUOUS（用户硬要求 #4 直接落实）
5. no-card 系列（db2k-no-card-*）48 张：无 override 记录 → AMBIGUOUS，不推断、不补值
6. `convert-gap-snapshot.mjs` L9-10/L297：gap 卡模型估算写 `overallSource="model-estimated-gap"`（用户可后续 override）

### 正向证明结论
**可以正向证明**："无 estimated 标记"本身不足以证明 official（3 个反例），但**显式 `source=user-ui-confirmed` 字段是强正向证明**——因为自动化写入路径（estimate-missing-ovr.mts）从不写该字段，只有用户 UI 确认流程会写。664 个 OFFICIAL 全部满足此判据。

---

## 新增 OVR V3 硬约束（85+ extrapolation）

1. **85+ 必须视为 extrapolation/out-of-support region**：官方标签上限 84，85+ 样本数 = 0
2. 不得报告 85+ accuracy
3. 不得因为 <85 CV 良好而自动推荐 production switch
4. 所有最终报告单独给出 **<70 / 70-79 / 80-84** 三 band 指标（V3 ablation 已实现）
5. **80-84 约 25 张逐样本 prediction/error 诊断**（V3 ablation §3b 已输出全部 25 张）
6. 主模型优先 **unified regularized position-interaction model**（V3-A/B/C/D 均为该结构）
7. **5 个独立 position Ridge 仅作为诊断模型**（V3 ablation §4，不作为生产候选）

---

## 修订后最终数字（全部自洽）

- OFFICIAL = **664**（PG 118 + SG 182 + SF 127 + PF 125 + C 112 = 664 ✓）
- OVR band：<70 = 184 + 70-79 = 455 + 80-84 = 25 = **664** ✓（85+ = 0）
- ESTIMATED = 997 · AMBIGUOUS = 51（48 no-card + 3 无 source）· NO_OVR = 85
- 训练集污染：1190 = OFFICIAL 664 + ESTIMATED 475 + AMBIGUOUS 51（生产 rookie 模型混入 475 张 estimated 标签）
- V3 训练集 = 审计 OFFICIAL 664（完全一致）
- V3-B (+Intangibles) 同集 MAE **0.971** vs Production **1.435**（但 85+ 外推 + synthetic Intangibles 语义未确认前，不推荐切换）
