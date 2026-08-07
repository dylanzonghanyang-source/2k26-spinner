import { badgeTierCN, badgeTierRank, type BadgeTier } from "./badgeTiers.ts";

export { badgeTierCN };

// English keys stay aligned with the source data; all user-facing text uses Chinese.
export const badgeNameCN: Record<string, string> = {
  "Deadeye": "神射手",
  "Limitless Range": "射程无限",
  "Mini Marksman": "迷你射手",
  "Set Shot Specialist": "定位投篮专家",
  "Shifty Shooter": "运投高手",

  "Ankle Assassin": "脚踝杀手",
  "Bail Out": "应变大师",
  "Break Starter": "一传大师",
  "Dimer": "十美分",
  "Handles For Days": "运球老手",
  "Lightning Launch": "闪电启动",
  "Strong Handle": "强力控球",
  "Unpluckable": "护球大师",
  "Versatile Visionary": "球场视野",

  "Aerial Wizard": "空中作业",
  "Float Game": "抛投高手",
  "Hook Specialist": "勾手专家",
  "Layup Mixmaster": "花式上篮手",
  "Paint Prodigy": "内线上篮高手",
  "Physical Finisher": "对抗上篮手",
  "Post Fade Phenom": "背身投篮大师",
  "Post Powerhouse": "背身对抗高手",
  "Post-Up Poet": "背身单打诗人",
  "Posterizer": "隔扣达人",
  "Rise Up": "强硬篮下",

  "Challenger": "防守干扰",
  "Glove": "持球抢断大师",
  "High-Flying Denier": "高飞干扰者",
  "Immovable Enforcer": "稳健防守者",
  "Interceptor": "拦截者",
  "Off-Ball Pest": "无球跑位杀手",
  "On-Ball Menace": "持球防守大师",
  "Paint Patroller": "禁区巡逻员",
  "Pick Dodger": "挡拆躲闪者",
  "Post Lockdown": "背身封防者",

  "Boxout Beast": "卡位怪兽",
  "Rebound Chaser": "冲板大师",

  "Brick Wall": "铜墙铁壁",
  "Pogo Stick": "弹跳大师",
  "Slippery Off-Ball": "无球跑位",
};

export function getBadgeNameCN(name: string): string {
  return badgeNameCN[name] ?? "未知徽章";
}

export type PlayerBadgeLike = {
  name: string;
  category?: string;
  tier: BadgeTier;
};

export type RookieBadgeTier = "rotation" | "lottery" | "generational";

export type BadgeBundleSource = {
  bundleId: string;
  playerId?: string;
};

export type BadgeBundleMap = Record<string, string | string[]>;

export function mappedBundleIds(badgeToBundle: BadgeBundleMap, badgeName: string): string[] {
  const mapping = badgeToBundle[badgeName];
  if (!mapping) return [];
  return Array.isArray(mapping) ? mapping : [mapping];
}

/**
 * Collect inherited badges per attribute slot. A badge may be mapped to one
 * or more related slots (for example, Deadeye belongs to both three and mid),
 * and duplicate names keep the highest tier.
 */
export function collectBadgesByBundle({
  sources,
  badgeToBundle,
  badgesForPlayer,
}: {
  sources: BadgeBundleSource[];
  badgeToBundle: BadgeBundleMap;
  badgesForPlayer: (playerId: string) => PlayerBadgeLike[] | undefined;
}): PlayerBadgeLike[] {
  const badgeByBundle = new Map<string, PlayerBadgeLike[]>();
  for (const source of sources) {
    if (!source.playerId) continue;
    const playerBadges = badgesForPlayer(source.playerId);
    if (!playerBadges) continue;
    for (const badge of playerBadges) {
      if (!mappedBundleIds(badgeToBundle, badge.name).includes(source.bundleId)) continue;
      const list = badgeByBundle.get(source.bundleId) ?? [];
      list.push(badge);
      badgeByBundle.set(source.bundleId, list);
    }
  }

  return uniqueBadges([...badgeByBundle.values()].flat());
}

export function buildBadgesByBundle({
  sources,
  badgeToBundle,
  badgesForPlayer,
  profileKnown,
  fallbackBadges,
}: {
  sources: BadgeBundleSource[];
  badgeToBundle: BadgeBundleMap;
  badgesForPlayer: (playerId: string) => PlayerBadgeLike[] | undefined;
  profileKnown: (playerId: string) => boolean;
  fallbackBadges: PlayerBadgeLike[];
}): { badges: PlayerBadgeLike[]; estimated: boolean } {
  const inherited = collectBadgesByBundle({ sources, badgeToBundle, badgesForPlayer });
  const missingBundles = new Set(sources
    .filter((source) => !source.playerId || !profileKnown(source.playerId))
    .map((source) => source.bundleId));
  const fallback = fallbackBadges.filter((badge) => {
    const mappedBundles = mappedBundleIds(badgeToBundle, badge.name);
    return mappedBundles.length > 0 && mappedBundles.every((bundleId) => missingBundles.has(bundleId));
  });
  return {
    badges: uniqueBadges([...inherited, ...fallback]),
    estimated: missingBundles.size > 0,
  };
}

export function downgradeBadgesForRookie(
  badges: PlayerBadgeLike[],
  tier: RookieBadgeTier,
): PlayerBadgeLike[] {
  const config = {
    rotation: { drop: 2, limit: 3 },
    lottery: { drop: 1, limit: 5 },
    generational: { drop: 1, limit: 7 },
  }[tier];
  const badgeTierByRank: Record<number, BadgeTier> = {
    1: "Bronze",
    2: "Silver",
    3: "Gold",
    4: "HOF",
    5: "Legendary",
  };
  return uniqueBadges(badges)
    .slice(0, config.limit)
    .map((badge) => ({
      ...badge,
      tier: badgeTierByRank[Math.max(1, badgeTierRank[badge.tier] - config.drop)],
    }));
}

export function uniqueBadges(badges: PlayerBadgeLike[]): PlayerBadgeLike[] {
  const unique = new Map<string, PlayerBadgeLike>();
  for (const badge of badges) {
    const existing = unique.get(badge.name);
    if (!existing || badgeTierRank[badge.tier] > badgeTierRank[existing.tier]) {
      unique.set(badge.name, badge);
    }
  }

  return [...unique.values()].sort(
    (left, right) => badgeTierRank[right.tier] - badgeTierRank[left.tier] || left.name.localeCompare(right.name),
  );
}
