# 2KSpinner Rookie Snapshot 1960-2025

生成时间: 2026-08-13T06:09:05.129Z
卡片总数: 1374（覆盖 55 个选秀年份：1960–2025）

## 文件说明

| 文件 | 内容 |
|---|---|
| `rookie-snapshot.json` | 全量新秀卡快照，每张卡全字段（属性/倾向/徽章/热区/耐久/身体/潜力/来源等） |
| `rookie-card-index.json` | 索引（15 组字段：keys/slugs/years/names/positions/overalls/attrs/tendencies/badges/personalityBadges/potentials/dataQualities/vitals/durability/hotZones），数组下标一一对应 |
| `manifest.json` | 元数据：各年份卡数、来源分布、字段覆盖率、schema |

## 索引用法

`rookie-card-index.json` 中各数组按下标对齐，例如：

```js
const idx = JSON.parse(fs.readFileSync("rookie-card-index.json", "utf8"));
// 第 i 张卡的信息：
idx.names[i];      // 英文名
idx.slugs[i];      // 唯一 slug（也用于关联快照中的卡）
idx.years[i];      // 选秀年份
idx.overalls[i];   // 综评
idx.attrs[i];      // 属性数组（35 个字段，与快照卡 detailed 对应）
```

用 slug 在快照中取完整卡：`snapshot.find(c => c.slug === slug)`。

## 数据来源

- 原始卡源: `src/data/rookieCards/{year}/*.json`
- 构建: `node scripts/build-all-cards.mjs` + `node scripts/build-rookie-card-index.mjs`
- 打包: `node scripts/build-rookie-snapshot-package.mjs`

## 注意

- 缺少年份: 1961, 1962, 1963, 1964, 1966, 1967, 1968, 1971, 1972, 1973, 1975（这些年份无采集数据）
- OVR 部分为模型估算（见 manifest.fieldCoverage.overallSourceBreakdown），非官方实机值
