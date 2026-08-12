/**
 * Rule-based build profile tags for the generated rookie.
 *
 * Pure function of the FINAL initial attributes (after body constraints and
 * the OVR constraint), so the tags describe the resulting player, not the
 * source players. Thresholds are design choices — tweak here, test in
 * scripts/test-build-profile.mts.
 */
export function buildProfile(attrs: Record<string, number>): string[] {
  const mean = (keys: string[]): number | null => {
    const values = keys
      .map((key) => attrs[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const tags: string[] = [];
  const perimeter = mean(["Perimeter Defense"]);
  const three = mean(["Three-Point Shot"]);
  const mid = mean(["Mid-Range Shot"]);
  const block = mean(["Block"]);
  const rebound = mean(["Offensive Rebound", "Defensive Rebound"]);
  const passing = mean(["Pass Accuracy", "Pass IQ", "Pass Vision"]);
  const handle = mean(["Ball Handle"]);
  const layup = mean(["Layup"]);
  const dunk = mean(["Driving Dunk", "Standing Dunk"]);

  if (perimeter != null && perimeter >= 85) tags.push("精英外防");
  if (three != null && mid != null && (three + mid) / 2 >= 82) tags.push("投射稳定");
  if (block != null && block < 60) tags.push("护框有限");
  if (perimeter != null && perimeter >= 80 && three != null && three >= 78) tags.push("双向");
  if (passing != null && handle != null && (passing + handle) / 2 >= 82) tags.push("组织核心");
  if (block != null && rebound != null && (block + rebound) / 2 >= 82) tags.push("内线屏障");
  if (dunk != null && dunk >= 85) tags.push("终结高手");
  if (layup != null && layup >= 85 && three != null && three < 70) tags.push("攻框为主");
  return tags;
}
