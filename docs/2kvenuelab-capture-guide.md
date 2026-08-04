# 2KVenueLab 采集 2K26 官方历史选秀数据 — 操作文档

> 目的：从 2K26 MyNBA **官方历史选秀届**（不导入自定义名单）批量导出球员属性/徽章/倾向，
> 生成 CSV/JSON，供 2k26-spinner 转成 `rookieCards` 数据库。
>
> 适用：Windows PC 本机，已装 NBA 2K26 PC 版。
> 状态：v2026-08-01，对应 2KVenueLab v2.15。

---

## 0. 先理解整个流程（30 秒版）

```
Windows 上：
  装 2KVenueLab（免费工具）→ 游戏开离线+关EAC → 进 MyNBA 官方某年选秀届
  → VenueLab 连接游戏内存 → 导出 CSV/JSON → 拷回 Mac/发给 Hermes
Mac 上：
  转成 rookieCards JSON → 生成器直填
```

**为什么不用导入 03-25 自定义选秀名单**：官方 MyNBA 历史选秀届直接就有
2003–2025 每年名单，更权威，不需要导入。

---

## 1. 前置条件检查（先确认，缺一个都跑不通）

| 条件 | 要求 | 怎么查 |
|---|---|---|
| 系统 | Windows 10 / 11 x64 | 设置 → 系统 → 关于 |
| 游戏 | NBA 2K26 **PC 版**（Steam） | — |
| 联网 | 下载工具时需要；**采集时游戏必须离线** | — |
| Edge WebView2 Runtime | 安装 VenueLab 时 Windows 会提示，按提示装 | 没有会白屏 |
| NLSC 论坛账号 | 下载需要登录（免费注册） | 见 §2 |

> ⚠️ 采集全程游戏保持**离线模式 + Easy Anti-Cheat 关闭**。
> VenueLab 检测到 EAC 活跃时会自动阻止内存连接（这是它自带的安全机制）。

---

## 2. 下载 2KVenueLab（唯一官方渠道）

工具作者：SexCurryBeats（NLSC 论坛，2026-05-07 发布，v2.15 活跃维护中）

**下载地址（二选一，同一个包）：**

1. NLSC 下载库（推荐，直接下载）：
   ```
   https://forums.nba-live.com/downloads.php?view=detail&df_id=13923
   ```
2. 论坛原帖（看更新日志/常见问题）：
   ```
   https://forums.nba-live.com/viewtopic.php?t=117401
   ```

**首次下载需要 NLSC 账号**（免费）：

1. 打开 https://forums.nba-live.com → 右上角 Register（注册）
2. 注册时建议勾选接收邮件确认，激活账号
3. 登录后回到下载页 → 点 Download → 拿到 `2KVenueLab_xxx.zip`（约几十 MB）

> ⚠️ 只从上述 NLSC 官方渠道下载。其他地方（百度网盘、公众号、QQ 群分享）的
> VenueLab 包一律不用——论坛里已有用户报告过带木马的"修改版"。

---

## 3. 安装

```
1. 解压 2KVenueLab_xxx.zip 到独立文件夹，例如  D:\2KVenueLab\
   （不要直接在 zip 里运行，不要把 VenueLab.exe 单独拷出来）
2. 双击 VenueLab.exe 启动
3. 如果提示缺少 WebView2 Runtime → 按提示安装（微软官方）
4. 首次启动可能较慢（IFF 预览引擎初始化）
```

**验证安装成功**：窗口打开，顶部有 Game Folders / Roster Editor 等标签页。

---

## 4. 游戏侧准备（每次采集前都要做）

```
1. 启动 NBA 2K26
2. 进入设置 → 关闭 Easy Anti-Cheat / 选择"无加密启动"（或 Steam 启动项加 -eac_launcher 跳过）
   具体入口以 2K26 实际版本为准：游戏启动器里选"Offline / No EAC"模式
3. 全程断网或 Steam 离线模式
4. 进入 MyNBA → 新建/读取一个联盟 → 打开历史选秀届（见 §5）
```

> ⚠️ 如果游戏提示"无法连接服务器/需要登录"，正常，离线模式就是这样的。
> 只要单机 MyNBA 能进就行。

---

