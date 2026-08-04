# 2KVenueLab 采集 2K26 官方历史选秀数据 — Agent 执行文档（含用户配合协议）

> 受众：Windows 本机上的 AI agent。本文件是唯一任务说明，按 STEP 顺序执行。
> 每个 STEP 有：动作 / 验证点（V）/ 失败分支（F）/ **用户配合点（U）**。
> 工作目录统一 `D:\2K26Export\`。全程游戏离线 + 关 EAC；只导出，禁止写入游戏。
>
> **Agent 核心职责：能自动的全自动；不能自动的，清晰、礼貌地请求用户配合，并给出用户需要做的精确操作。不要让用户猜。**

---

## 用户配合协议（Agent 必须先读）

本任务有 4 个环节**必须由用户手动完成**（GUI 游戏导航 / 账号登录 / 文件传输）。Agent 的职责是：
1. 自己先做完所有能自动的步骤（下载、解压、安装、启动、校验）
2. 到用户配合点时，**停下来**，用下方的「请求话术模板」输出给用户
3. 用户确认完成后，继续执行，并验证结果（不要假设用户做对了）

**用户配合点总览：**

| 编号 | 配合点 | 所属步骤 | Agent 能自动吗 |
|---|---|---|---|
| U1 | NLSC 账号登录/下载工具 | STEP 1 | 否（除非用户提供凭证） |
| U2 | 游戏启动（离线+关EAC） | STEP 4 | 否（agent 无游戏内控制） |
| U3 | 游戏内导航到 2018 选秀届 | STEP 4 | 否（全屏游戏无 UI 树） |
| U4 | 导出文件传回 Mac | STEP 8 | 否（跨机器） |

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
步骤：STEP 4 / U3
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
- NBA 2K26 安装路径：默认 `C:\Program Files (x86)\Steam\steamapps\common\NBA 2K26`（不同则记录）
- 游戏版本号：主菜单角标

---

## STEP 0 — 准备目录与检查前置

```powershell
New-Item -ItemType Directory -Force -Path D:\2K26Export | Out-Null
Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty pv
```

**V0**：目录存在；WebView2 输出版本号或为空（空则 STEP 2 装）。
**F0**：记录错误输出，回报。

---

## STEP 1 — 下载 2KVenueLab

官方源（唯一）：NLSC 论坛，作者 SexCurryBeats，v2.15
- 帖子：`https://forums.nba-live.com/viewtopic.php?t=117401`
- 下载页：`https://forums.nba-live.com/downloads.php?view=detail&df_id=13923`

**先尝试自动下载**（需要能登录）：

```powershell
Invoke-WebRequest -Uri "<下载直链>" -OutFile D:\2K26Export\2KVenueLab.zip
```

