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
import { bundles, type Position, type LockState } from "./createResult.ts";
import type { BuilderBody } from "./rookieBodyConstraints.ts";

export const DRAFT_STORAGE_KEY = "2kspinner.draft.v1";
export const DRAFT_VERSION = 1;

/** 难度预设：控制随机模式每局的"换一批"次数。 */
export type BuilderDifficulty = "relaxed" | "standard" | "hard" | "ironman";
export const SWITCH_LIMIT_BY_DIFFICULTY: Record<BuilderDifficulty, number> = {
  relaxed: 5,
  standard: 3,
  hard: 1,
  ironman: 0,
};

/** Legacy/corrupt drafts must not put the builder into an impossible preset. */
export function normalizeBuilderDifficulty(value: unknown): BuilderDifficulty {
  return value === "relaxed" || value === "standard" || value === "hard" || value === "ironman"
    ? value
    : "standard";
}

/** Preserve spent switches on restore but never grant or retain an invalid budget. */
export function normalizeSwitchesLeft(value: unknown, difficulty: BuilderDifficulty): number {
  const maximum = SWITCH_LIMIT_BY_DIFFICULTY[difficulty];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, maximum)
    : maximum;
}

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
  /** Which builder flow wrote the draft; legacy drafts default to random. */
  selectionMode?: "random" | "manual";
  manualSetupDone: boolean;
  skipBodyConstraints: boolean;
  difficulty?: BuilderDifficulty;
  round: { teamId: string; offset: number; playerOrder: string[] } | null;
  status: string;
  /** Completed-result snapshot: lets a finished page survive refresh (H1). */
  resultSnapshot?: ResultSnapshot | null;
};

/** Serializable slice of the finished result page (see RookieBuilder). */
export type ResultSnapshot = {
  /** JSON.stringify of the serializable createResult output (plain data). */
  resultJson: string;
  status: string;
};

export type DraftRound = NonNullable<RookieDraft["round"]>;

const validPositions = new Set<Position>(["PG", "SG", "SF", "PF", "C"]);
const bundlesById = new Map(bundles.map((bundle) => [bundle.id, bundle]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRating(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 25 && value <= 99;
}

function normalizeBody(value: unknown): BuilderBody | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.height) || value.height < 150 || value.height > 300) return null;
  if (!isFiniteNumber(value.weight) || value.weight < 50 || value.weight > 200) return null;
  const shapeKeys = ["wingspan", "shoulder", "neck", "torso"] as const;
  if (!shapeKeys.every((key) => isFiniteNumber(value[key]) && value[key] >= 1 && value[key] <= 100)) return null;
  return {
    height: value.height,
    weight: value.weight,
    wingspan: value.wingspan as number,
    shoulder: value.shoulder as number,
    neck: value.neck as number,
    torso: value.torso as number,
  } as BuilderBody;
}

function normalizeLocks(value: unknown): LockState {
  if (!isRecord(value)) return {};
  const locks: LockState = {};
  for (const [bundleId, lock] of Object.entries(value)) {
    const bundle = bundlesById.get(bundleId);
    if (!bundle || !isRecord(lock)) continue;
    if (lock.kind === "player" && typeof lock.playerId === "string" && lock.playerId) {
      locks[bundleId] = { kind: "player", playerId: lock.playerId };
      continue;
    }
    if (lock.kind === "custom" && bundleId !== "potential" && isRecord(lock.values)) {
      const customValues = lock.values as Record<string, unknown>;
      // The editor only commits a custom lock after every bundle attribute is
      // supplied. Retain that invariant on restore: do not silently fill a
      // damaged draft's missing fields with evaluateCustom()'s fallback 75.
      const values = Object.fromEntries(
        bundle.attrs.flatMap((attr) => isRating(customValues[attr]) ? [[attr, customValues[attr]]] : []),
      ) as Record<string, number>;
      if (Object.keys(values).length === bundle.attrs.length) {
        locks[bundleId] = { kind: "custom", values };
      }
    }
  }
  return locks;
}

