/**
 * Pure wheel-spinner math: slice geometry, target rotation, hit-index reversion.
 * Coordinate convention: angle 0 = top (12 o'clock), increasing clockwise.
 * The pointer is fixed at the top; the wheel element rotates by `rotation`
 * radians (CSS rotate, clockwise positive).
 */
export const TAU = Math.PI * 2;

export function sliceAngle(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return TAU;
  return TAU / n;
}

/** Center angle of slice `i` in wheel-local coordinates (0 = top, clockwise). */
export function sliceCenterAngle(i: number, n: number): number {
  return (i + 0.5) * sliceAngle(n);
}

/**
 * Which slice index is under the top pointer after `rotation` radians?
 * Returns -1 for invalid n.
 */
export function indexForRotation(rotation: number, n: number): number {
  if (!Number.isFinite(n) || n <= 0) return -1;
  const a = ((-rotation % TAU) + TAU) % TAU;
  return Math.min(n - 1, Math.floor(a / sliceAngle(n)));
}

/**
 * Compute the next cumulative rotation that lands the top pointer on the
 * center of slice `index`. Always advances at least `minSpins` full turns
 * plus `extraSpins` (0..1) beyond the current rotation.
 */
export function targetRotation(
  current: number,
  index: number,
  n: number,
  minSpins = 5,
  extraSpins = 0,
): number {
  if (!Number.isFinite(n) || n <= 0) return current;
  const clamped = Math.max(0, Math.min(n - 1, Math.floor(index)));
  // base includes fractional extraSpins turns; alignment must absorb the
  // base's own phase so the final rotation mod TAU equals the target phase.
  const base = current + minSpins * TAU + extraSpins * TAU;
  const baseMod = ((base % TAU) + TAU) % TAU;
  const alignment = ((TAU - sliceCenterAngle(clamped, n) - baseMod) % TAU + TAU) % TAU;
  return base + alignment;
}
