import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd());
const model26 = JSON.parse(readFileSync(path.join(root, "src/data/versions/2k26/rookieOverallModel.json"), "utf8"));
const model27 = JSON.parse(readFileSync(path.join(root, "src/data/versions/2k27-play-now/rookieOverallModel.json"), "utf8"));

for (const [label, model] of [["2k26", model26], ["2k27", model27]]) {
  assert.equal(model.dataVersion, "2K26 + 2K27 combined", `${label} must use the combined model metadata`);
  assert.deepEqual(model.sourceVersions, ["2k26", "2k27"], `${label} must record both training sources`);
  assert.equal(model.foldStrategy, "player-id", `${label} must group shared player IDs during CV`);
  assert.equal(model.trainingSamples, 958, `${label} must contain 958 complete cross-version samples`);
  assert.equal(model.crossValidation.mae, 1.818, `${label} combined CV MAE changed unexpectedly`);
  assert.equal(model.crossValidation.badgeSubsetMae, 1.572, `${label} combined badge CV MAE changed unexpectedly`);
  assert(model.crossValidation.badgeSubsetMae < model.crossValidation.mae, `${label} badge path must improve held-out MAE`);
}

assert.deepEqual(model26.positions, model27.positions, "2K26 and 2K27 must share attribute OVR coefficients");
assert.deepEqual(model26.positionsWithBadges, model27.positionsWithBadges, "2K26 and 2K27 must share badge OVR coefficients");
console.log("versioned overall model OK: 958 combined samples, non-negative coefficients, shared params, grouped CV");