## 5. 进入官方历史选秀届

```
MyNBA → 赛季设置 / 联盟设置 → 选秀（Draft）相关菜单
→ 找到「历史选秀届 / Historic Draft Classes」列表
→ 选择你要采集的年份（如 2018）
→ 打开该届名单（显示该年全部参选球员）
```

**你想要的球员在这届里的卡片 = 官方新秀卡**（属性/徽章/倾向都是当年入联盟的数值）。

> 每届名单里会混有 **2K 自动生成的边缘球员**（随机名字、无真实对应）。
> 过滤方法见 §8，不需要现在手动挑。

---

## 6. VenueLab 连接与导出（核心步骤）

### 6.1 连接

```
1. 游戏停留在「2018 选秀届名单」页面（或该届任意球员详情页）
2. 打开 VenueLab → Roster Editor 标签
3. 确认目标游戏选的是 NBA 2K26
4. 点 Auto Quick Connect（自动连接）
   - 如果球员列表正确出现 → 成功
   - 如果列表是空的/旧名单 → 点 Connect / Rebuild
   - 如果还不行（自定义/MyNBA 特殊结构）→ 点 Deep Scan（慢，耐心等）
```

**成功标志**：左侧出现球队列表，选中 2018 届后出现球员列表，点击球员能加载详情。

### 6.2 导出

```
Roster Editor → 找到 Export / Reports 区域
→ Export roster catalog（导出球员目录）
→ 格式选 CSV 或 JSON（我们两个都要一份，CSV 方便人工看，JSON 方便程序处理）
→ 选择导出位置（建议新建  D:\2K26Export\）
```

**每个年份导一次**，文件按年份命名，例如：

```
D:\2K26Export\
  2018_roster_catalog.csv
  2018_roster_catalog.json
  2003_roster_catalog.csv
  ...
```

### 6.3 补充：单独导出某个球员的完整数据

如果 catalog 里徽章/倾向列是空的（见 §9 验证），改用逐球员方式：

```
球员列表 → 选中目标球员 → 等详情加载 → 打开各标签页
（Attributes / Badges / Tendencies / 等）
→ 每个标签页有 Export / 复制按钮 → 逐个存
```

> 这种方式慢（每人点好几下），只用于 catalog 缺失字段时补关键球员。

---

## 7. 导出文件长什么样（预期格式）

**CSV（roster catalog）预期列：**

```
player_id, first_name, last_name, team, position, overall,
height, weight, wingspan, face_id, portrait_id,
close_shot, mid_range, three_pt, free_throw, ... (全部属性列),
badges (可能为空), tendencies (可能为空)
```

**JSON 预期结构（类似）：**

```json
{
  "players": [
    {
      "playerId": 12345,
      "firstName": "Luka",
      "lastName": "Doncic",
      "team": "DraftClass2018",
      "position": "PG",
      "attributes": { "MidRangeShot": 78, "ThreePointShot": 74 },
      "badges": [],
      "tendencies": {}
    }
  ]
}
```

> 实际列名/嵌套以导出结果为准，可能略有出入。
> **拿到文件后原样发我，我来做字段映射和清洗，不需要你手动整理。**

---

## 8. 自动生成球员的过滤（导出后自动处理，这里说明方法）

导出的名单里混着真实球员 + 2K 生成球员，按以下优先级过滤：

| 层级 | 方法 | 说明 |
|---|---|---|
| 1 | **真实选秀名单白名单** | 用该年 NBA 真实被选中球员名单（60 人）做匹配，能匹配上的保留。这是核心过滤。 |
| 2 | FaceID 有效性 | 真实历史球员有官方 FaceID/PortraitID；纯生成球员通常没有或为占位值。辅助过滤。 |
| 3 | 与现有 players.json 对照 | 能映射到已知 slug 的保留；映射不到但 FaceID 有效的 → 人工复核。 |

**你不需要在游戏里手动挑人**——导出全量，清洗在转换时自动做。

---

## 9. 重要验证（做完第一年先验一次，再批量）

**用 2018 届 + 东契奇做验证**，检查导出数据质量：

