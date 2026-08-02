/**
 * Compare production attribute OVR vs official OVR, and test whether badge
 * points from badgeProfiles.json reduce residual error.
 */
import detailedPlayers from "../src/data/players.json" with { type: "json" };
import rosterCatalog from "../src/data/rosterCatalog.json" with { type: "json" };
import rookieOverallModel from "../src/data/rookieOverallModel.json" with { type: "json" };
import badgeProfiles from "../src/data/badgeProfiles.json" with { type: "json" };

const attributes = rookieOverallModel.attributes;
const positions = ["PG", "SG", "SF", "PF", "C"];
const tierPoints = { Bronze: 1, Silver: 2, Gold: 3, HOF: 4 };
const detailedBySlug = new Map(detailedPlayers.map((player) => [player.slug, player]));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function estimate(values, position) {
  const model = rookieOverallModel.positions[position] ?? rookieOverallModel.positions.SF;
  const estimateValue = attributes.reduce((total, attribute) => {
    const raw = values[attribute];
    const resolved = Number.isFinite(raw) ? clamp(raw, 25, 99) : attribute === "Intangibles" ? 50 : 65;
    return total + resolved * (model.coefficients[attribute] ?? 0);
  }, model.intercept);
  return Math.round(clamp(estimateValue, 40, 99));
}

function badgePoints(badges) {
  if (!Array.isArray(badges) || badges.length === 0) return 0;
  return badges.reduce((sum, badge) => sum + (tierPoints[badge.tier] ?? 0), 0);
}

function defenseBadgePoints(badges) {
  if (!Array.isArray(badges)) return 0;
  return badges
    .filter((badge) => badge.category === "defense" || /pest|menace|challenger|interceptor|glove|denier|lockdown|patroller|dodger|pogo/i.test(badge.name))
    .reduce((sum, badge) => sum + (tierPoints[badge.tier] ?? 0), 0);
}

const samples = rosterCatalog.teams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players)
  .flatMap((player) => {
    const detailed = detailedBySlug.get(player.id);
    if (!detailed || typeof player.overall !== "number") return [];
    const [position] = String(player.position ?? "SF").split("/");
    if (!positions.includes(position)) return [];
    const badges = badgeProfiles[player.id] ?? [];
    const pred = estimate(detailed.detailed ?? {}, position);
    const points = badgePoints(badges);
    const defensePoints = defenseBadgePoints(badges);
    return [{
      id: player.id,
      name: player.name,
      position,
      official: player.overall,
      pred,
      residual: player.overall - pred,
      points,
      defensePoints,
      badgeCount: badges.length,
      hasBadges: badges.length > 0,
    }];
  });

const withBadges = samples.filter((sample) => sample.hasBadges);
const withoutBadges = samples.filter((sample) => !sample.hasBadges);

function metrics(rows, key = "pred") {
  const errors = rows.map((row) => row[key] - row.official);
  const abs = errors.map(Math.abs);
  return {
    n: rows.length,
    mae: average(abs),
    rmse: Math.sqrt(average(errors.map((error) => error ** 2))),
    bias: average(errors),
    within2: rows.filter((row) => Math.abs(row[key] - row.official) <= 2).length / Math.max(1, rows.length),
  };
}

function fitBadgeAdjustment(rows, xKey = "points") {
  // residual (official - pred) ~ a + b * x
  const xs = rows.map((row) => row[xKey] ?? 0);
  const ys = rows.map((row) => row.residual);
  const meanX = average(xs);
  const meanY = average(ys);
  const variance = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  if (variance < 1e-6) return { intercept: meanY, slope: 0, xKey };
  const slope = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0) / variance;
  return { intercept: meanY - slope * meanX, slope, xKey };
}

function fitTwoFeature(rows) {
  // residual ~ a + b*points + c*defensePoints  (normal equations, 3x3)
  const n = rows.length;
  if (n < 10) return null;
  let s1 = 0, sx = 0, sz = 0, sy = 0;
  let sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (const row of rows) {
    const x = row.points;
    const z = row.defensePoints;
    const y = row.residual;
    s1 += 1;
    sx += x; sz += z; sy += y;
    sxx += x * x; szz += z * z; sxz += x * z;
    sxy += x * y; szy += z * y;
  }
  // Solve [[n,sx,sz],[sx,sxx,sxz],[sz,sxz,szz]] * [a,b,c] = [sy,sxy,szy]
  const A = [
    [s1, sx, sz],
    [sx, sxx, sxz],
    [sz, sxz, szz],
  ];
  const Y = [sy, sxy, szy];
  const coef = solve3(A, Y);
  if (!coef) return null;
  return { intercept: coef[0], slopePoints: coef[1], slopeDefense: coef[2] };
}

