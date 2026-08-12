# 2k26-spinner 算法说明（除 OVR 评分外）

> 面向 agent 的技术文档：所有公式、参数、常量直接对应源码，改动前先读对应文件。
> OVR 评分模型（`src/rookieOverall.ts` / 各 `rookieOverallModel*.json` 的 Ridge 回归）不在此文范围。

## 0. 生成管线总览

`createResult()`（`src/createResult.ts:534`）是唯一入口，输入 16 个槽位锁（`LockState`）+ 年龄 + 位置 + 身体，输出完整新秀（属性/徽章/热区/倾向/成长轨迹/耐久/惯用手）。

两阶段评估（`evaluateAll`，`src/createResult.ts:343`）：
1. **阶段一**：每个槽位独立做身体约束评估（`evaluate`，`src/createResult.ts:233`）
2. **阶段二**：以阶段一最终 athletic/strength 值为目标，对声明了 `support` 依赖的槽位做软支持修正

确定性：`signature = 16 槽位锁串接 + 身体串接`，`makeRandom(hash(signature|age|position|secondary))`（FNV-1a + mulberry32，`createResult.ts:161-168`）——同一锁+身体+年龄+位置永远产生同一结果。所有随机点（热区/耐久/惯用手/成长扰动）都吃这个 random。

## 1. 身体生成（createBodySettings）

`src/components/RookieBuilder.tsx:330-341`。位置基准 `bodyBases`（`createResult.ts:136`）：

| 位置 | height cm | weight kg | wingspan | shoulder | neck | torso |
|---|---|---|---|---|---|---|
| PG | 185 | 82 | 46 | 46 | 50 | 48 |
| SG | 193 | 90 | 49 | 49 | 50 | 50 |
| SF | 201 | 98 | 53 | 53 | 51 | 52 |
| PF | 206 | 108 | 57 | 58 | 52 | 55 |
| C | 211 | 116 | 61 | 62 | 53 | 58 |

每项 = `clamp(base + (random()-0.5) * 幅度, 下限, 上限)`：height ±5cm、weight ±8kg、wingspan ±10、shoulder ±9、neck ±12、torso ±10。UI 手动可调（`updateBody`）。

## 2. 身体约束 + 跨位置减值（applyBodyConstraints）

`src/rookieBodyConstraints.ts:197`，核心文件。目标：把**来源球员/新秀卡的原始属性**继承到**目标身体+目标位置**时施加合理衰减。

### 2.1 常量

```
BODY_MISMATCH_PENALTY_SCALE = 4        // 身材结构惩罚总系数（身高体重影响 ×2 后翻倍）
POSITION_CROSS_SCALE        = 2.68     // 位置交叉放大（位置影响 ×4），bodyPressure 无上限
HEIGHT_GAP_REFERENCE_CM     = 40       // 身高差值参考尺度
WEIGHT_GAP_REFERENCE_KG     = 35       // 体重差值参考尺度
SECONDARY_BODY_DISTANCE_WEIGHT = 0.25  // 次要位置在有效距离中的权重
GRACE_ZONE_SAME    = { height: 12cm, weight: 18kg }    // 同位置宽容区
GRACE_ZONE_ADJACENT= { height: 10cm, weight: 15kg }    // 相邻位置宽容区
```

位置轴（`positionAxis`）：C=0, PF=1, SF=2, SG=3, PG=4。

### 2.2 位置距离

- 来源角色：`parsePositionRoles(sourcePosition)` 拆 `C/PF` 式双位置
- 主距离 `primaryDistance` = 目标位置到最近来源角色的轴距
- 有效距离 `effectiveDistance` = `(primary + 0.25 × secondary) / 1.25`（次要位置加权拉近）
- 宽容区类别 `graceZonePositionClass`：主距离=0 且有效 ≤1 → `same`；主距离=1 且有效 ≤1 → `adjacent`；否则 `none`（PG/C 仅靠次位置拉近**不能**进宽容区）

### 2.3 有符号差值 → 方向性劣势

```
heightDelta = target.height - source.height   (cm)
weightDelta = target.weight - source.weight   (kg)
disadvantage(delta, pref) = pref=="higher" ? max(0, -delta) : pref=="lower" ? max(0, delta) : 0
```
**只有目标处于不利方向才扣分**（来源比目标矮/轻 → 目标高/重方向无惩罚；来源比目标高/重 → 惩罚）。

