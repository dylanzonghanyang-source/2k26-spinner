/**
 * Entry-progress persistence for the final result screen.
 *
 * The generated result lists ~200 fields (attributes / tendencies / hot
 * zones / badges) that the user transcribes into NBA 2K26. Toggling a row
 * marks it as entered; the state is persisted per result signature so a
 * refresh or returning the next day continues where the user left off.
 *
 * - key namespace: `2kspinner.entry.v1.<resultSignature>`
 * - corrupted JSON or blocked storage silently degrade to an empty set
 * - clearing progress never touches the generated result itself
 */
import { safeGetStorageItem, safeSetStorageItem, safeRemoveStorageItem } from "./storage.ts";

const ENTRY_STORAGE_PREFIX = "2kspinner.entry.v1.";

export function entryStorageKey(resultSignature: string): string {
  return `${ENTRY_STORAGE_PREFIX}${resultSignature}`;
}

/** 字段级唯一 key：同一结果内 section:field 唯一。 */
export function entryFieldKey(section: string, field: string): string {
  return `${section}:${field}`;
}

export function loadEntrySet(resultSignature: string): Set<string> {
  const raw = safeGetStorageItem(entryStorageKey(resultSignature));
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === "string"));
  } catch {
    // 损坏 JSON：丢弃，不抛错
    return new Set();
  }
}

export function saveEntrySet(resultSignature: string, entries: ReadonlySet<string>): void {
  safeSetStorageItem(entryStorageKey(resultSignature), JSON.stringify([...entries]));
}

export function clearEntrySet(resultSignature: string): void {
  safeRemoveStorageItem(entryStorageKey(resultSignature));
}

export function toggleEntrySet(entries: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(entries);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
