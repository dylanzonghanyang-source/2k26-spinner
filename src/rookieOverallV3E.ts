/**
 * V3-E Display Overall — display/export/shadow 专用 OVR 估算。
 *
 * **绝对边界（Stage 6B 硬约束）**：
 * - 本模块只服务「最终显示 / 导出 / 报告 / shadow 对比」
 * - 严禁回流到 generation control：atomic attributes、potential、
 *   growth controller、constrainRookieInitialAttributes 一律不得调用本模块
 * - generation control 继续使用 legacy `estimateGameOverall`（C1/C2/C3）
 *
 * 模型：hierarchical 非负 position model（V3-E，λ1=100 / λ2=200），
 * 系数来自 scripts/export-v3e-model.mts 导出（official 664 全量训练）。
 * 34 能力属性 slope >= 0（单调），Intangibles slope 不约束。
 */
import modelData from "./data/rookieOverallV3E.json" with { type: "json" };

export type V3EDisplayInput = {
  /** 34 个能力属性值（raw 0-99 尺度），顺序必须与 model.attributes 前 34 一致 */
  attrs: number[];
  /** Intangibles（综评补偿），单独传入 */
  intangibles: number;
  /** 主位置 PG/SG/SF/PF/C */
  position: string;
};

export type V3EDisplayResult = {
  /** 连续预测（未 round，未 clamp） */
  raw: number;
  /** round + clamp 到 [40, 99] 的最终展示值 */
  score: number;
};

function clampValue(v: number, lo = 40, hi = 99) {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

const MODEL = modelData as {
  version: string;
  attributes: string[];
  positions: string[];
  perPosition: Record<string, { intercept: number; w: number[] }>;
};

/**
 * 计算 V3-E display OVR。
 * 输入 attrs 长度必须为 34；未知 position 回退 global 模型。
 */
export function estimateDisplayOverallV3E(input: V3EDisplayInput): V3EDisplayResult {
  const { attrs, intangibles, position } = input;
  if (attrs.length !== 34) {
    throw new Error(`estimateDisplayOverallV3E: expected 34 attrs, got ${attrs.length}`);
  }
  const pos = MODEL.positions.includes(position) ? position : "SF";
  const m = MODEL.perPosition[pos];
  const x = [...attrs, intangibles];
  const raw = m.intercept + x.reduce((sum, v, i) => sum + v * m.w[i], 0);
  return { raw, score: clampValue(raw) };
}

/**
 * 便捷版：直接从 Record<string, number> 取值（含 Intangibles 字段可选）。
 */
export function estimateDisplayOverallV3EFromRecord(
  values: Record<string, number>,
  position: string,
): V3EDisplayResult {
  const attrs = MODEL.attributes.slice(0, 34).map((name) => {
    const v = values[name];
    return typeof v === "number" && Number.isFinite(v) ? Math.min(99, Math.max(25, v)) : 50;
  });
  const int = values["Intangibles"] ?? 50;
  return estimateDisplayOverallV3E({ attrs, intangibles: int, position });
}

export const V3E_ATTRIBUTES = MODEL.attributes;
