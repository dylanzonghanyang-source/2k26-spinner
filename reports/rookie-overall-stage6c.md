# Stage 6C — Display/UI Cutover 交付报告

日期：2026-08-14 · 状态：**完成，STOP FOR REVIEW（未删 legacy estimator、未迁移 Growth Controller、未调 V3-E 系数、未重开 morphology）**

---

## 1. UI Overall 切换 ✅

**所有用户可见的当前球员 Overall 统一使用 `v3eDisplayOverall`**：

| 位置 | 改动 |
|---|---|
| result page 主 OVR（`data-testid="rookie-overall"`） | `initialStrength` → `displayOverall`（V3-E） |
| result page 副行"模型 OVR baseOverall" | **移除**（不再展示 legacy control OVR） |
| export/report `模型估算初始综评` | `initialStrength` → `displayOverall`（V3-E） |
| copy/share payload | 走 createExportText → 自动跟随 V3-E |
| mobile summary / card preview | 无 OVR 直接展示（不动） |

`baseOverall` / `initialStrength` 仅保留内部 generation/debug（growthGap、constraint 依赖），**不再作为用户可见综评**。

## 2. Backward Compatibility ✅

新增 `src/displayOverall.ts` → `resolveDisplayOverall(result)`：
- **原生**：有 `v3eDisplayOverall` → 直接用（source: "native"）
- **重算**：旧对象缺失 → 用 `initialAttrs + position + display Intangibles` 重算 V3-E（source: "recomputed"）
- **legacy fallback**：数据不足 → 用 `initialStrength`/`baseOverall`，UI 显示「旧档」琥珀标记 + title 提示（source: "legacyFallback"）

**绝不修改旧存档 attributes / growth / potential**（resolve 是纯函数，不写回）。

## 3. 85+ Extrapolation UI ✅

- `displayOverall >= 85` → 结果页显示轻量提示「85+ 为模型外推区间」（amber 样式，`data-testid="extrapolation-warning"`）；export 追加「提示: 85+ 为模型外推区间」
- **不降低数值、不 clamp 到 84、不修改生成结果**
- 84 不触发（单测覆盖：84 → 无 warning；85+ → 有 warning）

## 4. Export/Report Semantics ✅

- `模型估算初始综评` = V3-E display
- legacy control OVR 不进入普通用户导出
- legacy 仍可在 result 对象中以 `baseOverall`/`initialStrength` 访问（内部/debug 用途），UI 不再展示

## 5. 文档修正 ✅

Stage 6B.2 报告 §2 表述已改为准确版：
> 80-84 band Δ≥2 占 78.1%——**高 legacy-control OVR band 中 legacy 相对 V3-E 存在系统性偏高**（legacy 对高属性组合估值更激进）；**85+ 才属于无 official label 支撑的 extrapolation 区间**（official 标签上限 84）。

## 6. Regression / Smoke ✅

**`scripts/test-stage6c-cutover.mts` — 18/18 PASS**：
1. 新结果 display = v3eDisplayOverall（native 优先）
2. baseOverall 不再是用户可见 Overall
3. 旧存档缺失 v3eDisplayOverall → 重算（recomputed 匹配 fresh）
4. 数据不足 → legacyFallback 标记
5. multi-donor display Intangibles = 50
6. single-card display Intangibles = real
7. custom explicit Intangibles priority
8. 84 无 extrapolation warning / 85+ 有（export 文案）
9. export Overall = V3-E（非 initialStrength）
10. generation control invariance（initialStrength=baseOverall、growthGap 完整）

**UI 静态 smoke 7/7**：UI 用 displayOverall、无 initialStrength 直接显示、无 baseOverall 模型 OVR 残留、85+ warning、旧档标记、resolveDisplayOverall 接入、export 用 displayOverall。

**Headless Chrome real-DOM smoke PASS**：页面 body 正常渲染（54KB）、dist bundle 含 v3eDisplayOverall + 85+ warning。

**`pnpm run verify`**（实际执行，2026-08-14）：**exit code 0，全链 PASS**
- test-stage6c-cutover：18 PASS / 0 FAIL
- test-stage6c1-legacy-save：14 PASS / 0 FAIL（Stage 6C.1 后补充）
- test-body-degrade-v2：24 PASS / 0 FAIL
- test-slot-semantics-v2：58/58 passed
- test-adversarial：52/52 passed
- createResult production-path OK · test-export-text / draft-store / build-profile / entry-progress / result-overall-contract / rookie-card-units 全过
- validate:data / test:body / badges / overall / versioned-overall / tendencies / rookie-cards / database / routing / rookie-initial-overall / durability / motion / palette 全过
- build PASS · Bundle budget OK（16 chunks ≤ 500kB）

## 交付物
- `src/displayOverall.ts`（resolveDisplayOverall：native/recomputed/legacyFallback）
- `src/components/RookieBuilder.tsx`（结果页切换 + 85+ warning + 旧档标记）
- `src/exportText.ts`（export = V3-E + 85+ 提示）
- `scripts/test-stage6c-cutover.mts`（18 断言，已挂入 verify）
- `reports/rookie-overall-stage6b2.md` 文档修正

**STOP FOR REVIEW** —— 待审：① UI 切换后 official -0.28 / synthetic -1.69 的显示偏差是否接受；② 85+ warning 文案；③ 后续 Growth Controller V2 计划。
