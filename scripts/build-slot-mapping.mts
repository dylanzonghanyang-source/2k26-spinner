// 从代码映射源生成"槽位 → 属性/倾向/徽章"完整对照表（Markdown + JSON）
// 用法: node --experimental-strip-types scripts/build-slot-mapping.mts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bundles } from "../src/createResult.ts";
import { tendencyBundleMap } from "../src/components/tendencyBundleMap.ts";
import { badgeBundleMap } from "../src/components/badgeBundleMap.ts";
import { tendencyNameCN } from "../src/tendencyNames.ts";
import { badgeNameCN, normalizeBadgeName } from "../src/badges.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function push(map: Map<string, string[]>, id: string, value: string) {
  const list = map.get(id) ?? [];
  list.push(value);
  map.set(id, list);
}

const attrsBySlot = new Map<string, { label: string; attrs: string[] }>();
const tendBySlot = new Map<string, string[]>();
const badgeBySlot = new Map<string, string[]>();

for (const b of bundles) attrsBySlot.set(b.id, { label: b.label, attrs: b.attrs });
for (const [field, id] of Object.entries(tendencyBundleMap)) push(tendBySlot, id, field);
for (const [badge, ids] of Object.entries(badgeBundleMap)) {
  for (const id of Array.isArray(ids) ? ids : [ids]) push(badgeBySlot, id, badge);
}

// 中文名辅助
const tendCN = (en: string) => tendencyNameCN[en] ?? en;
const badgeCN = (en: string) => {
  const n = normalizeBadgeName(en);
  return badgeNameCN[n] ?? badgeNameCN[en] ?? en;
};

const lines: string[] = [];
lines.push("# 槽位映射对照表（2k26-spinner）");
lines.push("");
lines.push(`生成自代码：\`src/createResult.ts\`（属性）、\`src/components/tendencyBundleMap.ts\`（倾向）、\`src/components/badgeBundleMap.ts\`（徽章）。`);
lines.push("");

const json: Record<string, { label: string; attrs: string[]; tendencies: string[]; badges: string[] }> = {};

for (const b of bundles) {
  const attrs = attrsBySlot.get(b.id)?.attrs ?? [];
  const tends = (tendBySlot.get(b.id) ?? []).slice();
  const badges = (badgeBySlot.get(b.id) ?? []).slice();
  json[b.id] = {
    label: b.label,
    attrs: [...attrs],
    tendencies: [...tends],
    badges: [...badges],
  };

  lines.push(`## ${b.label}（\`${b.id}\`）`);
  lines.push("");
  lines.push(`**属性（${attrs.length}）**：${attrs.map((a) => `\`${a}\``).join("、")}`);
  lines.push("");
  lines.push(`**倾向（${tends.length}）**：`);
  for (const t of tends) lines.push(`- ${tendCN(t)}（\`${t}\`）`);
  lines.push("");
  lines.push(`**徽章（${badges.length}）**：`);
  for (const g of badges) lines.push(`- ${badgeCN(g)}（\`${g}\`）`);
  lines.push("");
}

// 汇总统计
const totalAttrs = [...attrsBySlot.values()].reduce((n, v) => n + v.attrs.length, 0);
const totalTends = [...tendBySlot.values()].reduce((n, v) => n + v.length, 0);
const totalBadges = [...badgeBySlot.values()].reduce((n, v) => n + v.length, 0);
const uniqueTends = new Set([...tendBySlot.values()].flat()).size;
const uniqueBadges = new Set([...badgeBySlot.values()].flat()).size;

lines.push("---");
lines.push("");
lines.push("## 汇总");
lines.push("");
lines.push(`- 槽位数：${bundles.length}`);
lines.push(`- 属性字段：${totalAttrs}（含重复分配，如 Potential/Overall Durability）`);
lines.push(`- 倾向字段：${uniqueTends}（共 ${totalTends} 次分配）`);
lines.push(`- 徽章字段：${uniqueBadges}（共 ${totalBadges} 次分配，含跨槽位共享）`);

const mdPath = join(root, "data/raw/slot-mapping.md");
const jsonPath = join(root, "data/raw/slot-mapping.json");
writeFileSync(mdPath, lines.join("\n"));
writeFileSync(jsonPath, JSON.stringify(json, null, 2));

console.log(`MD  -> ${mdPath}`);
console.log(`JSON-> ${jsonPath}`);
console.log(`槽位=${bundles.length} 属性=${totalAttrs} 倾向=${uniqueTends}(${totalTends}) 徽章=${uniqueBadges}(${totalBadges})`);
