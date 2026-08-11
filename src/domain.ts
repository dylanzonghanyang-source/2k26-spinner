import { badgeTierRank, type BadgeTier } from "./badgeTiers.ts";
export type { BadgeTier } from "./badgeTiers.ts";

export type PlayerSource = {
  id?: string;
  name: string;
  slug?: string;
  rosterCategory?: "current" | "classic" | "allTime";
  rosterTeam?: string;
  isEstimated?: boolean;
  badges?: PlayerBadge[];
  badgesKnown?: boolean;
  overall?: number | null;
  potential?: number | null;
  team?: string | null;
  position?: string | null;
  archetype?: string | null;
  height?: string | null;
  weight?: number | null;
  wingspan?: string | null;
  shooting: number | null;
  athleticism: number | null;
  playmaking: number | null;
  defense: number | null;
  inside: number | null;
  detailed: Record<string, number | null>;
};


export type AttributeGroupKey = "shooting" | "athleticism" | "playmaking" | "defense" | "inside";

export type BadgeCategory = AttributeGroupKey | "general" | "rebounding";
export type PlayerBadge = {
  name: string;
  category: BadgeCategory;
  tier: BadgeTier;
};

export type CareerStage = "rookie" | "prime";
export type RookieTier = "rotation" | "lottery" | "generational";
export type CareerProfile = {
  stage: CareerStage;
  rookieTier: RookieTier;
};

export const defaultCareerProfile: CareerProfile = {
  stage: "rookie",
  rookieTier: "lottery",
};

export type SourceMap = Record<AttributeGroupKey, PlayerSource>;

export type BodyTemplate = {
  position: string;
  height: string;
  weight: number | null;
  wingspan: string;
  shoulderWidth: string;
};

export type PlayerDraft = {
  position: string;
  height: string;
  weight: number | null;
  wingspan: string;
  shoulderWidth: string;
  careerStage: CareerStage;
  rookieTier: RookieTier;
  potential: number;
  badges: PlayerBadge[];
  peakBadges: PlayerBadge[];
  badgesEstimated: boolean;
  sourceNames: string[];
  // Category totals
  shooting: number;
  athleticism: number;
  playmaking: number;
  defense: number;
  inside: number;
  // Detailed attributes
  closeShot: number | null;
  midRangeShot: number | null;
  threePointShot: number | null;
  freeThrow: number | null;
  offensiveConsistency: number | null;
  shotIQ: number | null;
  speed: number;
  agility: number | null;
  vertical: number;
  strength: number;
  hustle: number | null;
  stamina: number | null;
  overallDurability: number | null;
  ballHandle: number | null;
  speedWithBall: number | null;
  passAccuracy: number | null;
  passVision: number | null;
  passIQ: number | null;
  block: number | null;
  steal: number | null;
  passPerception: number | null;
  interiorDefense: number | null;
  perimeterDefense: number | null;
  defensiveConsistency: number | null;
  helpDefenseIQ: number | null;
  layup: number | null;
  drivingDunk: number | null;
  standingDunk: number | null;
  postHook: number | null;
  postFade: number | null;
  postControl: number | null;
  drawFoul: number | null;
  hands: number | null;
  offensiveRebound: number | null;
  defensiveRebound: number | null;
  intangibles: number | null;
};

export const attributeGroups = [
  { key: "shooting", name: "投篮", description: "中投、三分、罚球与投篮包容性。" },
  { key: "athleticism", name: "运动", description: "速度、加速、弹跳与体能。" },
  { key: "playmaking", name: "组织", description: "控球、传球、变向和持球创造。" },
  { key: "defense", name: "防守", description: "外防、内防、抢断、盖帽与干扰。" },
  { key: "inside", name: "终结", description: "近框、扣篮、背身和篮下终结。" }
] as const;