### 2.4 结构惩罚

属性级 profile（`src/rookieBodyProfiles.ts` 的 `bodyTransferProfiles`，16 槽位各一份）：每轴 `{weight(占比, 和为1), preference(higher/lower/neutral/mixed), scale(每10cm/10kg基准强度)}` + `sensitivity(槽位总敏感度0-1)`。

```
structural = sensitivity × (hW × hDis/10 × hScale + wW × wDis/10 × wScale)
```
若 structural < 0：
```
bodyPressure = hW × hDis/40 + wW × wDis/35          // 无上限
positionMultiplier = 1 + effectiveDistance × 2.68 × bodyPressure × sensitivity
adjustment = structural × 4 × positionMultiplier
```

### 2.5 位置直接惩罚（传控类，独立于身材系数）

profile 声明 `positionCross: {weight, squared?}` 时：
```
penalty = weight × distance^(squared ? 2 : 1)
adjustment -= penalty
```
设计意图：**传球**只有这一个影响系数 → 平方放大；**控球**已有身材系数 → 位置线性叠加。

### 2.6 目标侧安全上限（cap）

`safetyCapForAttribute`（`rookieBodyConstraints.ts:102`）：
```
heightDelta = body.height - 185; weightDelta = body.weight - 82
wingDelta = body.wingspan - 50;  shoulderDelta = body.shoulder - 50
Strength        = clamp(weight×0.65 + 27 + shoulderDelta×0.08, 60, 99)
Block           = clamp(80 + h×0.55 + wing×0.12, 55, 99)
Interior Defense= clamp(82 + h×0.42 + w×0.14 + wing×0.08 + s×0.05, 55, 99)
O/D Rebound     = clamp(82 + h×0.5 + w×0.1 + wing×0.08, 55, 99)
Standing Dunk   = clamp(75 + h×0.55 + w×0.14 + s×0.05, 45, 99)
```
来源容量豁免：目标不比来源矮/轻（±1cm/±2kg）时，非力量属性 cap 提升到 ≥ 原始值（来源证明过的 outlier 不被压；力量仍服从体重硬上限）。

### 2.7 宽容区

`graceZoneWithin`：位置类别非 none 且 `|hGap| ≤ 阈值` 且 `|wGap| ≤ 阈值` → 非力量属性**原值继承**（`usedGraceZone=true`）。

### 2.8 skipBody

降级算法关闭：所有属性只 clamp 到 25-99，不做来源比较/位置交叉/目标 cap（UI 的"跳过身体限制"开关）。

### 2.9 属性方向偏好速查（bodyTransferProfiles 关键点）

- `three`/`mid`：sensitivity=0（投篮不受身体约束）
- `face`：中性 + 支持 Speed/Agility；`Layup` override 为 lower 方向
- `post`：支持 Strength；`Post Control` override higher
- `dunk`：height higher(0.62)/weight lower(0.38)，支持 Vertical/Strength；`Standing Dunk` override 双向 higher
- `handle`：positionCross 线性；`passing`：positionCross squared

## 3. 支持依赖修正（evaluateAll 阶段二）

`src/createResult.ts:299-417`。声明了 `support` 的槽位属性依赖根属性（Strength/Speed/Agility/Vertical）的**阶段一最终值**：
```
deficit = Σ dep.weight × max(0, sourceValue - targetValue) / 20   // 每20点差值=1单位缺口
cut = min(deficit, 8)                    // SUPPORT_MAX_CUT，单次最多扣8
floor = round(current × 0.65)            // SUPPORT_MIN_KEEP，不低于65%
next = max(current - cut, floor)
```
支持值只认真实观测（卡详细属性优先于球员当前属性）；缺失依赖不猜、上报 `supportIncomplete`。预览与最终生成共用 `evaluateAll`，结果一致。

## 4. 年龄成长曲线（rookieValue）

