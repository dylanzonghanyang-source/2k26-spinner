/**
 * Body Degrade V2 — atomic attribute 参数配置层（唯一权威参数来源）。
 *
 * 全部数值直接取自权威 fixture：
 *   tests/fixtures/body-degrade-v2.acceptance.json
 *
 * 本文件只含数据与类型，不含计算逻辑（计算在 rookieBodyV2.ts）。
 * 禁止在业务代码中散落 198 / 28.5 / 38 等魔法数字；参数一律集中于此。
 *
 * 设计约束（spec §2）：
 * - position 不进入任何 profile / dependency
 * - wingspanScore / shoulder / neck / torso 不进入任何 profile / dependency
 * - Support 只降不升；Structural / Support 是独立 ceiling，最后取 min
 */

// ─────────────────────────────────────────────────────────────────────────────
// 类型（spec §9 推荐数据结构）
// ─────────────────────────────────────────────────────────────────────────────

export type ThresholdMode = "MIN" | "MAX";

export type StructuralVariable = "heightCm" | "bmi";

export type StructuralDependency = {
  variable: StructuralVariable;
  mode: ThresholdMode;
  baseThreshold: number;
  saturationDistance: number;
  maxCeilingReduction: number;
};

export type Requirement =
  | { kind: "constant"; value: number }
  | {
      kind: "context";
      contextVariable: "heightCm";
      curve: string;
      interpolation: "linear";
      clampOutside: boolean;
    };

export type SupportDependencyV2 = {
  supportAttr: string;
  baseRequirement: Requirement;
  saturationDistance: number;
  maxCeilingReduction: number;
};

export type AtomicBodyProfile = {
  structural?: {
    dependencies: StructuralDependency[];
    totalCap: number;
  };
  support?: {
    dependencies: SupportDependencyV2[];
    totalCap: number;
  };
};

