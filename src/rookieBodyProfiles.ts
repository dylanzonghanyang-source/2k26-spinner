/**
 * 槽位级身体转移 profile。
 *
 * 与 OVR 的 positionWeights 完全分离：这里描述的是"来源球员属性继承到
 * 目标新秀时，身高/体重差异如何影响该槽位"，不是 OVR 评分权重。
 *
 * 核心概念：
 * - 有符号差值 heightDelta = target.height - source.height（cm），
 *   weightDelta = target.weight - source.weight（kg）。
 * - 每个轴独立偏好：higher（越高/越重越好）、lower（越矮/越轻越好）、
 *   neutral（不参与）、mixed（槽位默认无法决定，必须由属性级覆盖给出）。
 * - weight 是相对贡献（同一 profile 内 H/W 权重和为 1），决定身高/体重
 *   在结构惩罚中的占比；sensitivity 是槽位总敏感度；scale 是每 10cm /
 *   10kg 的属性点基准强度。
 *
 * 结构惩罚公式（见 rookieBodyConstraints.structuralAdjustmentFor）：
 *   sensitivity × (hW × hDis/10 × hScale + wW × wDis/10 × wScale)
 *
 * scale 校准：保持与旧属性级系数（cH/cW，每 cm/kg）等价，即
 *   sH = 10 × cH / (sensitivity × hW)，sW = 10 × cW / (sensitivity × wW)。
 */

export type AxisPreference = "higher" | "lower" | "neutral" | "mixed";

export type BodyAxisRule = {
  /** 相对贡献；同一 profile 内 height.weight + weight.weight = 1 */
  weight: number;
  preference: AxisPreference;
  /** 每 10cm / 10kg 差值对应的基准敏感度（按旧系数校准） */
  scale: number;
};

export type SupportDependency = {
  attr: "Strength" | "Speed" | "Agility" | "Vertical";
  weight: number;
};

export type BodyTransferProfile = {
  height: BodyAxisRule;
  weight: BodyAxisRule;
  /** 槽位总敏感度（0-1）：结构惩罚的整体缩放 */
  sensitivity: number;
  support?: readonly SupportDependency[];
  attributeOverrides?: Record<string, Partial<BodyTransferProfile>>;
};

/** 每次调用返回独立对象，避免共享可变引用 */
function neutral(): BodyAxisRule {
  return { weight: 0, preference: "neutral", scale: 0 };
}

function rule(weight: number, preference: AxisPreference, scale: number): BodyAxisRule {
  return { weight, preference, scale };
}

