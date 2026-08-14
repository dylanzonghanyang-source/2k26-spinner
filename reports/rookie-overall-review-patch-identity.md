# Stage 5 Review Patch — Identity Universe 统一报告

## 1. identity universe 定义

| 层级 | 数量 | 说明 |
|---|---|---|
| 文件条目 | 1800 | src/data/rookieCards 全部 .json |
| unique slug | 1797 | 3 组同 slug 多文件（bobby-jones / mike-dunleavy / reggie-williams） |
| unique coreName | 1797 | 与 slug 1:1（无 slug 变体）；同上 3 组 |
| **canonical（权威）** | **1797** | coreName 首见 = 最早年份正式卡（build-rookie-card-index 语义） |

**unique slug vs unique coreName**：本数据集二者完全相等（1797）。slug 是文件身份（同 slug 跨年份文件=同一人重复卡）；coreName 是归一化人名（去重音/后缀）。同 slug 多文件 3 组同时也是同 coreName 多文件，因此合并后唯一身份不变。

## 2. 交叉表合计 1799 vs canonical 1797

1799 = 旧审计用「唯一 slug」遍历文件条目时，3 组重复文件的第二份也被计数（1800 - 1 = 1799 是中间产物）。**权威口径 = canonical coreName 1797**（每身份一张正式卡，重复文件只算首见）。

## 3. 最终分类（canonical 1797）

| 标签 | 数量 | sum 校验 |
|---|---|---|
| OFFICIAL | 664 | byPos {"SF":127,"PF":125,"C":112,"SG":182,"PG":118} = 664；byBand {"70-79":455,"80-84":25,"<70":184} = 664 |
| ESTIMATED | 997 | — |
| AMBIGUOUS | 51 | 明细见 §5 |
| NO_OVR | 85 | 样例见 §6 |
| **total** | **1797** | **= 1797** ✓ |

## 4. NO_OVR 87 vs 85

- 87 = 旧判据（卡文件 raw overall 非 number）在唯一 slug 集合上的计数：含 mike-dunleavy(1976 cardOVR=null)、reggie-williams(1987 cardOVR=null)
- 85 = 新判据（override 覆盖后 effective OVR 仍非 number）在 canonical 上的计数
- 差异 2 = mike-dunleavy（override 合并后 73 有值 → AMBIGUOUS）+ reggie-williams（override 70 + source → OFFICIAL）
- **权威 = 85**

## 5. AMBIGUOUS 明细（51）

- no-card 系列（无 override）：48 张（db2k-no-card-*）
- 有 override 但无 source 字段：3 张
   Mike Dunleavy(eff=73) / Mickael Piétrus(eff=74) / Ömer Asik(eff=72)

## 6. NO_OVR 样例

共 85 张（overall 缺失且无 override）：Lenny Wilkens@1960, Larry Siegfried@1961, Dave Debusschere@1962, Jerry Lucas@1962, John Havlicek@1962, Nate Thurmond@1963, Joe Caldwell@1964, Willis Reed@1964, Dave Bing@1966, Jack Marin@1966, Lou Hudson@1966, Earl Monroe@1967 …

## 7. ESTIMATED 集合算术（消除 475+522/intersection=1 歧义）

- gap-source set（canonical 卡 overallSource=model-estimated-gap）：**475**
- override-estimated set（overrides.estimated=true）：**523**
- intersection：**1**（bobby-jones）
- union：**997**
- gap-only：474 · override-only：522
- canonical ESTIMATED：**997**（= union − 0，mike-dunleavy 因 canonical 首见 1976 + override 合并 73 无 source → AMBIGUOUS，从文件级 ESTIMATED 移出）
- 训练集缺口 522 = override-only 集合中卡文件未 materialize OVR 的部分（训练条件 `typeof card.overall === 'number'` 只接受卡文件有值）