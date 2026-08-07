# 2K26-spinner DB2KEditor 数据扒取工程 — Agent 执行文档（含用户配合协议）

> 受众：Windows 本机上的 AI agent。本文件是唯一任务说明，按 STEP 顺序执行。
> 每个 STEP 有：动作 / 验证点（V）/ 失败分支（F）/ **用户配合点（U）**。
> 工作目录统一 `D:\2K26Export\`。全程游戏离线 + 关 EAC；只导出，禁止写入游戏。
>
> **Agent 核心职责：能自动的全自动；不能自动的，清晰、礼貌地请求用户配合，并给出用户需要做的精确操作。不要让用户猜。**

---

## 任务背景

2k26-spinner（Mac 端 React 应用，https://2k26-spinner.vercel.app）需要 **2K26 MyNBA 历史选秀届**的真实球员数据（属性 + 徽章 + 倾向 + FaceID + 潜力 + 耐久），用于生成新秀卡。

**首选工具：DB2K Editor（discobisco/2k26-Editor）**。已审计（commit fb3ab613，2026-07-20）：内置 **Draft Class snapshot 导出路径**，可序列化 546 个字段（其中 450 个是直接 Draft Class 记录字段，覆盖 Vitals 70 / Gear 88 / Attributes 52 / Tendencies 112 / Signature 52 / Contract 20 / Badges 56；Stats 96 字段走错记录路径，**不可信，必须忽略**，包括其中的 Overall）。

**关键限制（审计结论，必须遵守）：**
1. **Draft Class 没有可靠的官方 OVR 字段** —— 唯一的 `Overall` 在不可信的 Stats 段里。新秀卡综评必须通过游戏内 UI 人工查看/OCR 获取，不能从 JSON 里读。
2. **徽章是 3-bit 整数，无 value_mapping** —— 数字层级顺序未经验证，必须用 2018 Luka 的可见徽章校准 `0..n → None/Bronze/Silver/Gold/HOF/Legendary`，不许臆测顺序。
3. **offset 是 build-dated 2026-06-24**，未做运行时版本校验 —— 若游戏更新后数值明显错乱，立即停止并回报，改用 2KVenueLab 交叉验证。
4. **工具请求 PROCESS_ALL_ACCESS 且有写入路径** —— 本任务只用只读导出；**绝对不执行任何 apply/write 操作**。
5. **只接受官方来源**：DB2K Editor 从 https://github.com/discobisco/2k26-Editor 获取；2KVenueLab 从 NLSC 论坛获取。禁止从其他渠道下载。
6. **不联网使用内存工具、不碰 EAC 在线模式。**

**备选/交叉验证工具：2KVenueLab v2.15**（NLSC，作者 SexCurryBeats）。若 DB2K 导出失败或字段错乱，按 `docs/2kvenuelab-agent-guide.md`（Mac 仓库内已有）执行 VenueLab 方案。**两工具结果冲突时，以游戏内 UI + 截图为准。**

---

## 用户配合协议（Agent 必须先读）

本任务有多个环节**必须由用户手动完成**（游戏导航 / 安装路径确认 / 文件传输）。Agent 的职责是：
1. 自己先做完所有能自动的步骤（克隆、依赖、启动、校验）
2. 到用户配合点时，**停下来**，用下方的「请求话术模板」输出给用户
3. 用户确认完成后，继续执行，并验证结果（**不要假设用户做对了**）

**用户配合点总览：**

| 编号 | 配合点 | 所属步骤 | Agent 能自动吗 |
|---|---|---|---|
| U1 | 确认 NBA 2K26 安装路径 | STEP 0 | 否（路径不确定，无法可靠猜测） |
| U2 | 游戏启动（离线+关EAC） | STEP 2 | 否（agent 无游戏内控制） |
| U3 | 游戏内导航到 2018 选秀届 | STEP 2 | 否（全屏游戏无 UI 树） |
| U4 | 导出文件传回 Mac | STEP 7 | 否（跨机器） |
| U5 | 2K26 游戏版本号确认 | STEP 0 | 否（主菜单角标，agent 看不到） |

**请求话术模板（Agent 必须按此格式输出，中文）：**

```
【需要你配合】
步骤：<STEP 编号> / <U 编号>
原因：<一句话说明为什么 agent 做不了>
请你做：<精确操作清单，1. 2. 3.>
完成后回复我：「<完成信号>」
```

示例（U3）：

```
【需要你配合】
步骤：STEP 2 / U3
原因：2K26 是全屏游戏，我无法读取游戏画面或点击游戏内菜单。
请你做：
1. 启动 NBA 2K26（选择无 EAC / 离线模式启动）
2. 进入 MyNBA → 联盟设置 → 历史选秀届
3. 选择「2018」届，停留在该届球员名单页面
4. 不要关闭游戏，回到这里告诉我
完成后回复我：「已就位」
```

---

## 环境信息（回报时原样带上）

- Windows 版本：`cmd /c ver`
- NBA 2K26 安装路径：**用户提供，不假设默认路径**（用户明确说过安装文件夹不一定在 C 盘）
- 游戏版本号：主菜单角标（U5 向用户索取）
- Python：`python --version`（DB2K 需要 3.11+）

---

## STEP 0 — 准备目录与获取环境信息

```powershell
New-Item -ItemType Directory -Force -Path D:\2K26Export | Out-Null
cmd /c ver
python --version
```

**U1（安装路径）+ U5（游戏版本号）**：按模板请求用户：

```
【需要你配合】
步骤：STEP 0 / U1 + U5
原因：2K26 的安装位置每个电脑不一样，我不能靠猜；游戏版本号在主菜单角标，我读不到。
请你做：
1. 告诉我 NBA 2K26 的完整安装路径（例如 D:\SteamLibrary\steamapps\common\NBA 2K26 或 E:\Games\NBA 2K26）
2. 启动游戏后告诉我主菜单上的版本号/补丁号
完成后回复我：「已提供」
```

**V0**：`D:\2K26Export` 存在；拿到安装路径和版本号。
**F0**：记录错误输出，回报。

---

## STEP 1 — 获取 DB2K Editor

优先尝试自动克隆：

```powershell
cd D:\2K26Export
git clone https://github.com/discobisco/2k26-Editor.git
cd 2k26-Editor
pip install -r requirements.txt
```

**V1**：目录存在，`python -c "import 2keditor"` 成功（或等价验证）。
**F1（克隆失败/网络问题）**：回报错误；必要时请求用户手动下载 zip 到 `D:\2K26Export\`，回复「已下载」。

**验证工具版本**：记录 `git rev-parse HEAD`（应为或接近审计过的 `fb3ab613`；**不是该 commit 则先提示用户可能未审计，再继续**，因为后续版本字段可能不同）。

---

## STEP 2 — 游戏侧准备（用户配合步骤）

**U2 + U3（必须用户手动，agent 无游戏内控制能力）**：按模板请求用户完成（见上文示例）。

用户回复后，agent 验证：
- `Get-Process -Name NBA2K26 -ErrorAction SilentlyContinue`（游戏进程在）
- 游戏是否真的在选秀届页面：无法直接验证 → **向用户确认一次**「请在游戏里确认当前停留在 2018 选秀届名单页面」；用户再次确认后继续

**V2**：游戏进程存活 + 用户两次确认（就位 + 页面确认）。
**F2**：进程不在 → 提醒用户启动游戏；仍失败回报。

---

## STEP 3 — 导出 2018 届 Draft Class 数据（DB2K Editor）

优先尝试 **headless 导出**。仓库已有 `EditorDataModel.attach()` + `export_player_roster_snapshot_for_items()` 路径；Draft Class 模式通过 `player_items_for_team_filter("Draft Class")` 或 `PLAYER_ROSTER_EXPORT_MODES` 选择。**只允许只读导出，禁止调用 apply/write 路径。**

```powershell
cd D:\2K26Export\2k26-Editor
python -m 2keditor.entrypoints.gui --export-draft-class --year 2018 --output "D:\2K26Export\2018_roster_snapshot.json" --manifest
```

（若该 CLI 参数不存在，改用仓库现有导出入口：`export_player_roster_snapshot_for_items` 的 Python 调用脚本，输出同格式 JSON + manifest。**不要为了跑通而改动仓库源码的写入路径。**）

**如果 headless 不可行，请求用户 GUI 配合（U6）：**

```
【需要你配合】
步骤：STEP 3 / U6
原因：DB2K Editor 的 GUI 导出按钮需要手动点击。
请你做：
1. 打开 DB2K Editor（D:\2K26Export\2k26-Editor 内启动入口）
2. 选择 Draft Class 模式，目标 2018 届
3. 点击导出/快照按钮，保存为 D:\2K26Export\2018_roster_snapshot.json
完成后回复我：「已导出」
```

**V3**：文件存在且 >0 字节。
**F3a（命令失败）**：记录错误；尝试 GUI 路径（U6）。
**F3b（文件存在但内容异常）**：解析 JSON，检查 `records` 数量（150 左右）与字段结构；异常则回报。

---

## STEP 4 — 数据自动校验（agent 独立完成）

```powershell
Get-Item D:\2K26Export\2018_roster_snapshot.json | Select-Object Name, Length
Get-Content D:\2K26Export\2018_roster_snapshot.json -Raw | ConvertFrom-Json | Select-Object record_count, mode
```

**V4 检查表（逐项记录，进回报）：**

| 检查 | 通过标准 | 失败处理 |
|---|---|---|
| 文件非空 | >0 字节 | 重做 STEP 3 |
| JSON 可解析 | ConvertFrom-Json 成功 | 记录错误 |
| 东契奇存在 | 搜 "Doncic" 有行 | 届可能不对，回报 |
| 属性段有值 | Attributes/ 下有数值 | 记录 |
| 徽章段 | Badges/ 有 3-bit 数值 | 空 → 记 "badges: empty" |
| 倾向段 | Tendencies/ 有值 | 空 → 记 "tendencies: empty" |
| FaceID/PortraitID | Vitals/ 有值 | 空 → 记 "identity: empty" |
| 潜力段 | Potential 有值 | 空 → 记 "potential: empty" |

**不要从该 JSON 读取 Overall**（Stats/Overall 不可信，见任务背景第 1 条）。

东契奇行提取（PowerShell 中搜索任意包含 Doncic 的字段）：

```powershell
Get-Content D:\2K26Export\2018_roster_snapshot.json -Raw | Select-String -Pattern "Doncic"
```

**F4（徽章/倾向等段空）**：记录，不阻塞 —— 空段可在 Mac 侧用降档算法回退。**F4b（字段值明显错乱，如属性 0-99 范围外）**：停止，回报，怀疑 offset 与游戏 build 不匹配，改用 2KVenueLab 交叉验证。

---

## STEP 5 — 2018 Luka 人工验证（用户配合）

**这是整个流程的验收闸门。** 未经此验证不得批量采其他届。

**U7（Luka 卡片数值）**：请求用户：

```
【需要你配合】
步骤：STEP 5 / U7
原因：游戏内 UI 是唯一权威；我需要真实卡片数据来校验 JSON 导出的准确性。
请你做：
1. 在游戏 2018 届里打开 Luka Doncic 的新秀卡
2. 把以下数值告诉我（截图也可以）：
   - 综评 Overall
   - 中投 Mid-Range、三分 Three-Point
   - 3-5 个徽章名称和等级（如 Dimer 铜）
   - 任意 3 个倾向数值（如三分出手倾向、控球倾向）