/** 16 个槽位（与 src/createResult.ts 的 bundles id 一一对应） */
export const bodyTransferProfiles: Record<string, BodyTransferProfile> = {
  three: { height: neutral(), weight: neutral(), sensitivity: 0 },
  mid: { height: neutral(), weight: neutral(), sensitivity: 0 },
  face: {
    // Close Shot / Draw Foul / Hands 与身高体重无明确方向依赖 → 中性；
    // Layup 由属性级 override 给出移动能力方向。
    height: neutral(),
    weight: neutral(),
    sensitivity: 0.35,
    support: [
      { attr: "Speed", weight: 0.5 },
      { attr: "Agility", weight: 0.5 },
    ],
    attributeOverrides: {
      Layup: {
        height: rule(0.4, "lower", 1.43),
        weight: rule(0.6, "lower", 1.43),
      },
    },
  },
  post: {
    // Post Fade / Post Hook 无身材系数 → 中性；Post Control 由 override 给出。
    height: rule(0.5, "higher", 0),
    weight: rule(0.5, "higher", 0),
    sensitivity: 0.7,
    support: [{ attr: "Strength", weight: 1 }],
    attributeOverrides: {
      "Post Control": {
        height: rule(0.5, "higher", 1.71),
        weight: rule(0.5, "higher", 1.71),
      },
    },
  },
  dunk: {
    height: rule(0.62, "higher", 0.65),
    weight: rule(0.38, "lower", 1.4),
    sensitivity: 0.75,
    support: [
      { attr: "Vertical", weight: 0.6 },
      { attr: "Strength", weight: 0.4 },
    ],
    attributeOverrides: {
      "Standing Dunk": {
        height: rule(0.68, "higher", 2.94),
        weight: rule(0.32, "higher", 2.92),
      },
    },
  },
  handle: {
    height: rule(0.65, "lower", 3.26),
    weight: rule(0.35, "lower", 3.36),
    sensitivity: 0.85,
    support: [
      { attr: "Speed", weight: 0.5 },
      { attr: "Agility", weight: 0.5 },
    ],
    attributeOverrides: {
      "Ball Handle": {
        height: rule(0.65, "lower", 2.9),
        weight: rule(0.35, "lower", 2.69),
      },
    },
  },
  passing: { height: neutral(), weight: neutral(), sensitivity: 0 },
  perimeter: {
    height: rule(0.6, "lower", 1.67),
    weight: rule(0.4, "lower", 1.67),
    sensitivity: 0.6,
    support: [
      { attr: "Speed", weight: 0.6 },
      { attr: "Agility", weight: 0.4 },
    ],
  },
  interior: {
    height: rule(0.56, "higher", 2.1),
    weight: rule(0.44, "higher", 2.14),
    sensitivity: 0.85,
    support: [{ attr: "Strength", weight: 1 }],
  },
  steal: {
    // 来源真实翼展暂不比较：无结构系数，由 Speed/Agility 支持依赖主导。
    height: rule(0.35, "lower", 0),
    weight: rule(0.65, "lower", 0),
    sensitivity: 0.4,
    support: [
      { attr: "Speed", weight: 0.5 },
      { attr: "Agility", weight: 0.5 },
    ],
  },
  block: {
    // 体重结构系数为 0（盖帽主要由身高驱动 + Vertical/Strength 支持）。
    height: rule(0.8, "higher", 2.25),
    weight: rule(0.2, "higher", 0),
    sensitivity: 1,
    support: [
      { attr: "Vertical", weight: 0.6 },
      { attr: "Strength", weight: 0.4 },
    ],
  },
  rebound: {
    // 体重是混合方向：卡位收益 vs 弹跳代价，由属性级覆盖拆分。
    height: rule(0.8, "higher", 1.81),
    weight: rule(0.2, "mixed", 0),
    sensitivity: 0.9,
    support: [
      { attr: "Strength", weight: 0.5 },
      { attr: "Vertical", weight: 0.5 },
    ],
    attributeOverrides: {
      "Offensive Rebound": {
        weight: rule(0.2, "neutral", 0),
        support: [
          { attr: "Vertical", weight: 0.7 },
          { attr: "Strength", weight: 0.3 },
        ],
      },
      "Defensive Rebound": {
        weight: rule(0.2, "higher", 3.33),
        support: [
          { attr: "Strength", weight: 0.7 },
          { attr: "Vertical", weight: 0.3 },
        ],
      },
    },
  },
  athletic: {
    // 根槽位：Speed/Agility 偏 lower，Vertical 由 override 调整。
    height: rule(0.65, "lower", 2.92),
    weight: rule(0.35, "lower", 2.81),
    sensitivity: 0.8,
    attributeOverrides: {
      Speed: { height: rule(0.6, "lower", 2.92), weight: rule(0.4, "lower", 2.81) },
      Agility: { height: rule(0.64, "lower", 3.13), weight: rule(0.36, "lower", 3.13) },
      Vertical: { height: rule(0.5, "neutral", 0), weight: rule(0.5, "neutral", 0) },
      Stamina: { height: rule(0.5, "neutral", 0), weight: rule(0.5, "neutral", 0) },
      Hustle: { height: rule(0.5, "neutral", 0), weight: rule(0.5, "neutral", 0) },
    },
  },
  strength: {
    height: rule(0, "neutral", 0),
    weight: rule(1, "higher", 1.56),
    sensitivity: 0.9,
  },
  stability: { height: neutral(), weight: neutral(), sensitivity: 0 },
  potential: { height: neutral(), weight: neutral(), sensitivity: 0 },
};

export function profileFor(profile: BodyTransferProfile, attr: string): BodyTransferProfile {
  const override = profile.attributeOverrides?.[attr];
  if (!override) return profile;
  return {
    ...profile,
    ...override,
    height: override.height ?? profile.height,
    weight: override.weight ?? profile.weight,
    support: override.support ?? profile.support,
  };
}

/** 属性名 → 槽位 id（与 src/createResult.ts 的 bundles 对应） */
export const attrToSlot: Record<string, string> = {
  "Three-Point Shot": "three",
  "Mid-Range Shot": "mid",
  "Free Throw": "mid",
  Layup: "face",
  "Close Shot": "face",
  "Draw Foul": "face",
  Hands: "face",
  "Post Fade": "post",
  "Post Hook": "post",
  "Post Control": "post",
  "Driving Dunk": "dunk",
  "Standing Dunk": "dunk",
  "Ball Handle": "handle",
  "Speed with Ball": "handle",
  "Pass Accuracy": "passing",
  "Pass IQ": "passing",
  "Pass Vision": "passing",
  "Perimeter Defense": "perimeter",
  "Interior Defense": "interior",
  Steal: "steal",
  "Pass Perception": "steal",
  Block: "block",
  "Offensive Rebound": "rebound",
  "Defensive Rebound": "rebound",
  Speed: "athletic",
  Agility: "athletic",
  Vertical: "athletic",
  Stamina: "athletic",
  Hustle: "athletic",
  Strength: "strength",
  "Offensive Consistency": "stability",
  "Defensive Consistency": "stability",
  "Shot IQ": "stability",
  "Help Defense IQ": "stability",
  "Overall Durability": "stability",
  Potential: "potential",
};

export function profileForAttribute(attr: string): BodyTransferProfile {
  const slot = attrToSlot[attr];
  if (!slot) {
    return {
      height: { weight: 0, preference: "neutral", scale: 0 },
      weight: { weight: 0, preference: "neutral", scale: 0 },
      sensitivity: 0,
    };
  }
  return profileFor(bodyTransferProfiles[slot], attr);
}