function normalizeRound(value: unknown): DraftRound | null {
  if (!isRecord(value)) return null;
  if (typeof value.teamId !== "string" || !value.teamId) return null;
  if (typeof value.offset !== "number" || !Number.isInteger(value.offset) || value.offset < 0) return null;
  if (!Array.isArray(value.playerOrder) || !value.playerOrder.every((id) => typeof id === "string" && id)) return null;
  return { teamId: value.teamId, offset: value.offset, playerOrder: value.playerOrder };
}

/** Restore the completed-result snapshot only when it is fully shaped. */
export function normalizeResultSnapshot(value: unknown): ResultSnapshot | null {
  if (!isRecord(value) || typeof value.resultJson !== "string" || typeof value.status !== "string") return null;
  if (value.resultJson.length < 64 || value.resultJson.length > 4_000_000) return null;
  try {
    const parsed = JSON.parse(value.resultJson) as Record<string, unknown>;
    if (!isRecord(parsed) || !isRecord(parsed.initialAttrs) || !isRecord(parsed.tendencies) || !isRecord(parsed.hotZones)) return null;
    if (!Object.values(parsed.initialAttrs).every(isFiniteNumber)) return null;
    if (!Object.values(parsed.tendencies).every(isFiniteNumber)) return null;
    if (!Array.isArray(parsed.badges) || !Array.isArray(parsed.peakBadges)) return null;
    if (!isFiniteNumber(parsed.initialStrength) || !isFiniteNumber(parsed.potential)) return null;
  } catch {
    return null;
  }
  return { resultJson: value.resultJson, status: value.status };
}

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
    if (!validPositions.has(parsed.position as Position)) return null;
    if (parsed.secondaryPosition != null && !validPositions.has(parsed.secondaryPosition as Position)) return null;
    if (typeof parsed.secondaryEnabled !== "boolean") return null;
    if (!isFiniteNumber(parsed.age) || !Number.isInteger(parsed.age) || parsed.age < 18 || parsed.age > 23) return null;
    if (typeof parsed.settingsLocked !== "boolean") return null;
    const body = normalizeBody(parsed.body);
    if (!body) return null;
    const locks = normalizeLocks(parsed.locks);
    // 无实质进度（未确认设置且无任何锁定）时视为无效草稿
    const hasProgress = parsed.settingsLocked === true || Object.keys(locks).length > 0;
    if (!hasProgress) return null;
    const difficulty = normalizeBuilderDifficulty(parsed.difficulty);
    // Pre-mode-schema manual drafts can be identified by their durable card
    // pseudo-source IDs. Other legacy/corrupt values safely use random mode.
    const selectionMode = parsed.selectionMode === "manual"
      || (parsed.selectionMode === undefined && Object.values(locks).some((lock) => lock.kind === "player" && lock.playerId.startsWith("card:")))
      ? "manual"
      : "random";
    return {
      ...parsed,
      position: parsed.position as Position,
      secondaryPosition: parsed.secondaryPosition as Position | null,
      secondaryEnabled: parsed.secondaryEnabled,
      age: parsed.age,
      body,
      settingsLocked: parsed.settingsLocked,
      manualFinalize: parsed.manualFinalize === true,
      locks,
      switchesLeft: normalizeSwitchesLeft(parsed.switchesLeft, difficulty),
      selectionMode,
      manualSetupDone: parsed.manualSetupDone === true,
      skipBodyConstraints: parsed.skipBodyConstraints === true,
      difficulty,
      round: normalizeRound(parsed.round),
      status: typeof parsed.status === "string" ? parsed.status : "已恢复草稿",
      resultSnapshot: normalizeResultSnapshot(parsed.resultSnapshot ?? null),
    } as RookieDraft;
  } catch {
    // 损坏 JSON：丢弃，不抛错
    clearDraft();
    return null;
  }
}