export const attrGroupMap: Record<string, { key: string; name: string; color: string; attrs: string[] }> = {
  shooting: {
    key: "shooting", name: "投篮", color: "#4f9f95",
    attrs: ["Close Shot", "Mid-Range Shot", "Three-Point Shot", "Free Throw", "Offensive Consistency", "Shot IQ"]
  },
  athleticism: {
    key: "athleticism", name: "运动", color: "#4b83b8",
    attrs: ["Speed", "Strength", "Agility", "Vertical", "Hustle", "Stamina", "Overall Durability"]
  },
  playmaking: {
    key: "playmaking", name: "组织", color: "#b86f5a",
    attrs: ["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass Vision", "Pass IQ"]
  },
  defense: {
    key: "defense", name: "防守", color: "#2f9d83",
    attrs: ["Block", "Steal", "Pass Perception", "Interior Defense", "Perimeter Defense", "Defensive Consistency", "Help Defense IQ"]
  },
  inside: {
    key: "inside", name: "终结", color: "#8f72be",
    attrs: ["Layup", "Driving Dunk", "Standing Dunk", "Post Hook", "Post Fade", "Post Control", "Draw Foul", "Hands", "Offensive Rebound", "Defensive Rebound", "Intangibles"]
  }
};


export const attrNameCN: Record<string, string> = {
  "Close Shot": "\u8fd1\u8ddd\u79bb\u6295\u7bee",
  "Mid-Range Shot": "\u4e2d\u8ddd\u79bb\u6295\u7bee",
  "Three-Point Shot": "\u4e09\u5206\u7403",
  "Free Throw": "\u7f5a\u7403",
  "Offensive Consistency": "\u8fdb\u653b\u7a33\u5b9a\u6027",
  "Shot IQ": "\u6295\u7bee\u667a\u5546",
  "Speed": "\u901f\u5ea6",
  "Strength": "\u529b\u91cf",
  "Agility": "\u654f\u6377",
  "Vertical": "\u5f39\u8df3",
  "Hustle": "\u79ef\u6781\u6027",
  "Stamina": "\u4f53\u529b",
  "Overall Durability": "\u6574\u4f53\u8010\u4e45\u5ea6",
  "Ball Handle": "\u63a7\u7403",
  "Speed with Ball": "\u8fd0\u7403\u901f\u5ea6",
  "Pass Accuracy": "\u4f20\u7403\u51c6\u786e\u6027",
  "Pass Vision": "\u4f20\u7403\u89c6\u91ce",
  "Pass IQ": "\u4f20\u7403\u667a\u5546",
  "Block": "\u76d6\u5e3d",
  "Steal": "\u62a2\u65ad",
  "Pass Perception": "\u4f20\u7403\u6d1e\u5bdf\u529b",
  "Interior Defense": "\u5185\u7ebf\u9632\u5b88",
  "Perimeter Defense": "\u5916\u7ebf\u9632\u5b88",
  "Defensive Consistency": "\u9632\u5b88\u7a33\u5b9a\u6027",
  "Help Defense IQ": "\u534f\u9632\u667a\u5546",
  "Layup": "\u4e0a\u7bee",
  "Driving Dunk": "\u5207\u5165\u6263\u7bee",
  "Standing Dunk": "\u539f\u5730\u6263\u7bee",
  "Post Hook": "\u80cc\u8eab\u52fe\u624b",
  "Post Fade": "\u80cc\u8eab\u540e\u4ef0",
  "Post Control": "\u80cc\u8eab\u63a7\u5236",
  "Draw Foul": "\u9020\u8fdd\u89c4",
  "Hands": "\u63a5\u7403",
  "Offensive Rebound": "\u8fdb\u653b\u7bee\u677f",
  "Defensive Rebound": "\u9632\u5b88\u7bee\u677f",
  "Intangibles": "\u7efc\u8bc4\u8865\u507f",
  "Potential": "\u6f5c\u529b",
  "Head Durability": "\u5934\u90e8\u8010\u4e45",
  "Neck Durability": "\u9888\u90e8\u8010\u4e45",
  "Back Durability": "\u80cc\u90e8\u8010\u4e45",
  "Left Shoulder Durability": "\u5de6\u80a9\u8010\u4e45",
  "Right Shoulder Durability": "\u53f3\u80a9\u8010\u4e45",
  "Left Elbow Durability": "\u5de6\u8098\u8010\u4e45",
  "Right Elbow Durability": "\u53f3\u8098\u8010\u4e45",
  "Left Hip Durability": "\u5de6\u9acb\u5173\u8282\u8010\u4e45",
  "Right Hip Durability": "\u53f3\u9acb\u5173\u8282\u8010\u4e45",
  "Left Knee Durability": "\u5de6\u819d\u8010\u4e45",
  "Right Knee Durability": "\u53f3\u819d\u8010\u4e45",
  "Left Ankle Durability": "\u5de6\u8e1d\u5173\u8282\u8010\u4e45",
  "Right Ankle Durability": "\u53f3\u8e1d\u5173\u8282\u8010\u4e45",
  "Left Foot Durability": "\u5de6\u811a\u8010\u4e45",
  "Right Foot Durability": "\u53f3\u811a\u8010\u4e45"
};



