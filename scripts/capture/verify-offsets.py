#!/usr/bin/env python3
"""
Verify an offset table against a real DB2K snapshot, WITHOUT a live game.

Method: for each record in a real snapshot, rebuild mock memory from the
snapshot's raw_value fields (encode back to bytes using the offset table's
read shapes), decode via db2kdecode.read_entry(), and compare the resulting
display_value with the snapshot's display_value.

A high match rate proves the offset table + decode rules reproduce DB2K
snapshot output exactly — so a config-driven capture on Windows will produce
snapshots the existing convert-db2k-to-rookiecard.mjs pipeline can consume.

Usage:
  python3 scripts/capture/verify-offsets.py \
    --table scripts/capture/offsets/2k26.json \
    --snapshot data/raw/db2k/2019player_roster_snapshot.json \
    [--limit 5] [--verbose]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from db2kdecode import (
    _norm_key,
    encode_raw_to_bytes,
    field_address,
    read_field_raw,
    raw_to_display,
    to_int,
)


class MockMemory:
    """Byte-addressable memory store with DB2K-reader-compatible surface.

    Stored as {address: byte} so overlapping writes (bitfields sharing a byte)
    behave like real memory: a 1-byte write never destroys sibling bytes that a
    wider earlier write placed at neighboring addresses.
    """

    def __init__(self) -> None:
        self._bytes: dict[int, int] = {}
        self.pointer_size = 8

    def write(self, address: int, data: bytes) -> None:
        for i, byte in enumerate(data):
            self._bytes[address + i] = byte

    def read_bytes(self, address: int, size: int) -> bytes:
        return bytes(self._bytes.get(address + i, 0) for i in range(size))

    def read_u64(self, address: int) -> int:
        return int.from_bytes(self.read_bytes(address, 8), "little")

    def read_wstring(self, address: int, max_chars: int) -> str:
        data = self.read_bytes(address, max_chars * 2)
        chars: list[str] = []
        for i in range(0, len(data) - 1, 2):
            code = data[i] | (data[i + 1] << 8)
            if code == 0:
                break
            chars.append(chr(code) if code < 0x10000 else "\ufffd")
        return "".join(chars)

    def read_ascii(self, address: int, max_chars: int) -> str:
        data = self.read_bytes(address, max_chars)
        end = data.find(b"\x00")
        if end >= 0:
            data = data[:end]
        return data.decode("ascii", errors="replace")


def build_mock_memory(record: dict[str, Any], table: dict[str, Any]) -> MockMemory:
    """Write every field's raw_value back into a mock record buffer."""
    mem = MockMemory()
    base = 0x1_0000_0000
    parents = table.get("parents", {})
    field_by_path = {f["path"]: f for f in table["fields"]}
    fields = record.get("fields", {})
    written_ptrs: set[int] = set()
    for path, value in fields.items():
        entry = field_by_path.get(path)
        if entry is None or value.get("raw_value") is None:
            continue
        raw = value["raw_value"]
        try:
            encoded = encode_raw_to_bytes(raw, entry)
        except Exception:
            continue  # unencodable shapes are reported as coverage gaps below
        parent_name = entry.get("parent")
        if parent_name:
            parent = parents.get(_norm_key(parent_name))
            if parent is None:
                continue
            # One shared parent structure per record: write the pointer once,
            # all child fields land at parent_target + their own offset.
            ptr_addr = base + to_int(parent.get("offset"))
            if ptr_addr not in written_ptrs:
                mem.write(ptr_addr, (base + 0x8000).to_bytes(8, "little"))
                written_ptrs.add(ptr_addr)
            merge_write(mem, base + 0x8000 + to_int(entry.get("offset")), encoded)
        else:
            merge_write(mem, base + to_int(entry.get("offset")), encoded)
    return mem


def merge_write(mem: MockMemory, address: int, data: bytes) -> None:
    """Write bytes, OR-merging with existing data at the same address.

    Bitfield fields share bytes (e.g. BAILOUT @1152 bit0 and DIMER @1152 bit6),
    so a naive overwrite would erase sibling fields' bits.
    """
    existing = mem.read_bytes(address, len(data))
    merged = bytes(a | b for a, b in zip(existing, data))
    mem.write(address, merged)


