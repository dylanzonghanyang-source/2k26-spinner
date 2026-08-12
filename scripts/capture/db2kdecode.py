#!/usr/bin/env python3
"""
Shared decode/encode core for the config-driven memory capture pipeline.

Single source of truth for translating raw memory bytes -> DB2K-style
{display_value, raw_value} snapshots. Mirrors the decode rules of
discobisco/2k26-Editor commit fb3ab61 (core/field_io.py `_raw_to_display_value`)
so a configured offset table plus this module reproduces DB2K snapshot output
exactly — no DB2K runtime needed.

A "reader" is any object exposing:
    read_bytes(address: int, size: int) -> bytes
    read_u64(address: int) -> int
    read_wstring(address: int, max_chars: int) -> str
    read_ascii(address: int, max_chars: int) -> str
    pointer_size: int = 8
"""

from __future__ import annotations

import struct
from typing import Any

# ---------------------------------------------------------------------------
# Display conversion constants (mirror core/conversions.py)
# ---------------------------------------------------------------------------
RATING_MIN = 25
RATING_MAX_DISPLAY = 99
RATING_MAX_TRUE = 110
YEAR_BASE = 1900
HEIGHT_UNIT_SCALE = 254

# Field IDs that display on a plain 0-100 scale (mirror _PLAYER_ZERO_TO_100_FIELD_IDS)
ZERO_TO_100_FIELD_IDS = {
    "MINPOTENTIAL", "MAXPOTENTIAL", "MINIMUMPOTENTIAL", "MAXIMUMPOTENTIAL",
    "AVGPERCENT", "AVERAGEPERCENT", "BUSTPERCENT", "BUSTPERCENTAGE",
    "BOOMPERCENT", "BOOMPERCENTAGE", "FINANCIALSECURITY", "LOYALTY",
    "PLAYFORWINNER",
}

# Year-offset fields: raw < 1900 is stored as offset from YEAR_BASE
_YEAR_FIELD_IDS = {"DRAFTEDYEAR", "HISTORICYEAR", "BIRTHYEAR"}

_PARENT_POINTER_TYPES = {"pointer", "address", "uint64", "ulonglong"}

_FIXED_TYPE_WIDTHS = {
    # Mirrors DB2K _FIXED_NUMERIC_TYPE_WIDTHS exactly: types NOT listed here
    # (integer/number/dropdown/slider/...) resolve width from length bits.
    "byte": 1, "ubyte": 1, "ushort": 2, "uint": 4, "uint64": 8,
    "ulonglong": 8, "pointer": 8, "address": 8,
}


def to_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value or "").strip()
    if not text:
        return 0
    try:
        return int(text, 16) if text.lower().startswith("0x") else int(text)
    except ValueError:
        return 0


