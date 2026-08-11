/**
 * Height unit normalization for DB2K snapshot conversion.
 *
 * DB2K snapshots inconsistently store Vitals/HEIGHT as inches (60–100) for
 * most years and as centimeters (150–250) for the 2019–2025 partial
 * snapshots. The rookie-card contract requires `vitals.heightInches` and
 * `card.height` to ALWAYS be inches.
 *
 * This module is the single normalization point for raw DB2K height values.
 * Never multiply an unvalidated height by 2.54 downstream — route every raw
 * value through `normalizeHeightInches()` first.
 */

/** Plausible inch range for NBA players (5'0"–8'4"). */
export const HEIGHT_INCHES_MIN = 60;
export const HEIGHT_INCHES_MAX = 100;
/** Plausible centimeter range (1.50–2.50 m); values in this band are cm. */
const HEIGHT_CM_MIN = 150;
const HEIGHT_CM_MAX = 250;

/**
 * Normalize a raw DB2K HEIGHT value to inches.
 *
 * - 60–100: already inches, returned unchanged.
 * - 150–250: centimeters, converted via Math.round(n / 2.54).
 * - anything else / non-finite: null (caller must skip or flag).
 */
export function normalizeHeightInches(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n >= HEIGHT_INCHES_MIN && n <= HEIGHT_INCHES_MAX) return n;
  if (n >= HEIGHT_CM_MIN && n <= HEIGHT_CM_MAX) return Math.round(n / 2.54);
  return null;
}

/** True when an inch value is within the plausible NBA range. */
export function isPlausibleHeightInches(n) {
  return typeof n === "number" && Number.isFinite(n)
    && n >= HEIGHT_INCHES_MIN && n <= HEIGHT_INCHES_MAX;
}