def decode_record(mem: MockMemory, table: dict[str, Any]) -> dict[str, Any]:
    base = 0x1_0000_0000
    parents = table.get("parents", {})
    out: dict[str, Any] = {}
    for entry in table["fields"]:
        try:
            addr = field_address(mem, base, entry, parents)
            raw = read_field_raw(mem, addr, entry)
            display = raw_to_display(entry["section"], entry["name"], entry, raw)
        except Exception as exc:
            out[entry["path"]] = {"decode_error": str(exc)}
            continue
        out[entry["path"]] = {"display_value": display, "raw_value": raw}
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify offset table against a real snapshot")
    parser.add_argument("--table", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=5, help="records to verify (default 5, 0 = all)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    table = json.loads(args.table.read_text(encoding="utf-8"))
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    records = snapshot.get("records", [])
    limit = args.limit if args.limit > 0 else len(records)

    field_by_path = {f["path"]: f for f in table["fields"]}
    summary: dict[str, dict[str, Any]] = {}
    for entry in table["fields"]:
        summary[entry["path"]] = {"compared": 0, "match": 0, "mismatch": 0, "decode_error": 0, "examples": []}

    for rec in records[:limit]:
        mem = build_mock_memory(rec, table)
        decoded = decode_record(mem, table)
        fields = rec.get("fields", {})
        for path, entry in summary.items():
            truth = fields.get(path)
            got = decoded.get(path)
            if truth is None or truth.get("display_value") is None:
                continue
            summary[path]["compared"] += 1
            if got is None or "decode_error" in got:
                summary[path]["decode_error"] += 1
                if len(summary[path]["examples"]) < 3:
                    summary[path]["examples"].append(f"decode_error: {got}")
                continue
            if got["display_value"] == truth["display_value"]:
                summary[path]["match"] += 1
            else:
                summary[path]["mismatch"] += 1
                if len(summary[path]["examples"]) < 3:
                    summary[path]["examples"].append(
                        f"snapshot={truth['display_value']!r} decoded={got['display_value']!r} (raw {truth.get('raw_value')!r})"
                    )

    total_cmp = sum(s["compared"] for s in summary.values())
    total_match = sum(s["match"] for s in summary.values())
    total_mismatch = sum(s["mismatch"] for s in summary.values())
    total_err = sum(s["decode_error"] for s in summary.values())
    total_missing = sum(1 for path in fields_union(records[:limit]) if path not in field_by_path and path.split("/")[0] != "Stats")

    print(f"snapshot: {snapshot.get('target_executable')} mode={snapshot.get('mode')} records={len(records)} verified={limit}")
    print(f"table: {args.table.name} ({len(table['fields'])} fields)")
    print(f"compared={total_cmp} match={total_match} mismatch={total_mismatch} decode_error={total_err} table-missing={total_missing}")
    if total_cmp:
        print(f"match rate: {total_match / total_cmp * 100:.2f}%")

    bad = [p for p, s in summary.items() if s["mismatch"] or s["decode_error"]]
    if bad:
        print(f"\nfields with mismatches/decode errors ({len(bad)}):")
        for p in sorted(bad):
            s = summary[p]
            print(f"  {p}: match={s['match']}/{s['compared']} mismatch={s['mismatch']} err={s['decode_error']}")
            for ex in s["examples"]:
                print(f"      {ex}")
    if total_missing:
        missing = [p for p in fields_union(records[:limit]) if p not in field_by_path and p.split("/")[0] != "Stats"]
        print(f"\nfields in snapshot but missing from table ({len(missing)}):")
        for p in sorted(missing)[:30]:
            print("  ", p)
    return 0 if (total_mismatch == 0 and total_err == 0 and total_missing == 0) else 1


def fields_union(records: list[dict[str, Any]]) -> set[str]:
    union: set[str] = set()
    for rec in records:
        union.update(rec.get("fields", {}).keys())
    return union


if __name__ == "__main__":
    sys.exit(main())
