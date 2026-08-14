# Slot Semantics V2 — Stage 1/2/3 交付报告

日期：2026-08-14
状态：Stage 1/2/3 完成；Stage 4（OVR audit）/Stage 5（V3 ablation）待进行

---

## 1. 修改文件列表

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/slotPresentationProfiles.ts` | **新增** | 权威权重配置（PART B 全部表格），模块加载断言权重 sum==1 |
| `src/slotPresentation.ts` | **新增** | 纯函数 `computeSlotDisplay` / `effectiveWeightsFor` |
| `scripts/test-slot-semantics-v2.mts` | **新增** | 58 项断言（E1 展示、E2/E3 mapping、H1/H2 硬要求回归、浮点边界） |
| `src/createResult.ts` | 修改 | Evaluation 增加 `displayScore`；`adjusted` 语义冻结为 legacy simple-average；`supportIncomplete` 增加 `reasons` 分类 |
| `src/components/tendencyBundleMap.ts` | 修改 | 6 个冻结迁移 + Roll vs Pop unresolved 注释 |
| `src/components/badgeBundleMap.ts` | 修改 | 4 个冻结迁移（2 shared 扩展） |
| `scripts/test-badge-inheritance.mts` | 修改 | Aerial Wizard 迁移后改从 dunk 槽继承 |
| `src/components/RookieBuilder.tsx` | 修改 | 槽位卡片/结果页用 displayScore + provisional ≈ 标记 |
| `src/components/SlotPicker.tsx` | 修改 | 排序/展示用 displayScore + ≈ 标记 |
| `data/raw/slot-mapping.md` / `.json` | 重新生成 | 反映新 ownership |
| `package.json` | 修改 | +`test:slot-semantics-v2`，已挂入 verify |

## 2. 权重配置表（PART B 权威值，全部按 spec 实现）

### 六单原子（100%，全位置相同）
three=Three-Point Shot · perimeter=Perimeter Defense · interior=Interior Defense · block=Block · strength=Strength · potential=Potential

### 五固定权重
| slot | 权重 |
|---|---|
| mid | Mid-Range Shot 0.85 / Free Throw 0.15 |
| passing | Pass Accuracy 0.4 / Pass IQ 0.3 / Pass Vision 0.3 |
| steal | Steal 0.75 / Pass Perception 0.25 |
| rebound | OREB 0.5 / DREB 0.5 |
| stability | Off. Consistency 0.25 / Def. Consistency 0.25 / Shot IQ 0.15 / Help Def. IQ 0.15 / Overall Durability 0.2 |

### 五 position-aware（按 PG/SG/SF/PF/C，全部 sum==1）
- face: Layup 0.50/0.45/0.38/0.28/0.18 · Close Shot 0.15/0.20/0.27/0.37/0.47 · Draw Foul 0.25 恒定 · Hands 0.10 恒定
- post: Post Fade 0.45/0.45/0.40/0.30/0.20 · Post Hook 0.15/0.15/0.20/0.30/0.40 · Post Control 0.40 恒定
- dunk: Driving Dunk 0.85/0.80/0.70/0.55/0.40 · Standing Dunk 0.15/0.20/0.30/0.45/0.60
- handle: Ball Handle 0.60/0.65/0.70/0.75/0.80 · SWB 0.40/0.35/0.30/0.25/0.20
- athletic: Speed 0.32/0.30/0.27/0.23/0.20 · Agility 0.28/0.27/0.25/0.23/0.20 · Vertical 0.15/0.18/0.20/0.24/0.28 · Stamina 0.15/0.15/0.18/0.20/0.22 · Hustle 0.10 恒定

### Secondary 混合（B5）
`effective = 0.75*primary + 0.25*secondary`；secondary 缺失/相同 → 100% primary；固定/单原子槽忽略。

## 3. Tendency mapping before → after

| slot | before | after | 迁移 |
|---|---|---|---|
| face | 15 | **13** | −Alley-Oop, −Putback |
| dunk | 3 | **4** | +Alley-Oop |
| rebound | 1 | **2** | +Putback |
| handle | 21 | **24** | +Iso Elite/Good/Average |
| stability | 6 | **4** | −3×Iso, +Transition Spot Up vs Cut to Basket |
| passing | 5 | **4** | −Transition Spot Up vs Cut to Basket |
| **total** | **96** | **96** | 无丢失/无伪造 |

Roll vs Pop：保持 passing owner（unresolved，代码注释 + 本报告 TODO）。

## 4. Badge mapping before → after

| badge | before | after |
|---|---|---|
| Lightning Launch | athletic | **handle** |
| Aerial Wizard | athletic | **[dunk, rebound]** |
| Immovable Enforcer | interior | **[interior, strength]** |
| Brick Wall | interior | **[interior, strength]** |
| Pogo Stick | block | block（未冻结共享，保持） |

unique badges = **40**（不变）· assignments = **45 → 48**（+3：Aerial +2、Lightning +1、Immovable +1、Brick Wall +1、−athletic 2）
Athletic：attributes 5 项，tendencies 0，badges 0（正确结果，未自动补）。

## 5. 硬要求 #1 — displayScore / OVR fallback 解耦

- `Evaluation.adjusted` 语义冻结为 **legacy simple-average**，是 `createResult` `scores.push(adjusted)` → OVR fallback mean 的唯一输入，**生产 OVR 不变**
- `Evaluation.displayScore` 为 Slot Presentation V2 position-aware 分，仅 UI/SlotPicker 消费
- 回归测试（H1a-g）：dunk adjusted=70 vs displayScore@PG=84；passing adjusted=80 vs displayScore=81；固定槽 position 切换 displayScore/adjusted 均不变；**无任何路径 displayScore 进入 OVR**
- 浏览器实证：Mitchell 扣篮 `74→89`（74=legacy adjusted，89=PG/SG 混合 displayScore），同输入 OVR 计算路径不变

## 6. 硬要求 #2 — supportIncomplete 原因分类

- `SupportIncompleteReason` = `target_context_missing`（单槽缺跨槽 support，可 provisional）| `donor_support_missing` | `donor_context_missing`（源数据缺失，不可提示"完整组合后会自动计算"）
- `parseSupportIncomplete` 从 V2 incomplete 描述串分类；`missing` 保持纯 attr 名兼容契约
- UI 判定：**仅当存在 target_context_missing 且无任何 donor 类原因时**显示 ≈
- 回归测试（H2a-e）：单槽 evaluate → target_context_missing → provisional；无 donor → donor_support_missing → 不可 provisional；完整 DAG（含全部 support 源槽）→ 无 incomplete
- provisional 只改变显示状态，不改变 score 公式（E1.10）

## 7. Presentation acceptance 结果

```
scripts/test-slot-semantics-v2.mts: 58/58 passed, 0 failed
```
覆盖：E1.1-1.10 全部、锚点（Dunk PG 84/SG 82/SF 78/PF 72/C 66、SG/SF secondary 81、Three 90 全位置、Passing 81 全位置）、16 槽全定义、权重 sum==1（1e-12）、浮点边界（89.95→90 epsilon）、E2.1-2.5、E3.1-3.8、H1a-g、H2a-e

## 8. Browser smoke 结果

headless Chrome CDP，自选模式 PG/SG（draft 恢复值）：

| 场景 | 观测 | 判定 |
|---|---|---|
| Mitchell 扣篮 SlotPicker | `槽位主值≈89` + legacy 74（双值显示） | ✅ displayScore 生效（PG/SG 75/25 混合=89.36→89），不再被 50/50 拖低 |
| Mitchell 锁定后槽位 | `多诺万·米切尔 · 74→89` + ≈ | ✅ 锁定后 displayScore 保持，provisional 标记 |
| Jokić 传球（固定槽） | `槽位主值 85`（0.4×85+0.3×85+0.3×84=84.7→85） | ✅ 固定权重生效 |
| console | 无 error/warning | ✅ |

关键插曲（记录）：初测 UI 显示 89 而单元预期 90，排查为 **draft 恢复的 secondaryPosition=SG 触发 B5 混合**（不是 bug）；浮点边界（89.95）epsilon 修复在单元层验证（97×0.85+50×0.15 在 IEEE 754 下为 89.94999…，加 1e-9 后 round=90）。

## 9. verify / build 结果

```
pnpm run verify: exit 0（含 test:slot-semantics-v2 58/58、body-degrade-v2 24/24、adversarial 52/52、全部既有套件）
pnpm run build: PASS
pnpm run check:bundle: Bundle budget OK
```

## 10. Body V2 atomic diff

**0**。Slot Presentation 只读 finalAtomicValues，无任何回写路径；tendency/badge mapping 不参与 atomic 计算（E1.1 断言 + 全链路测试确认）。

## 11. Unresolved TODO

1. `Roll vs Pop` ownership unresolved — 保持 passing（兼容行为），等待冻结决策
2. `Pogo Stick` Block+Rebound 共享未冻结 — 保持 block only
3. 98 tendency 恢复（Iso vs Poor Defender / Contest Shot）— 数据源问题，不补值；恢复后 Iso→handle、Contest Shot 候选 perimeter
4. **Stage 4（下一步）**：OVR Ground Truth Audit — 1374 (snapshot) vs 1800 (rookieCards) universe 差异、OFFICIAL/ESTIMATED/AMBIGUOUS 三分、official-only 判定；未完成前不训练 V3
5. **Stage 5**：OVR V3 A/B/C/D ablation（34 attrs + position；position one-hot + interaction；同集公平对比；报告后 STOP 等待审阅）
