/**
 * Adversarial tests for wheel math (src/wheelMath.ts).
 * Run: node --experimental-strip-types scripts/test-wheel-math.mts
 */
import {
  TAU,
  indexForRotation,
  sliceAngle,
  sliceCenterAngle,
  targetRotation,
} from "../src/wheelMath.ts";

let failures = 0;
let checks = 0;
function check(label: string, condition: boolean, detail = "") {
  checks++;
  if (!condition) {
    failures++;
    console.log(`❌ FAIL: ${label} ${detail}`);
  } else {
    console.log(`✅ pass: ${label}`);
  }
}

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// --- slice geometry ---
check("sliceAngle(4) = π/2", close(sliceAngle(4), Math.PI / 2));
check("sliceAngle(1) = 2π", close(sliceAngle(1), TAU));
check("sliceAngle(0) guarded", close(sliceAngle(0), TAU));
check("sliceAngle(-3) guarded", close(sliceAngle(-3), TAU));
check("sliceAngle(NaN) guarded", close(sliceAngle(NaN), TAU));
check("sliceCenter(0,4) = π/4", close(sliceCenterAngle(0, 4), Math.PI / 4));
check("sliceCenter(3,4) = 7π/4", close(sliceCenterAngle(3, 4), (7 * Math.PI) / 4));

// --- index reversion (clockwise: θ=π/2 puts the slice originally at 270° under the top pointer) ---
check("indexForRotation(0, 4) = 0", indexForRotation(0, 4) === 0);
check("indexForRotation(π/2, 4) = 3", indexForRotation(Math.PI / 2, 4) === 3);
check("indexForRotation(π, 4) = 2", indexForRotation(Math.PI, 4) === 2);
check("indexForRotation(3π/2 - ε, 4) = 1", indexForRotation((3 * Math.PI) / 2 - 1e-9, 4) === 1);
check("indexForRotation(TAU*3 + π, 4) = 2 (multi-turn)", indexForRotation(TAU * 3 + Math.PI, 4) === 2);
check("indexForRotation(-π/2, 4) = 1 (negative)", indexForRotation(-Math.PI / 2, 4) === 1);
check("indexForRotation(0, 1) = 0", indexForRotation(0, 1) === 0);
check("indexForRotation(anything, 1) = 0", indexForRotation(123.456, 1) === 0);
check("indexForRotation(0, 0) = -1", indexForRotation(0, 0) === -1);
check("indexForRotation(π, 60) in range", indexForRotation(Math.PI, 60) >= 0 && indexForRotation(Math.PI, 60) < 60);

// --- target rotation lands exactly on requested slice center ---
for (const [n, i] of [[8, 0], [8, 7], [4, 2], [60, 59], [1, 0], [2, 1]] as const) {
  const t = targetRotation(0, i, n, 5, 0);
  check(`targetRotation(0, ${i}, ${n}) lands on ${i}`, indexForRotation(t, n) === i, `idx=${indexForRotation(t, n)}`);
  check(`targetRotation(0, ${i}, ${n}) advances ≥5 turns`, t >= 5 * TAU - 1e-9);
}

// --- cumulative spins: second spin continues from first ---
{
  const n = 10;
  const first = targetRotation(0, 3, n, 5, 0.3);
  const second = targetRotation(first, 7, n, 5, 0.7);
  check("second spin > first", second > first + 5 * TAU - 1e-9);
  check("second spin lands on 7", indexForRotation(second, n) === 7, `idx=${indexForRotation(second, n)}`);
}

// --- extraSpins bounds ---
{
  const n = 6;
  for (const extra of [0, 0.25, 0.999]) {
    const t = targetRotation(1.7, 2, n, 4, extra);
    const delta = t - 1.7;
    // alignment may add up to ~1 extra turn on top of minSpins+extra turns
    check(`extra=${extra}: delta in [4,6) turns`, delta >= 4 * TAU - 1e-9 && delta < 6 * TAU, `delta=${delta}`);
  }
}

// --- edge: index clamp ---
{
  const t = targetRotation(0, 99, 8, 3, 0);
  check("index 99 clamps to 7", indexForRotation(t, 8) === 7);
}

// --- round-trip: for all n in 1..60 and all slices ---
{
  let ok = true;
  for (let n = 1; n <= 60; n++) {
    for (let i = 0; i < n; i++) {
      const t = targetRotation(0, i, n, 2, 0.5);
      if (indexForRotation(t, n) !== i) { ok = false; console.log(`round-trip fail n=${n} i=${i}`); break; }
    }
    if (!ok) break;
  }
  check("round-trip all n∈[1,60] all slices", ok);
}

console.log(`\n===== wheel-math: ${checks - failures}/${checks} passed, ${failures} failed =====`);
process.exit(failures > 0 ? 1 : 0);