export type ContextCurve = {
  input: "heightCm";
  interpolation: "linear";
  clampOutside: boolean;
  anchors: { heightCm: number; requirement: number }[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Contextual support curves（spec §6：线性插值，边界外 clamp 首/尾锚点）
// ─────────────────────────────────────────────────────────────────────────────

export const contextCurves: Record<string, ContextCurve> = {
  "standingDunk.vertical": {
    input: "heightCm",
    interpolation: "linear",
    clampOutside: true,
    anchors: [
      { heightCm: 198, requirement: 90 },
      { heightCm: 206, requirement: 65 },
      { heightCm: 213, requirement: 50 },
      { heightCm: 221, requirement: 40 },
      { heightCm: 229, requirement: 30 },
    ],
  },
  "offensiveRebound.vertical": {
    input: "heightCm",
    interpolation: "linear",
    clampOutside: true,
    anchors: [
      { heightCm: 198, requirement: 65 },
      { heightCm: 203, requirement: 60 },
      { heightCm: 208, requirement: 55 },
      { heightCm: 213, requirement: 48 },
      { heightCm: 218, requirement: 38 },
      { heightCm: 229, requirement: 30 },
    ],
  },
  "defensiveRebound.vertical": {
    input: "heightCm",
    interpolation: "linear",
    clampOutside: true,
    anchors: [
      { heightCm: 198, requirement: 65 },
      { heightCm: 203, requirement: 58 },
      { heightCm: 208, requirement: 52 },
      { heightCm: 213, requirement: 42 },
      { heightCm: 218, requirement: 35 },
      { heightCm: 229, requirement: 30 },
    ],
  },
  "interiorDefense.vertical": {
    input: "heightCm",
    interpolation: "linear",
    clampOutside: true,
    anchors: [
      { heightCm: 198, requirement: 65 },
      { heightCm: 203, requirement: 58 },
      { heightCm: 208, requirement: 50 },
      { heightCm: 213, requirement: 40 },
      { heightCm: 218, requirement: 32 },
      { heightCm: 229, requirement: 30 },
    ],
  },
  "block.vertical": {
    input: "heightCm",
    interpolation: "linear",
    clampOutside: true,
    anchors: [
      { heightCm: 200, requirement: 75 },
      { heightCm: 203, requirement: 70 },
      { heightCm: 208, requirement: 62 },
      { heightCm: 213, requirement: 50 },
      { heightCm: 218, requirement: 38 },
      { heightCm: 229, requirement: 30 },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Structural profiles（spec §4 表 4.1 Height / 表 4.2 BMI）
// 带 * 的属性 Height+BMI 共用 totalCap（已并入各 profile 的 totalCap 字段）。
// ─────────────────────────────────────────────────────────────────────────────

export const structuralProfiles: Record<string, AtomicBodyProfile> = {
  Layup: {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 175, saturationDistance: 15, maxCeilingReduction: 8 },
      ],
      totalCap: 8,
    },
  },
  "Post Hook": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 198, saturationDistance: 18, maxCeilingReduction: 20 },
      ],
      totalCap: 20,
    },
  },
  "Ball Handle": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MAX", baseThreshold: 210, saturationDistance: 18, maxCeilingReduction: 20 },
        { variable: "bmi", mode: "MAX", baseThreshold: 27.5, saturationDistance: 5.0, maxCeilingReduction: 14 },
      ],
      totalCap: 26,
    },
  },
  "Offensive Rebound": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 198, saturationDistance: 18, maxCeilingReduction: 24 },
        { variable: "bmi", mode: "MIN", baseThreshold: 22.5, saturationDistance: 4.0, maxCeilingReduction: 16 },
      ],
      totalCap: 30,
    },
  },
  "Standing Dunk": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 198, saturationDistance: 18, maxCeilingReduction: 35 },
      ],
      totalCap: 35,
    },
  },
  "Driving Dunk": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 180, saturationDistance: 15, maxCeilingReduction: 10 },
      ],
      totalCap: 10,
    },
  },
  "Defensive Rebound": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 195, saturationDistance: 15, maxCeilingReduction: 24 },
        { variable: "bmi", mode: "MIN", baseThreshold: 22.5, saturationDistance: 4.0, maxCeilingReduction: 18 },
      ],
      totalCap: 32,
    },
  },
  "Interior Defense": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 198, saturationDistance: 18, maxCeilingReduction: 24 },
        { variable: "bmi", mode: "MIN", baseThreshold: 22.5, saturationDistance: 4.0, maxCeilingReduction: 20 },
      ],
      totalCap: 32,
    },
  },
  "Perimeter Defense": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MAX", baseThreshold: 215, saturationDistance: 15, maxCeilingReduction: 10 },
        { variable: "bmi", mode: "MAX", baseThreshold: 27.5, saturationDistance: 5.0, maxCeilingReduction: 10 },
      ],
      totalCap: 14,
    },
  },
  Block: {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MIN", baseThreshold: 200, saturationDistance: 20, maxCeilingReduction: 32 },
      ],
      totalCap: 32,
    },
  },
  Speed: {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MAX", baseThreshold: 215, saturationDistance: 15, maxCeilingReduction: 14 },
        { variable: "bmi", mode: "MAX", baseThreshold: 28.5, saturationDistance: 4.5, maxCeilingReduction: 14 },
      ],
      totalCap: 20,
    },
  },
  Agility: {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MAX", baseThreshold: 213, saturationDistance: 15, maxCeilingReduction: 18 },
        { variable: "bmi", mode: "MAX", baseThreshold: 28.0, saturationDistance: 4.5, maxCeilingReduction: 16 },
      ],
      totalCap: 24,
    },
  },
  "Mid-Range Shot": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MAX", baseThreshold: 220, saturationDistance: 20, maxCeilingReduction: 6 },
        { variable: "bmi", mode: "MAX", baseThreshold: 30.0, saturationDistance: 6.0, maxCeilingReduction: 6 },
      ],
      totalCap: 8,
    },
  },
  "Three-Point Shot": {
    structural: {
      dependencies: [
        { variable: "heightCm", mode: "MAX", baseThreshold: 218, saturationDistance: 20, maxCeilingReduction: 8 },
        { variable: "bmi", mode: "MAX", baseThreshold: 30.0, saturationDistance: 6.0, maxCeilingReduction: 8 },
      ],
      totalCap: 10,
    },
  },
  "Post Control": {
    structural: {
      dependencies: [
        { variable: "bmi", mode: "MIN", baseThreshold: 22.0, saturationDistance: 3.5, maxCeilingReduction: 20 },
      ],
      totalCap: 20,
    },
  },
  Vertical: {
    structural: {
      dependencies: [
        { variable: "bmi", mode: "MAX", baseThreshold: 29.0, saturationDistance: 4.0, maxCeilingReduction: 18 },
      ],
      totalCap: 18,
    },
  },
  Strength: {
    structural: {
      dependencies: [
        { variable: "bmi", mode: "MIN", baseThreshold: 22.5, saturationDistance: 4.0, maxCeilingReduction: 25 },
      ],
      totalCap: 25,
    },
  },
  Stamina: {
    structural: {
      dependencies: [
        { variable: "bmi", mode: "MAX", baseThreshold: 30.0, saturationDistance: 5.0, maxCeilingReduction: 12 },
      ],
      totalCap: 12,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Support profiles（spec §7 表 7.0 + Support total caps 表）
// 没有列出的原子属性 Support = NONE。
// ─────────────────────────────────────────────────────────────────────────────

export const supportProfiles: Record<string, AtomicBodyProfile> = {
  "Ball Handle": {
    support: {
      dependencies: [
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 70 }, saturationDistance: 30, maxCeilingReduction: 18 },
      ],
      totalCap: 18,
    },
  },
  "Speed with Ball": {
    support: {
      dependencies: [
        { supportAttr: "Speed", baseRequirement: { kind: "constant", value: 80 }, saturationDistance: 30, maxCeilingReduction: 18 },
        { supportAttr: "Ball Handle", baseRequirement: { kind: "constant", value: 75 }, saturationDistance: 30, maxCeilingReduction: 24 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 25, maxCeilingReduction: 10 },
      ],
      totalCap: 32,
    },
  },
  Layup: {
    support: {
      dependencies: [
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 25, maxCeilingReduction: 14 },
        { supportAttr: "Speed with Ball", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 30, maxCeilingReduction: 9 },
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 35 }, saturationDistance: 20, maxCeilingReduction: 8 },
        { supportAttr: "Vertical", baseRequirement: { kind: "constant", value: 55 }, saturationDistance: 25, maxCeilingReduction: 7 },
      ],
      totalCap: 22,
    },
  },
  "Standing Dunk": {
    support: {
      dependencies: [
        {
          supportAttr: "Vertical",
          baseRequirement: { kind: "context", contextVariable: "heightCm", curve: "standingDunk.vertical", interpolation: "linear", clampOutside: true },
          saturationDistance: 30,
          maxCeilingReduction: 24,
        },
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 50 }, saturationDistance: 25, maxCeilingReduction: 16 },
      ],
      totalCap: 30,
    },
  },
  "Driving Dunk": {
    support: {
      dependencies: [
        { supportAttr: "Vertical", baseRequirement: { kind: "constant", value: 80 }, saturationDistance: 30, maxCeilingReduction: 38 },
        { supportAttr: "Speed with Ball", baseRequirement: { kind: "constant", value: 60 }, saturationDistance: 30, maxCeilingReduction: 18 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 60 }, saturationDistance: 25, maxCeilingReduction: 14 },
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 40 }, saturationDistance: 20, maxCeilingReduction: 10 },
      ],
      totalCap: 46,
    },
  },
  "Post Control": {
    support: {
      dependencies: [
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 60 }, saturationDistance: 25, maxCeilingReduction: 20 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 35 }, saturationDistance: 20, maxCeilingReduction: 10 },
      ],
      totalCap: 24,
    },
  },
  "Post Hook": {
    support: {
      dependencies: [
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 55 }, saturationDistance: 25, maxCeilingReduction: 12 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 30 }, saturationDistance: 20, maxCeilingReduction: 6 },
      ],
      totalCap: 14,
    },
  },
  "Post Fade": {
    support: {
      dependencies: [
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 35 }, saturationDistance: 20, maxCeilingReduction: 10 },
      ],
      totalCap: 10,
    },
  },
  "Offensive Rebound": {
    support: {
      dependencies: [
        {
          supportAttr: "Vertical",
          baseRequirement: { kind: "context", contextVariable: "heightCm", curve: "offensiveRebound.vertical", interpolation: "linear", clampOutside: true },
          saturationDistance: 25,
          maxCeilingReduction: 18,
        },
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 60 }, saturationDistance: 25, maxCeilingReduction: 18 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 30 }, saturationDistance: 20, maxCeilingReduction: 6 },
      ],
      totalCap: 28,
    },
  },
  "Defensive Rebound": {
    support: {
      dependencies: [
        {
          supportAttr: "Vertical",
          baseRequirement: { kind: "context", contextVariable: "heightCm", curve: "defensiveRebound.vertical", interpolation: "linear", clampOutside: true },
          saturationDistance: 25,
          maxCeilingReduction: 16,
        },
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 25, maxCeilingReduction: 20 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 30 }, saturationDistance: 20, maxCeilingReduction: 5 },
      ],
      totalCap: 28,
    },
  },
  "Interior Defense": {
    support: {
      dependencies: [
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 25, maxCeilingReduction: 26 },
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 40 }, saturationDistance: 20, maxCeilingReduction: 11 },
        {
          supportAttr: "Vertical",
          baseRequirement: { kind: "context", contextVariable: "heightCm", curve: "interiorDefense.vertical", interpolation: "linear", clampOutside: true },
          saturationDistance: 25,
          maxCeilingReduction: 7,
        },
      ],
      totalCap: 34,
    },
  },
  "Perimeter Defense": {
    support: {
      dependencies: [
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 75 }, saturationDistance: 30, maxCeilingReduction: 28 },
        { supportAttr: "Speed", baseRequirement: { kind: "constant", value: 70 }, saturationDistance: 30, maxCeilingReduction: 18 },
        { supportAttr: "Strength", baseRequirement: { kind: "constant", value: 45 }, saturationDistance: 20, maxCeilingReduction: 9 },
      ],
      totalCap: 36,
    },
  },
  Block: {
    support: {
      dependencies: [
        {
          supportAttr: "Vertical",
          baseRequirement: { kind: "context", contextVariable: "heightCm", curve: "block.vertical", interpolation: "linear", clampOutside: true },
          saturationDistance: 30,
          maxCeilingReduction: 40,
        },
      ],
      totalCap: 40,
    },
  },
  Steal: {
    support: {
      dependencies: [
        { supportAttr: "Agility", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 25, maxCeilingReduction: 10 },
        { supportAttr: "Speed", baseRequirement: { kind: "constant", value: 65 }, saturationDistance: 30, maxCeilingReduction: 5 },
      ],
      totalCap: 12,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DAG（spec §8：计算顺序必须固定，显式 topological order）
// ─────────────────────────────────────────────────────────────────────────────

export const dagLevels: { level: number; attrs: string[] }[] = [
  {
    level: 0,
    attrs: ["Speed", "Agility", "Vertical", "Strength", "Stamina"],
  },
  {
    level: 1,
    attrs: [
      "Ball Handle",
      "Standing Dunk",
      "Post Control",
      "Post Hook",
      "Post Fade",
      "Offensive Rebound",
      "Defensive Rebound",
      "Interior Defense",
      "Perimeter Defense",
      "Block",
      "Steal",
    ],
  },
  {
    level: 2,
    attrs: ["Speed with Ball"],
  },
  {
    level: 3,
    attrs: ["Layup", "Driving Dunk"],
  },
];

export const dagLevelOf: Record<string, number> = Object.fromEntries(
  dagLevels.flatMap(({ level, attrs }) => attrs.map((attr) => [attr, level])),
);

// ─────────────────────────────────────────────────────────────────────────────
// 属性覆盖面：profiled / passthrough 完整性（修正点 3）
// allAtomicAttrs 是生成器全量 atomic 属性（不含 Potential / Intangibles，
// 它们不参与 Body Degrade V2）。
// ─────────────────────────────────────────────────────────────────────────────

export const allAtomicAttrs: readonly string[] = [
  // 投篮
  "Three-Point Shot",
  "Mid-Range Shot",
  "Free Throw",
  // 面框
  "Layup",
  "Close Shot",
  "Draw Foul",
  "Hands",
  // 背身
  "Post Fade",
  "Post Hook",
  "Post Control",
  // 扣篮
  "Driving Dunk",
  "Standing Dunk",
  // 控球
  "Ball Handle",
  "Speed with Ball",
  // 传球
  "Pass Accuracy",
  "Pass IQ",
  "Pass Vision",
  // 防守
  "Perimeter Defense",
  "Interior Defense",
  "Steal",
  "Pass Perception",
  "Block",
  "Offensive Rebound",
  "Defensive Rebound",
  // 运动
  "Speed",
  "Agility",
  "Vertical",
  "Stamina",
  "Hustle",
  "Strength",
  // 稳定
  "Offensive Consistency",
  "Defensive Consistency",
  "Shot IQ",
  "Help Defense IQ",
  "Overall Durability",
];

/** 有 Structural 或 Support profile 的属性（V2 实际参与计算的集合）。 */
export const profiledAttrs: readonly string[] = Array.from(
  new Set([
    ...Object.keys(structuralProfiles),
    ...Object.keys(supportProfiles),
  ]),
).sort();

/** 无任何 profile 的属性：V2 显式 raw passthrough（不允许 fallback 到 V1）。 */
export const passthroughAttrs: readonly string[] = allAtomicAttrs
  .filter((attr) => !profiledAttrs.includes(attr));

/**
 * 完整性断言：确保每个 known attr 明确属于 profiled 或 passthrough，
 * 且 profile 键名没有拼错（防止未知字段偷偷走 legacy path）。
 * 在 runner / 启动时调用。
 */
export function assertProfileCoverage(): string[] {
  const errors: string[] = [];
  const profiledSet = new Set(profiledAttrs);
  const allSet = new Set(allAtomicAttrs);

  for (const attr of profiledAttrs) {
    if (!allSet.has(attr)) {
      errors.push(`profile 引用未知属性: "${attr}"（不在 allAtomicAttrs 中）`);
    }
  }
  for (const attr of allAtomicAttrs) {
    if (profiledSet.has(attr)) continue;
    if (!passthroughAttrs.includes(attr)) {
      errors.push(`属性 "${attr}" 既不在 profiled 也不在 passthrough 列表`);
    }
  }
  // passthrough 与 profiled 不得重叠
  for (const attr of passthroughAttrs) {
    if (profiledSet.has(attr)) {
      errors.push(`属性 "${attr}" 同时出现在 profiled 与 passthrough`);
    }
  }
  // DAG 拓扑：所有 support dependency 必须指向更早 level 的属性
  const levelOf = dagLevelOf;
  for (const [attr, profile] of Object.entries(supportProfiles)) {
    const attrLevel = levelOf[attr];
    if (attrLevel === undefined) {
      errors.push(`support profile "${attr}" 不在 DAG 中`);
      continue;
    }
    for (const dep of profile.support?.dependencies ?? []) {
      const depLevel = levelOf[dep.supportAttr];
      if (depLevel === undefined) {
        errors.push(`support dependency "${attr} ← ${dep.supportAttr}"：supportAttr 不在 DAG 中`);
      } else if (depLevel >= attrLevel) {
        errors.push(
          `support dependency "${attr} ← ${dep.supportAttr}" 违反拓扑：level ${depLevel} >= ${attrLevel}`,
        );
      }
    }
  }
  // structural 变量必须存在
  for (const [attr, profile] of Object.entries(structuralProfiles)) {
    for (const dep of profile.structural?.dependencies ?? []) {
      if (dep.variable !== "heightCm" && dep.variable !== "bmi") {
        errors.push(`structural dependency "${attr}" 使用未知变量 "${dep.variable}"`);
      }
    }
  }
  // contextual requirement 的 curve 必须存在
  for (const [attr, profile] of Object.entries(supportProfiles)) {
    for (const dep of profile.support?.dependencies ?? []) {
      const req = dep.baseRequirement;
      if (req.kind === "context" && !contextCurves[req.curve]) {
        errors.push(`support dependency "${attr} ← ${dep.supportAttr}" 引用未知 curve "${req.curve}"`);
      }
    }
  }
  return errors;
}