**U1（下载需要登录）**：按模板请求用户二选一：
- 选项 A：用户提供 NLSC 账号（agent 登录后下载；**提示用户：登录后尽快改密码**）
- 选项 B：用户手动下载 `2KVenueLab.zip` 到 `D:\2K26Export\`，回复「已下载」

**F1（不是官方 zip / 来源可疑）**：停止，回报。**禁止从非 NLSC 渠道下载。**

下载就位后：

```powershell
Expand-Archive -Path D:\2K26Export\2KVenueLab.zip -DestinationPath D:\2K26Export\2KVenueLab -Force
Get-ChildItem D:\2K26Export\2KVenueLab -Recurse -Filter VenueLab.exe | Select-Object FullName
```

**V1**：`VenueLab.exe` 存在。**F1b**：列目录，判断嵌套，调整解压路径。

---

## STEP 2 — 安装 WebView2 Runtime（如 STEP 0 为空）

```powershell
Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile D:\2K26Export\WebView2Setup.exe
Start-Process -FilePath D:\2K26Export\WebView2Setup.exe -ArgumentList "/silent /install" -Wait
```

**V2**：重跑 STEP 0 检测命令有版本号。

---

## STEP 3 — 启动 2KVenueLab

```powershell
Start-Process -FilePath "D:\2K26Export\2KVenueLab\VenueLab.exe"
Start-Sleep -Seconds 15
Get-Process -Name VenueLab -ErrorAction SilentlyContinue | Select-Object Id, ProcessName
```

**V3**：进程存活。**F3**：重装 WebView2；记录退出信息回报。

---

## STEP 4 — 游戏侧准备（用户配合步骤）

**U2 + U3（必须用户手动，agent 无游戏内控制能力）**：按模板请求用户完成：

```
1. 启动 NBA 2K26，选择「无 EAC / 离线」模式（Steam 离线或启动器选项）
2. 进入 MyNBA → 历史选秀届 → 打开 2018 届
3. 停留在该届名单页面，不要关闭游戏
完成后回复：「已就位」
```

用户回复后，agent 验证：
- `Get-Process -Name NBA2K26 -ErrorAction SilentlyContinue`（游戏进程在）
- 游戏是否真的在选秀届页面：无法直接验证 → **向用户确认一次**「请在游戏里确认当前停留在 2018 选秀届名单页面」；用户再次确认后继续

**V4**：游戏进程存活 + 用户两次确认（就位 + 页面确认）。

---

## STEP 5 — VenueLab 连接（agent 用 computer_use / GUI 自动化执行）

**若 agent 有 GUI 自动化能力（Hermes computer_use / pyautogui / UI Automation）：**

1. `capture` 定位 VenueLab 窗口 → Roster Editor 标签
2. 确认目标 = NBA 2K26
3. 点 **Auto Quick Connect** → 失败则 **Connect / Rebuild** → 仍失败 **Deep Scan**（等待完成）
4. 验证：球员列表出现（capture 确认）

**若 agent 无 GUI 自动化能力（Codex/Claude Code 类）：**

**U5（点按钮）**：按模板请求用户手动：
```
请你做：
1. 打开 VenueLab 窗口 → 点顶部「Roster Editor」标签
2. 确认游戏目标显示 NBA 2K26
3. 点「Auto Quick Connect」
4. 如果左侧出现球员列表，回复我「已连接」；如果提示失败，回复我「连接失败」
```

**F5（EAC/拒绝连接）**：请求用户关 EAC + 离线重启游戏，重连。仍失败回报截图。

---

## STEP 6 — 导出 CSV + JSON

**GUI 自动化可用**：
1. Roster Editor → Export/Reports → Export roster catalog → 格式 **CSV**
2. 保存 `D:\2K26Export\2018_roster_catalog.csv`
3. 重复导出 **JSON** → `D:\2K26Export\2018_roster_catalog.json`

**无 GUI 自动化**：

**U6**：按模板请求用户手动导出两个文件到上述路径，回复「已导出」。

**V6**：两个文件存在且 >0 字节。**F6**：请求用户确认游戏停留在正确 roster → 重连 → 重导。

---

## STEP 7 — 导出数据自动校验（agent 独立完成）

```powershell
Get-Item D:\2K26Export\2018_roster_catalog.csv, D:\2K26Export\2018_roster_catalog.json | Select-Object Name, Length
Get-Content D:\2K26Export\2018_roster_catalog.csv -TotalCount 2
Get-Content D:\2K26Export\2018_roster_catalog.json -Raw | ConvertFrom-Json | Select-Object -First 1
```

**V7 检查表（逐项记录，进回报）：**

| 检查 | 通过标准 | 失败处理 |
|---|---|---|
| 文件非空 | >0 字节 | 重做 STEP 6 |
| CSV 有列名 | 头部含属性列 | 记录实际列名 |
| JSON 可解析 | ConvertFrom-Json 成功 | 记录错误 |
| 东契奇存在 | 搜 "Doncic" 有行 | 届可能不对，回报 |
| 东契奇属性有值 | 中投/三分列有数值 | 记录 |
| 徽章列 | 有值 / 空 | 空 → 记 "badges: empty" |
| 倾向列 | 有值 / 空 | 空 → 记 "tendencies: empty" |

东契奇行提取：

```powershell
Import-Csv D:\2K26Export\2018_roster_catalog.csv | Where-Object { $_.last_name -match "Doncic" -or $_.Last -match "Doncic" } | Format-List *
```

---

## STEP 8 — 回报与文件传输

**U4（传文件）**：按模板请求用户把两个文件传回 Mac（微信/网盘/U 盘均可），回复「已传」。

**回报模板（agent 最终输出，严格按此）：**

```
## 2KVenueLab 采集回报
- Windows: <版本>
- 游戏版本: <版本号>
- 2KVenueLab: v2.15
- 连接方式: Auto Quick Connect / Rebuild / Deep Scan / 用户手动
- 导出文件:
  - D:\2K26Export\2018_roster_catalog.csv (字节数)
  - D:\2K26Export\2018_roster_catalog.json (字节数)
- CSV 列名: <前 15 个列名>
- 东契奇: 找到/未找到; 中投=<值> 三分=<值> 综评=<值>
- 徽章列: 有值 / 空
- 倾向列: 有值 / 空
- 生成球员可识别: 是 / 否
- 用户配合记录: U1-U6 哪些完成，哪些跳过
- 阻塞点: 无 / <描述>
```

---

## Agent 行为总则（最终检查）

1. ✅ 每步先做验证，再进下一步
2. ✅ 用户配合点用模板请求，给精确操作，不模糊
3. ✅ 用户确认后**重新验证**，不假设成功
4. ❌ 不下载非 NLSC 来源的工具
5. ❌ 不做任何游戏写入/编辑操作（只导出）
6. ❌ 不联网使用内存工具、不碰 EAC 在线模式
7. ✅ 遇到文档未覆盖的问题：回报原帖 https://forums.nba-live.com/viewtopic.php?t=117401 + 截图

## 阻塞处理汇总

| 阻塞 | 处理 |
|---|---|
| NLSC 登录 | U1：用户给凭证或手动下载 |
| WebView2 缺失 | STEP 2 自动 |
| VenueLab 秒退 | 重装 WebView2；回报 |
| 连接失败 | Rebuild → Deep Scan → 回报 |
| EAC 拒绝 | 用户关 EAC + 离线重启 |
| 导出空文件 | 确认 roster → 重连 → 重导 |
| 徽章/倾向列空 | 记录回报（不阻塞，Mac 侧回退降档算法） |
| 无 GUI 自动化 | U5/U6 用户手动，agent 负责其余 |
| 其他 | 原帖 + 截图回报 |
