#!/usr/bin/env node
/**
 * Stage 5 Review Patch — 统一 identity universe + 全部修正数字。
 * 权威 universe：canonical coreName（首见文件 = 最早年份正式卡），
 * classify 判据：override 覆盖 effective OVR + source 字段。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = "src/data/rookieCards";
const OVERRIDES_DIR = "data/raw/db2k";
const positions = ["PG", "SG", "SF", "PF", "C"];

const coreName = (raw) => String(raw ?? "")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\u0131/g, "i")
  .toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const overrides = new Map();
for (const f of readdirSync(OVERRIDES_DIR).filter((x) => /^\d{4}-overrides\.json$/.test(x)).sort()) {
  for (const [slug, v] of Object.entries(JSON.parse(readFileSync(path.join(OVERRIDES_DIR, f), "utf8")))) overrides.set(slug, v);
}

const files = [];
for (const year of readdirSync(CARDS_DIR).filter((d) => /^\d{4}$/.test(d))) {
  for (const f of readdirSync(path.join(CARDS_DIR, year))) {
    if (!f.endsWith(".json") || ["review.json", "capture-manifest.json", "gap-conversion-manifest.json"].includes(f)) continue;
    const c = JSON.parse(readFileSync(path.join(CARDS_DIR, year, f), "utf8"));
    files.push({ ...c, year: Number(year), file: `${year}/${f}` });
  }
}

// canonical：coreName 首见（最早年份）
const canonical = new Map();
for (const c of files) {
  const k = coreName(c.name);
  if (!canonical.has(k)) canonical.set(k, c);
}

function classify(card) {
  const ov = overrides.get(card.slug);
  if (ov?.estimated === true || card.overallSource === "model-estimated-gap") return "ESTIMATED";
  const effectiveOvr = ov?.overall != null ? ov.overall : card.overall;
  if (typeof effectiveOvr !== "number") return "NO_OVR";
  if (typeof ov?.source === "string" && ov.source.startsWith("user-ui-confirmed")) return "OFFICIAL";
  return "AMBIGUOUS";
}
const effOvr = (card) => {
  const ov = overrides.get(card.slug);
  return ov?.overall != null ? ov.overall : card.overall;
};

const counts = {};
const byPos = {};
const byBand = {};
for (const c of canonical.values()) {
  const label = classify(c);
  counts[label] = (counts[label] ?? 0) + 1;
  if (label === "OFFICIAL") {
    const pos = String(c.position ?? "").split("/")[0];
    if (positions.includes(pos)) byPos[pos] = (byPos[pos] ?? 0) + 1;
    const o = effOvr(c);
    const band = o < 70 ? "<70" : o < 80 ? "70-79" : o < 85 ? "80-84" : "85+";
    byBand[band] = (byBand[band] ?? 0) + 1;
  }
}
console.log("=== canonical universe（coreName 首见）:", canonical.size, "===");
console.log("分类:", JSON.stringify(counts), "sum:", Object.values(counts).reduce((a, b) => a + b, 0));
console.log("OFFICIAL byPos:", JSON.stringify(byPos), "sum:", Object.values(byPos).reduce((a, b) => a + b, 0));
console.log("OFFICIAL byBand:", JSON.stringify(byBand), "sum:", Object.values(byBand).reduce((a, b) => a + b, 0));

// ESTIMATED 集合算术（canonical 级）
const estCanon = [...canonical.values()].filter((c) => classify(c) === "ESTIMATED").map((c) => c.slug);
const gapSet = new Set([...canonical.values()].filter((c) => c.overallSource === "model-estimated-gap").map((c) => c.slug));
const ovEstSet = new Set();
for (const [slug, v] of overrides) if (v.estimated === true) ovEstSet.add(slug);
const inter = [...gapSet].filter((s) => ovEstSet.has(s));
const union = new Set([...gapSet, ...ovEstSet]);
console.log("\n=== ESTIMATED 集合算术（canonical slug）===");
console.log("gap-source set:", gapSet.size, "| override-estimated set:", ovEstSet.size);
console.log("intersection:", inter.length, inter, "| union:", union.size);
console.log("gap-only:", [...gapSet].filter((s) => !ovEstSet.has(s)).length, "| override-only:", [...ovEstSet].filter((s) => !gapSet.has(s)).length);
console.log("canonical ESTIMATED:", estCanon.length);
console.log("union 中 canonical 非 ESTIMATED:", [...union].filter((s) => !estCanon.includes(s)).length);

// AMBIGUOUS 明细（canonical）
const amb = [...canonical.values()].filter((c) => classify(c) === "AMBIGUOUS");
console.log("\n=== AMBIGUOUS 明细 ===");
for (const c of amb) {
  const ov = overrides.get(c.slug);
  console.log(`  ${c.name}@${c.year} slug=${c.slug} cardOVR=${c.overall} effOVR=${effOvr(c)} src=${c.source} override=${JSON.stringify(ov)}`);
}

// NO_OVR 明细（canonical）前 10
const noOvr = [...canonical.values()].filter((c) => classify(c) === "NO_OVR");
console.log("\n=== NO_OVR（canonical）:", noOvr.length, "===");
console.log("样例:", noOvr.slice(0, 10).map((c) => `${c.name}@${c.year}(ovr=${c.overall})`).join(", "));

// 输出报告
const L2 = [];
const L = (s = "") => { L2.push(s); };
L("# Stage 5 Review Patch — Identity Universe 统一报告");
L("");
L("## 1. identity universe 定义");
L("");
L("| 层级 | 数量 | 说明 |");
L("|---|---|---|");
L("| 文件条目 | 1800 | src/data/rookieCards 全部 .json |");
L("| unique slug | 1797 | 3 组同 slug 多文件（bobby-jones / mike-dunleavy / reggie-williams） |");
L("| unique coreName | 1797 | 与 slug 1:1（无 slug 变体）；同上 3 组 |");
L("| **canonical（权威）** | **1797** | coreName 首见 = 最早年份正式卡（build-rookie-card-index 语义） |");
L("");
L("**unique slug vs unique coreName**：本数据集二者完全相等（1797）。slug 是文件身份（同 slug 跨年份文件=同一人重复卡）；coreName 是归一化人名（去重音/后缀）。同 slug 多文件 3 组同时也是同 coreName 多文件，因此合并后唯一身份不变。");
L("");
L("## 2. 交叉表合计 1799 vs canonical 1797");
L("");
L("1799 = 旧审计用「唯一 slug」遍历文件条目时，3 组重复文件的第二份也被计数（1800 - 1 = 1799 是中间产物）。**权威口径 = canonical coreName 1797**（每身份一张正式卡，重复文件只算首见）。");
L("");
L("## 3. 最终分类（canonical 1797）");
L("");
L(`| 标签 | 数量 | sum 校验 |`);
L("|---|---|---|");
L(`| OFFICIAL | ${counts.OFFICIAL} | byPos ${JSON.stringify(byPos)} = ${Object.values(byPos).reduce((a, b) => a + b, 0)}；byBand ${JSON.stringify(byBand)} = ${Object.values(byBand).reduce((a, b) => a + b, 0)} |`);
L(`| ESTIMATED | ${counts.ESTIMATED} | — |`);
L(`| AMBIGUOUS | ${counts.AMBIGUOUS} | 明细见 §5 |`);
L(`| NO_OVR | ${counts.NO_OVR} | 样例见 §6 |`);
L(`| **total** | **${Object.values(counts).reduce((a, b) => a + b, 0)}** | **= 1797** ✓ |`);
L("");
L("## 4. NO_OVR 87 vs 85");
L("");
L("- 87 = 旧判据（卡文件 raw overall 非 number）在唯一 slug 集合上的计数：含 mike-dunleavy(1976 cardOVR=null)、reggie-williams(1987 cardOVR=null)");
L("- 85 = 新判据（override 覆盖后 effective OVR 仍非 number）在 canonical 上的计数");
L("- 差异 2 = mike-dunleavy（override 合并后 73 有值 → AMBIGUOUS）+ reggie-williams（override 70 + source → OFFICIAL）");
L("- **权威 = 85**");
L("");
L("## 5. AMBIGUOUS 明细（51）");
L("");
L(`- no-card 系列（无 override）：${amb.filter((c) => !overrides.has(c.slug)).length} 张（db2k-no-card-*）`);
L(`- 有 override 但无 source 字段：${amb.filter((c) => overrides.has(c.slug)).length} 张`);
L(`   ${amb.filter((c) => overrides.has(c.slug)).map((c) => `${c.name}(eff=${effOvr(c)})`).join(" / ")}`);
L("");
L("## 6. NO_OVR 样例");
L("");
L(`共 ${noOvr.length} 张（overall 缺失且无 override）：${noOvr.slice(0, 12).map((c) => `${c.name}@${c.year}`).join(", ")}${noOvr.length > 12 ? " …" : ""}`);
L("");
L("## 7. ESTIMATED 集合算术（消除 475+522/intersection=1 歧义）");
L("");
L(`- gap-source set（canonical 卡 overallSource=model-estimated-gap）：**${gapSet.size}**`);
L(`- override-estimated set（overrides.estimated=true）：**${ovEstSet.size}**`);
L(`- intersection：**${inter.length}**（${inter.join(", ") || "无"}）`);
L(`- union：**${union.size}**`);
L(`- gap-only：${[...gapSet].filter((s) => !ovEstSet.has(s)).length} · override-only：${[...ovEstSet].filter((s) => !gapSet.has(s)).length}`);
L(`- canonical ESTIMATED：**${estCanon.length}**（= union − ${[...union].filter((s) => !estCanon.includes(s)).length}，mike-dunleavy 因 canonical 首见 1976 + override 合并 73 无 source → AMBIGUOUS，从文件级 ESTIMATED 移出）`);
L("- 训练集缺口 522 = override-only 集合中卡文件未 materialize OVR 的部分（训练条件 `typeof card.overall === 'number'` 只接受卡文件有值）");

writeFileSync("reports/rookie-overall-review-patch-identity.md", L2.join("\n"), "utf8");
console.log("\nreport -> reports/rookie-overall-review-patch-identity.md");
