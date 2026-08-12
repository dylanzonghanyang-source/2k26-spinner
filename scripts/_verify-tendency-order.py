#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verify tendencyGroups order matches the DB2K table order (for fields the project has)."""
import csv, re

CSV_PATH = "data/raw/db2k/2k26 球员全部字段 - 工作表1.csv"

# Parse CSV column 4 (index 3, 倾向): subcategory rows + field rows
rows = []
with open(CSV_PATH, encoding="utf-8-sig") as f:
    for row in csv.reader(f):
        if len(row) >= 4:
            v = (row[3] or "").strip()
            if v:
                rows.append(v)

# Subcategory markers; "切入" is BOTH a subcategory and a field name, so a
# repeated marker with the same active group is treated as a field row.
markers = {"跳投", "上篮和扣篮", "切入", "传球", "背身", "自由发挥", "防守"}
table = []  # [(group, [fields])]
cur = None
for v in rows:
    if v in markers and (cur is None or cur[0] != v):
        cur = [v, []]
        table.append(cur)
    elif cur is not None:
        cur[1].append(v)

# Extract CN -> EN mapping from tendencyNames.ts
src = open("src/tendencyNames.ts", encoding="utf-8").read()
m = re.search(r"tendencyNameCN[^=]*=\s*\{", src)
pairs = re.findall(r'"([^"]+)"\s*:\s*"([^"]+)"', src[m.start():])
cn_to_en = {cn: en for en, cn in pairs}

# Extract code groups (only within the tendencyGroups block)
code_src = open("src/fieldCategories.ts", encoding="utf-8").read()
code_block = code_src[code_src.index("export const tendencyGroups"):code_src.index("export type HotZoneGroup")]
code_groups = []
for gm in re.finditer(r'label: "([^"]+)",[\s\S]*?fields: \[(.*?)\]', code_block, re.S):
    code_groups.append((gm.group(1), re.findall(r'"([^"]+)"', gm.group(2))))

print("=== 顺序核对（表顺序 vs 代码顺序）===")
all_ok = True
for group_label, table_fields in table:
    code_fields = next((cg[1] for cg in code_groups if cg[0] == group_label), None)
    if code_fields is None:
        print(f"[组缺失] {group_label}")
        all_ok = False
        continue
    # map table CN -> code EN (skip CN without mapping or code field absent)
    code_seq = []
    missing = []
    for cn in table_fields:
        en = cn_to_en.get(cn)
        if en is None:
            missing.append(f"{cn}(无名映射)")
            continue
        if en not in code_fields:
            missing.append(f"{cn}->{en}(代码组无此字段)")
            continue
        code_seq.append(en)
    # relative order check: code_seq must be a subsequence of code_fields (i.e. code order == table order for shared fields)
    pos = 0
    ok = True
    for en in code_seq:
        idx = code_fields.index(en)
        if idx < pos:
            ok = False
            break
        pos = idx
    extra = [en for en in code_fields if en not in code_seq]
    status = "✓" if ok else "✗ 顺序不一致"
    if not ok:
        all_ok = False
    print(f"{group_label}: {status}")
    if not ok:
        # print detailed diffs
        table_ordered = [cn_to_en.get(cn, cn) for cn in table_fields]
        print(f"  表序: {table_ordered}")
        print(f"  代码: {code_fields}")
    if missing:
        print(f"  表有项目无/无映射: {missing}")
    if extra:
        print(f"  代码独有(表无): {extra}")

print("\n结果:", "PASS" if all_ok else "FAIL")
