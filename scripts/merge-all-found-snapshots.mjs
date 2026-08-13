#!/usr/bin/env -S node --input-type=module
/**
 * 合并 Windows Hermes 采集的三份游戏快照为一份全量快照，
 * 供 convert-db2k-to-rookiecard.mjs 按届转换。
 * 去重优先级：full_draft_table（新秀数值）> all_found_rookie_roster > all_found_team_only。
 * 同时修正已知的源数据错误：Anthony Randolph DRAFTEDYEAR 2007 -> 2008（官方 2008 #14）。
 */
import fs from "node:fs";
import path from "node:path";

const ATTACH = "/Users/yangzonghan/.hermes/attachments";
const OUT = path.join("data", "raw", "db2k", "merged-all-found.json");

const coreName = (raw) => String(raw ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\u0131/g, "i")
  .toLowerCase()
  .replace(/[.'’]/g, "")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const vitals = (rec, key) => rec?.fields?.[`Vitals/${key}`]?.display_value;
const nameOf = (rec) => {
  const first = String(vitals(rec, "FIRSTNAME") ?? "");
  const last = String(vitals(rec, "LASTNAME") ?? "");
  return `${first} ${last}`.trim() || String(rec?.label ?? "").trim();
};

const sources = [
  { name: "full_draft_table_rookie", file: "full_draft_table_rookie.json", priority: 0 },
  { name: "all_found_rookie_roster", file: "all_found_rookie_roster.json", priority: 1 },
  { name: "all_found_team_only", file: "all_found_team_only.json", priority: 2 },
];

const merged = new Map(); // key -> { rec, priority, source }
const stats = {};
for (const source of sources) {
  const full = path.join(ATTACH, source.file);
  const snapshot = JSON.parse(fs.readFileSync(full, "utf8"));
  let kept = 0;
  for (const rec of snapshot.records ?? []) {
    const name = nameOf(rec);
    if (!name) continue;
    const year = String(vitals(rec, "DRAFTEDYEAR") ?? "");
    if (!year) continue;
    const key = `${year}|${coreName(name)}`;
    const existing = merged.get(key);
    if (existing && existing.priority <= source.priority) continue;
    // 源数据年份修正：Anthony Randolph 官方 2008 #14（游戏误标 2007）
    if (coreName(name) === "anthony randolph" && year === "2007") {
      rec.fields["Vitals/DRAFTEDYEAR"].display_value = 2008;
      rec.fields["Vitals/DRAFTEDYEAR"].value = 2008;
    }
    merged.set(key, { rec, priority: source.priority, source: source.name });
    kept++;
  }
  stats[source.name] = kept;
}

const records = [...merged.values()].map(({ rec }) => rec);
// 与 merged-2003-2018-full.json 相同约定：不写 mode 字段（转换器接受 undefined）。
// 源信息保留在脚本注释与 data/raw/db2k/ 目录的文件说明中。
const snapshot = {
  target_executable: "NBA2K26.exe",
  domain: "Players",
  record_count: records.length,
  records,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot));
console.log("merge stats:", stats);
console.log("merged total:", records.length, "->", OUT);

// 验证修正生效
const randolph = records.find((rec) => coreName(nameOf(rec)) === "anthony randolph");
console.log("randolph after fix:", randolph ? `${nameOf(randolph)} DRAFTEDYEAR=${vitals(randolph, "DRAFTEDYEAR")}` : "NOT FOUND");