function solve3(A, Y) {
  // Gaussian elimination with partial pivot
  const M = A.map((row, i) => [...row, Y[i]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let j = col; j < 4; j += 1) M[col][j] /= div;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j < 4; j += 1) M[row][j] -= factor * M[col][j];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

function applyBadgeModel(rows, model) {
  return rows.map((row) => {
    let delta = model.intercept;
    if (model.xKey) delta += model.slope * (row[model.xKey] ?? 0);
    else if (model.slopePoints != null) {
      delta += model.slopePoints * row.points + model.slopeDefense * row.defensePoints;
    } else {
      delta += model.slope * row.points;
    }
    return {
      ...row,
      predBadge: Math.round(clamp(row.pred + delta, 40, 99)),
    };
  });
}

function corr(xs, ys) {
  const meanX = average(xs);
  const meanY = average(ys);
  const num = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0);
  const denX = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0));
  const denY = Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0));
  return denX && denY ? num / (denX * denY) : 0;
}

console.log("=== Badge coverage ===");
console.log(`detailed current samples: ${samples.length}`);
console.log(`with badges: ${withBadges.length} (${(withBadges.length / samples.length * 100).toFixed(1)}%)`);
console.log(`without badges: ${withoutBadges.length}`);
if (withBadges.length) {
  console.log(`avg badge count: ${average(withBadges.map((row) => row.badgeCount)).toFixed(1)}`);
  console.log(`avg badge points: ${average(withBadges.map((row) => row.points)).toFixed(1)}`);
  console.log(`avg defense badge points: ${average(withBadges.map((row) => row.defensePoints)).toFixed(1)}`);
}

console.log("\n=== Attribute-only production model ===");
console.log(`all: ${format(metrics(samples))}`);
if (withBadges.length) console.log(`badge subset attr-only: ${format(metrics(withBadges))}`);
if (withoutBadges.length) console.log(`no-badge subset attr-only: ${format(metrics(withoutBadges))}`);

if (withBadges.length >= 30) {
  const model = fitBadgeAdjustment(withBadges, "points");
  const adjusted = applyBadgeModel(withBadges, model);
  const defModel = fitBadgeAdjustment(withBadges, "defensePoints");
  const defAdjusted = applyBadgeModel(withBadges, defModel);
  const two = fitTwoFeature(withBadges);
  console.log("\n=== Experimental badge residual model ===");
  console.log(`fit(all pts): residual ≈ ${model.intercept.toFixed(3)} + ${model.slope.toFixed(4)} * badgePoints`);
  console.log(`badge subset + all-pts adj: ${format(metrics(adjusted, "predBadge"))}`);
  console.log(`fit(def pts): residual ≈ ${defModel.intercept.toFixed(3)} + ${defModel.slope.toFixed(4)} * defenseBadgePoints`);
  console.log(`badge subset + def-pts adj: ${format(metrics(defAdjusted, "predBadge"))}`);
  if (two) {
    const twoAdj = applyBadgeModel(withBadges, two);
    console.log(`fit(2feat): residual ≈ ${two.intercept.toFixed(3)} + ${two.slopePoints.toFixed(4)}*pts + ${two.slopeDefense.toFixed(4)}*defPts`);
    console.log(`badge subset + 2feat adj: ${format(metrics(twoAdj, "predBadge"))}`);
  }
  console.log(`corr(residual, badgePoints): ${corr(withBadges.map((row) => row.residual), withBadges.map((row) => row.points)).toFixed(3)}`);
  console.log(`corr(residual, defenseBadgePoints): ${corr(withBadges.map((row) => row.residual), withBadges.map((row) => row.defensePoints)).toFixed(3)}`);

  const underrated = [...withBadges].filter((row) => row.residual >= 2).sort((a, b) => b.residual - a.residual).slice(0, 10);
  console.log("\nOfficial higher than attr model (need badges?) top residuals:");
  for (const row of underrated) {
    const allAdj = Math.round(clamp(row.pred + model.intercept + model.slope * row.points, 40, 99));
    const defAdj = Math.round(clamp(row.pred + defModel.intercept + defModel.slope * row.defensePoints, 40, 99));
    console.log(`  ${row.name} (${row.position}) off=${row.official} pred=${row.pred} residual=+${row.residual} badges=${row.badgeCount} pts=${row.points} defPts=${row.defensePoints} → allPts=${allAdj} defPtsModel=${defAdj}`);
  }
} else {
  console.log("\nNot enough badge-covered players to fit residual model yet.");
}

function format(result) {
  return `n=${result.n} MAE=${result.mae.toFixed(2)} RMSE=${result.rmse.toFixed(2)} bias=${result.bias.toFixed(2)} ≤2=${(result.within2 * 100).toFixed(0)}%`;
}
