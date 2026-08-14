# OVR Ground Truth Audit — official/estimated 标签审计

日期：2026-08-14（含 Audit Revision v2）· 数据源：snapshot 1374 / src/data/rookieCards 1800

## 0. Audit Revision 摘要（666/667 → 664，权威判据 = source 字段）

### 0.1 set diff 结果
差异样本：**reggie-williams**（同 coreName 两张卡：1987 ovr=null / 2008 ovr=70，override 有 source=user-ui-confirmed）。
- 原审计 byPos/byBand 用 `Map<slug,label>` 后写覆盖 → 1987 条目被 2008 的 OFFICIAL 覆盖 → 多计 1 → 667
- V3 训练脚本 seenCore 在检查之后占位 → 2008 冒充正式卡进入 → 666
- 按 coreName 首见 + 卡文件 raw overall → 665（reggie 1987 卡文件 ovr=null 被排除）
- **最终权威（Audit Revision v2）**：override 覆盖 + source 字段判据 → **664**
- 664 = 667(index 覆盖) − 3（Mike Dunleavy / Mickael Piétrus / Ömer Asik：override 有 OVR 但无 source 字段 → 无法正向证明 → AMBIGUOUS）
- 修复：audit/train 统一为「coreName 首见 + override 覆盖 overall + source 字段判据」

### 0.2 classification × OVR availability 交叉表
| label | card.overall numeric（index 语义） | override-only OVR | 无可用 OVR | total |
|---|---|---|---|---|
| OFFICIAL | 664 | 0 | 0 | 664 |
| ESTIMATED | 475 | 522 | 0 | 997 |
| AMBIGUOUS | 51 | 0 | 0 | 51 |
| NO_OVR | 0 | 2 | 85 | 87 |

### 0.3 ESTIMATED=997 与训练集 ESTIMATED=475 的关系
- ESTIMATED 总数 997 = gap-source 475（overallSource=model-estimated-gap）+ override-estimated 522（estimated:true 但卡未 materialize OVR）；其中 1 张同时命中两标记
- 当前训练集（train-rookie-card-ovr.mts 条件 `typeof c.overall === "number"`）只纳入 **475** 张卡 overall numeric 的 ESTIMATED
- 其余 **522** 张 estimated 未进入训练集：overall 只存在于 overrides（estimated:true），卡文件 overall 为 null/缺失（未 materialize），不满足训练集条件

### 0.4 OFFICIAL positive provenance 依据（硬要求 #3/#4 最终版）

**判据：override 条目显式 `source: "user-ui-confirmed-2026-08-08"` 字段（共 664 条）。**
代码/数据依据：
1. `scripts/estimate-missing-ovr.mts` 是唯一写入 `{year}-overrides.json` 的自动化脚本（其余引用脚本只读），总是写 `estimated: true`（L114），且绝不覆盖已有用户值（L127 `if (existing[slug]?.overall != null) continue`）
2. 用户 UI 确认写入的条目带 `source="user-ui-confirmed-YYYY-MM-DD"`——本次数据 664 条全部来自 2026-08-08 批次（用户游戏内确认后由 UI 写入）
3. override 有 OVR 但无 source 字段、无 estimated 标记的 3 个样本（Mike Dunleavy 73 / Mickael Piétrus 74 / Ömer Asik 72）→ **不因 estimated!==true 自动视为 OFFICIAL**，降为 AMBIGUOUS（硬要求 #4）
4. no-card 系列（db2k-no-card-*）48 张：无 override 记录 → AMBIGUOUS，不推断、不补值
5. `convert-gap-snapshot.mjs` L9-10/L297：gap 卡模型估算写 `overallSource="model-estimated-gap"`（用户可后续 override）

## 1. Universe 差异（硬要求 #3）

