# Residual × Body Morphology Audit

日期：2026-08-14 · official 664（含身体数据 664）· attribute-only 模型 = V3-E-NoInt（monotonic hierarchical 34 attrs，OOF 5-fold）
residual = official OVR − attribute-only predicted OVR（OOF）

## 0. 总览

- attribute-only OOF MAE：1.206
- residual mean：-0.014 · std：1.713
- Intangibles mean：57.7 · std：18.0
- corr(residual, Intangibles)：0.543

## 1. Pearson 相关性（residual / Intangibles × 身体指标）

| 指标 | corr(residual) | corr(Intangibles) |
|---|---|---|
| Height (in) | 0.039 | -0.087 |
| Weight (lb) | 0.030 | -0.061 |
| BMI | 0.004 | 0.005 |
| Wingspan (in) | 0.041 | -0.071 |
| Height × Wingspan | 0.043 | -0.082 |
| Height z-score (within position) | 0.063 | -0.021 |
| Wingspan z-score (within position) | 0.058 | 0.013 |

注：corr 绝对值 ≥0.1 视为值得注意，≥0.2 视为强相关（n=664）。

## 2. 极端体型组（residual / Intangibles 均值）

| 组 | 定义 | n | mean residual | mean Intangibles | vs 全体 residual 均值 |
|---|---|---|---|---|---|
| 极高个 | position 内 z>2 | 26 | 0.23 | 57.0 | 0.24 |
| 极矮 | position 内 z>2 | 14 | -0.57 | 56.1 | -0.56 |
| 极长臂 | position 内 z>2 | 16 | -0.38 | 54.6 | -0.36 |
| 极重（position 内体重 z>2） | position 内体重 z>2 | 12 | 0.33 | 61.1 | 0.35 |
| 极轻（position 内体重 z<-2） | position 内体重 z<-2 | 16 | 0.00 | 59.1 | 0.01 |
| position-body outlier（|height z|+|wingspan z| ≥ 4） | |height z|+|wingspan z| ≥ 4 | 11 | -0.18 | 52.5 | -0.17 |

## 3. 极端组明细（每组 top 5 by |residual|）

### 极高个

| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |
|---|---|---|---|---|---|---|---|
| Blake Wesley | PG | 81 | 185 | 79.7992125984252 | 55 | -7 | 65 |
| Kristaps Porzingis | C | 87 | 240 | 90 | 60 | +5 | 80 |
| Victor Wembanyama | C | 88 | 210 | 96 | 98 | +3 | 84 |
| Kon Knueppel | SG | 82 | 217 | 81.5983631967264 | 60 | +3 | 75 |
| Channing Frye | PF | 84 | 248 | 86.5 | 75 | +2 | 74 |

### 极矮

| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |
|---|---|---|---|---|---|---|---|
| Chuck Hayes | PF | 78 | 240 | 82 | 60 | -3 | 73 |
| Haywood Highsmith | PF | 77 | 220 | 80.85039370078741 | 30 | -3 | 65 |
| Anderson Varejao | C | 79 | 230 | 82.67716535433071 | 25 | -2 | 72 |
| Draymond Green | PF | 78 | 230 | 85.25196850393701 | 70 | +2 | 77 |
| Jamal Cain | PF | 78 | 191 | 81.9015748031496 | 60 | -2 | 71 |

### 极长臂

| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |
|---|---|---|---|---|---|---|---|
| Mikal Bridges | SG | 78 | 210 | 86 | 25 | -3 | 73 |
| Victor Wembanyama | C | 88 | 210 | 96 | 98 | +3 | 84 |
| Giannis Antetokounmpo | SF | 84 | 205 | 88 | 25 | +2 | 77 |
| Trendon Watford | SG | 80 | 237 | 86.25196850393701 | 25 | -2 | 63 |
| Cedric Coward | SG | 77 | 200 | 86.25196850393701 | 45 | -2 | 71 |

### 极重（position 内体重 z>2）

| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |
|---|---|---|---|---|---|---|---|
| Marcus Smart | PG | 76 | 220 | 80 | 98 | +4 | 76 |
| Kobe Brown | SF | 80 | 250 | 84.75196850393701 | 40 | -4 | 67 |
| Glen Davis | PF | 81 | 289 | 84.44094488188976 | 95 | +3 | 72 |
| Greg Oden | C | 84 | 285 | 88.25196850393701 | 40 | +2 | 79 |
| Zion Williamson | SF | 78 | 284 | 82.25196850393701 | 35 | +2 | 81 |

### 极轻（position 内体重 z<-2）

| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |
|---|---|---|---|---|---|---|---|
| Jaden McDaniels | PF | 81 | 185 | 84 | 98 | +4 | 71 |
| Corey Brewer | SF | 81 | 185 | 80.25196850393701 | 38 | -2 | 73 |
| Darren Collison | PG | 72 | 160 | 75 | 55 | -2 | 73 |
| Aaron Brooks | PG | 72 | 161 | 76 | 85 | -1 | 74 |
| Ziaire Williams | PF | 81 | 185 | 82.25196850393701 | 35 | -1 | 68 |

### position-body outlier（|height z|+|wingspan z| ≥ 4）

| name | pos | H(in) | W(lb) | WS(in) | Int | residual | OVR |
|---|---|---|---|---|---|---|---|
| Haywood Highsmith | PF | 77 | 220 | 80.85039370078741 | 30 | -3 | 65 |
| Victor Wembanyama | C | 88 | 210 | 96 | 98 | +3 | 84 |
| Anderson Varejao | C | 79 | 230 | 82.67716535433071 | 25 | -2 | 72 |
| Giannis Antetokounmpo | SF | 84 | 205 | 88 | 25 | +2 | 77 |
| J.J. Barea | PG | 70 | 185 | 70.75196850393701 | 70 | +1 | 73 |

## 4. Matched comparison（属性相似、体型差异大）

方法：对每对球员计算 attribute vector 距离（34 维欧氏）与体型差异（|Δheight|+|Δwingspan| 归一化），
筛选 attribute 距离小（同 position 前 20%）但体型差异大的对；比较 Intangibles / residual。

| 对 | pos | 高个 | 矮个 | Δattr | Δbody(in) | Int 高个 | Int 矮个 | residual 高个 | residual 矮个 | 谁 Int/res 更高 |
|---|---|---|---|---|---|---|---|---|---|---|
| Zach Edey vs Drew Eubanks | C | 89" | 82" | 68.9 | 18 | 60 | 50 | -1 | -1 | Int: 高个 · Res: 平 |
| Ben Saraf vs Travis Diener | PG | 81" | 73" | 57.5 | 17 | 45 | 80 | +0 | +0 | Int: 矮个 · Res: 平 |
| Jordan Clarkson vs J.J. Barea | PG | 77" | 70" | 65.1 | 16 | 80 | 70 | +1 | +1 | Int: 高个 · Res: 平 |
| Donovan Clingan vs Anderson Varejao | C | 87" | 79" | 75.8 | 16 | 50 | 25 | +1 | -2 | Int: 高个 · Res: 高个 |
| Ben Saraf vs Darius Garland | PG | 81" | 73" | 61.0 | 16 | 45 | 25 | +0 | +0 | Int: 高个 · Res: 平 |
| Zach Edey vs Isaiah Stewart | C | 89" | 80" | 65.4 | 16 | 60 | 80 | -1 | +1 | Int: 矮个 · Res: 矮个 |
| Micah Peavy vs Cedric Coward | SG | 82" | 77" | 59.7 | 15 | 40 | 45 | -1 | -2 | Int: 矮个 · Res: 高个 |
| Nicolas Batum vs Monta Ellis | SG | 80" | 75" | 60.9 | 15 | 55 | 55 | +1 | +0 | Int: 平 · Res: 高个 |
| Kon Knueppel vs Robert Dillingham | SG | 82" | 74" | 61.8 | 15 | 60 | 60 | +3 | +0 | Int: 平 · Res: 高个 |
| P.J. Washington vs Dillon Brooks | SF | 82" | 78" | 61.1 | 12 | 75 | 75 | +1 | +1 | Int: 平 · Res: 平 |
| Kyle Anderson vs Sviatoslav Mykhailiuk | SF | 81" | 79" | 52.7 | 12 | 70 | 65 | -1 | +2 | Int: 高个 · Res: 矮个 |
| James Jones vs Max Strus | SF | 80" | 77" | 54.7 | 12 | 60 | 45 | +0 | +0 | Int: 高个 · Res: 平 |
| Leonard Miller vs Haywood Highsmith | PF | 83" | 77" | 68.6 | 11 | 50 | 30 | -1 | -3 | Int: 高个 · Res: 高个 |
| Santi Aldama vs David West | PF | 84" | 81" | 68.5 | 11 | 45 | 40 | -1 | -2 | Int: 高个 · Res: 高个 |
| Santi Aldama vs Adama Sanogo | PF | 84" | 81" | 63.2 | 11 | 45 | 50 | -1 | -1 | Int: 矮个 · Res: 平 |

## 5. 结论

（结论由审阅者根据上表数据给出——脚本仅输出事实）