def _bits_to_bytes(bits: int) -> int:
    return max(1, (int(bits) + 7) // 8)


def resolved_length_bits(payload: dict[str, Any]) -> int:
    for key in ("length", "bit_length", "byteLength"):
        v = to_int(payload.get(key))
        if v > 0:
            return v
    return 0


def numeric_width(payload: dict[str, Any]) -> int:
    explicit = to_int(payload.get("byteLength"))
    if explicit > 0:
        return explicit
    type_key = str(payload.get("type", "")).lower()
    fixed = _FIXED_TYPE_WIDTHS.get(type_key)
    if fixed:
        return fixed
    bits = resolved_length_bits(payload)
    if bits > 0:
        return _bits_to_bytes(bits)
    raise KeyError(f"cannot determine width for {payload}")


# ---------------------------------------------------------------------------
# Raw decoding (mirror field_io._read_authored_value)
# ---------------------------------------------------------------------------

def read_field_raw(reader: Any, address: int, payload: dict[str, Any]) -> Any:
    type_key = str(payload.get("type", "")).lower()
    bit_offset = to_int(payload.get("bit_offset")) or to_int(payload.get("startBit"))
    length_bits = resolved_length_bits(payload)
    uses_bitfield = (
        type_key in {"bit", "bitfield"}
        or (type_key in {"number", "integer", "int", "binary", "ushort", "uint", "uint64"} and bit_offset and length_bits > 0)
        or (type_key in {"number", "integer", "int", "binary"} and "startBit" in payload and length_bits > 0)
    )
    if uses_bitfield and (bit_offset or "startBit" in payload):
        width = _bits_to_bytes(bit_offset + length_bits)
        raw_int = int.from_bytes(reader.read_bytes(address, width), "little")
        mask = (1 << length_bits) - 1
        value = (raw_int >> bit_offset) & mask
        # Signed conversion ONLY for type "int" (mirrors DB2K: "Integer" is unsigned)
        if type_key == "int" and value >= (1 << (length_bits - 1)):
            value -= 1 << length_bits
        return value
    if type_key in {"float"}:
        return struct.unpack("<f", reader.read_bytes(address, 4))[0]
    if type_key in {"string", "wstring"}:
        max_chars = to_int(payload.get("length")) or 64
        return (reader.read_wstring if type_key == "wstring" else reader.read_ascii)(address, max_chars)
    if type_key == "ptr_string":
        ptr = reader.read_u64(address)
        if ptr <= 0:
            return ""
        text_type = "wstring" if bool(payload.get("unicode")) else "string"
        max_chars = to_int(payload.get("length")) or 64
        return (reader.read_wstring if text_type == "wstring" else reader.read_ascii)(ptr, max_chars)
    if type_key in {"binary", "hex_bytes"}:
        return reader.read_bytes(address, numeric_width(payload))
    width = numeric_width(payload)
    raw = reader.read_bytes(address, width)
    if width == 8:
        return struct.unpack("<Q", raw)[0]
    if width == 4:
        return struct.unpack("<I", raw)[0]
    return int.from_bytes(raw, "little")


def _list_mapping(raw_value: Any, options: Any) -> Any | None:
    if not isinstance(options, list):
        return None
    try:
        index = int(raw_value)
    except (TypeError, ValueError):
        return None
    if 0 <= index < len(options):
        return options[index]
    return None


def _mapped_display(payload: dict[str, Any], raw_value: Any) -> Any | None:
    for key in ("values", "dropdown"):
        mapped = _list_mapping(raw_value, payload.get(key))
        if mapped is not None:
            return mapped
    mapping = payload.get("value_mapping")
    if isinstance(mapping, dict):
        if raw_value in mapping:
            return mapping[raw_value]
        if str(raw_value) in mapping:
            return mapping[str(raw_value)]
    return None


def convert_raw_to_rating(raw: int, length_bits: int) -> int:
    max_raw = (1 << length_bits) - 1
    if max_raw <= 0:
        return RATING_MIN
    rating = RATING_MIN + (raw / max_raw) * (RATING_MAX_TRUE - RATING_MIN)
    rating = max(RATING_MIN, min(RATING_MAX_DISPLAY, rating))
    return int(round(rating))


def convert_raw_to_tendency(raw: int) -> int:
    return max(0, min(100, int(raw)))


def convert_raw_to_year(raw: int, base: int = YEAR_BASE) -> int:
    v = to_int(raw)
    if v >= base:
        return v
    return base + max(0, v)


def raw_height_to_inches(raw: int) -> int:
    return max(0, int(round(to_int(raw) / HEIGHT_UNIT_SCALE)))


def convert_raw_to_body_scale(raw: Any) -> int:
    try:
        value = float(str(raw))
    except (TypeError, ValueError):
        value = 0.0
    return convert_raw_to_tendency(int(round(value * 50.0)))


def convert_raw_to_potential(raw: int, length_bits: int) -> int:
    if length_bits > 0:
        rating = convert_raw_to_rating(to_int(raw), length_bits)
    else:
        rating = to_int(raw)
    return max(40, min(99, rating))


# ---------------------------------------------------------------------------
# Display conversion (mirror field_io._raw_to_display_value)
# ---------------------------------------------------------------------------

def raw_to_display(section: str, field_name: str, payload: dict[str, Any], raw_value: Any) -> Any:
    mapped = _mapped_display(payload, raw_value)
    if mapped is not None:
        return mapped
    field_id = str(field_name or "").upper()
    length_bits = resolved_length_bits(payload)
    if "season_year_base" in payload:
        start_year = to_int(payload.get("season_year_base")) + to_int(raw_value)
        if bool(payload.get("season_range")):
            return f"{start_year}-{start_year + 1}"
        return start_year
    if "year_map_base" in payload or field_id in _YEAR_FIELD_IDS:
        return convert_raw_to_year(to_int(raw_value), to_int(payload.get("year_map_base")) or YEAR_BASE)
    if field_id in {"HEIGHT", "WINGSPAN"}:
        return raw_height_to_inches(to_int(raw_value))
    if bool(payload.get("div100")):
        return to_int(raw_value) / 100
    if bool(payload.get("body_scale_0_100")) or bool(payload.get("body_scale_25_75")):
        return convert_raw_to_body_scale(raw_value)
    if "scale" in payload:
        return float(raw_value) * float(payload.get("scale") or 1)
    if field_id == "POTENTIAL":
        return convert_raw_to_potential(to_int(raw_value), length_bits)
    if field_id in ZERO_TO_100_FIELD_IDS:
        return convert_raw_to_tendency(to_int(raw_value))
    if bool(payload.get("injury_duration_days")) or field_id in {"INJURY1DURATION", "INJURY2DURATION"}:
        return max(0, min(450, (to_int(raw_value) & 0xFFFFF) // 1440))
    if section in {"Attributes", "Durability"}:
        return convert_raw_to_rating(to_int(raw_value), length_bits)
    if section == "Tendencies":
        return convert_raw_to_tendency(to_int(raw_value))
    return raw_value


# ---------------------------------------------------------------------------
# Config-driven field read: resolves parent pointers, reads raw, displays
# ---------------------------------------------------------------------------

def _norm_key(raw: str) -> str:
    """Normalize a parent/field label for dictionary lookup ('Appearance Data' -> 'APPEARANCEDATA')."""
    return "".join(ch for ch in str(raw).upper() if ch.isalnum())


def field_address(reader: Any, record_base: int, entry: dict[str, Any], parents: dict[str, dict[str, Any]]) -> int:
    parent_name = entry.get("parent")
    if parent_name:
        parent = parents.get(_norm_key(parent_name))
        if parent is None:
            raise KeyError(f"parent '{parent_name}' not found for {entry['path']}")
        base = record_base + to_int(parent.get("offset"))
        if str(parent.get("type", "")).lower() in _PARENT_POINTER_TYPES:
            base = reader.read_u64(base)
        return base + to_int(entry.get("offset"))
    return record_base + to_int(entry.get("offset"))


def read_entry(reader: Any, record_base: int, entry: dict[str, Any], parents: dict[str, dict[str, Any]]) -> tuple[Any, Any]:
    address = field_address(reader, record_base, entry, parents)
    raw = read_field_raw(reader, address, entry)
    display = raw_to_display(entry["section"], entry["name"], entry, raw)
    return raw, display


# ---------------------------------------------------------------------------
# Encode raw back to bytes (for mock-memory verification)
# ---------------------------------------------------------------------------

def encode_raw_to_bytes(raw_value: Any, payload: dict[str, Any]) -> bytes:
    type_key = str(payload.get("type", "")).lower()
    bit_offset = to_int(payload.get("bit_offset")) or to_int(payload.get("startBit"))
    length_bits = resolved_length_bits(payload)
    uses_bitfield = (
        type_key in {"bit", "bitfield"}
        or (type_key in {"number", "integer", "int", "binary", "ushort", "uint", "uint64"} and bit_offset and length_bits > 0)
        or (type_key in {"number", "integer", "int", "binary"} and "startBit" in payload and length_bits > 0)
    )
    if uses_bitfield and (bit_offset or "startBit" in payload):
        width = _bits_to_bytes(bit_offset + length_bits)
        buf = bytearray(width)
        raw_int = int(raw_value) & ((1 << length_bits) - 1)
        shifted = (raw_int << bit_offset) & ((1 << (width * 8)) - 1)
        buf[0:width] = shifted.to_bytes(width, "little")
        return bytes(buf)
    if type_key == "float":
        return struct.pack("<f", float(raw_value))
    if type_key in {"string", "wstring"}:
        max_chars = to_int(payload.get("length")) or 64
        if type_key == "wstring":
            text = str(raw_value).encode("utf-16-le")[: (max_chars - 1) * 2]
            return text + b"\x00\x00"
        text = str(raw_value).encode("ascii", errors="replace")[: max_chars - 1]
        return text + b"\x00"
    if type_key == "ptr_string":
        return struct.pack("<Q", to_int(raw_value))
    width = numeric_width(payload)
    if width == 4 and type_key in {"float"}:
        return struct.pack("<f", float(raw_value))
    if width == 8:
        return int(raw_value).to_bytes(8, "little")
    if width == 4:
        return int(raw_value).to_bytes(4, "little")
    return int(raw_value).to_bytes(width, "little")