`src/createResult.ts:431-440`。非卡槽位的 peak 属性 → 初始属性：
```
progressByCategory = {
  technical: [0.82, 0.85, 0.88, 0.91, 0.93, 0.95],
  physical:  [0.92, 0.94, 0.96, 0.97, 0.98, 0.99],
  mental:    [0.77, 0.81, 0.85, 0.88, 0.90, 0.92],
}
ageIndex = clamp(age - 18, 0, 5)
progress = clamp(progressByCategory[category][ageIndex], 0.55, 1)
value = clamp(25 + (value - 25) × progress)
```
**有真实新秀卡的槽位不走此曲线**（卡值是官方 rookie 数据，verbatim 继承）；耐久也不走 mental 曲线（独立算法，见 §6）。

## 5. 潜力与评级

- 潜力来源优先级：潜力槽锁定的卡 `potential.current` > peak 评估值 > `round(sourcePeakOverall)`；clamp 40-99
- `potentialMin/Max`：卡官方范围优先，否则 `potential ± 5` 对称带（clamp 40-99）
- 评级 `rookieTierForPotential`（`createResult.ts:482`）：`≥94 → generational`；`≥87 → lottery`；否则 `rotation`

## 6. 耐久算法（rookieDurability）

`src/rookieDurability.ts`。16 项耐久（9 组对称部位 + Overall Durability，部位组：头/颈/背单侧 + 肩肘髋膝踝脚 6 组左右对称）。

### 6.1 均值

```
rookieDurabilityMean(sourceOverallDurability, bodyStress, random):
  mean = 82 + 0.35×(source - 80) - 0.75×stress + seededNormal×1.5
  clamp 到 [74, 92]（ROOKIE_DURABILITY_FLOOR/CEILING）
```
- `bodyStress = max(0, (weight - bodyBase.weight)/15) + max(0, (height - bodyBase.height)/12)`
- 输入非有限 → 回退 source=80 / stress=0
- seededNormal：Box-Muller（两个 bounded random）

### 6.2 部位生成

每部位 `latent = mean + normal×1.5` → clamp；对称组两侧差值：`random()<0.5 ? 0 : random()<0.5 ? -1 : 1`（50% 对称、25% 差 1、25% 差 -1）。

### 6.3 均值再平衡（rebalancePartMean）

目标 = mean × 15（不含 Overall），贪心迭代（上限 200 次，NaN/不收敛快速退出——公测审计 10.1）：
```
difference = targetSum - currentSum
direction = difference > 0 ? +1 : -1
每组 shift ±1（对称组 |diff|≥2 时可一次 ±2）
```
`Overall Durability` = targetMean（硬设）。手动锁定 Overall Durability 时：它成为固定均值，15 部位围绕它生成且永不被覆盖。

## 7. 冷热区（createHotZones）

`src/createResult.ts:490-532`。14 个区域：篮下 + 3 近距离 + 5 中距离 + 5 三分。

每个区域评分：
```
base = 区域对应属性均值（篮下: Close/Layup/Dunk/Standing；近距: Close/Layup/PostHook/PostControl；
       中距: Mid-Range/ShotIQ/OffConsist；三分: Three/ShotIQ/OffConsist）
handBias = center:0 | 惯用手侧:+3 | 非惯用手侧:-2
roleBias = (PG/SG 且 center 且 mid/three): +3 | (PF/C 且 rim/close): +4 | 0
score = base + handBias + roleBias + (random()-0.5)×24
```
排名后分配极值：`coldCount = random()<0.7 ? 1 : 2`（冷区 1-2 个），`hotCount = random()<0.5 ? 3 : 4`（热区 3-4 个）——热区图表达相对强弱，不逐区独立分类。

## 8. 徽章

### 8.1 规则生成（createBadges，`createResult.ts:463`）

峰值属性驱动的 11 条规则，score ≥ 78 才产出，tier 按 score：
```
Set Shot Specialist: avg(Three, Mid)          Deadeye: avg(Mid, ShotIQ)
Limitless Range: Three - 2                    Physical Finisher: avg(Layup, Strength)
Posterizer: avg(DrivingDunk, Vertical)        Handles For Days: avg(BallHandle, Stamina)
Dimer: avg(PassAcc, PassIQ, PassVision)       Challenger: avg(PerimeterDef, Agility)
Interceptor: avg(Steal, PassPerception)       Paint Patroller: avg(Block, InteriorDef)
Rebound Chaser: avg(OReb, DReb)
tier: ≥96 HOF | ≥90 Gold | ≥84 Silver | else Bronze
```

