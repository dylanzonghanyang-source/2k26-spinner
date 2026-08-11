#!/usr/bin/env -S node --experimental-strip-types
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const model = JSON.parse(fs.readFileSync(path.join(root, "src/data/rookieOverallModel-rookie.json"), "utf8"));
const positions = ["PG", "SG", "SF", "PF", "C"] as const;

assert.equal(model.badgeCombination, "monotonic-max-nonnegative");

for (const section of ["positions", "positionsWithBadges"] as const) {
  for (const position of positions) {
    const posModel = model[section][position];
    for (const [attribute, coefficient] of Object.entries(posModel.coefficients) as [string, number][]) {
      assert.ok(coefficient >= 0, `${section}.${position}.${attribute} coefficient must be non-negative, got ${coefficient}`);
    }
    for (const [category, coefficient] of Object.entries(posModel.badgeCoefficients ?? {}) as [string, number][]) {
      assert.ok(coefficient >= 0, `${section}.${position}.${category} badge coefficient must be non-negative, got ${coefficient}`);
    }
  }
}

function estimate(position: string, values: Record<string, number>) {
  const posModel = model.positions[position];
  const raw = model.attributes.reduce((sum: number, attribute: string) => sum + (values[attribute] ?? 45) * (posModel.coefficients[attribute] ?? 0), posModel.intercept);
  return Math.round(Math.min(99, Math.max(40, raw)));
}

for (const position of positions) {
  for (const attribute of model.attributes as string[]) {
    const lowValues = Object.fromEntries(model.attributes.map((name: string) => [name, 45]));
    const highValues = { ...lowValues, [attribute]: 99 };
    const low = estimate(position, lowValues);
    const high = estimate(position, highValues);
    assert.ok(high >= low, `${position} ${attribute} must be monotonic (${low} -> ${high})`);
  }
}

console.log("rookie OVR monotonic contract OK");
