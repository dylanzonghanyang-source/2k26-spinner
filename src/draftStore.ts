/**
 * Draft persistence for the 16-slot rookie flow.
 *
 * Stores the recoverable subset of builder state under a versioned key so a
 * refresh or Safari page reclamation doesn't zero out a long manual flow.
 * - corrupted JSON is dropped and reported (never crashes)
 * - storage blocked (privacy sandbox etc.) silently degrades to memory-only
 * - restore is opt-in: the builder shows 恢复草稿 / 清空草稿
 */
import { safeGetStorageItem, safeSetStorageItem, safeRemoveStorageItem } from "./storage.ts";
import type { Position } from "./createResult.ts";
import type { LockState } from "./createResult.ts";
import type { BuilderBody } from "./rookieBodyConstraints.ts";

export const DRAFT_STORAGE_KEY = "2kspinner.draft.v1";
export const DRAFT_VERSION = 1;

export type RookieDraft = {
  version: typeof DRAFT_VERSION;
  savedAt: number;
  firstName: string;
  lastName: string;
  position: Position;
  secondaryPosition: Position | null;
  secondaryEnabled: boolean;
  age: number;
  body: BuilderBody;
  settingsLocked: boolean;
  manualFinalize: boolean;
  locks: LockState;
  switchesLeft: number;
  manualSetupDone: boolean;
  skipBodyConstraints: boolean;
  round: { teamId: string; offset: number; playerOrder: string[] } | null;
  status: string;
};

export type DraftRound = NonNullable<RookieDraft["round"]>;

export function saveDraft(draft: RookieDraft): void {
  safeSetStorageItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  safeRemoveStorageItem(DRAFT_STORAGE_KEY);
}

/**
 * Read and validate the persisted draft. Returns null when absent, corrupt,
 * version-mismatched, or carrying no meaningful progress (nothing locked and
 * settings never confirmed).
 */
export function loadDraft(): RookieDraft | null {
  const raw = safeGetStorageItem(DRAFT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RookieDraft>;
    if (parsed.version !== DRAFT_VERSION) return null;
    if (typeof parsed.savedAt !== "number") return null;
    if (typeof parsed.firstName !== "string" || typeof parsed.lastName !== "string") return null;
    if (typeof parsed.settingsLocked !== "boolean") return null;
    if (!parsed.locks || typeof parsed.locks !== "object") return null;
    if (typeof parsed.age !== "number") return null;
    if (!parsed.body || typeof parsed.body !== "object") return null;
    // 无实质进度（未确认设置且无任何锁定）时视为无效草稿
    const hasProgress = parsed.settingsLocked === true || Object.keys(parsed.locks).length > 0;
    if (!hasProgress) return null;
    return parsed as RookieDraft;
  } catch {
    // 损坏 JSON：丢弃，不抛错
    clearDraft();
    return null;
  }
}
