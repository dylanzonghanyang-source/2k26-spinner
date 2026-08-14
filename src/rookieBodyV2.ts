/**
 * Body Degrade V2 — 纯函数计算引擎。
 *
 * 只读配置（rookieAtomicBodyProfiles.ts），只做计算，无副作用、无 React、
 * 无 V1 依赖。所有中间值保留 float，仅最终一次 round + clamp。
 *
 * 核心公式（spec §0 / §3 / §5）：
 *   finalAtomic = roundAndClamp(min(raw, structuralCeiling, supportCeiling))
 *
 * Structural 与 Support 是独立 bottleneck ceiling，绝不相加、不连减。
 *
 * 硬性排除：position / wingspanScore / shoulder / neck / torso
 * 不进入本模块的任何输入（类型层面也不出现）。
 */

import {
  assertProfileCoverage,
  contextCurves,
  dagLevelOf,
  structuralProfiles,
  supportProfiles,
  type AtomicBodyProfile,
  type StructuralDependency,
  type SupportDependencyV2,
  type ThresholdMode,
} from "./rookieAtomicBodyProfiles.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 输入 / 输出类型（spec §10）
// ─────────────────────────────────────────────────────────────────────────────

export type BodyV2 = {
  heightCm: number;
  weightKg: number;
};

export type AtomicEvaluationInput = {
  attr: string;
  raw: number;
  /** target 合成人身体（spec §10 targetBody） */
  targetBody: BodyV2;
  /** donor 身体（提供该 raw 的同一 slot donor）；null = 无来源身体数据 */
  donorBody: BodyV2 | null;
  /** donor 自己的 support 观测值（同 donor，非生成球员运动槽 donor） */
  donorObservedSupports: Record<string, number | undefined>;
  /** target DAG 中已 finalize 的 support 值 */
  finalizedTargetSupports: Record<string, number | undefined>;
  skipBody?: boolean;
};

export type FactorTrace = {
  /** structural: "heightCm" | "bmi"；support: supportAttr 名 */
  key: string;
  mode?: ThresholdMode;
  baseThresholdOrRequirement: number;
  effectiveThresholdOrRequirement: number;
  /** target 侧值：身高 cm / BMI / target support 值 */
  targetValue: number;
  /** donor 侧值（height cm / BMI / donor support），缺失时为 undefined */
  sourceValue?: number;
  violationOrDeficit: number;
  saturationDistance: number;
  severity: number;
  maxCeilingReduction: number;
  ceilingReduction: number;
};

