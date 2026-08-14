/**
 * Export text builder for generated rookies.
 *
 * Contract (public-beta audit 2026-08-11):
 * - The page's generated result is the primary record. The export MUST use the
 *   final generated name, body and attributes — never the source card's
 *   identity/body.
 * - When a single rookie card backs the whole build, the card's raw vitals are
 *   kept in a separate "[来源卡资料]" appendix labelled as template-source data.
 * - "[模板]" slot lines resolve lock playerIds against the FULL source map
 *   (roster players + manual-mode card pseudo sources), so self-pick exports
 *   never show "--" for card sources.
 */
import { attrNameCN, type PlayerSource } from "./domain.ts";
import { badgeTierCN, getBadgeNameCN, normalizeBadgeName } from "./badges.ts";
import { getTendencyNameCN } from "./tendencyNames.ts";
import { getPlayerNameCN } from "./playerNames.ts";
import { attributeGroups, badgeGroups, tendencyGroups } from "./fieldCategories.ts";
import { bundles, type Evaluation, type LockState, type createResult } from "./createResult.ts";
import { resolveDisplayOverall } from "./displayOverall.ts";

/** Mirrors RookieBuilder's load state union (kept local for testability). */
export type TendencyLoadState = "idle" | "loading" | "ready" | "unavailable" | "error";