完成后回复我：「已提供」
```

**V5**：拿到 Luka 数值后，agent 逐字段对比 JSON：
- 属性：差异 ≤ 2 视为通过（注意 JSON 属性名可能有别名映射）
- 徽章：校准 `0..n → None/Bronze/Silver/Gold/HOF/Legendary` 的顺序（用可见徽章反推；顺序不确定时记 "badge_tier_map: unverified"）
- 倾向：差异 ≤ 5 视为通过
- Overall：**只来自用户提供值**，写入输出，来源标记 `ui-confirmed`

**F5（大范围不一致）**：停止，回报差异表，改用 2KVenueLab 或 OCR 方案，不批量导出。

---

## STEP 6 — 转换输出（Mac 侧，SSH 可选）

导出文件需转成 `rookieCards/2018/{slug}.json`（schema 见 Mac 仓库 `references/rookie-card-schema.md`）。

**方式 A（推荐，若 Windows Hermes 配了 SSH terminal backend 到 Mac）：**
```powershell
# 直接把文件推到 Mac（若已配置 SSH）
scp D:\2K26Export\2018_roster_snapshot.json yangzonghan@<MAC_IP>:/Users/yangzonghan/Projects/Personal/2k26-spinner/data/raw/db2k/2018_roster_snapshot.json
```
Mac 侧转换脚本（由 Mac 端 Hermes 执行，不在本 Windows 任务范围）：`scripts/convert-db2k-to-rookiecard.py --input ... --output rookieCards/2018/ --validate`。

**方式 B（无 SSH）：U4 文件传输** —— 按模板请求用户：

```
【需要你配合】
步骤：STEP 6 / U4
原因：文件在 Windows 上，需要转给 Mac 端处理。
请你做：
1. 把 D:\2K26Export\2018_roster_snapshot.json 传到 Mac（微信/网盘/U 盘均可）
2. 放到 /Users/yangzonghan/Projects/Personal/2k26-spinner/data/raw/db2k/ 下
完成后回复我：「已传」
```

**V6**：文件已在 Mac 端目标路径（若 agent 能看到则验证；看不到就靠用户确认 + 文件大小核对）。

---

## STEP 7 — 回报（最终输出，严格按此模板）

```
## DB2K Editor 采集回报
- Windows: <版本>
- 游戏版本: <版本号>
- DB2K Editor commit: <git rev-parse HEAD>
- 安装路径: <用户提供的路径>
- 导出文件: D:\2K26Export\2018_roster_snapshot.json (字节数)
- record_count: <N>
- 东契奇: 找到/未找到; 中投=<值> 三分=<值> 综评=<UI 确认值>
- 徽章段: 有值 / 空; tier 映射: 已校准 / unverified
- 倾向段: 有值 / 空
- FaceID/PortraitID: 有值 / 空
- 潜力段: 有值 / 空
- 用户配合记录: U1-U7 哪些完成，哪些跳过
- 阻塞点: 无 / <描述>
```

---

## Agent 行为总则（最终检查）

1. ✅ 每步先做验证，再进下一步
2. ✅ 用户配合点用模板请求，给精确操作，不模糊
3. ✅ 用户确认后**重新验证**，不假设成功
4. ✅ 安装路径等环境信息问用户，**不猜默认值**
5. ❌ 不下载非官方来源的工具（DB2K=GitHub 官方仓库；VenueLab=NLSC）
6. ❌ 不做任何游戏写入/编辑操作（只导出）
7. ❌ 不联网使用内存工具、不碰 EAC 在线模式
8. ❌ 不把 Stats 段（含 Overall）当可信数据
9. ✅ 遇到文档未覆盖的问题：回报 + 截图

---

## 阻塞处理汇总

| 阻塞 | 处理 |
|---|---|
| 安装路径未知 | U1：直接问用户，不猜 |
| 游戏版本号未知 | U5：问用户主菜单角标 |
| DB2K 克隆失败 | F1：回报，或用户手动下载 zip |
| 游戏未启动/未就位 | U2+U3：用户手动导航，两次确认 |
| headless 导出失败 | F3a：转 GUI（U6） |
| 导出空文件 | 重做 STEP 3 |
| 徽章/倾向段空 | 记录回报（不阻塞，Mac 侧回退降档算法） |
| 字段值错乱 | F4b：停止，怀疑 offset 不匹配，改用 2KVenueLab |
| Luka 校验不一致 | F5：停止，回报差异表，不批量 |
| 传文件 | U4：用户手动传（或 SSH 直连） |
| 其他 | 回报 + 截图 |

---

## 参考（Mac 仓库内，供 Mac 侧处理时使用）

- `references/2k26-tool-evaluation.md` — DB2K Editor 完整代码审计
- `references/rookie-card-schema.md` — 输出 JSON schema
- `references/2kvenuelab-data-coverage.md` — VenueLab 覆盖对比
- `docs/2kvenuelab-agent-guide.md` — VenueLab 备选方案完整执行文档
- `references/dna-export-and-presentation-strategy.md` — 字段覆盖与 DNA 导出策略