| 检查项 | 期望 | 不满足怎么办 |
|---|---|---|
| 东契奇属性齐全 | 中投/三分/控球等有值且明显低于现役（中投 ~70-80 区间） | 属性都没拿到 → 工具对 2K26 不成熟，见 §10 阻塞处理 |
| 徽章列有值 | 有 1-5 个铜/银徽章（不是 HOF 一堆） | 徽章为空 → 用 §6.3 逐球员导出补；还是空 → 徽章回退到现有降档算法 |
| 倾向列有值 | 有数值（如投篮倾向 40-70） | 倾向为空 → 先不采倾向，属性先行 |
| 生成球员可区分 | 边缘球员 FaceID 为空/白名单外 | 清洗时处理，不阻塞 |

**通过后**再批量导出其余年份（2003、2009、2011、2014、2019、2020、2023、2025…优先你们生成器高频年份）。

---

## 10. 遇到阻塞怎么办（故障排查表）

| 症状 | 原因 | 处理 |
|---|---|---|
| 下载需要登录 | NLSC 要求注册 | §2 注册流程，免费 |
| VenueLab 打开白屏 | 缺 WebView2 Runtime | 装微软 WebView2 Runtime 后重启 |
| 游戏已开但连接失败 | 游戏没停留在 roster 页面 / 目录过期 | 回到选秀届页面 → Connect / Rebuild |
| Connect/Rebuild 也找不到 | MyNBA 特殊结构 | Deep Scan（会慢，等它跑完） |
| 提示 EAC / 拒绝连接 | EAC 没关或游戏在联网 | 关 EAC、离线模式重启游戏，再连 |
| 导出 CSV 是空的 | 没选中正确 roster / 没加载球员 | 确认左侧球员列表有内容后再导出 |
| 某年导出内容明显不对 | 游戏内没停在该年选秀届 | 回游戏切到正确年份 → Rebuild → 重新导出 |
| 属性有但徽章/倾向空 | 2K26 这两块映射未完全解锁（作者明说 NOT FULLY UNLOCKED） | §6.3 逐球员导出；仍空 → 徽章/倾向用现有降档算法，属性用真实数据 |
| 工具崩溃/无响应 | Beta 版稳定性问题 | 备份后重开；等作者更新（帖子有更新日志） |
| 其他奇怪问题 | — | 先查原帖 https://forums.nba-live.com/viewtopic.php?t=117401 的更新日志和回帖，再不行把错误截图发我 |

---

## 11. 安全注意事项（重要）

- ✅ 只用 NLSC 官方下载，**不要用任何"汉化/破解/整合版"**
- ✅ 只做**导出（只读）**，不做任何写入/编辑操作——我们不需要改游戏
- ✅ 游戏保持**离线 + 关 EAC**，绝不在联网状态连内存工具
- ✅ 导出前可点 **Backup Saves**（工具自带备份），防手滑
- ✅ VenueLab 检测到 EAC 会自行阻止连接——这是正常安全行为
- ⚠️ 我们只导出官方选秀届的数据用于个人项目，不涉及任何修改器功能

---

## 12. 交付物清单（做完给我这些）

```
1. 至少一年的导出文件（建议先 2018）：
   D:\2K26Export\2018_roster_catalog.csv
   D:\2K26Export\2018_roster_catalog.json
2. 告诉我：
   - 游戏版本号（主菜单角标或设置里）
   - 徽章列/倾向列是否有值（看一眼 CSV 就行）
   - 东契奇那行整体评分大概多少（验证用）
```

拿到后我在 Mac 侧：字段映射 → 自动生成球员过滤 → 转 `rookieCards/{slug}.json` →
接入 `src/domain.ts` 直填路径 → 校验（新秀中投 < 现役）。

---

## 13. 如果 VenueLab 这条路走不通（备选）

| 情况 | 备选 |
|---|---|
| VenueLab 对 2K26 徽章/倾向完全不支持 | 属性用 VenueLab，徽章/倾向保持现有降档算法 |
| VenueLab 连接 MyNBA 选秀届失败且 Deep Scan 无效 | 用游戏内截图 + OCR 方案（已有计划） |
| 工具本身有严重问题 | 社区还有 Sync Editor / Immerse（同为内存工具），但口碑和活跃度不如 VenueLab，最后再考虑 |
