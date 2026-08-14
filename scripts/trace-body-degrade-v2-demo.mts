#!/usr/bin/env -S node --experimental-strip-types
/** Stage 1 收尾：打印关键 acceptance case 的完整 trace（验收要求 #7）。 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateAtomic } from "../src/rookieBodyV2.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(__dirname, "../tests/fixtures/body-degrade-v2.acceptance.json"), "utf8"),
);

function bodyFrom(o: any) {
  return { heightCm: o.heightCm, weightKg: o.weightKg };
}

function run(caseId: string, variantIndex = 0) {
  const c = fixture.cases.find((x: any) => x.id === caseId);
  if (!c) return console.log(`${caseId}: not found`);
  const i = c.inputs;
  const body = i.targetBodies?.[variantIndex] ?? i.targetBody;
  const result = evaluateAtomic({
    attr: i.attribute,
    raw: i.raw,
    targetBody: bodyFrom(body),
    donorBody: i.sourceBody ? bodyFrom(i.sourceBody) : null,
    donorObservedSupports: i.sourceSupports ?? {},
    finalizedTargetSupports: i.targetFinalSupports ?? {},
    skipBody: i.skipBody === true,
  });
  console.log(`\n=== ${caseId} ${c.title} ===`);
  console.log(`raw=${result.raw} passthrough=${result.passthrough}`);
  for (const t of result.structuralTrace) {
    console.log(
      `[structural ${t.key} ${t.mode}] base=${t.baseThresholdOrRequirement} eff=${t.effectiveThresholdOrRequirement} ` +
        `target=${t.targetValue} src=${t.sourceValue ?? "-"} viol=${t.violationOrDeficit} ` +
        `sat=${t.saturationDistance} sev=${t.severity.toFixed(6)} maxRed=${t.maxCeilingReduction} red=${t.ceilingReduction.toFixed(6)}`,
    );
  }
  console.log(`structural: uncapped=${result.uncappedStructuralReduction.toFixed(6)} capped=${result.cappedStructuralReduction} ceiling=${result.structuralCeiling.toFixed(6)}`);
  for (const t of result.supportTrace) {
    console.log(
      `[support ${t.key}] base=${t.baseThresholdOrRequirement} eff=${t.effectiveThresholdOrRequirement} ` +
        `target=${t.targetValue} src=${t.sourceValue ?? "-"} deficit=${t.violationOrDeficit} ` +
        `sat=${t.saturationDistance} sev=${t.severity.toFixed(6)} maxRed=${t.maxCeilingReduction} red=${t.ceilingReduction.toFixed(6)}`,
    );
  }
  console.log(`support: uncapped=${result.uncappedSupportReduction.toFixed(6)} capped=${result.cappedSupportReduction} ceiling=${result.supportCeiling.toFixed(6)}`);
  console.log(`finalBeforeRound=${result.finalBeforeRound.toFixed(6)} final=${result.final}`);
}

run("F09"); // 240cm Vertical5 Driving Dunk
run("F10"); // 180cm Vertical20 Block
run("F11"); // 220cm BMI32.5 Agility45 Perimeter Defense
run("F07"); // Bradley contextual donor case
run("F19", 1); // Zion donor-expanded BMI case (target BMI 34)
