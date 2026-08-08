# 2KSpinner

NBA 2K26 王朝模式球员生成工具：混合多位真实球员的属性槽，生成新秀/巅峰球员卡，支持新秀卡真实数据、徽章/倾向继承、体型约束与 OVR 模型估算。

- 三个模式：随机新秀（16 属性槽随机继承）、生成巅峰球员、自选来源（手动锁定每个槽的球员版本）
- 新秀卡数据：DB2K 导出的 2003–2025 真实新秀卡（属性、倾向、徽章、潜力、耐久、热区），生成与展示均使用卡内真实值
- OVR：联合岭回归模型（35 属性 + 6 类徽章计数，按位置），新秀初始 OVR 按潜力/年龄目标约束
- 数据版本：2K26（已开放）/ 2K27 Play Now（数据就绪，入口暂未开放）

## Local development

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm run build
```

The production output is generated in `dist/`.

## Verification gate

发布前必须通过统一门禁（数据校验 + 全部测试 + 构建 + bundle 预算）：

```bash
pnpm run verify
```

CI（GitHub Pages workflow）在每次 push 时自动运行该门禁。

## Data pipeline

- `pnpm run convert:rookie-cards` — DB2K Draft Class 快照 → `src/data/rookieCards/{year}/`
- `pnpm run build:versioned-data` — 从源数据构建 2K26/2K27 数据包
- `pnpm run sync:latest-roster` — 定时同步 2K27 现役名单（自动重训联合模型并校验）
- `pnpm run sync:badges` — 同步徽章档案（同时镜像到版本数据包）
- `pnpm run backfill:badges` — Wayback 徽章回填（保留已知零徽章语义）