// --- Physical attribute wheel definitions ---

export const positions = ["PG", "SG", "SF", "PF", "C"] as const;

export function allHeights(): string[] {
  const result: string[] = [];
  for (let cm = 150; cm <= 300; cm++) {
    result.push(`${cm}`);
  }
  return result;
}

export function randomChoice<T>(items: readonly T[] | T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

export function randomPosition(): string {
  return randomChoice(positions);
}

export function randomHeight(): string {
  return randomChoice(allHeights());
}

export function randomShoulderWidth(): string {
  return `${Math.floor(Math.random() * 100) + 1}`;
}

export function randomWingspan(): string {
  return `${Math.floor(Math.random() * 100) + 1}`;
}

export function randomWeight(): string {
  return `${Math.floor(Math.random() * 151) + 50}`;
}



export function randomWheelIndex(itemCount: number): number {
  if (itemCount <= 0) return -1;
  return Math.floor(Math.random() * itemCount);
}

export function availablePlayers(selectedNames: string[], pool: PlayerSource[]) {
  return pool.filter((player) => selectedNames.includes(playerSourceKey(player)));
}

export function playerSourceKey(player: PlayerSource): string {
  return player.id ?? player.slug ?? player.name;
}


export function createRandomSourceMap(selectedNames: string[], pool: PlayerSource[]): SourceMap {
  const availablePool = availablePlayers(selectedNames, pool);
  if (availablePool.length === 0) {
    throw new Error("Cannot create a source map without player data.");
  }

  return {
    shooting: randomChoice(availablePool),
    athleticism: randomChoice(availablePool),
    playmaking: randomChoice(availablePool),
    defense: randomChoice(availablePool),
    inside: randomChoice(availablePool)
  };
}

export function normalizeSourceMap(
  selectedNames: string[],
  current: Partial<SourceMap>,
  pool: PlayerSource[]
): SourceMap {
  const availablePool = availablePlayers(selectedNames, pool);
  if (availablePool.length === 0) {
    throw new Error("Cannot normalize source map without player data.");
  }

  return {
    shooting: ensurePoolMember(current.shooting, availablePool),
    athleticism: ensurePoolMember(current.athleticism, availablePool),
    playmaking: ensurePoolMember(current.playmaking, availablePool),
    defense: ensurePoolMember(current.defense, availablePool),
    inside: ensurePoolMember(current.inside, availablePool)
  };
}

export function createDraftFromSources(
  sources: SourceMap,
  body: BodyTemplate,
  profile: CareerProfile = defaultCareerProfile,
): PlayerDraft {
  const sourceNames = attributeGroups.map(({ key }) => sources[key].name);
  const bias = bodyBiasByPosition[body.position] ?? { speed: 0, vertical: 0, strength: 0, handle: 0, shooting: 0, athleticism: 0, playmaking: 0, defense: 0, inside: 0 };

  const average = (values: readonly (number | null)[]): number => { const valid = values.filter((v): v is number => v !== null); return valid.length > 0 ? Math.round(valid.reduce((s, v) => s + v, 0) / valid.length) : 55; };
  const blended = (key: "shooting" | "athleticism" | "playmaking" | "defense" | "inside", sourceKeys: AttributeGroupKey[]) =>
    average(sourceKeys.map((groupKey) => sources[groupKey][key] ?? 55));

  const inheritDetail = (attrName: string, sourceKey: AttributeGroupKey): number | null => {
    const src = sources[sourceKey];
    const val = src.detailed?.[attrName];
    return typeof val === "number" ? val : null;
  };

  const peakDraft: PlayerDraft = {
    ...body,
    careerStage: profile.stage,
    rookieTier: profile.rookieTier,
    potential: 0,
    badges: [],
    peakBadges: [],
    badgesEstimated: false,
    shooting: clamp(blended("shooting", ["shooting", "playmaking", "athleticism"]) + bias.shooting + randomOffset(4), 55, 99),
    athleticism: clamp(blended("athleticism", ["athleticism", "defense"]) + bias.athleticism + randomOffset(4), 55, 99),
    playmaking: clamp(blended("playmaking", ["playmaking", "shooting"]) + bias.playmaking + randomOffset(4), 55, 99),
    defense: clamp(blended("defense", ["defense", "inside"]) + bias.defense + randomOffset(4), 55, 99),
    inside: clamp(blended("inside", ["inside", "defense"]) + bias.inside + randomOffset(4), 55, 99),
    closeShot: inheritDetail("Close Shot", "shooting"),
    midRangeShot: inheritDetail("Mid-Range Shot", "shooting"),
    threePointShot: inheritDetail("Three-Point Shot", "shooting"),
    freeThrow: inheritDetail("Free Throw", "shooting"),
    offensiveConsistency: inheritDetail("Offensive Consistency", "shooting"),
    shotIQ: inheritDetail("Shot IQ", "shooting"),
    speed: clamp((inheritDetail("Speed", "athleticism") ?? 55) + bias.speed + randomOffset(4), 55, 99),
    agility: inheritDetail("Agility", "athleticism"),
    vertical: clamp((inheritDetail("Vertical", "athleticism") ?? 55) + bias.vertical + randomOffset(4), 55, 99),
    strength: clamp((inheritDetail("Strength", "athleticism") ?? 55) + bias.strength + randomOffset(4), 55, 99),
    hustle: inheritDetail("Hustle", "athleticism"),
    stamina: inheritDetail("Stamina", "athleticism"),
    overallDurability: inheritDetail("Overall Durability", "athleticism"),
    ballHandle: clamp((inheritDetail("Ball Handle", "playmaking") ?? 55) + bias.handle + randomOffset(4), 55, 99),
    speedWithBall: inheritDetail("Speed with Ball", "playmaking"),
    passAccuracy: inheritDetail("Pass Accuracy", "playmaking"),
    passVision: inheritDetail("Pass Vision", "playmaking"),
    passIQ: inheritDetail("Pass IQ", "playmaking"),
    block: inheritDetail("Block", "defense"),
    steal: inheritDetail("Steal", "defense"),
    passPerception: inheritDetail("Pass Perception", "defense"),
    interiorDefense: inheritDetail("Interior Defense", "defense"),
    perimeterDefense: inheritDetail("Perimeter Defense", "defense"),
    defensiveConsistency: inheritDetail("Defensive Consistency", "defense"),
    helpDefenseIQ: inheritDetail("Help Defense IQ", "defense"),
    layup: inheritDetail("Layup", "inside"),
    drivingDunk: inheritDetail("Driving Dunk", "inside"),
    standingDunk: inheritDetail("Standing Dunk", "inside"),
    postHook: inheritDetail("Post Hook", "inside"),
    postFade: inheritDetail("Post Fade", "inside"),
    postControl: inheritDetail("Post Control", "inside"),
    drawFoul: inheritDetail("Draw Foul", "inside"),
    hands: inheritDetail("Hands", "inside"),
    offensiveRebound: inheritDetail("Offensive Rebound", "inside"),
    defensiveRebound: inheritDetail("Defensive Rebound", "defense"),
    intangibles: inheritDetail("Intangibles", "shooting"),
    sourceNames
  };

  return applyCareerProfile(peakDraft, sources, profile);
}

const badgeTierByRank: Record<number, BadgeTier> = {
  1: "Bronze",
  2: "Silver",
  3: "Gold",
  4: "HOF",
  5: "Legendary",
};

function applyCareerProfile(draft: PlayerDraft, sources: SourceMap, profile: CareerProfile): PlayerDraft {
  const peakBadges = buildPeakBadges(sources);
  const peakScore = Math.round((draft.shooting + draft.athleticism + draft.playmaking + draft.defense + draft.inside) / 5);
  const potential = calculatePotential(peakScore, profile.rookieTier);

  if (profile.stage === "prime") {
    return {
      ...draft,
      careerStage: "prime",
      potential,
      badges: peakBadges.badges,
      peakBadges: peakBadges.badges,
      badgesEstimated: peakBadges.estimated,
    };
  }

  const next = { ...draft } as Record<string, unknown>;
  for (const key of rookieRatingKeys) {
    const rating = next[key];
    if (typeof rating !== "number") continue;
    next[key] = rookieRating(rating, key, profile.rookieTier);
  }

  return {
    ...(next as PlayerDraft),
    careerStage: "rookie",
    potential,
    badges: downgradeBadges(peakBadges.badges, profile.rookieTier),
    peakBadges: peakBadges.badges,
    badgesEstimated: peakBadges.estimated,
  };
}

function calculatePotential(peakScore: number, tier: RookieTier): number {
  const config = {
    rotation: { floor: 74, scale: 0.48, cap: 86 },
    lottery: { floor: 82, scale: 0.62, cap: 93 },
    generational: { floor: 88, scale: 0.72, cap: 98 },
  }[tier];
  return clamp(Math.round(config.floor + Math.max(0, peakScore - 68) * config.scale), config.floor, config.cap);
}

const physicalRatingKeys = new Set([
  "athleticism", "speed", "agility", "vertical", "strength", "hustle", "stamina", "overallDurability",
  "drivingDunk", "standingDunk", "block", "offensiveRebound", "defensiveRebound",
]);

const mentalRatingKeys = new Set([
  "offensiveConsistency", "shotIQ", "passVision", "passIQ", "passPerception", "defensiveConsistency", "helpDefenseIQ", "intangibles",
]);

const rookieRatingKeys = [
  "shooting", "athleticism", "playmaking", "defense", "inside",
  "closeShot", "midRangeShot", "threePointShot", "freeThrow", "offensiveConsistency", "shotIQ",
  "speed", "agility", "vertical", "strength", "hustle", "stamina", "overallDurability",
  "ballHandle", "speedWithBall", "passAccuracy", "passVision", "passIQ",
  "block", "steal", "passPerception", "interiorDefense", "perimeterDefense", "defensiveConsistency", "helpDefenseIQ",
  "layup", "drivingDunk", "standingDunk", "postHook", "postFade", "postControl", "drawFoul", "hands", "offensiveRebound", "defensiveRebound", "intangibles",
];

function rookieRating(value: number, key: string, tier: RookieTier): number {
  const config = {
    rotation: { technical: 0.48, physical: 0.61, mental: 0.39, cap: 78 },
    lottery: { technical: 0.59, physical: 0.71, mental: 0.5, cap: 85 },
    generational: { technical: 0.69, physical: 0.8, mental: 0.61, cap: 90 },
  }[tier];
  const multiplier = physicalRatingKeys.has(key)
    ? config.physical
    : mentalRatingKeys.has(key)
      ? config.mental
      : config.technical;
  const baseline = physicalRatingKeys.has(key) ? 54 : mentalRatingKeys.has(key) ? 50 : 52;
  return clamp(Math.round(baseline + (value - baseline) * multiplier), 25, config.cap);
}

function buildPeakBadges(sources: SourceMap): { badges: PlayerBadge[]; estimated: boolean } {
  const result: PlayerBadge[] = [];
  let estimated = false;

  for (const group of attributeGroups) {
    const source = sources[group.key];
    const exact = source.badges?.filter((badge) => badgeMatchesGroup(badge, group.key)) ?? [];
    if (source.badgesKnown) {
      result.push(...exact);
    } else {
      estimated = true;
      result.push(...inferBadges(source, group.key));
    }
  }

  const unique = new Map<string, PlayerBadge>();
  for (const badge of result) {
    const existing = unique.get(badge.name);
    if (!existing || badgeTierRank[badge.tier] > badgeTierRank[existing.tier]) {
      unique.set(badge.name, badge);
    }
  }

  return {
    badges: [...unique.values()].sort((left, right) => badgeTierRank[right.tier] - badgeTierRank[left.tier] || left.name.localeCompare(right.name)),
    estimated,
  };
}

function badgeMatchesGroup(badge: PlayerBadge, group: AttributeGroupKey): boolean {
  if (badge.category === group) return true;
  if (badge.category === "general") return group === "shooting" || group === "athleticism";
  if (badge.category === "rebounding") return group === "defense" || group === "inside";
  return false;
}

function inferBadges(source: PlayerSource, group: AttributeGroupKey): PlayerBadge[] {
  const detail = source.detailed;
  const rating = (key: string, fallback = source[group] ?? 60) => detail[key] ?? fallback;
  const makeBadge = (name: string, category: BadgeCategory, score: number): PlayerBadge => ({
    name,
    category,
    tier: score >= 96 ? "HOF" : score >= 89 ? "Gold" : score >= 80 ? "Silver" : "Bronze",
  });

  if (group === "shooting") {
    return [
      makeBadge("Set Shot Specialist", "shooting", rating("Three-Point Shot")),
      makeBadge("Deadeye", "shooting", rating("Mid-Range Shot")),
      ...(rating("Three-Point Shot") >= 82 ? [makeBadge("Limitless Range", "shooting", rating("Three-Point Shot") - 3)] : []),
      ...(rating("Ball Handle") >= 78 ? [makeBadge("Shifty Shooter", "shooting", rating("Ball Handle"))] : []),
    ];
  }
  if (group === "inside") {
    return [
      makeBadge("Physical Finisher", "inside", rating("Layup")),
      makeBadge("Posterizer", "inside", rating("Driving Dunk")),
      ...(rating("Standing Dunk") >= 70 ? [makeBadge("Rise Up", "inside", rating("Standing Dunk"))] : []),
    ];
  }
  if (group === "playmaking") {
    return [
      makeBadge("Handles For Days", "playmaking", rating("Ball Handle")),
      makeBadge("Dimer", "playmaking", rating("Pass Accuracy")),
      makeBadge("Unpluckable", "playmaking", rating("Ball Handle") - 3),
    ];
  }
  if (group === "defense") {
    return [
      makeBadge("Challenger", "defense", rating("Perimeter Defense")),
      makeBadge("Interceptor", "defense", rating("Pass Perception")),
      makeBadge("Paint Patroller", "defense", rating("Block")),
    ];
  }
  return [
    makeBadge("Lightning Launch", "athleticism", rating("Speed with Ball", source.athleticism ?? 60)),
    makeBadge("Aerial Wizard", "athleticism", rating("Vertical", source.athleticism ?? 60)),
  ];
}

function downgradeBadges(badges: PlayerBadge[], tier: RookieTier): PlayerBadge[] {
  const config = {
    rotation: { drop: 2, limit: 3 },
    lottery: { drop: 1, limit: 5 },
    generational: { drop: 1, limit: 7 },
  }[tier];

  return badges
    .slice(0, config.limit)
    .map((badge) => ({
      ...badge,
      tier: badgeTierByRank[Math.max(1, badgeTierRank[badge.tier] - config.drop)],
    }));
}

function randomOffset(range: number) {
  return Math.floor(Math.random() * (range * 2 + 1)) - range;
}

function ensurePoolMember(candidate: PlayerSource | undefined, pool: PlayerSource[]) {
  if (candidate && pool.some((player) => playerSourceKey(player) === playerSourceKey(candidate))) {
    return candidate;
  }

  return randomChoice(pool);
}

const bodyBiasByPosition: Record<
  BodyTemplate["position"],
  {
    speed: number;
    vertical: number;
    strength: number;
    handle: number;
    shooting: number;
    athleticism: number;
    playmaking: number;
    defense: number;
    inside: number;
  }
> = {
  PG: { speed: 5, vertical: 3, strength: -6, handle: 4, shooting: 1, athleticism: 4, playmaking: 3, defense: 0, inside: -8 },
  SG: { speed: 3, vertical: 2, strength: -3, handle: 2, shooting: 1, athleticism: 2, playmaking: 1, defense: 0, inside: -5 },
  SF: { speed: 1, vertical: 1, strength: 0, handle: 0, shooting: 0, athleticism: 1, playmaking: 0, defense: 1, inside: 0 },
  PF: { speed: -2, vertical: 0, strength: 4, handle: -1, shooting: -1, athleticism: -1, playmaking: -2, defense: 2, inside: 4 },
  C: { speed: -5, vertical: -1, strength: 8, handle: -3, shooting: -2, athleticism: -3, playmaking: -4, defense: 4, inside: 7 }
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
