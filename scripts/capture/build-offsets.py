#!/usr/bin/env python3
"""
Build a config-driven offset table from DB2K Editor's bundled offset JSONs.

Input (from discobisco/2k26-Editor, commit fb3ab61):
  - core/Offsets/offsets_players.json   (field definitions per section)
  - core/Offsets/offsets_league.json    (Draft Class pointer/structure)
  - core/Offsets/dropdowns.json         (dropdown enum tables)

Output: offsets/<game>.json — a self-contained table that
scripts/capture/read-memory-snapshot.py consumes to reproduce DB2K-style
snapshots from raw process memory, with zero DB2K runtime dependency.

Usage:
  python3 scripts/capture/build-offsets.py \
    --offsets-dir /tmp/2keditor/core/Offsets \
    --game 2k26 \
    --out scripts/capture/offsets/2k26.json
  # or, with network: no --offsets-dir -> downloads from GitHub main

The generated table keeps every decode-relevant payload flag (div100, scale,
body_scale_0_100, year_map_base, dropdown, parent, ...) so db2kdecode.py can
reproduce display values exactly. Verification: scripts/capture/verify-offsets.py
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RAW_BASE = "https://raw.githubusercontent.com/discobisco/2k26-Editor/main/2keditor/core/Offsets"

SKIP_SECTIONS = {"Stats"}  # Stats section is untrusted (audit conclusion)

# Version keys are comma-separated lists ("2K22", "2K23,2K24", ...)
def pick_version(payload: dict[str, Any], target: str) -> dict[str, Any] | None:
    versions = payload.get("versions")
    if not isinstance(versions, dict):
        return None
    for key, value in versions.items():
        if target in str(key).split(","):
            return value if isinstance(value, dict) else None
    return None


def normalize_name(d: dict[str, Any]) -> str:
    raw = d.get("normalized_name") or d.get("display_name") or ""
    return str(raw).strip().upper()


def _norm_key(raw: str) -> str:
    """Normalize a parent/field label for dictionary lookup ('Appearance Data' -> 'APPEARANCEDATA')."""
    return "".join(ch for ch in str(raw).upper() if ch.isalnum())


def fetch(url: str) -> Any:
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_dropdown_tables(dropdowns: dict[str, Any]) -> dict[tuple[str, str], list[Any]]:
    """Flatten dropdowns.json into (section, name) -> options list.

    Keyed by section+name so a fallback lookup can never attach a same-named
    table from another section (e.g. a Gear 'FREETHROW' onto Attributes).
    """
    tables: dict[tuple[str, str], list[Any]] = {}
    for domain, sections in (dropdowns or {}).items():
        if not isinstance(sections, dict):
            continue
        for section, fields in sections.items():
            if not isinstance(fields, dict):
                continue
            for family, defs in fields.items():
                if not isinstance(defs, list):
                    continue
                for d in defs:
                    if not isinstance(d, dict):
                        continue
                    v26 = pick_version(d, "2K26")
                    if v26 is None:
                        continue
                    options = v26.get("dropdown")
                    if isinstance(options, list):
                        name = str(d.get("normalized_name") or d.get("display_name") or family).upper()
                        tables[(section, name)] = options
    return tables


def resolve_dropdown(value: Any, tables: dict[tuple[str, str], list[Any]]) -> Any:
    """Inline a dropdown list, resolving string table references (unresolvable refs
    are left as-is; the (section, name) fallback in build_fields handles them)."""
    if isinstance(value, list):
        return value
    return value


def build_fields(players: dict[str, Any], tables: dict[tuple[str, str], list[Any]], game: str) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], list[str]]:
    fields: list[dict[str, Any]] = []
    parents: dict[str, dict[str, Any]] = {}
    skipped: list[str] = []

    for section, families in players.items():
        if section in SKIP_SECTIONS:
            continue
        if not isinstance(families, dict):
            continue
        for family, defs in families.items():
            if not isinstance(defs, list):
                continue
            for d in defs:
                if not isinstance(d, dict):
                    continue
                v26 = pick_version(d, game)
                if v26 is None:
                    skipped.append(f"{section}/{family} ({d.get('normalized_name')}): no {game} version")
                    continue
                name = normalize_name(d)
                entry: dict[str, Any] = {
                    "path": f"{section}/{name}",
                    "section": section,
                    "name": name,
                    "offset": v26.get("address"),
                    "type": v26.get("type"),
                }
                if "length" in v26:
                    entry["length"] = v26["length"]
                if "bit_length" in v26:
                    entry["bit_length"] = v26["bit_length"]
                if "byteLength" in v26:
                    entry["byteLength"] = v26["byteLength"]
                if "startBit" in v26:
                    entry["startBit"] = v26["startBit"]
                if "bit_offset" in v26:
                    entry["bit_offset"] = v26["bit_offset"]
                if v26.get("parent"):
                    entry["parent"] = v26["parent"]
                if v26.get("hidden"):
                    entry["hidden"] = True
                if v26.get("requiresDereference"):
                    entry["requiresDereference"] = True
                    entry["dereferenceAddress"] = v26.get("dereferenceAddress")
                if v26.get("offset2"):
                    entry["offset2"] = v26["offset2"]
                if v26.get("unicode"):
                    entry["unicode"] = True
                # display-relevant flags
                for flag in ("div100", "body_scale_0_100", "body_scale_25_75", "injury_duration_days", "season_range"):
                    if v26.get(flag):
                        entry[flag] = True
                if "scale" in v26:
                    entry["scale"] = v26["scale"]
                if "year_map_base" in v26:
                    entry["year_map_base"] = v26["year_map_base"]
                if "season_year_base" in v26:
                    entry["season_year_base"] = v26["season_year_base"]
                dropdown = resolve_dropdown(v26.get("dropdown"), tables)
                if not (isinstance(dropdown, list) and dropdown):
                    # Some 2K26 payloads carry no dropdown (e.g. Contract Terms);
                    # the mapping lives in dropdowns.json keyed by (section, name).
                    dropdown = tables.get((section, name))
                if isinstance(dropdown, list) and dropdown:
                    entry["dropdown"] = dropdown
                if isinstance(v26.get("values"), list):
                    entry["values"] = v26["values"]
                if isinstance(v26.get("value_mapping"), dict):
                    entry["value_mapping"] = v26["value_mapping"]

                if entry.get("offset") is None:
                    skipped.append(f"{section}/{name}: no address")
                    continue
                # Pointer-ish containers that serve as parents for child fields
                if str(entry.get("type", "")).lower() in {"pointer", "address", "uint64", "ulonglong"} and v26.get("parent") is None:
                    parents[_norm_key(name)] = {"offset": entry["offset"], "type": entry["type"]}
                fields.append(entry)

    fields.sort(key=lambda e: (e["section"], e["name"]))
    return fields, parents, skipped


def build_record_config(league: dict[str, Any], game: str) -> dict[str, Any]:
    """Extract Draft Class pointer/structure from offsets_league.json.

    Shape: { "versions": { "<GAME>": { "base_pointers": { "DraftClass": {...} },
    "stride_constants": { "draftClassSize": N, "draftClassCount": N,
    "draftClassBodyOffset": N } } } }
    """
    versions = league.get("versions") if isinstance(league, dict) else None
    if not isinstance(versions, dict):
        raise RuntimeError("offsets_league.json has no versions map")
    entry = None
    for key in versions:
        if game in str(key).split(","):
            entry = versions[key]
            break
    if entry is None:
        raise RuntimeError(f"no {game} version entry in offsets_league.json")
    pointer = (entry.get("base_pointers") or {}).get("DraftClass")
    if not isinstance(pointer, dict):
        raise RuntimeError(f"no base_pointers.DraftClass for {game}")
    strides = entry.get("stride_constants") or {}
    cfg = {
        "address": pointer.get("address"),
        "finalOffset": pointer.get("finalOffset"),
        "signature": pointer.get("signature"),
        "record_count": pointer.get("record_count"),
        "draftClassSize": strides.get("draftClassSize"),
        "draftClassCount": strides.get("draftClassCount"),
        "draftClassBodyOffset": strides.get("draftClassBodyOffset"),
    }
    if cfg["address"] is None or cfg["draftClassSize"] is None:
        raise RuntimeError(f"incomplete DraftClass config: {json.dumps(cfg, ensure_ascii=False)}")
    return cfg


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build offset table from DB2K Editor JSONs")
    parser.add_argument("--offsets-dir", type=Path, help="local directory with the three JSON files (default: download from GitHub)")
    parser.add_argument("--game", default="2K26", help="game version label, e.g. 2K26 (future: 2K27)")
    parser.add_argument("--out", type=Path, default=Path("scripts/capture/offsets/2k26.json"))
    args = parser.parse_args(argv)

    if args.offsets_dir:
        players_raw = load_json(args.offsets_dir / "offsets_players.json")
        league = load_json(args.offsets_dir / "offsets_league.json")
        dropdowns = load_json(args.offsets_dir / "dropdowns.json")
        source = f"local:{args.offsets_dir}"
    else:
        print("downloading DB2K offset JSONs from GitHub main ...")
        players_raw = fetch(f"{RAW_BASE}/offsets_players.json")
        league = fetch(f"{RAW_BASE}/offsets_league.json")
        dropdowns = fetch(f"{RAW_BASE}/dropdowns.json")
        source = "https://github.com/discobisco/2k26-Editor main"

    # offsets_players.json wraps sections under a single "Players" domain key
    if isinstance(players_raw, dict) and "Players" in players_raw:
        players = players_raw["Players"]
    else:
        players = players_raw

    tables = load_dropdown_tables(dropdowns)
    fields, parents, skipped = build_fields(players, tables, args.game)
    record = build_record_config(league, args.game)

    table = {
        "game": args.game,
        "module": f"nba2k{args.game[-2:].lower()}.exe",
        "source": source,
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "record": record,
        "parents": parents,
        "fields": fields,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(table, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"wrote {args.out} ({len(fields)} fields, {len(parents)} parents)")
    print(f"record: {json.dumps(record, ensure_ascii=False)}")
    print(f"skipped ({len(skipped)}):")
    for s in skipped[:20]:
        print("  ", s)
    if len(skipped) > 20:
        print(f"   ... and {len(skipped) - 20} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