export function createExportText(
  rookieName: string,
  result: ReturnType<typeof createResult>,
  locks: LockState,
  evaluations: Record<string, Evaluation>,
  sources: Map<string, PlayerSource>,
  tendencyLoadState: TendencyLoadState,
  dataVersionLabel: string,
) {
  void evaluations; // reserved for future sections; kept for signature stability
  const card = result.card ?? null;
  // Stage 6C: export Overall 统一为 V3-E display（旧对象重算/标记 fallback）。
  const { overall: displayOverall } = resolveDisplayOverall(result);
  const sep = " ｜ ";
  const handCN = (hand: string | number | boolean | null | undefined) =>
    hand === "Right" ? "右手" : hand === "Left" ? "左手" : hand == null ? "--" : String(hand);
  const v = (key: string) => card?.vitals?.[key];
  const vs = (key: string) => {
    const value = v(key);
    return value == null || value === "" ? "--" : String(value);
  };
  const vn = (key: string) => {
    const value = v(key);
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "--";
  };

  // --- primary record: ALWAYS the generated result ---
  const vitalLines = [
    `姓名: ${rookieName}`,
    `年龄: ${result.age}${sep}位置: ${result.position}${result.secondary ? `（次要: ${result.secondary}）` : ""}`,
    `惯用手: ${result.hand}（扣篮: ${result.dunkHand}）`,
    `巅峰年龄: ${result.peakStart}-${result.peakEnd}`,
    `成长速度: 每年 +${result.progressSpeed} OVR`,
    `潜力: ${result.potential}（${result.potentialMin}-${result.potentialMax}）${sep}成长概率: ${result.boom}%${sep}平均: ${result.normal}%${sep}衰退: ${result.bust}%`,
  ];
  const bodyLines = [
    `身高: ${result.height} cm${sep}体重: ${result.weight} kg`,
    `臂展（1-100）: ${result.wingspan}${sep}肩宽: ${result.shoulder}${sep}颈长: ${result.neck}${sep}躯干: ${result.torso}`,
  ];

  // --- durability / attributes / OVR / hot zones / badges / tendencies ---
  const cardDurabilityKeys = ["head", "neck", "back", "leftShoulder", "rightShoulder", "leftElbow", "rightElbow", "leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle", "leftFoot", "rightFoot"] as const;
  const durabilityShort: Record<(typeof cardDurabilityKeys)[number], string> = {
    head: "头部", neck: "颈部", back: "背部",
    leftShoulder: "左肩", rightShoulder: "右肩",
    leftElbow: "左肘", rightElbow: "右肘",
    leftHip: "左髋", rightHip: "右髋",
    leftKnee: "左膝", rightKnee: "右膝",
    leftAnkle: "左踝", rightAnkle: "右踝",
    leftFoot: "左脚", rightFoot: "右脚",
  };
  const durabilityAttrByCardKey: Record<(typeof cardDurabilityKeys)[number], string> = {
    head: "Head Durability", neck: "Neck Durability", back: "Back Durability",
    leftShoulder: "Left Shoulder Durability", rightShoulder: "Right Shoulder Durability",
    leftElbow: "Left Elbow Durability", rightElbow: "Right Elbow Durability",
    leftHip: "Left Hip Durability", rightHip: "Right Hip Durability",
    leftKnee: "Left Knee Durability", rightKnee: "Right Knee Durability",
    leftAnkle: "Left Ankle Durability", rightAnkle: "Right Ankle Durability",
    leftFoot: "Left Foot Durability", rightFoot: "Right Foot Durability",
  };
  // 复制/下载文案：每个字段独占一行（名称 数值），组标签单独成行。
  const durabilityLines = [
    `综合 ${result.initialAttrs["Overall Durability"] ?? "--"}`,
    ...cardDurabilityKeys.map((key) => `${durabilityShort[key]} ${result.initialAttrs[durabilityAttrByCardKey[key]] ?? "--"}`),
  ];
  const zoneSlots: { label: string; slots: { short: string; keys: string[] }[] }[] = [
    { label: "篮下", slots: [
      { short: "篮下", keys: ["underBasket", "篮下"] },
      { short: "近距离左侧", keys: ["closeLeft", "近距离左侧"] },
      { short: "近距离中央", keys: ["closeMiddle", "近距离中央"] },
      { short: "近距离右侧", keys: ["closeRight", "近距离右侧"] },
    ] },
    { label: "中距离", slots: [
      { short: "左底角", keys: ["midLeft", "中距离左侧底角"] },
      { short: "左45", keys: ["midLeftCenter", "中距离左侧45度"] },
      { short: "弧顶", keys: ["midCenter", "中距离弧顶"] },
      { short: "右45", keys: ["midRightCenter", "中距离右侧45度"] },
      { short: "右底角", keys: ["midRight", "中距离右侧底角"] },
    ] },
    { label: "三分", slots: [
      { short: "左底角", keys: ["threeLeft", "三分左侧底角"] },
      { short: "左45", keys: ["threeLeftCenter", "三分左侧45度"] },
      { short: "弧顶", keys: ["threeCenter", "三分弧顶"] },
      { short: "右45", keys: ["threeRightCenter", "三分右侧45度"] },
      { short: "右底角", keys: ["threeRight", "三分右侧底角"] },
    ] },
  ];
  const hotZoneSource = result.hotZones;
  const zoneStateCN = (state: string) => (state === "Hot" || state === "热区") ? "热区" : (state === "Cold" || state === "冷区") ? "冷区" : "中性";
  const hotZoneLines = zoneSlots.flatMap((group) => {
    const items = group.slots.flatMap((slot) => {
      const key = slot.keys.find((k) => hotZoneSource[k] !== undefined);
      return key != null ? [`${slot.short} ${zoneStateCN(hotZoneSource[key])}`] : [];
    });
    return items.length ? [group.label, ...items] : [];
  });
  const badgeLabel = (badge: { name: string; tier: string }) => `${getBadgeNameCN(badge.name)} ${badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}`;
  const personalityLines = card?.personalityBadges?.length
    ? card.personalityBadges.map(badgeLabel)
    : [];
  const groupBadgeLines = (badges: { name: string; tier: string }[]): string[] => {
    const grouped = badgeGroups.flatMap((group) => {
      const members = badges.filter((badge) =>
        group.badges.some((candidate) => normalizeBadgeName(candidate) === normalizeBadgeName(badge.name)),
      );
      return members.length ? [group.label, ...members.map(badgeLabel)] : [];
    });
    const ungrouped = badges.filter((badge) =>
      !badgeGroups.some((group) => group.badges.some((candidate) => normalizeBadgeName(candidate) === normalizeBadgeName(badge.name))),
    );
    return [...grouped, ...(ungrouped.length ? ["其他", ...ungrouped.map(badgeLabel)] : [])];
  };
  const tendencyLines = tendencyLoadState === "loading"
    ? ["正在加载倾向数据"]
    : tendencyLoadState === "error"
      ? ["倾向数据加载失败，请刷新后重试"]
      : tendencyLoadState === "unavailable"
        ? ["当前版本暂无独立倾向数据"]
        : Object.keys(result.tendencies).length
        ? tendencyGroups.flatMap((group) => {
          const members = group.fields.filter((field) => result.tendencies[field] !== undefined);
          return members.length ? [group.label, ...members.map((field) => `${getTendencyNameCN(field)} ${result.tendencies[field]}`)] : [];
        })
        : ["暂无倾向数据"];
  const durabilityAttrShort: Record<string, string> = {
    "Head Durability": "头部", "Neck Durability": "颈部", "Back Durability": "背部",
    "Left Shoulder Durability": "左肩", "Right Shoulder Durability": "右肩",
    "Left Elbow Durability": "左肘", "Right Elbow Durability": "右肘",
    "Left Hip Durability": "左髋", "Right Hip Durability": "右髋",
    "Left Knee Durability": "左膝", "Right Knee Durability": "右膝",
    "Left Ankle Durability": "左踝", "Right Ankle Durability": "右踝",
    "Left Foot Durability": "左脚", "Right Foot Durability": "右脚",
    "Overall Durability": "综合",
  };
  const attributeLines = attributeGroups.flatMap((group) => {
    const items = group.attrs.flatMap((attr) => {
      if (attr === "Potential Min" || attr === "Potential Max") return [];
      const value = result.initialAttrs[attr];
      return value == null ? [] : [`${durabilityAttrShort[attr] ?? attrNameCN[attr] ?? attr} ${value}`];
    });
    return items.length ? [group.label, ...items] : [];
  });
  const ovrLines = [
    "说明: 综评由本工具按最终属性、徽章和无形属性模型估算，仅作生成参考；不是 2K 实机读取的真实官方综评。",
    `模型估算初始综评: ${displayOverall}（目标 ${result.initialOverallTarget}）`,
    `无形属性: ${result.intangibles}`,
    ...(displayOverall >= 85 ? ["提示: 85+ 为模型外推区间"] : []),
    ...(result.initialOverallConstraintReachable ? [] : ["警告：手动锁定的数值使模型估算综评无法完全达到目标"]),
  ];

  // --- [模板] resolves against the FULL source map (roster + card pseudo-sources) ---
  const templateLines = bundles.map((bundle) => {
    const lock = locks[bundle.id];
    if (lock?.kind === "custom") {
      const values = bundle.attrs.map((attr) => `${attrNameCN[attr] ?? attr} ${lock.values[attr]}`).join("，");
      return `${bundle.label}: 手动设置（${values}）`;
    }
    const player = lock?.kind === "player" ? sources.get(lock.playerId) : undefined;
    return `${bundle.label}: ${player ? getPlayerNameCN(player.name) : "--"}`;
  });

  // --- [来源卡资料] appendix: raw card vitals, labelled as template source ---
  const cardAppendix: string[] = [];
  if (card) {
    cardAppendix.push(
      `来源卡: ${card.name}（${card.year} 届 · 卡 OVR ${card.overall ?? "--"}）`,
      `名字: ${vs("firstName")}${sep}姓氏: ${vs("lastName")}${sep}昵称: ${vs("nickname")}`,
      `球衣号码: ${vn("jerseyNumber")}`,
      `出生: ${vn("birthYear")}年${vn("birthMonth")}月${vn("birthDay")}日`,
      `惯用手: ${handCN(v("dominantHand"))}（扣篮: ${handCN(v("dominantDunkHand"))}）${sep}职业年限: ${vn("yearsPro")}`,
      `巅峰年龄: ${vn("peakStartAge")}-${vn("peakEndAge")}`,
      `身高: ${typeof v("heightInches") === "number" ? `${Math.round((v("heightInches") as number) * 2.54)} cm` : "--"}${sep}体重: ${typeof v("weightLb") === "number" ? `${Math.round((v("weightLb") as number) * 0.4536)} kg` : "--"}`,
      `臂展: ${typeof v("wingspanCm") === "number" ? `${v("wingspanCm")} cm` : "--"}${sep}肩宽: ${vs("shoulderLength")}${sep}颈长: ${vs("neckLength")}${sep}躯干: ${vs("trunkLength")}`,
      `进攻方式: ${[1, 2, 3, 4].map((n) => vs(`playType${n}`)).join(sep)}`,
      `比赛主控者: ${v("playInitiator") == null ? "--" : v("playInitiator") ? "是" : "否"}${sep}强制不先发: ${vs("forceNonStarter")}`,
      `胜利重要性: ${vn("playForWinner")}${sep}经济重要性: ${vn("financialSecurity")}${sep}忠诚度: ${vn("loyalty")}`,
      `成长概率: ${vn("boomPercent")}%${sep}平均: ${vn("averagePercent")}%${sep}衰退: ${vn("bustPercent")}%`,
    );
  }

  // --- [生成履历] appendix: 16-slot provenance (bundle / source / raw → adjusted) ---
  const ledgerLines: string[] = [];
  for (const bundle of bundles) {
    const lock = locks[bundle.id];
    const evaluation = evaluations[bundle.id];
    if (!lock || !evaluation) continue;
    if (lock.kind === "custom") {
      ledgerLines.push(`${bundle.label}${sep}手动设置${sep}${evaluation.raw} → ${evaluation.adjusted}`);
      continue;
    }
    const player = sources.get(lock.playerId);
    const sourceName = player ? player.name : lock.playerId;
    const team = player?.rosterTeam ?? player?.team ?? "--";
    ledgerLines.push(`${bundle.label}${sep}${getPlayerNameCN(sourceName)}（${team}）${sep}${evaluation.raw} → ${evaluation.adjusted}`);
  }

  return [
    `${dataVersionLabel} 新秀生成清单`, "",
    "[资料]", ...vitalLines,
    "", "[身体]", ...bodyLines,
    "", "[耐久]", ...durabilityLines,
    "", "[属性]", ...attributeLines,
    "", "[模型估算综评]", ...ovrLines,
    "", "[热区]", ...hotZoneLines,
    "", "[徽章]", ...groupBadgeLines(result.badges),
    ...(personalityLines.length ? ["", "[个性]", ...personalityLines] : []),
    "", "[倾向]", ...tendencyLines,
    "", "[模板]", ...templateLines,
    ...(ledgerLines.length ? ["", "[生成履历]", ...ledgerLines] : []),
    ...(cardAppendix.length ? ["", "[来源卡资料]", ...cardAppendix] : []),
  ].join("\n");
}