| 维度 | snapshot | src/data/rookieCards | 差异 |
|---|---|---|---|
| 总数 | 1374 | 1800 | +426 |
| unique coreName | 1374 | 1797 | +423 |
| overlap | 1374 | 1374 | — |
| only-in-snapshot | 0 | — | 见下 |
| only-in-rookieCards | — | 423 | 见下 |

only-in-snapshot (0)：

only-in-rookieCards (423)：lenny wilkens, tom sanders, larry siegfried, dave debusschere, don nelson, jerry lucas, john havlicek, jim king, nate thurmond, hank finkel, joe caldwell, john thompson, mel counts, willis reed, dave bing…

### duplicates/version 说明
同 coreName 出现多张卡（不同年份/版本）：3 组；去重后 unique 1797
（build-rookie-card-index 按 coreName 保留最早年份作为正式 rookie 卡，其余为版本重复）

### 缺字段（34 atomic）
- OFFICIAL: 0 张缺字段（样例：）
- ESTIMATED: 0 张缺字段（样例：）
- AMBIGUOUS: 0 张缺字段（样例：）

## 2. 标签三分（硬要求 #4）

| 标签 | 数量 | 判定依据 |
|---|---|---|
| OFFICIAL | 664 | override.source 显式 user-ui-confirmed 字段（用户 UI 游戏内确认） |
| ESTIMATED | 997 | overallSource=model-estimated-gap 或 overrides.estimated=true |
| AMBIGUOUS | 51 | overall 有值但无正向 provenance（48 no-card + 3 无 source 字段 override） |
| NO_OVR | 85 | overall 缺失 |

## 3. OFFICIAL 样本分布

按位置：PG=118 · SG=182 · SF=127 · PF=125 · C=112
按 OVR band：70-79=455 · 80-89=25 · <70=184
按年份（前 10/后 10）：1987:1 2003:25 2004:13 2005:16 2006:18 2007:16 2008:15 2009:17 2010:11 2011:12 ... 2016:20 2017:23 2018:40 2019:45 2020:41 2021:60 2022:60 2023:58 2024:62 2025:54

⚠️ **OFFICIAL 标签 OVR 上限 = 84：85+ 完全无官方样本（90+ = 0）。**
顶级球员（85+）的 OVR 全部是模型估算或未采集——V3 在 85+ 区间的能力必须按样本量=0 报告，不得用百分比制造假精度（F6 要求）。

## 4. 当前生产模型训练集污染检查

train-rookie-card-ovr.mts 使用「overall 为 number」的全部卡：1190 张
标签构成：ESTIMATED=475 · AMBIGUOUS=51 · OFFICIAL=664

⚠️ **当前生产 rookie OVR 模型训练集混入 475 张 ESTIMATED 标签**（模型估算值当 ground truth）——V3 必须修复为 official-only。

## 5. V3 canonical training universe 建议

**选择 src/data/rookieCards（1800）中的 OFFICIAL（664 张）作为 V3 训练 universe。**
理由：
1. src/data/rookieCards 是仓库运行时数据源（rookieCards.ts 加载），与生产路径一致；snapshot 是导出快照（无运行时消费）
2. OFFICIAL 定义要求正向 provenance（overrides 无 estimated 标记 = 用户游戏内确认），杜绝 estimated-as-truth
3. AMBIGUOUS / ESTIMATED / NO_OVR 一律排除，不推断、不补值（硬要求 #4）
4. 若 OFFICIAL 样本量不足以支撑 position 分组，按 grouped holdout 报告实际样本数，不编造精度

## 6. 结论

- OFFICIAL 可用训练样本：664（唯一判据：override.source=user-ui-confirmed）
- 需要排除：ESTIMATED 997 + AMBIGUOUS 51 + NO_OVR 85
- 生产模型训练集污染：是（475 张）
- 三集合一致性：S1=classification / S2=position / S3=band 全部 = 664（set diff 0）
- V3 训练前必须完成：official-only 重切分（Stage 5 执行，已按此语义实现）