### 8.2 继承（buildBadgesByBundle，`src/badges.ts:207`）

锁定球员的徽章按 `badgeBundleMap` 映射到槽位；`badgesKnown` 为真的球员徽章 verbatim；未知的走规则生成（`createBadges` fallback）。

### 8.3 新秀降级（downgradeBadgesForRookie，`src/badges.ts:234`）

按评级降档并限量：
```
rotation:    drop 2 档, 取前 3 个
lottery:     drop 1 档, 取前 5 个
generational:drop 1 档, 取前 7 个
tier 降档: Bronze→Bronze(floor 1), Silver→Bronze, Gold→Silver, HOF→Gold, Legendary→HOF
```
**卡徽章不降级**（官方 rookie 等级 verbatim），`uniqueBadges` 同名取高。

## 9. 成长轨迹参数

`createResult.ts:780-816`（有潜力卡 vitals 时全部继承官方值，否则公式）：

```
progressSpeed = clamp(2.4 + max(0, (potential-87)/10) + (random()-0.5)×0.6, 2.2, 5.4)  // 每岁点数
yearsToPeak = ceil(growthGap / progressSpeed)       // growthGap = potential - initialStrength
peakStart = max(24, age + yearsToPeak)  clamp [age, 30]
peakDuration = clamp(7 + (durability-70)/15 + random()×1.5, 5, 11)
peakEnd = peakStart + peakDuration    clamp [peakStart, 40]
boom = clamp(28 + potential - 84 - (age-18)×2 + (random()-0.5)×8, 10, 55)
bust = clamp(18 - (age-18) + (random()-0.5)×8, 8, 40)
normal = 100 - boom - bust
```

## 10. 初始属性 OVR 约束（constrainRookieInitialAttributes）

`src/rookieInitialOverall.ts:59`。非 OVR 评分本身，是"初始属性逼近潜力目标综评"的约束：

```
targetOverall = initialOverallForPotential(potential, age)
若估计 OVR ≤ target：原样返回
否则对可调属性（排除锁定值）统一 offset：从 -1 扫到 -30，
  找"≤ target 且最接近 target"的偏移（不可达时取最低 OVR 偏移）
```
锁定值（卡槽位身体约束值、custom 硬锁、Intangibles）绝不被下调。顺序（createResult.ts:790-810）：Intangibles 先解析（custom 硬锁 > 潜力卡 > 同卡 > 50）写入，再约束，最后重算最终 OVR——保证报告的 OVR 与导出属性严格一致（Task 4 修复）。

## 11. 其他小算法

- **惯用手**：运动槽卡 `vitals.dominantHand` 优先；否则 `random()<0.11 → 左手`；扣篮手 80% 同惯用手
- **抽队**（`createRound`，`RookieBuilder.tsx:378`）：从非空球队池排除上一队后均匀随机；球员顺序 Fisher-Yates shuffle；"换一批"= offset 前进（随机模式每轮 3 次限制）
- **名字生成**：`src/rookieNames.ts`，80 名 × 130 姓等概率采样
- **倾向**：`collectTendenciesByBundle`（`src/tendencies.ts:46`），槽位按 `tendencyBundleMap` 读字段，卡导出倾向优先于 ATD lookup，verbatim 无降级
- **卡槽位路径**：有真实卡（`lookupRookieCard` 按归一化名匹配）的槽位：属性/徽章/倾向/耐久/潜力/惯用手/成长 vitals 全部优先卡数据；卡属性过同一身体约束路径（与 UI 预览一致）

## 12. 关键数据文件

| 文件 | 内容 |
|---|---|
| `src/data/rookieCards/` + `rookieCardIndex*.min.json` | 1190 张新秀卡（2018-2025 详细属性 + 1960-2017 全史） |
| `src/data/rookieOverallModel-rookie.json` | rookie OVR Ridge 模型（非负系数） |
| `src/data/versions/2k26|2k27-play-now/` | 2K26/2K27 roster + 模型 + 倾向 |
| `src/data/players.json` / `badgeProfiles.2k26.json` / `tendencyProfiles.min-*.json` | 球员徽章/倾向 |
| `src/rookieBodyProfiles.ts` | 16 槽位身体转移 profile（§2.4 参数表） |