export type AtomicEvaluationResult = {
  attr: string;
  raw: number;
  passthrough: boolean;
  structuralCeiling: number;
  supportCeiling: number;
  uncappedStructuralReduction: number;
  cappedStructuralReduction: number;
  uncappedSupportReduction: number;
  cappedSupportReduction: number;
  finalBeforeRound: number;
  final: number;
  structuralTrace: FactorTrace[];
  supportTrace: FactorTrace[];
  /** 数据缺失被跳过的 dependency 描述 */
  incomplete: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// 基础纯函数
// ─────────────────────────────────────────────────────────────────────────────

export function bmi(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return weightKg / (heightM * heightM);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** smoothstep：x=clamp(v/s,0,1); severity=3x²-2x³（spec §3.5 / §5.5） */
export function smoothstep(violation: number, saturationDistance: number): number {
  const x = clamp01(violation / saturationDistance);
  return 3 * x * x - 2 * x * x * x;
}

export function clampRating(value: number, min = 25, max = 99): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** 最终一步：round 后 clamp 到 [25,99]（spec：roundAndClamp） */
export function roundAndClamp(value: number): number {
  return clampRating(value);
}

/** contextual curve 线性插值，边界外 clamp 首/尾锚点（spec §6） */
export function interpolateCurve(curveName: string, heightCm: number): number {
  const curve = contextCurves[curveName];
  if (!curve) throw new Error(`unknown context curve: ${curveName}`);
  const anchors = curve.anchors;
  if (anchors.length === 0) throw new Error(`empty context curve: ${curveName}`);
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (heightCm <= first.heightCm) return first.requirement;
  if (heightCm >= last.heightCm) return last.requirement;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (heightCm >= a.heightCm && heightCm <= b.heightCm) {
      const span = b.heightCm - a.heightCm;
      if (span === 0) return b.requirement;
      const t = (heightCm - a.heightCm) / span;
      return a.requirement + (b.requirement - a.requirement) * t;
    }
  }
  return last.requirement;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural Engine（spec §3 / §4）
// ─────────────────────────────────────────────────────────────────────────────

function structuralTargetValue(dep: StructuralDependency, targetBody: BodyV2): number {
  return dep.variable === "heightCm" ? targetBody.heightCm : bmi(targetBody.weightKg, targetBody.heightCm);
}

function donorStructuralValue(dep: StructuralDependency, donorBody: BodyV2 | null): number | undefined {
  if (!donorBody) return undefined;
  return dep.variable === "heightCm" ? donorBody.heightCm : bmi(donorBody.weightKg, donorBody.heightCm);
}

function effectiveThresholdFor(dep: StructuralDependency, donorValue: number | undefined): number {
  if (donorValue === undefined) return dep.baseThreshold;
  return dep.mode === "MIN"
    ? Math.min(dep.baseThreshold, donorValue)
    : Math.max(dep.baseThreshold, donorValue);
}

function violationFor(dep: StructuralDependency, effectiveThreshold: number, targetValue: number): number {
  return dep.mode === "MIN"
    ? Math.max(0, effectiveThreshold - targetValue)
    : Math.max(0, targetValue - effectiveThreshold);
}

export type StructuralResult = {
  ceiling: number;
  uncappedReduction: number;
  cappedReduction: number;
  totalCap: number;
  trace: FactorTrace[];
};

/**
 * Structural evaluator（修正点 2 签名）：
 * profile 可同时含 Height 与 BMI dependency；donorBody 传入后由每个
 * dependency 根据 variable 独立解析 donor height / donor BMI。
 */
export function evaluateStructural(
  profile: AtomicBodyProfile,
  targetBody: BodyV2,
  donorBody: BodyV2 | null,
): StructuralResult {
  const structural = profile.structural;
  if (!structural) {
    return { ceiling: 99, uncappedReduction: 0, cappedReduction: 0, totalCap: 0, trace: [] };
  }
  let uncapped = 0;
  const trace: FactorTrace[] = [];
  for (const dep of structural.dependencies) {
    const donorValue = donorStructuralValue(dep, donorBody);
    const effectiveThreshold = effectiveThresholdFor(dep, donorValue);
    const targetValue = structuralTargetValue(dep, targetBody);
    const violation = violationFor(dep, effectiveThreshold, targetValue);
    const severity = smoothstep(violation, dep.saturationDistance);
    const reduction = severity * dep.maxCeilingReduction;
    uncapped += reduction;
    trace.push({
      key: dep.variable,
      mode: dep.mode,
      baseThresholdOrRequirement: dep.baseThreshold,
      effectiveThresholdOrRequirement: effectiveThreshold,
      targetValue,
      sourceValue: donorValue,
      violationOrDeficit: violation,
      saturationDistance: dep.saturationDistance,
      severity,
      maxCeilingReduction: dep.maxCeilingReduction,
      ceilingReduction: reduction,
    });
  }
  const capped = Math.min(uncapped, structural.totalCap);
  return {
    ceiling: 99 - capped,
    uncappedReduction: uncapped,
    cappedReduction: capped,
    totalCap: structural.totalCap,
    trace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Support Engine（spec §5 / §6 / §7）
// ─────────────────────────────────────────────────────────────────────────────

function requirementFor(
  req: SupportDependencyV2["baseRequirement"],
  donorBody: BodyV2 | null,
  targetBody: BodyV2,
): { sourceRequirement: number | null; targetRequirement: number } {
  if (req.kind === "constant") {
    return { sourceRequirement: req.value, targetRequirement: req.value };
  }
  // contextual：source 侧需要 donor body 才能算 donor context requirement
  const targetRequirement = interpolateCurve(req.curve, targetBody.heightCm);
  if (!donorBody) return { sourceRequirement: null, targetRequirement };
  const sourceRequirement = interpolateCurve(req.curve, donorBody.heightCm);
  return { sourceRequirement, targetRequirement };
}

export type SupportResult = {
  ceiling: number;
  uncappedReduction: number;
  cappedReduction: number;
  totalCap: number;
  trace: FactorTrace[];
  incomplete: string[];
};

/**
 * Support evaluator。
 * - donorSupport 必须来自「提供该 target skill 的同一个 donor」；
 * - contextual dependency 的 donor exception 是「异常兑现效率」：
 *   donorException = max(0, requirement(sourceContext) - donorSupport)
 *   effectiveRequirement = max(0, requirement(targetContext) - donorException)
 *   禁止把高个 donor 的低 requirement 偷渡给矮身体。
 */
export function evaluateSupport(
  profile: AtomicBodyProfile,
  targetBody: BodyV2,
  donorBody: BodyV2 | null,
  donorObservedSupports: Record<string, number | undefined>,
  finalizedTargetSupports: Record<string, number | undefined>,
): SupportResult {
  const support = profile.support;
  if (!support) {
    return { ceiling: 99, uncappedReduction: 0, cappedReduction: 0, totalCap: 0, trace: [], incomplete: [] };
  }
  let uncapped = 0;
  const trace: FactorTrace[] = [];
  const incomplete: string[] = [];

  for (const dep of support.dependencies) {
    const donorSupport = donorObservedSupports[dep.supportAttr];
    if (typeof donorSupport !== "number") {
      incomplete.push(`${dep.supportAttr}(donor support 缺失)`);
      continue;
    }
    const { sourceRequirement, targetRequirement } = requirementFor(dep.baseRequirement, donorBody, targetBody);
    if (sourceRequirement === null) {
      incomplete.push(`${dep.supportAttr}(contextual 缺 donor body)`);
      continue;
    }

    const donorException = Math.max(0, sourceRequirement - donorSupport);
    const effectiveRequirement = Math.max(0, targetRequirement - donorException);

    const targetFinalSupport = finalizedTargetSupports[dep.supportAttr];
    if (typeof targetFinalSupport !== "number") {
      incomplete.push(`${dep.supportAttr}(target support 缺失)`);
      continue;
    }

    const deficit = Math.max(0, effectiveRequirement - targetFinalSupport);
    const severity = smoothstep(deficit, dep.saturationDistance);
    const reduction = severity * dep.maxCeilingReduction;
    uncapped += reduction;
    trace.push({
      key: dep.supportAttr,
      baseThresholdOrRequirement: targetRequirement,
      effectiveThresholdOrRequirement: effectiveRequirement,
      targetValue: targetFinalSupport,
      sourceValue: donorSupport,
      violationOrDeficit: deficit,
      saturationDistance: dep.saturationDistance,
      severity,
      maxCeilingReduction: dep.maxCeilingReduction,
      ceilingReduction: reduction,
    });
  }

  const capped = Math.min(uncapped, support.totalCap);
  return {
    ceiling: 99 - capped,
    uncappedReduction: uncapped,
    cappedReduction: capped,
    totalCap: support.totalCap,
    trace,
    incomplete,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic evaluator 主入口（spec §10）
// ─────────────────────────────────────────────────────────────────────────────

export function atomicProfileFor(attr: string): AtomicBodyProfile | null {
  const structural = structuralProfiles[attr];
  const support = supportProfiles[attr];
  if (!structural && !support) return null;
  return {
    structural: structural?.structural,
    support: support?.support,
  };
}

export function evaluateAtomic(input: AtomicEvaluationInput): AtomicEvaluationResult {
  const { attr, raw } = input;
  const profile = atomicProfileFor(attr);

  if (input.skipBody) {
    return {
      attr,
      raw,
      passthrough: false,
      structuralCeiling: 99,
      supportCeiling: 99,
      uncappedStructuralReduction: 0,
      cappedStructuralReduction: 0,
      uncappedSupportReduction: 0,
      cappedSupportReduction: 0,
      finalBeforeRound: raw,
      final: roundAndClamp(raw),
      structuralTrace: [],
      supportTrace: [],
      incomplete: [],
    };
  }

  if (!profile) {
    // 显式 passthrough：无 Structural/Support profile 的属性原样通过
    // （不允许 fallback 到 V1）。ceiling 不限制，最终仍 round+clamp。
    return {
      attr,
      raw,
      passthrough: true,
      structuralCeiling: 99,
      supportCeiling: 99,
      uncappedStructuralReduction: 0,
      cappedStructuralReduction: 0,
      uncappedSupportReduction: 0,
      cappedSupportReduction: 0,
      finalBeforeRound: raw,
      final: roundAndClamp(raw),
      structuralTrace: [],
      supportTrace: [],
      incomplete: [],
    };
  }

  const structuralResult = evaluateStructural(profile, input.targetBody, input.donorBody);
  const supportResult = evaluateSupport(
    profile,
    input.targetBody,
    input.donorBody,
    input.donorObservedSupports,
    input.finalizedTargetSupports,
  );

  const finalBeforeRound = Math.min(raw, structuralResult.ceiling, supportResult.ceiling);
  return {
    attr,
    raw,
    passthrough: false,
    structuralCeiling: structuralResult.ceiling,
    supportCeiling: supportResult.ceiling,
    uncappedStructuralReduction: structuralResult.uncappedReduction,
    cappedStructuralReduction: structuralResult.cappedReduction,
    uncappedSupportReduction: supportResult.uncappedReduction,
    cappedSupportReduction: supportResult.cappedReduction,
    finalBeforeRound,
    final: roundAndClamp(finalBeforeRound),
    structuralTrace: structuralResult.trace,
    supportTrace: supportResult.trace,
    incomplete: [...supportResult.incomplete],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 顶层 DAG 评估（spec §8）：roots freeze → level1 → level2 → level3
// ─────────────────────────────────────────────────────────────────────────────

export type AtomicSource = {
  raw: number;
  donorBody: BodyV2 | null;
  donorObservedSupports: Record<string, number | undefined>;
  skipBody?: boolean;
};

/**
 * 按固定拓扑顺序评估整张 atomic 图。
 * finalizedTargetSupports 在每层结束后自动累积（读取前序层的 final 值）。
 * 输入顺序 / 对象键顺序不影响结果（依赖 level 数组驱动，而非对象遍历）。
 */
export function evaluateAtomicGraph(
  sources: Record<string, AtomicSource>,
  targetBody: BodyV2,
): Record<string, AtomicEvaluationResult> {
  const results: Record<string, AtomicEvaluationResult> = {};
  const finalizedTargetSupports: Record<string, number | undefined> = {};

  const ordered: string[] = [];
  for (let level = 0; level <= 3; level += 1) {
    ordered.push(...Object.keys(dagLevelOf).filter((a) => dagLevelOf[a] === level));
  }
  // 不在 DAG 中但提供了 source 的属性（passthrough / 未来新增）：最后评估
  for (const attr of Object.keys(sources)) {
    if (!ordered.includes(attr)) ordered.push(attr);
  }

  for (const attr of ordered) {
    const source = sources[attr];
    if (!source) continue;
    const result = evaluateAtomic({
      attr,
      raw: source.raw,
      targetBody,
      donorBody: source.donorBody,
      donorObservedSupports: source.donorObservedSupports,
      finalizedTargetSupports,
      skipBody: source.skipBody,
    });
    results[attr] = result;
    finalizedTargetSupports[attr] = result.final;
  }
  return results;
}

/** 启动期完整性自检（测试 / 接入时调用） */
export function assertV2Config(): string[] {
  return assertProfileCoverage();
}
