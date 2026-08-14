# UI Bugfix — Slot Selection / Repeated Donor Audit

日期：2026-08-14 · 状态：**修复完成 + 验证通过，STOP FOR REVIEW**

---

## 1. 根因（文件 / 条件）

**`src/createResult.ts` → `applyBundleLockTransaction`（L90-92）**：

```ts
if (lock.kind === "player" && usedPlayerIds.has(lock.playerId)) {
  return { next: current, usedPlayerIds: nextUsed, accepted: false };
}
```

这是**全局跨槽 uniqueness guard**：任何模式下，同一 `playerId`（custom 模式为 `card:<slug>`）一旦被任一槽位锁定，后续任何槽位再提交同卡都会被事务层**无条件拒绝**（`accepted: false`）。

调用链：`SlotPicker onPick → RookieBuilder pickCard → finishLock → applyBundleLockTransaction`。事务被拒后 `finishLock` 直接 return，槽位不写入、picker 不关闭、无反馈——与 Repro A（Deron 2005 背身+力量）/ Repro B（DLo 2015 抢断+盖帽）现象完全吻合。

**为什么 custom/challenge 共用此 guard**：`finishLock` 是所有 mode 的提交入口，事务层没有 mode 概念。challenge 模式通过 `clickBundle`（L1317 的 `usedBy.has`）另有 UI 层保护，但事务层是最后防线，一视同仁地拒绝了 custom 模式的合法重复。

## 2. 修复（最小改动，mode 隔离）

**`applyBundleLockTransaction` 增加第 5 参数 `allowDuplicateDonor = false`**：

```ts
if (lock.kind === "player" && !allowDuplicateDonor && usedPlayerIds.has(lock.playerId)) {
```

- **custom/self-build**（`RookieBuilder.finishLock` 传 `isManualSelection`）→ `true`：同卡可锁多槽
- **challenge/random**（默认 `false`）→ 原"一名球员一次"玩法限制**完全保留**
- `usedPlayerIds` 集合语义不变（仍记录所有已用 donor，供 unlock 的 stillUsed 判断）

**未改动**：Body V2 / Slot Semantics / database / OVR / createResult 的 evaluateAll / draft store 序列化。

## 3. 为什么重复 donor 是安全的（数据语义验证）

| 机制 | 结论 |
|---|---|
| 每槽只继承自己 bundle 的 attrs（post→Fade/Hook/Control；strength→Strength） | ✅ 无数据冲突 |
| `evaluateAll` 按 `SlotInput[]` 逐 bundle 求值 | ✅ 同卡跨槽天然独立 |
| `cardSourcesFromLocks` 按 playerId 去重为 Map | ✅ 同卡只需一个 source |
| `unlockBundle` stillUsed 检查（其他槽仍用时保留 usedPlayerIds） | ✅ 删一槽不连带 |
| draft 恢复 `usedPlayerIdsRef`（Set 去重） | ✅ 重复 donor 正确重建 |
| challenge 模式 `clickBundle`/`usedBy` UI 禁用 | ✅ 原样保留 |

## 4. 验证

### 单测（`scripts/test-duplicate-donor.mts`，**26/26 PASS**）
- 同卡 post+strength 两槽均 accepted（Repro A 场景）
- 同卡 steal+block 两槽均 accepted（Repro B 场景）
- 同卡连续 3 槽独立保存；删一槽不连带；替换一槽不修改同 donor 其他槽
- evaluateAll 同卡跨槽无串扰（steal 不含 Block，block 不含 Steal）
- custom 模式 duplicate allowed；challenge 模式拒绝（含默认参数=旧语义）
- draft 恢复 usedPlayerIds 去重正确

### Browser real-DOM smoke（headless Chrome，真实 UI 流程）
- **Repro A ✅**：背身选德隆·威廉姆斯（Deron Williams 2005）→ 力量槽再选同一张卡 → 力量锁定 Strength 69，背身保持锁定（Post Fade 77/Hook 42/Control 58 → 槽位主值 64）
- **Repro B ✅**：抢断选丹吉洛·拉塞尔（DLo 2015）→ 盖帽槽再选同一张卡 → 盖帽锁定 37，抢断保持锁定（70）

### 完整 verify
见下方实际执行结果。

## 5. 交付
- `src/createResult.ts`（applyBundleLockTransaction + allowDuplicateDonor）
- `src/components/RookieBuilder.tsx`（finishLock 传 isManualSelection + 注释）
- `scripts/test-duplicate-donor.mts`（26 断言，已挂入 verify）

**STOP FOR REVIEW** — 待审：① mode 隔离语义（custom 允许 / challenge 保留）是否符合预期；② challenge 模式若未来也需同卡多槽，可再调整。
