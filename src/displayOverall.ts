/**
 * Display Overall 解析辅助（Stage 6C / 6C.1 — UI Cutover + Legacy Save Semantics）。
 *
 * 所有用户可见的当前球员 Overall 统一使用 v3eDisplayOverall。
 * baseOverall / initialStrength（legacy control）仅供内部 generation/debug。
 *
 * 旧存档兼容（Stage 6C.1 provenance 审计）：
 *   旧存档 initialAttrs.Intangibles 可能是 pre-6B 的 control/Potential-donor 值，
 *   不得默认当作 Final display policy 值。可证明安全时才重算：
 *     S1  native：有 v3eDisplayOverall（当前 createResult 输出）
 *     S2  stored Intangibles == 50：任何场景（custom=50 / single real=50 /
 *          multi-donor neutral）Final display 都是 50 → 用 50 重算
 *     S3  result.card 存在 且 card.detailed.Intangibles === stored：
 *          证明 stored 是 single-card real（或 custom 恰好同值，结果等价）
 *          → 用 stored 重算
 *     S4  其他（stored ≠ 50 且无法证明来源：可能是 multi-donor Potential-donor
 *          污染或 custom 覆盖）→ 不猜测，进入 legacyFallback 并标记
 *   绝不修改旧存档 attributes / growth / potential。
 */
import { estimateDisplayOverallV3EFromRecord } from "./rookieOverallV3E.ts";

export type DisplayOverallResolution = {
  /** 用户可见 Overall（V3-E display）。 */
  overall: number;
  /** 重算来源：原生字段 / recomputed / legacyFallback。 */
  source: "native" | "recomputed" | "legacyFallback";
};

type CardLike = {
  detailed?: Record<string, number | null> | null;
} | null | undefined;

/**
 * 解析任意 result-like 对象的 display overall。
 * result 需含 position 与 initialAttrs；card 为可选的 singleCard 判定信息
 * （createResult 返回的 result.card）。
 */
export function resolveDisplayOverall(result: {
  v3eDisplayOverall?: number | null;
  initialStrength?: number | null;
  baseOverall?: number | null;
  position?: string | null;
  initialAttrs?: Record<string, number> | null;
  card?: CardLike;
}): DisplayOverallResolution {
  // S1. 原生 V3-E 字段（当前 createResult 输出）
  if (typeof result.v3eDisplayOverall === "number" && Number.isFinite(result.v3eDisplayOverall)) {
    return { overall: result.v3eDisplayOverall, source: "native" };
  }
  // 重算所需数据检查
  if (!result.initialAttrs || typeof result.initialAttrs !== "object" || !result.position) {
    return legacyFallback(result);
  }
  const storedInt = result.initialAttrs["Intangibles"];
  if (typeof storedInt !== "number" || !Number.isFinite(storedInt)) {
    return legacyFallback(result);
  }
  // S2. stored == 50 → Final display 必为 50（任何场景），安全重算
  if (storedInt === 50) {
    return recompute(result, 50);
  }
  // S3. single-card 可证明：card 存在且卡 real Intangibles === stored
  const cardInt = result.card?.detailed?.["Intangibles"];
  if (typeof cardInt === "number" && cardInt === storedInt) {
    return recompute(result, storedInt);
  }
  // S4. 无法证明来源 → 不猜测，legacyFallback
  return legacyFallback(result);
}

function recompute(
  result: { position?: string | null; initialAttrs?: Record<string, number> | null },
  intangibles: number,
): DisplayOverallResolution {
  try {
    const resolved = estimateDisplayOverallV3EFromRecord(
      { ...result.initialAttrs!, Intangibles: intangibles },
      result.position!,
    );
    if (Number.isFinite(resolved.score)) {
      return { overall: resolved.score, source: "recomputed" };
    }
  } catch {
    // fall through
  }
  return legacyFallback(result);
}

function legacyFallback(result: Record<string, unknown>): DisplayOverallResolution {
  const initialStrength = result["initialStrength"];
  const baseOverall = result["baseOverall"];
  if (typeof initialStrength === "number" && Number.isFinite(initialStrength)) {
    return { overall: initialStrength, source: "legacyFallback" };
  }
  if (typeof baseOverall === "number" && Number.isFinite(baseOverall)) {
    return { overall: baseOverall, source: "legacyFallback" };
  }
  return { overall: 0, source: "legacyFallback" };
}
