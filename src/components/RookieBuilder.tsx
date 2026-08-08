import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Pencil,
  RefreshCw,
  Shuffle,
  Unlock,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { badgeTierCN, getBadgeNameCN, normalizeBadgeName } from "../badges";
import MarqueeDraw, { type MarqueeDrawItem } from "./MarqueeDraw";
import { attrNameCN, type PlayerSource } from "../domain";
import {
  ages,
  bodyBases,
  bundles,
  clamp,
  createResult,
  evaluate,
  evaluateCustom,
  makeRandom,
  positions,
  secondaryPositionShare,
  type Bundle,
  type Evaluation,
  type HotZoneState,
  type LockState,
  type Position,
} from "../createResult";
import {
  loadTendencyLookup,
  type TendencyDataVersion,
  type TendencyLookup,
} from "../tendencies";
import { loadRookieCards, lookupRookieCard, type RookieCardLookup } from "../rookieCards";
import { getTendencyNameCN } from "../tendencyNames";
import { getPlayerHeadshotSources, prefetchPlayerHeadshots } from "../playerHeadshots";
import { getPlayerNameCN } from "../playerNames";
import { type OverallDataVersion } from "../rookieOverall";
import { generateRookieName } from "../rookieNames";
import { type BuilderBody as BodySettings } from "../rookieBodyConstraints";
import { DURABILITY_ATTRIBUTES } from "../rookieDurability";
import { attributeGroups, badgeGroups, hotZoneGroups, tendencyGroups } from "../fieldCategories";

export type RookieBuilderTeam = {
  id: string;
  name: string;
  players: PlayerSource[];
};

export type BuilderMode = "rookie" | "prime";
export type SourceSelectionMode = "random" | "manual";

type TeamRound = {
  teamId: string;
  playerOrder: string[];
  offset: number;
};
type ManualPlayerGroup = {
  key: string;
  representative: PlayerSource;
  variants: PlayerSource[];
};
type TendencyLoadState = "idle" | "loading" | "ready" | "unavailable" | "error";
type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

const playersPerRound = 8;
const playerSwitchLimit = 3;
const teamDrawDurationMs = 1800;
const teamDrawSettleHoldMs = 360;

const teamLogoCodes: Record<string, string> = {
  "Atlanta Hawks": "atl", "Boston Celtics": "bos", "Brooklyn Nets": "bkn", "Charlotte Hornets": "cha",
  "Chicago Bulls": "chi", "Cleveland Cavaliers": "cle", "Dallas Mavericks": "dal", "Denver Nuggets": "den",
  "Detroit Pistons": "det", "Golden State Warriors": "gs", "Houston Rockets": "hou", "Indiana Pacers": "ind",
  "Los Angeles Clippers": "lac", "Los Angeles Lakers": "lal", "Memphis Grizzlies": "mem", "Miami Heat": "mia",
  "Milwaukee Bucks": "mil", "Minnesota Timberwolves": "min", "New Orleans Pelicans": "no", "New York Knicks": "ny",
  "Oklahoma City Thunder": "okc", "Orlando Magic": "orl", "Philadelphia 76ers": "phi", "Phoenix Suns": "phx",
  "Portland Trail Blazers": "por", "Sacramento Kings": "sac", "San Antonio Spurs": "sa", "Toronto Raptors": "tor",
  "Utah Jazz": "utah", "Washington Wizards": "wsh",
};

function teamMark(team: RookieBuilderTeam) {
  return team.name
    .split(/\s+/)
    .filter((word) => !["Los", "Angeles", "New", "San"].includes(word))
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase() || team.id.slice(0, 3).toUpperCase();
}

function teamLogoUrl(team: RookieBuilderTeam, theme: "light" | "dark" = "light") {
  const code = teamLogoCodes[team.name];
  if (!code) return undefined;
  // ESPN ships a dedicated 500-dark set that stays readable on dark panels.
  const folder = theme === "dark" ? "500-dark" : "500";
  return `https://a.espncdn.com/i/teamlogos/nba/${folder}/${code}.png`;
}

const naturalSecondaryPositions: Record<Position, Position[]> = {
  PG: ["SG", "SF"],
  SG: ["PG", "SF"],
  SF: ["PG", "SG", "PF"],
  PF: ["SF", "C"],
  C: ["PF"],
};

function defaultSecondaryPosition(position: Position): Position {
  return ({ PG: "SG", SG: "PG", SF: "PF", PF: "C", C: "PF" } as const)[position];
}

function isNaturalSecondaryPosition(position: Position, secondary: Position) {
  return naturalSecondaryPositions[position].includes(secondary);
}

function blendedPositionWeight(position: Position, secondary: Position, bundleId: string) {
  return positionWeights[position][bundleId] * (1 - secondaryPositionShare) + positionWeights[secondary][bundleId] * secondaryPositionShare;
}

function displayedPositionWeight(position: Position, secondary: Position, bundleId: string) {
  return Math.round(blendedPositionWeight(position, secondary, bundleId));
}

const fullAttributeGroups = attributeGroups;

/** 热区字段 → 中文名（表格「热区」列命名，DB2K 卡英文 key） */
const hotZoneLabelCN: Record<string, string> = {
  underBasket: "篮下", closeLeft: "近距离左侧", closeMiddle: "近距离正面", closeRight: "近距离右侧",
  midLeft: "左侧底角中距离", midLeftCenter: "左侧 45 度中距离", midCenter: "弧顶中距离",
  midRightCenter: "右侧 45 度中距离", midRight: "右侧底角中距离",
  threeLeft: "左侧底角三分", threeLeftCenter: "左侧 45 度三分", threeCenter: "弧顶三分",
  threeRightCenter: "右侧 45 度三分", threeRight: "右侧底角三分",
};

/**
 * 生成热区的中文 key 分组（createResult 的 hotZones 用中文 key，与 DB2K 卡的英文 key 不同）。
 * 篮下 / 中距离 / 三分 三组，匹配中文 key 前缀。
 */
const hotZoneCNGroups: { key: string; label: string; keys: string[] }[] = [
  { key: "inside", label: "篮下", keys: ["篮下", "近距离左侧", "近距离中央", "近距离右侧"] },
  { key: "mid", label: "中距离", keys: ["中距离左侧底角", "中距离左侧45度", "中距离弧顶", "中距离右侧45度", "中距离右侧底角"] },
  { key: "three", label: "三分", keys: ["三分左侧底角", "三分左侧45度", "三分弧顶", "三分右侧45度", "三分右侧底角"] },
];

/** 按徽章分类分组渲染（表格「徽章」列分类），无法归类的徽章放入「其他」。 */
function renderBadgeGroups(badges: { name: string; tier: string }[]) {
  if (!badges.length) return <div className="text-[9px] text-ink-400">无</div>;
  const rows: React.ReactNode[] = [];
  for (const group of badgeGroups) {
    const members = badges.filter((badge) =>
      group.badges.some((candidate) => normalizeBadgeName(candidate) === normalizeBadgeName(badge.name)),
    );
    if (!members.length) continue;
    rows.push(
      <div key={group.key} className="mb-2">
        <div className="mb-1 text-[9px] font-semibold text-court-700">{group.label}</div>
        <div className="flex flex-wrap gap-1">
          {members.map((badge) => (
            <span key={`${group.key}:${badge.name}:${badge.tier}`} className="border border-warning-500/20 bg-warning-50 px-1 py-0.5 text-[8px] text-warning-800">
              {getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}
            </span>
          ))}
        </div>
      </div>,
    );
  }
  const ungrouped = badges.filter((badge) =>
    !badgeGroups.some((group) => group.badges.some((candidate) => normalizeBadgeName(candidate) === normalizeBadgeName(badge.name))),
  );
  if (ungrouped.length) {
    rows.push(
      <div key="other">
        <div className="mb-1 text-[9px] font-semibold text-ink-400">其他</div>
        <div className="flex flex-wrap gap-1">
          {ungrouped.map((badge) => (
            <span key={`other:${badge.name}:${badge.tier}`} className="border border-ink-200 bg-ink-50 px-1 py-0.5 text-[8px] text-ink-600">
              {getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}
            </span>
          ))}
        </div>
      </div>,
    );
  }
  return <>{rows}</>;
}

// PG-SF and PF weights are adapted from the supplied mobile-game tables.
// Strength is kept separate from athleticism so body weight can constrain it independently.
// The missing C table is conservatively inferred from the PF distribution.
const positionWeights: Record<Position, Record<string, number>> = {
  PG: { three: 10, mid: 10, face: 6, post: 2, dunk: 4, handle: 14, passing: 14, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 10, strength: 2, stability: 8, potential: 0 },
  SG: { three: 12, mid: 12, face: 7, post: 3, dunk: 6, handle: 10, passing: 8, perimeter: 7, interior: 4, steal: 3, block: 2, rebound: 4, athletic: 10, strength: 2, stability: 10, potential: 0 },
  SF: { three: 10, mid: 10, face: 7, post: 3, dunk: 8, handle: 8, passing: 6, perimeter: 7, interior: 8, steal: 3, block: 4, rebound: 6, athletic: 11, strength: 3, stability: 6, potential: 0 },
  PF: { three: 8, mid: 6, face: 6, post: 6, dunk: 6, handle: 6, passing: 4, perimeter: 7, interior: 12, steal: 3, block: 8, rebound: 10, athletic: 10, strength: 4, stability: 4, potential: 0 },
  C: { three: 4, mid: 4, face: 4, post: 6, dunk: 8, handle: 2, passing: 4, perimeter: 3, interior: 14, steal: 1, block: 12, rebound: 14, athletic: 11, strength: 7, stability: 6, potential: 0 },
};

const teamNamesCN: Record<string, string> = {
  "Atlanta Hawks": "老鹰", "Boston Celtics": "凯尔特人", "Brooklyn Nets": "篮网",
  "Charlotte Hornets": "黄蜂", "Chicago Bulls": "公牛", "Cleveland Cavaliers": "骑士",
  "Dallas Mavericks": "独行侠", "Denver Nuggets": "掘金", "Detroit Pistons": "活塞",
  "Golden State Warriors": "勇士", "Houston Rockets": "火箭", "Indiana Pacers": "步行者",
  "Los Angeles Clippers": "快船", "Los Angeles Lakers": "湖人", "Memphis Grizzlies": "灰熊",
  "Miami Heat": "热火", "Milwaukee Bucks": "雄鹿", "Minnesota Timberwolves": "森林狼",
  "New Orleans Pelicans": "鹈鹕", "New York Knicks": "尼克斯", "Oklahoma City Thunder": "雷霆",
  "Orlando Magic": "魔术", "Philadelphia 76ers": "76人", "Phoenix Suns": "太阳",
  "Portland Trail Blazers": "开拓者", "Sacramento Kings": "国王", "San Antonio Spurs": "马刺",
  "Toronto Raptors": "猛龙", "Utah Jazz": "爵士", "Washington Wizards": "奇才",
};

const teamAliasesCN: Record<string, string> = {
  "76ers": "76人", "Bucks": "雄鹿", "Bulls": "公牛", "Cavaliers": "骑士", "Celtics": "凯尔特人",
  "Clippers": "快船", "Grizzlies": "灰熊", "Hawks": "老鹰", "Heat": "热火", "Hornets": "黄蜂",
  "Jazz": "爵士", "Kings": "国王", "Knicks": "尼克斯", "Lakers": "湖人", "Magic": "魔术",
  "Mavericks": "独行侠", "Nets": "篮网", "Nuggets": "掘金", "Pacers": "步行者", "Pelicans": "鹈鹕",
  "Pistons": "活塞", "Raptors": "猛龙", "Rockets": "火箭", "Spurs": "马刺", "Suns": "太阳",
  "Thunder": "雷霆", "Timberwolves": "森林狼", "Trail Blazers": "开拓者", "Warriors": "勇士",
  "Wizards": "奇才", "New Jersey Nets": "篮网", "Charlotte Bobcats": "黄蜂", "Seattle SuperSonics": "超音速",
  "New Orleans Hornets": "鹈鹕", "Vancouver Grizzlies": "灰熊", "Washington Bullets": "奇才",
};

const rosterCategoryCN: Record<NonNullable<PlayerSource["rosterCategory"]>, string> = {
  current: "现役",
  classic: "经典赛季",
  allTime: "历史阵容",
};

function shuffle<T>(items: readonly T[], random: () => number) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function createBodySettings(position: Position, seed: number): BodySettings {
  const base = bodyBases[position];
  const random = makeRandom(seed);
  return {
    height: clamp(base.height + (random() - 0.5) * 10, 150, 300),
    weight: clamp(base.weight + (random() - 0.5) * 16, 50, 200),
    wingspan: clamp(base.wingspan + (random() - 0.5) * 20, 1, 100),
    shoulder: clamp(base.shoulder + (random() - 0.5) * 18, 1, 100),
    neck: clamp(base.neck + (random() - 0.5) * 24, 1, 100),
    torso: clamp(base.torso + (random() - 0.5) * 20, 1, 100),
  };
}

function playerId(player: PlayerSource) {
  return player.id ?? `${player.rosterTeam ?? player.team ?? "team"}:${player.slug ?? player.name}`;
}

function playerIdentity(player: PlayerSource) {
  return player.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizePlayerSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.'’\-]/g, "");
}

function matchesPlayerSearch(player: PlayerSource, query: string) {
  const normalizedQuery = normalizePlayerSearch(query);
  if (!normalizedQuery) return true;
  return [player.name, getPlayerNameCN(player.name), player.rosterTeam ?? "", player.position ?? ""]
    .some((value) => normalizePlayerSearch(value).includes(normalizedQuery));
}

function matchesPlayerGroupSearch(group: ManualPlayerGroup, query: string) {
  const normalizedQuery = normalizePlayerSearch(query);
  if (!normalizedQuery) return true;
  return group.variants.some((player) => matchesPlayerSearch(player, query))
    || normalizePlayerSearch(getPlayerNameCN(group.representative.name)).includes(normalizedQuery);
}

function localizedTeamName(team: string) {
  return teamNamesCN[team]
    ?? teamAliasesCN[team]
    ?? team.replace(/^(?:All-Time\s+)?(?:\d{4}-\d{2}\s+)?/, "");
}

function playerVariantLabel(player: PlayerSource) {
  const rawTeam = player.rosterTeam ?? player.team ?? "未记录球队";
  const category = player.rosterCategory ? rosterCategoryCN[player.rosterCategory] : "球员版本";
  const allTimeTeam = rawTeam.replace(/^All-Time\s+/, "");
  const classicMatch = rawTeam.match(/^(\d{4}-\d{2})\s+(.+)$/);
  if (player.rosterCategory === "allTime") return `${category} · ${localizedTeamName(allTimeTeam)}`;
  if (classicMatch) return `${category} · ${classicMatch[1]} · ${localizedTeamName(classicMatch[2])}`;
  return `${category} · ${localizedTeamName(rawTeam)}`;
}

/** Classic game rarity scale: gold, red, purple, blue, green, then white/common. */
function valueColor(value: number) {
  if (value >= 90) return "text-warning-800 value-rating value-rating-gold";
  if (value >= 80) return "text-rose-800 value-rating value-rating-red";
  if (value >= 70) return "text-purple-800 value-rating value-rating-purple";
  if (value >= 60) return "text-blue-800 value-rating value-rating-blue";
  if (value >= 50) return "text-court-800 value-rating value-rating-green";
  return "text-ink-900 value-rating value-rating-common";
}

function createRound(teams: RookieBuilderTeam[], seed: number, previousTeamId = ""): TeamRound {
  const valid = teams.filter((team) => team.players.length > 0);
  const random = makeRandom(seed);
  // Exclude the previous team so every remaining team stays equally likely.
  // Replacing a repeat with "next in array" doubled that neighbor's odds.
  const candidates = valid.length > 1
    ? valid.filter((team) => team.id !== previousTeamId)
    : valid;
  const pool = candidates.length > 0 ? candidates : valid;
  const team = pool[Math.floor(random() * pool.length)] ?? pool[0];
  return {
    teamId: team?.id ?? "",
    playerOrder: team ? shuffle(team.players.map(playerId), random) : [],
    offset: 0,
  };
}


async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose Clipboard API but reject it outside a secure context.
    }
  }

  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command was rejected.");
    }
  } finally {
    textarea.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
}

function createExportText(
  rookieName: string,
  result: ReturnType<typeof createResult>,
  locks: LockState,
  evaluations: Record<string, Evaluation>,
  players: Map<string, PlayerSource>,
  mode: BuilderMode,
  tendencyLoadState: TendencyLoadState,
  dataVersionLabel: string,
) {
  const isPrime = mode === "prime";
  const card = result.card ?? null;
  const v = (key: string) => card?.vitals?.[key];
  const vs = (key: string) => {
    const value = v(key);
    return value == null || value === "" ? "--" : String(value);
  };
  const vn = (key: string) => {
    const value = v(key);
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "--";
  };
  const handCN = (hand: string | number | boolean | null | undefined) =>
    hand === "Right" ? "右手" : hand === "Left" ? "左手" : hand == null ? "--" : String(hand);
  // Full record sections come from the locked rookie card (single-card build);
  // without a card the export keeps the classic reduced fields.
  const vitalLines = card ? [
    `名字: ${vs("firstName")}`, `姓氏: ${vs("lastName")}`, `昵称: ${vs("nickname")}`,
    `位置: ${result.position}`, `次要位置: ${result.secondary}`,
    `出生: ${vn("birthYear")}年${vn("birthMonth")}月${vn("birthDay")}日`, `年龄: ${result.age}`,
    `球衣号码: ${vn("jerseyNumber")}`, `惯用手: ${handCN(v("dominantHand"))}`,
    `扣篮惯用手: ${handCN(v("dominantDunkHand"))}`, `职业年限: ${vn("yearsPro")}`,
    `巅峰开始年龄: ${vn("peakStartAge")}`, `巅峰结束年龄: ${vn("peakEndAge")}`,
    `潜力: ${result.potential}（${result.potentialMin}-${result.potentialMax}）`,
    `衰退百分比: ${vn("bustPercent")}%`, `平均百分比: ${vn("averagePercent")}%`,
    `成长百分比: ${vn("boomPercent")}%`,
    `胜利重要性: ${vn("playForWinner")}`, `经济重要性: ${vn("financialSecurity")}`,
    `忠诚度: ${vn("loyalty")}`, `强制不先发: ${vs("forceNonStarter")}`,
    `比赛主控者: ${v("playInitiator") == null ? "--" : v("playInitiator") ? "是" : "否"}`,
    `进攻方式 1: ${vs("playType1")}`, `进攻方式 2: ${vs("playType2")}`,
    `进攻方式 3: ${vs("playType3")}`, `进攻方式 4: ${vs("playType4")}`,
    `数据版本: ${dataVersionLabel}`,
    ...(!isPrime ? [`预计成长速度: 每年 +${result.progressSpeed} OVR`] : []),
  ] : [
    `姓名: ${rookieName}`, `年龄: ${result.age}`, `位置: ${result.position}`, `次要位置: ${result.secondary}`,
    `惯用手: ${result.hand}`, `扣篮惯用手: ${result.dunkHand}`,
    `巅峰开始年龄: ${result.peakStart}`, `巅峰结束年龄: ${result.peakEnd}`,
    `数据版本: ${dataVersionLabel}`,
    ...(!isPrime ? [`预计成长速度: 每年 +${result.progressSpeed} OVR`] : []),
    `潜力: ${result.potential}（${result.potentialMin}-${result.potentialMax}）`,
    `成长概率: ${result.boom}%`, `平均概率: ${result.normal}%`, `衰退概率: ${result.bust}%`,
  ];
  const bodyLines = card ? [
    // 身高/体重/臂展: 卡真实值（游戏内 in/lb/cm，括号为换算 cm/kg）
    `身高: ${typeof v("heightInches") === "number" ? `${v("heightInches")} in（${Math.round((v("heightInches") as number) * 2.54)} cm）` : `${result.height} cm`}`,
    `体重: ${typeof v("weightLb") === "number" ? `${v("weightLb")} lb（${Math.round((v("weightLb") as number) * 0.4536)} kg）` : `${result.weight} kg`}`,
    `臂展: ${typeof v("wingspanCm") === "number" ? `${v("wingspanCm")} cm` : result.wingspan}`,
    // 肩宽/颈长/躯干: 游戏内为 1-100 评分（DB2K 快照当前全为占位 50，无真实值）
    `肩宽（1-100）: ${vs("shoulderLength") === "--" ? result.shoulder : vs("shoulderLength")}`,
    `颈部长度（1-100）: ${vs("neckLength") === "--" ? result.neck : vs("neckLength")}`,
    `躯干长度（1-100）: ${vs("trunkLength") === "--" ? result.torso : vs("trunkLength")}`,
  ] : [
    `身高: ${result.height} cm`, `体重: ${result.weight} kg`,
    `臂展（1-100）: ${result.wingspan}`, `肩宽（1-100）: ${result.shoulder}`,
    `颈部长度（1-100）: ${result.neck}`, `躯干长度（1-100）: ${result.torso}`,
  ];
  const durabilityLines = card && Object.keys(card.durability).length ? [
    `头部耐久: ${card.durability.head ?? "--"}`, `颈部耐久: ${card.durability.neck ?? "--"}`,
    `背部耐久: ${card.durability.back ?? "--"}`,
    `左肩耐久: ${card.durability.leftShoulder ?? "--"}`, `右肩耐久: ${card.durability.rightShoulder ?? "--"}`,
    `左肘耐久: ${card.durability.leftElbow ?? "--"}`, `右肘耐久: ${card.durability.rightElbow ?? "--"}`,
    `左髋关节耐久: ${card.durability.leftHip ?? "--"}`, `右髋关节耐久: ${card.durability.rightHip ?? "--"}`,
    `左膝耐久: ${card.durability.leftKnee ?? "--"}`, `右膝耐久: ${card.durability.rightKnee ?? "--"}`,
    `左踝关节耐久: ${card.durability.leftAnkle ?? "--"}`, `右踝关节耐久: ${card.durability.rightAnkle ?? "--"}`,
    `左脚耐久: ${card.durability.leftFoot ?? "--"}`, `右脚耐久: ${card.durability.rightFoot ?? "--"}`,
    `综合耐久: ${card.durability.overall ?? "--"}`,
  ] : [];
  const hotZoneCN: Record<string, string> = {
    underBasket: "篮下", closeLeft: "近距离左侧", closeMiddle: "近距离正面", closeRight: "近距离右侧",
    midLeft: "左侧底角中距离", midLeftCenter: "左侧 45 度中距离", midCenter: "弧顶中距离",
    midRightCenter: "右侧 45 度中距离", midRight: "右侧底角中距离",
    threeLeft: "左侧底角三分", threeLeftCenter: "左侧 45 度三分", threeCenter: "弧顶三分",
    threeRightCenter: "右侧 45 度三分", threeRight: "右侧底角三分",
  };
  const hotZoneLines = card && Object.keys(card.hotZones).length
    ? hotZoneGroups.flatMap((group) => [
      `-- ${group.label} --`,
      ...group.zones.map((key) => {
        const state = card.hotZones[key];
        return `${hotZoneCN[key] ?? key}: ${state === "Hot" ? "热区" : state === "Cold" ? "冷区" : "正常"}`;
      }),
    ])
    : hotZoneCNGroups.flatMap((group) => {
      const entries = group.keys.filter((key) => result.hotZones[key] !== undefined);
      return entries.length ? [`-- ${group.label} --`, ...entries.map((name) => `${name}: ${result.hotZones[name]}`)] : [];
    });
  const personalityLines = card?.personalityBadges?.length
    ? card.personalityBadges.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}`)
    : [];
  // 徽章按分类分组输出（内线得分/外线得分/组织/防守/运动能力/篮板/个性）。
  const groupBadgeLines = (badges: { name: string; tier: string }[]): string[] => {
    const grouped = badgeGroups.flatMap((group) => {
      const members = badges.filter((badge) =>
        group.badges.some((candidate) => normalizeBadgeName(candidate) === normalizeBadgeName(badge.name)),
      );
      return members.length ? [`-- ${group.label} --`, ...members.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}`)] : [];
    });
    const ungrouped = badges.filter((badge) =>
      !badgeGroups.some((group) => group.badges.some((candidate) => normalizeBadgeName(candidate) === normalizeBadgeName(badge.name))),
    );
    return [
      ...grouped,
      ...(ungrouped.length ? ["-- 其他 --", ...ungrouped.map((badge) => `${getBadgeNameCN(badge.name)}: ${badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}`)] : []),
    ];
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
          return members.length ? [`-- ${group.label} --`, ...members.map((field) => `${getTendencyNameCN(field)}: ${result.tendencies[field]}`)] : [];
        })
        : ["暂无倾向数据（来源球员没有对应档案）"];
  return [
    `${dataVersionLabel} ${isPrime ? "巅峰球员" : "新秀"}生成清单`, "",
    `[资料${card ? `（${card.name} ${card.year} 届新秀卡）` : ""}]`,
    ...vitalLines,
    "", "[身体设定]", ...bodyLines,
    ...(durabilityLines.length ? ["", "[耐久]", ...durabilityLines] : []),
    "", `[完整${isPrime ? "巅峰" : "初始"}属性预览]`,
    ...fullAttributeGroups.flatMap((group) => [
      `-- ${group.label} --`,
      ...group.attrs.map((attr) => `${attrNameCN[attr] ?? attr}: ${result.initialAttrs[attr] ?? "--"}`),
    ]),
    "", "[杂项]", `游戏 OVR 估算: ${result.baseOverall}`, `无形属性: ${result.intangibles}`,
    `${isPrime ? "巅峰 OVR" : "预计初始 OVR"}: ${result.initialStrength}`, `潜力: ${result.potential}（${result.potentialMin}-${result.potentialMax}）`,
    ...(!isPrime ? [
      `新秀初始 OVR 目标: ${result.initialOverallTarget}`,
      ...(result.initialOverallConstraintReachable ? [] : ["警告：手动锁定的数值使初始 OVR 无法完全达到目标"]),
    ] : []),
    "", "[热区]", ...hotZoneLines,
    ...(isPrime ? [
      "", `[巅峰徽章（按属性槽继承${result.badgesEstimated ? "，含推算" : ""}）]`, ...(result.badges.length ? groupBadgeLines(result.badges) : ["无"]),
    ] : [
      "", `[当前徽章（按${result.rookieTier}档调整）]`, ...(result.badges.length ? groupBadgeLines(result.badges) : ["无"]),
      "", `[巅峰徽章（按属性槽继承${result.badgesEstimated ? "，含推算" : ""}）]`, ...(result.peakBadges.length ? groupBadgeLines(result.peakBadges) : ["无"]),
    ]),
    ...(personalityLines.length ? ["", "[个性徽章]", ...personalityLines] : []),
    "", "[倾向（继承属性来源，未按等级调整）]",
    ...tendencyLines,
    "", "[属性来源]", ...bundles.map((bundle) => {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        const values = bundle.attrs.map((attr) => `${attrNameCN[attr] ?? attr} ${lock.values[attr]}`).join("，");
        return `${bundle.label}: 手动设置（${values}）`;
      }
      const player = lock?.kind === "player" ? players.get(lock.playerId) : undefined;
      const evaluation = evaluations[bundle.id];
      const bodyAdjustment = evaluation?.bodyAdjustment ?? 0;
      const capLabel = Object.entries(evaluation?.bodyCaps ?? {})
        .map(([attr, cap]) => `${attrNameCN[attr] ?? attr}上限 ${cap}`)
        .join(" / ");
      const adjustments = [
        bodyAdjustment ? `身体修正 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment}` : "",
        capLabel,
        player?.isEstimated ? "估算值" : "",
      ].filter(Boolean).join("，");
      const weightLabel = bundle.id === "potential"
        ? "独立潜力来源"
        : `位置权重 ${displayedPositionWeight(result.position, result.secondary, bundle.id)}%`;
      return `${bundle.label}（${weightLabel}）: ${player ? getPlayerNameCN(player.name) : "--"}${adjustments ? `（${adjustments}）` : ""}`;
    }),
  ].join("\n");
}

const headshotSourceTimeoutMs = 2500;

function PlayerHeadshot({ name, priority = false }: { name: string; priority?: boolean }) {
  const sources = useMemo(() => getPlayerHeadshotSources(name), [name]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = sources[sourceIndex];

  useLayoutEffect(() => {
    setSourceIndex(0);
    setLoaded(false);
  }, [name, sources]);

  useEffect(() => {
    if (!priority || !src || loaded) return;
    const timeout = window.setTimeout(() => {
      setLoaded(false);
      setSourceIndex((current) => sources[current] === src ? current + 1 : current);
    }, headshotSourceTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [loaded, priority, sources, src]);

  if (!src) {
    return (
      <span
        aria-label={`${getPlayerNameCN(name)}默认头像`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[5px] border border-ink-200 bg-ink-100 text-ink-400"
        role="img"
        title="默认头像"
      >
        <UserRound aria-hidden="true" className="h-5 w-5 stroke-[1.6]" />
      </span>
    );
  }

  return (
    <img
      alt={`${getPlayerNameCN(name)}头像`}
      className="h-9 w-9 shrink-0 rounded-[5px] border border-ink-200 bg-ink-100 object-cover object-top"
      decoding="async"
      // Visible roster cards should load immediately; later batches can wait.
      fetchPriority={priority ? "high" : "low"}
      loading={priority ? "eager" : "lazy"}
      onError={() => {
        // Advance through proxy → primary CDN → secondary CDN; past the end shows the default avatar.
        setLoaded(false);
        setSourceIndex((current) => sources[current] === src ? current + 1 : current);
      }}
      onLoad={() => setLoaded(true)}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

function BodyNumberInput({
  disabled,
  label,
  max,
  min,
  onChange,
  unit,
  value,
}: {
  disabled: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  unit?: string;
  value: number;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = (rawValue: string) => {
    const parsed = Number(rawValue);
    const next = Number.isFinite(parsed) ? clamp(parsed, min, max) : value;
    setDraft(String(next));
    onChange(next);
  };

  return (
    <label className="min-w-0">
      <span className="mb-1 flex items-center justify-between gap-1 text-[9px] font-semibold text-ink-500"><span>{label}</span>{unit && <span className="font-normal text-ink-400">{unit}</span>}</span>
      <input
        className="h-8 w-full rounded-[5px] border border-ink-200 bg-ink-50 px-2 text-center text-[12px] font-semibold tabular-nums text-ink-800 outline-none transition focus:border-court-500 focus:bg-white disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
        disabled={disabled}
        inputMode="numeric"
        max={max}
        min={min}
        onBlur={(event) => commit(event.currentTarget.value)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
        type="number"
        value={draft}
      />
    </label>
  );
}

function RookieBuilder({
  teams,
  mode = "rookie",
  tendencyVersion = "2k26",
  overallVersion = "2k26",
  dataVersionLabel = "NBA 2K26",
  selectionMode = "random",
  availablePlayers = [],
  onFlowActiveChange,
}: {
  teams: RookieBuilderTeam[];
  mode?: BuilderMode;
  selectionMode?: SourceSelectionMode;
  availablePlayers?: PlayerSource[];
  tendencyVersion?: TendencyDataVersion;
  overallVersion?: OverallDataVersion;
  dataVersionLabel?: string;
  onFlowActiveChange?: (active: boolean) => void;
}) {
  const isPrime = mode === "prime";
  const isManualSelection = selectionMode === "manual";
  const [rookieName, setRookieName] = useState(() => generateRookieName());
  const [position, setPosition] = useState<Position>("PG");
  const [secondaryPosition, setSecondaryPosition] = useState<Position>(() => defaultSecondaryPosition("PG"));
  const [age, setAge] = useState(19);

  const [body, setBody] = useState<BodySettings>(() => createBodySettings("PG", Date.now()));
  const [settingsLocked, setSettingsLocked] = useState(false);
  const [tendencyLookup, setTendencyLookup] = useState<TendencyLookup | null>(null);
  const [tendencyLoadError, setTendencyLoadError] = useState(false);
  const [rookieCards, setRookieCards] = useState<RookieCardLookup | null>(null);
  const [rookieCardLoadError, setRookieCardLoadError] = useState(false);
  const [locks, setLocks] = useState<LockState>({});
  const [round, setRound] = useState<TeamRound>(() => createRound(teams, Date.now()));
  const [isTeamDrawing, setIsTeamDrawing] = useState(false);
  const [teamDrawPhase, setTeamDrawPhase] = useState<"rolling" | "landing">("rolling");
  const [drawingTeamId, setDrawingTeamId] = useState<string | null>(null);
  const [switchesLeft, setSwitchesLeft] = useState(playerSwitchLimit);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playerVersionGroupKey, setPlayerVersionGroupKey] = useState<string | null>(null);
  const [customizingBundleId, setCustomizingBundleId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({});
  const [playerSearch, setPlayerSearch] = useState("");
  const [status, setStatus] = useState(`确认${isPrime ? "巅峰球员" : "新秀"}设置后开始生成`);

  const pendingTeamDrawRef = useRef<{ round: TeamRound; completionStatus: string } | null>(null);
  const customDialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onFlowActiveChange?.(settingsLocked);
  }, [onFlowActiveChange, settingsLocked]);

  useEffect(() => () => onFlowActiveChange?.(false), [onFlowActiveChange]);

  useEffect(() => () => {
    pendingTeamDrawRef.current = null;
  }, []);

  useEffect(() => {
    if (!settingsLocked || tendencyLookup || tendencyLoadError) return;
    let active = true;
    loadTendencyLookup(tendencyVersion)
      .then((lookup) => {
        if (active) setTendencyLookup(lookup);
      })
      .catch(() => {
        if (active) setTendencyLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [settingsLocked, tendencyLoadError, tendencyLookup, tendencyVersion]);

  // Real rookie cards (DB2K exports 2018–2025) are lazy-loaded in rookie mode
  // as soon as the builder mounts — before settings are confirmed — so the
  // first generation already has card data. Prime mode never loads them.
  useEffect(() => {
    if (isPrime || rookieCards || rookieCardLoadError) return;
    let active = true;
    loadRookieCards()
      .then((cards) => {
        if (active) setRookieCards(cards);
      })
      .catch(() => {
        if (active) setRookieCardLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [isPrime, rookieCardLoadError, rookieCards]);

  useEffect(() => {
    if (!customizingBundleId && !playerVersionGroupKey) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = () => {
      const focusable = customDialogRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])");
      focusable?.focus();
    };
    const animationFrame = window.requestAnimationFrame(focusDialog);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (customizingBundleId) setCustomizingBundleId(null);
        else setPlayerVersionGroupKey(null);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [...(customDialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? [])];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [customizingBundleId, playerVersionGroupKey]);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(
    () => new Map([
      ...teams.flatMap((team) => team.players.map((player) => [playerId(player), player] as const)),
      ...availablePlayers.map((player) => [playerId(player), player] as const),
    ]),
    [availablePlayers, teams],
  );
  const manualPlayerGroups = useMemo<ManualPlayerGroup[]>(
    () => {
      const grouped = new Map<string, Map<string, PlayerSource>>();
      for (const player of availablePlayers) {
        const identity = playerIdentity(player);
        const variants = grouped.get(identity) ?? new Map<string, PlayerSource>();
        variants.set(playerId(player), player);
        grouped.set(identity, variants);
      }

      return [...grouped.entries()]
        .map(([key, variantsById]) => {
          const variants = [...variantsById.values()].sort((left, right) => (
            (left.rosterCategory === "current" ? 0 : left.rosterCategory === "classic" ? 1 : 2)
            - (right.rosterCategory === "current" ? 0 : right.rosterCategory === "classic" ? 1 : 2)
          ) || (right.overall ?? 0) - (left.overall ?? 0) || left.name.localeCompare(right.name));
          return { key, representative: variants[0], variants };
        })
        .sort((left, right) => (
          (right.variants.reduce((max, player) => Math.max(max, player.overall ?? 0), 0))
          - (left.variants.reduce((max, player) => Math.max(max, player.overall ?? 0), 0))
        ) || getPlayerNameCN(left.representative.name).localeCompare(getPlayerNameCN(right.representative.name)));
    },
    [availablePlayers],
  );
  const playerVersionGroup = playerVersionGroupKey
    ? manualPlayerGroups.find((group) => group.key === playerVersionGroupKey)
    : undefined;
  const team = settingsLocked ? teamsById.get(round.teamId) : undefined;
  const [logoTheme, setLogoTheme] = useState<"light" | "dark">(() => (
    document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  ));

  useEffect(() => {
    const root = document.documentElement;
    const syncTheme = () => {
      setLogoTheme(root.dataset.theme === "dark" ? "dark" : "light");
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const teamDrawItems = useMemo<MarqueeDrawItem[]>(() => teams
    .filter((candidate) => candidate.players.length > 0)
    .map((candidate) => ({
      id: candidate.id,
      imageSrc: teamLogoUrl(candidate, logoTheme),
      label: teamNamesCN[candidate.name] ?? candidate.name,
      mark: teamMark(candidate),
      meta: `${candidate.players.length} 名球员`,
    })), [logoTheme, teams]);
  const drawingTeamLabel = drawingTeamId
    ? teamDrawItems.find((item) => item.id === drawingTeamId)?.label
    : undefined;
  const handleTeamDrawPhaseChange = useCallback((phase: "idle" | "rolling" | "landing" | "settled") => {
    if (phase === "landing") setTeamDrawPhase("landing");
    else if (phase === "rolling") setTeamDrawPhase("rolling");
  }, []);
  const displayStatus = isTeamDrawing && teamDrawPhase === "landing"
    ? `已抽中${drawingTeamLabel ?? "球队"}`
    : status;
  const selectedPlayer = selectedPlayerId ? playersById.get(selectedPlayerId) : undefined;
  // Keyed by the concrete roster version id, not by normalized identity: the
  // same player's different versions (current / classic / all-time) are
  // intentionally allowed to lock different slots.
  const usedBy = useMemo(() => new Map(Object.entries(locks).flatMap(([bundleId, lock]) => {
    if (lock.kind !== "player") return [];
    return [[lock.playerId, bundleId] as const];
  })), [locks]);
  const evaluations = useMemo(() => {
    const next: Record<string, Evaluation> = {};
    for (const bundle of bundles) {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        next[bundle.id] = evaluateCustom(bundle, lock.values, body);
        continue;
      }
      const player = lock?.kind === "player" ? playersById.get(lock.playerId) : undefined;
      if (player) {
        const card = !isPrime ? lookupRookieCard(rookieCards, player.name) : null;
        next[bundle.id] = evaluate(player, bundle, body, card);
      }
    }
    return next;
  }, [body, isPrime, locks, playersById, rookieCards]);
  const selectedEvaluations = useMemo(() => Object.fromEntries(
    selectedPlayer ? bundles.map((bundle) => {
      const card = !isPrime ? lookupRookieCard(rookieCards, selectedPlayer.name) : null;
      return [bundle.id, evaluate(selectedPlayer, bundle, body, card)];
    }) : [],
  ) as Record<string, Evaluation>, [body, isPrime, rookieCards, selectedPlayer]);
  const bodyAdjustedAttributes = useMemo(() => new Set(
    bundles.flatMap((bundle) => {
      const evaluation = evaluations[bundle.id];
      if (!evaluation) return [];
      return bundle.attrs.filter((attr) => (
        (evaluation.bodyAdjustments[attr] ?? 0) !== 0
        || Object.prototype.hasOwnProperty.call(evaluation.bodyCaps, attr)
      ));
    }),
  ), [evaluations]);
  const effectiveAge = isPrime ? 28 : age;
  const result = useMemo(
    () => createResult(
      locks,
      effectiveAge,
      position,
      secondaryPosition,
      body,
      mode,
      playersById,
      tendencyLookup,
      overallVersion,
      rookieCards,
    ),
    [body, effectiveAge, locks, mode, overallVersion, playersById, position, secondaryPosition, rookieCards, tendencyLookup],
  );
  const tendencyLoadState: TendencyLoadState = tendencyLookup?.available === false
    ? "unavailable"
    : tendencyLookup
      ? "ready"
      : tendencyLoadError
        ? "error"
        : settingsLocked
          ? "loading"
          : "idle";
  const tendencyCount = Object.keys(result.tendencies).length;
  const tendencyStatusLabel = tendencyLoadState === "ready"
    ? `${tendencyCount} 项 · 未调整`
    : tendencyLoadState === "unavailable"
      ? "当前版本暂无数据"
      : tendencyLoadState === "error"
        ? "加载失败"
        : tendencyLoadState === "loading"
          ? "正在加载…"
          : "尚未加载";
  const tendencyEmptyText = tendencyLoadState === "error"
    ? "倾向数据加载失败，请刷新后重试"
    : tendencyLoadState === "loading"
      ? "正在加载倾向数据…"
      : tendencyLoadState === "unavailable"
        ? "当前版本暂无独立倾向数据"
        : "暂无倾向数据";
  const completed = Object.keys(locks).length;
  const isComplete = completed === bundles.length;
  const exportReady = isComplete && tendencyLoadState !== "loading";
  const shownIds = round.playerOrder.slice(round.offset, round.offset + playersPerRound);
  const shownPlayers = settingsLocked
    ? shownIds.map((id) => playersById.get(id)).filter((player): player is PlayerSource => Boolean(player))
    : [];
  const filteredManualPlayerGroups = useMemo(
    () => manualPlayerGroups.filter((group) => matchesPlayerGroupSearch(group, playerSearch)),
    [manualPlayerGroups, playerSearch],
  );
  const hasNextBatch = settingsLocked && round.offset + playersPerRound < round.playerOrder.length;
  const zoneCounts = Object.values(result.hotZones).reduce<Record<HotZoneState, number>>(
    (counts, state) => ({ ...counts, [state]: counts[state] + 1 }),
    { 冷区: 0, 中性: 0, 热区: 0 },
  );
  const customizingBundle = bundles.find((bundle) => bundle.id === customizingBundleId);
  const customDraftIsValid = Boolean(customizingBundle?.attrs.every((attr) => {
    const value = Number(customDraft[attr]);
    return Number.isFinite(value) && value >= 25 && value <= 99;
  }));
  const changePosition = (nextPosition: Position) => {
    if (settingsLocked) return;
    setPosition(nextPosition);
    setSecondaryPosition(defaultSecondaryPosition(nextPosition));
    setBody(createBodySettings(nextPosition, Date.now()));
  };

  const changeSecondaryPosition = (nextPosition: Position) => {
    if (settingsLocked || nextPosition === position) return;
    setSecondaryPosition(nextPosition);
  };

  const updateBody = (key: keyof BodySettings, value: number) => {
    if (settingsLocked) return;
    setBody((current) => ({ ...current, [key]: value }));
  };


  const randomizeBody = () => {
    if (settingsLocked) return;
    setBody(createBodySettings(position, Date.now()));
  };

  const randomizeName = () => {
    if (settingsLocked) return;
    setRookieName(generateRookieName());
  };

  const finishTeamDraw = () => {
    const pendingDraw = pendingTeamDrawRef.current;
    if (!pendingDraw) return;
    pendingTeamDrawRef.current = null;
    setRound(pendingDraw.round);
    setDrawingTeamId(null);
    setIsTeamDrawing(false);
    setTeamDrawPhase("rolling");
    setStatus(pendingDraw.completionStatus);
  };

  const startTeamDraw = (previousTeamId: string | undefined, completionStatus: string) => {
    const seed = Date.now();
    const nextRound = createRound(teams, seed, previousTeamId);
    // Warm only the first visible roster batch during the marquee. Prefetching the
    // full team can saturate the local proxy and delay the cards the user can see.
    const visiblePlayerNames = nextRound.playerOrder
      .slice(0, playersPerRound)
      .map((id) => playersById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    prefetchPlayerHeadshots(visiblePlayerNames);

    setTeamDrawPhase("rolling");
    setIsTeamDrawing(true);
    setDrawingTeamId(nextRound.teamId);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    setStatus("正在抽取球队…");
    pendingTeamDrawRef.current = { round: nextRound, completionStatus };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishTeamDraw();
    }
  };

  // Prefetch the next switch batch while the user browses the current eight.
  useEffect(() => {
    if (!settingsLocked || isTeamDrawing || !hasNextBatch) return;
    const upcoming = round.playerOrder
      .slice(round.offset + playersPerRound, round.offset + playersPerRound * 2)
      .map((id) => playersById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    prefetchPlayerHeadshots(upcoming);
  }, [hasNextBatch, isTeamDrawing, playersById, round.offset, round.playerOrder, settingsLocked]);

  const confirmSettings = () => {
    setRookieName((current) => current.trim().replace(/\s+/g, " ") || generateRookieName());
    setSettingsLocked(true);
    if (isManualSelection) {
      setStatus("请为每个属性槽选择来源球员");
    } else {
      startTeamDraw(undefined, "第 1 轮球队已确定");
    }
  };

  const drawNextTeam = () => {
    startTeamDraw(round.teamId, "下一轮球队已确定");
  };

  const switchPlayers = () => {
    if (!settingsLocked || isTeamDrawing || switchesLeft <= 0 || !hasNextBatch) return;
    setRound((current) => ({
      teamId: current.teamId,
      playerOrder: current.playerOrder,
      offset: current.offset + playersPerRound,
    }));
    setSwitchesLeft((current) => current - 1);
    setSelectedPlayerId(null);
    setStatus(`已换一批${team ? teamNamesCN[team.name] ?? team.name : "当前球队"}球员`);
  };

  const choosePlayer = (player: PlayerSource) => {
    const id = playerId(player);
    if (!settingsLocked || isTeamDrawing || (!isManualSelection && usedBy.has(id))) return;
    setSelectedPlayerId(id);
    setPlayerVersionGroupKey(null);
    setStatus(`已选择${getPlayerNameCN(player.name)}`);
  };

  const openPlayerVersionPicker = (group: ManualPlayerGroup) => {
    if (!settingsLocked || isTeamDrawing || isComplete) return;
    setCustomizingBundleId(null);
    setPlayerVersionGroupKey(group.key);
  };

  const finishLock = (nextLocks: LockState) => {
    setLocks(nextLocks);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    if (Object.keys(nextLocks).length === bundles.length) {
      setStatus(`${isPrime ? "巅峰球员" : "新秀"}已生成`);
    } else if (isManualSelection) {
      setStatus("已锁定。请继续为下一个属性槽选择来源球员");
    } else {
      drawNextTeam();
    }
  };

  const clickBundle = (bundle: Bundle) => {
    const existing = locks[bundle.id];
    if (existing || !settingsLocked || isTeamDrawing || !selectedPlayer || usedBy.has(playerId(selectedPlayer))) return;
    finishLock({ ...locks, [bundle.id]: { kind: "player", playerId: playerId(selectedPlayer) } });
  };

  const openCustomEditor = (bundle: Bundle) => {
    if (bundle.id === "potential" || locks[bundle.id] || !settingsLocked || isTeamDrawing) return;
    const preview = selectedEvaluations[bundle.id];
    setCustomDraft(Object.fromEntries(bundle.attrs.map((attr) => [attr, String(preview?.values[attr] ?? 75)])));
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(bundle.id);
  };

  const confirmCustomLock = () => {
    if (!customizingBundle || customizingBundle.id === "potential" || !customDraftIsValid || locks[customizingBundle.id] || isTeamDrawing) return;
    const values = Object.fromEntries(customizingBundle.attrs.map((attr) => [attr, clamp(Number(customDraft[attr]))]));
    finishLock({ ...locks, [customizingBundle.id]: { kind: "custom", values } });
  };

  const reset = () => {
    const seed = Date.now();
    pendingTeamDrawRef.current = null;
    setRookieName(generateRookieName());
    setPosition("PG");
    setSecondaryPosition(defaultSecondaryPosition("PG"));
    setAge(19);
    setBody(createBodySettings("PG", seed));
    setRound(createRound(teams, seed));
    setSettingsLocked(false);
    setIsTeamDrawing(false);
    setTeamDrawPhase("rolling");
    setDrawingTeamId(null);
    setLocks({});
    setSwitchesLeft(playerSwitchLimit);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    setCustomDraft({});
    setPlayerSearch("");
    setStatus(`确认${isPrime ? "巅峰球员" : "新秀"}设置后开始生成`);
  };

  const copyResult = async () => {
    try {
      await copyText(createExportText(rookieName, result, locks, evaluations, playersById, mode, tendencyLoadState, dataVersionLabel));
      setStatus("已复制生成报告");
    } catch {
      setStatus("复制失败，请手动复制");
    }
  };

  const downloadResult = async () => {
    const blob = new Blob([createExportText(rookieName, result, locks, evaluations, playersById, mode, tendencyLoadState, dataVersionLabel)], { type: "text/plain;charset=utf-8" });
    const nameSlug = rookieName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suggestedName = `2k26-${isPrime ? "prime" : "rookie"}-${nameSlug || position.toLowerCase()}.txt`;
    const showSaveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

    if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName,
          types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatus("已导出生成数据");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatus("已取消导出");
          return;
        }
      }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已导出生成数据");
  };

  return (
    <section className="flex min-h-0 flex-col gap-2.5">
      <div
        aria-labelledby="builder-step-settings"
        className="builder-setup panel-surface overflow-hidden"
        data-mobile-active={!settingsLocked}
        id="builder-pane-settings"
        role="tabpanel"
      >
        <div className="builder-setup-grid">
          <section aria-labelledby="player-identity-label" className="builder-setup-identity bg-white px-3 py-3">
            <div className="section-label mb-2" id="player-identity-label">球员信息</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <div className="section-label mb-1">{isPrime ? "球员姓名" : "新秀姓名"}</div>
                <div className="flex h-8 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
                  <input
                    aria-label={`${isPrime ? "巅峰球员" : "新秀"}英文姓名`}
                    className="min-w-0 flex-1 bg-transparent px-2.5 text-[12px] font-semibold text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
                    disabled={settingsLocked}
                    maxLength={48}
                    onChange={(event) => setRookieName(event.target.value)}
                    spellCheck={false}
                    type="text"
                    value={rookieName}
                  />
                  <button aria-label="随机生成英文名" className="icon-button flex w-8 shrink-0 items-center justify-center border-l border-ink-200 text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300" disabled={settingsLocked} onClick={randomizeName} title="随机生成英文名" type="button"><RefreshCw className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="min-w-0">
                <div className="section-label mb-1">年龄</div>
                <div className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200">
                  {isPrime ? (
                    <button aria-label="巅峰球员年龄固定为 28 岁" className="h-full min-w-14 cursor-not-allowed bg-ink-900 px-3 text-[11px] font-semibold text-white" disabled title="巅峰球员年龄固定为 28 岁" type="button">28</button>
                  ) : ages.map((option) => (
                    <button key={option} className={`segmented-button h-full min-w-0 flex-1 px-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 ${age === option ? "bg-ink-900 text-white" : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800"}`} disabled={settingsLocked} onClick={() => setAge(option)} type="button">{option}</button>
                  ))}
                </div>
              </div>
              <div className="min-w-0">
                <div className="section-label mb-1">主位置</div>
                <div aria-label="主位置" className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
                  {positions.map((option) => {
                    const selected = position === option;
                    const stateClass = selected
                      ? "bg-ink-900 text-white"
                      : settingsLocked
                        ? "bg-ink-50 text-ink-300"
                        : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800";
                    return (
                      <button key={option} aria-label={`主位置 ${option}`} aria-pressed={selected} className={`segmented-button h-full min-w-0 flex-1 px-1 text-[11px] font-semibold disabled:cursor-not-allowed ${stateClass}`} disabled={settingsLocked} onClick={() => changePosition(option)} type="button">{option}</button>
                    );
                  })}
                </div>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <div className="section-label mb-1 flex items-center gap-1.5">
                  次要位置
                </div>
                <div aria-label="次要位置" className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
                  {positions.map((option) => {
                    const isPrimary = option === position;
                    const selected = secondaryPosition === option;
                    const natural = !isPrimary && isNaturalSecondaryPosition(position, option);
                    const stateClass = selected
                      ? natural ? "bg-court-700 text-white" : "bg-warning-600 text-white"
                      : settingsLocked || isPrimary
                        ? "bg-ink-50 text-ink-300"
                        : natural
                          ? "bg-white text-ink-600 hover:bg-court-50 hover:text-court-800"
                          : "bg-warning-50/70 text-warning-600 hover:bg-warning-100 hover:text-warning-800";
                    return (
                      <button key={option} aria-label={`次要位置 ${option}`} aria-pressed={selected} className={`segmented-button h-full min-w-0 flex-1 px-1 text-[11px] font-semibold disabled:cursor-not-allowed ${stateClass}`} disabled={settingsLocked || isPrimary} onClick={() => changeSecondaryPosition(option)} title={isPrimary ? "次要位置不能与主位置相同" : natural ? "常规搭配" : "非常规搭配：仍会结合来源属性和体型计算"} type="button">{option}</button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>


          <section aria-labelledby="body-settings-label" className="builder-setup-body bg-ink-50/60 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="section-label" id="body-settings-label">身体设定</div>
              <button aria-label="随机生成身体设定" className="action-button h-7 w-7 justify-center" disabled={settingsLocked} onClick={randomizeBody} title="随机生成身体设定" type="button"><Shuffle className="h-3.5 w-3.5" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
              <BodyNumberInput disabled={settingsLocked} label="身高" max={300} min={150} onChange={(value) => updateBody("height", value)} unit="cm" value={body.height} />
              <BodyNumberInput disabled={settingsLocked} label="体重" max={200} min={50} onChange={(value) => updateBody("weight", value)} unit="kg" value={body.weight} />
              <BodyNumberInput disabled={settingsLocked} label="臂展" max={100} min={1} onChange={(value) => updateBody("wingspan", value)} value={body.wingspan} />
              <BodyNumberInput disabled={settingsLocked} label="肩宽" max={100} min={1} onChange={(value) => updateBody("shoulder", value)} value={body.shoulder} />
              <BodyNumberInput disabled={settingsLocked} label="颈长" max={100} min={1} onChange={(value) => updateBody("neck", value)} value={body.neck} />
              <BodyNumberInput disabled={settingsLocked} label="躯干" max={100} min={1} onChange={(value) => updateBody("torso", value)} value={body.torso} />
            </div>
          </section>

          <div className="builder-setup-footer bg-ink-50/80 px-3 py-2.5">
            <div className="builder-setup-status flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-ink-500">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-court-500" />
              <span className="truncate">{displayStatus}</span>
            </div>
            <div className="builder-setup-progress" aria-label={`完成进度 ${completed}/${bundles.length}`}>
              <div className="mb-1 flex items-center justify-between gap-2 text-[9px] font-semibold text-ink-500">
                <span>完成进度</span>
                <span className="tabular-nums text-ink-700">{completed}/{bundles.length}</span>
              </div>
              <div aria-valuemax={bundles.length} aria-valuemin={0} aria-valuenow={completed} className="builder-setup-progress-track" role="progressbar">
                <div
                  className="builder-setup-progress-fill"
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, completed / bundles.length))})` }}
                />
              </div>
            </div>
            <div className="builder-setup-actions flex shrink-0 items-center justify-end gap-1.5" aria-label="设置操作">
              {!settingsLocked && (
                <button className="action-button primary-action justify-center px-3 py-1.5 text-[11px] font-semibold" onClick={confirmSettings} type="button">
                  <Check className="h-3.5 w-3.5" />{isManualSelection ? "确认设置" : "确认并抽取"}
                </button>
              )}
              <button className="action-button justify-center px-3 py-1.5 text-[11px]" onClick={reset} type="button">
                <RefreshCw className="h-3.5 w-3.5" />{settingsLocked ? "重新开始" : "重置"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="builder-workspace">
        <aside
          aria-label="属性槽"
          className="builder-pane builder-attributes-pane panel-surface min-w-0 overflow-hidden"
          data-mobile-active={settingsLocked && !isComplete}
          id="builder-pane-attributes"
          role="tabpanel"
        >
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
            <span className="section-label">属性槽</span>
            <span className="max-w-[130px] truncate text-[9px] font-medium text-ink-500">{selectedPlayer ? getPlayerNameCN(selectedPlayer.name) : "尚未选择球员"}</span>
          </div>
          <div className="builder-mobile-summary mb-2 flex items-center gap-3 rounded-[5px] border border-ink-200 bg-ink-50/70 px-2.5 py-2 lg:hidden">
            <div className="flex shrink-0 flex-col items-center">
              <span className="text-[22px] font-bold leading-none tabular-nums text-ink-300">--</span>
              <span className="mt-1 text-[8px] font-medium text-ink-400">总评</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[9px] font-semibold text-ink-500">
                <span className="truncate">{position}/{secondaryPosition} · {effectiveAge}岁</span>
                <span className="shrink-0 tabular-nums text-ink-700">{completed}/{bundles.length}</span>
              </div>
              <div aria-valuemax={bundles.length} aria-valuemin={0} aria-valuenow={completed} className="builder-setup-progress-track" role="progressbar">
                <div
                  className="builder-setup-progress-fill"
                  style={{ transform: `scaleX(${Math.max(0, Math.min(1, completed / bundles.length))})` }}
                />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 p-2.5">
            {bundles.map((bundle) => {
              const lock = locks[bundle.id];
              const lockedPlayer = lock?.kind === "player" ? playersById.get(lock.playerId) : undefined;
              const lockedEvaluation = evaluations[bundle.id];
              const preview = selectedEvaluations[bundle.id];
              const value = lockedEvaluation?.adjusted ?? preview?.adjusted;
              const activeEvaluation = lockedEvaluation ?? preview;
              const bodyAdjustment = lockedEvaluation?.bodyAdjustment ?? preview?.bodyAdjustment ?? 0;
              const sourceLabel = lock?.kind === "custom" ? "手动设置" : lockedPlayer ? getPlayerNameCN(lockedPlayer.name) : (selectedPlayer ? "可锁定" : "等待选择");
              const weightLabel = bundle.id === "potential"
                ? "潜力独立取值，不计入位置权重"
                : `位置综合权重：${displayedPositionWeight(position, secondaryPosition, bundle.id)}%`;
              const bodyAdjustmentLabel = bodyAdjustment ? `身体修正 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment}` : "";
              const capLabels = Object.entries(activeEvaluation?.bodyCaps ?? {})
                .map(([attr, cap]) => `${attrNameCN[attr] ?? attr}上限 ${cap}`);
              const hasBodyConstraint = bodyAdjustment !== 0 || capLabels.length > 0;
              const adjustmentLabel = [
                bodyAdjustmentLabel,
                ...capLabels,
              ].filter(Boolean).join(" · ");
              return (
                <div
                  key={bundle.id}
                  className={`relative h-[52px] min-w-0 overflow-hidden rounded-[5px] border transition ${lock ? "border-court-500/25 bg-court-50/70" : selectedPlayer ? "border-ink-200 bg-white" : "border-ink-100 bg-ink-50/70"}`}
                  style={{ borderLeftColor: bundle.color, borderLeftWidth: 3 }}
                >
                  <button
                    aria-label={lock ? `已锁定${bundle.label}` : `锁定${bundle.label}`}
                    className={`flex h-full w-full min-w-0 items-center gap-1.5 px-2 pr-7 text-left transition ${lock ? "cursor-not-allowed" : selectedPlayer ? "hover:bg-ink-50" : "cursor-not-allowed"}`}
                    disabled={Boolean(lock) || !settingsLocked || !selectedPlayer}
                    onClick={() => clickBundle(bundle)}
                    title={lock ? `${weightLabel} · 已锁定；如需修改，请重新开始` : typeof value === "number" ? `${weightLabel} · ${sourceLabel}：${lockedEvaluation?.raw ?? preview?.raw} → ${value}${adjustmentLabel ? `（${adjustmentLabel}）` : ""}` : `${bundle.label} · ${weightLabel}`}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-ink-800">{bundle.label}</span>
                      <span className="block truncate text-[8px] text-ink-400">{sourceLabel}{bodyAdjustmentLabel ? ` · ${bodyAdjustmentLabel}` : ""}</span>
                    </span>
                    {typeof value === "number" ? (
                      <span className="flex shrink-0 items-center gap-1" title={hasBodyConstraint ? adjustmentLabel : undefined}>
                        {hasBodyConstraint && <span className="text-[8px] font-semibold text-court-600">身体</span>}
                        <span className={`text-[13px] font-bold tabular-nums ${valueColor(value)}`}>{value}</span>
                      </span>
                    ) : <span className="text-ink-300">--</span>}
                  </button>
                  {!lock && bundle.id !== "potential" && (
                    <button
                      aria-label={`手动设置${bundle.label}`}
                      className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-ink-400 transition hover:bg-ink-200 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-200"
                      disabled={!settingsLocked || isTeamDrawing}
                      onClick={() => openCustomEditor(bundle)}
                      title={`手动设置${bundle.label}的最终数值`}
                      type="button"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {lock && <Check className="absolute right-1 top-1 h-2.5 w-2.5 text-court-600" />}
                </div>
              );
            })}
          </div>
        </aside>

        <div
          aria-label="球队与球员"
          className="builder-pane builder-player-pane panel-surface min-w-0 flex-col overflow-hidden"
          data-complete={isComplete}
          data-mobile-active={settingsLocked && !isComplete}
          id="builder-pane-players"
          role="tabpanel"
        >
          <div className="workspace-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div>
              <div className="flex items-center gap-2"><span className="draw-status-icon" data-active={isTeamDrawing}><UsersRound className="h-3.5 w-3.5" /></span><h2 className="text-[14px] font-semibold text-ink-900">{isManualSelection ? "自选来源" : isTeamDrawing ? "随机球队" : team ? teamNamesCN[team.name] ?? team.name : "等待开始"}</h2></div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-400">{!settingsLocked ? "等待确认基础设置" : isManualSelection ? isComplete ? `已完成 · ${completed}/${bundles.length}` : "搜索球员，选定版本后锁定属性" : isTeamDrawing ? teamDrawPhase === "landing" ? "结果已确定" : "正在抽取球队" : isComplete ? `已完成 · ${completed}/${bundles.length}` : `第 ${completed + 1} 轮 · 已展示 ${shownPlayers.length}/${team?.players.length ?? 0}`}</div>
            </div>
            {settingsLocked && !isComplete && !isManualSelection && (
              <div className="flex items-center gap-1.5">
                {(() => {
                  const switchDisabled = isTeamDrawing || switchesLeft <= 0 || !hasNextBatch;
                  const switchTitle = isTeamDrawing
                    ? "正在抽取球队，请稍候"
                    : !hasNextBatch
                      ? "本队球员已全部展示，暂时无法更换"
                      : switchesLeft <= 0
                          ? "本轮更换次数已用完"
                          : "仅更换当前球队的候选球员，不会重新抽取球队";
                  // Disabled buttons often skip hover tooltips; wrap so the hint still appears.
                  return (
                    <span className="inline-flex" title={switchTitle}>
                      <button
                        className="action-button px-2 py-1.5 text-[10px]"
                        disabled={switchDisabled}
                        onClick={switchPlayers}
                        type="button"
                      >
                        <UsersRound className="h-3 w-3" />
                        换一批（{switchesLeft}）
                      </button>
                    </span>
                  );
                })()}
              </div>
            )}
          </div>

          {settingsLocked ? isManualSelection ? <>
            <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
              <input
                aria-label="搜索来源球员"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
                onChange={(event) => setPlayerSearch(event.target.value)}
                placeholder="搜索姓名、位置或球队"
                type="search"
                value={playerSearch}
              />
              <span className="shrink-0 text-[9px] tabular-nums text-ink-400">{filteredManualPlayerGroups.length}/{manualPlayerGroups.length}</span>
            </div>
            <div className="grid flex-1 auto-rows-[62px] grid-cols-2 gap-2 overflow-y-auto p-2.5">
              {filteredManualPlayerGroups.map((group) => {
                const selected = selectedPlayer ? playerIdentity(selectedPlayer) === group.key : false;
                const representative = group.representative;
                const cardForGroup = !isPrime ? lookupRookieCard(rookieCards, representative.name) : null;
                const maxOverall = group.variants.reduce((max, player) => Math.max(max, player.overall ?? 0), 0);
                const displayedOverall = cardForGroup?.overall ?? maxOverall;
                const positionSummary = [...new Set(group.variants.map((player) => player.position).filter(Boolean))].join("/");
                return (
                  <button
                    key={group.key}
                    aria-label={`选择${getPlayerNameCN(representative.name)}，${group.variants.length}个版本`}
                    aria-pressed={selected}
                    className={`interactive-card flex min-w-0 items-center gap-2 rounded-[6px] border px-2 text-left ${selected ? "border-ink-700 bg-ink-50 shadow-[inset_3px_0_0_#2b8969]" : isComplete ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-40" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`}
                    disabled={isComplete}
                    onClick={() => openPlayerVersionPicker(group)}
                    title={`${getPlayerNameCN(representative.name)} · 点击选择版本`}
                    type="button"
                  >
                    <PlayerHeadshot name={representative.name} priority={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(representative.name)}</span>
                      <span className="block truncate text-[9px] text-ink-400">{representative.name} · {group.variants.length} 个版本{positionSummary ? ` · ${positionSummary}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className={`text-[14px] font-bold tabular-nums ${displayedOverall ? valueColor(displayedOverall) : "text-ink-400"}`}>{displayedOverall || "--"}</span>
                      {cardForGroup?.overall != null && <span className="rounded-[3px] bg-court-500/10 px-1 py-0.5 text-[8px] font-semibold text-court-700">新秀</span>}
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-300" />
                    </span>
                  </button>
                );
              })}
              {filteredManualPlayerGroups.length === 0 && <div className="col-span-2 flex min-h-[180px] items-center justify-center text-[11px] text-ink-400">没有找到匹配的球员</div>}
            </div>
          </> : isTeamDrawing ? <div className="team-draw-stage flex min-h-[300px] flex-1 items-center px-2.5 py-3 sm:px-4">
            <MarqueeDraw
              currentLabel={drawingTeamLabel}
              dataKind="team"
              durationMs={teamDrawDurationMs}
              emptyText="暂无可抽取的球队"
              isDrawing
              items={teamDrawItems}
              onPhaseChange={handleTeamDrawPhaseChange}
              onSettled={finishTeamDraw}
              precedingItems={18}
              selectedId={drawingTeamId ?? undefined}
              settleHoldMs={teamDrawSettleHoldMs}
              title={teamDrawPhase === "landing" ? "抽取完成" : "正在抽取球队"}
            />
          </div> : <div className="grid flex-1 auto-rows-[62px] grid-cols-2 gap-2 p-2.5">
            {shownPlayers.map((player) => {
              const id = playerId(player);
              const unavailable = usedBy.has(id);
              const selected = selectedPlayerId === id;
              const cardForPlayer = !isPrime ? lookupRookieCard(rookieCards, player.name) : null;
              const displayedPlayerOverall = cardForPlayer?.overall ?? player.overall;
              return (
                <button key={id} className={`interactive-card flex min-w-0 items-center gap-2 rounded-[6px] border px-2 text-left ${selected ? "border-ink-700 bg-ink-50 shadow-[inset_3px_0_0_#2b8969]" : unavailable || isComplete ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-40" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`} disabled={unavailable || isComplete} onClick={() => choosePlayer(player)} type="button">
                  <PlayerHeadshot name={player.name} priority />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(player.name)}</span><span className="block text-[9px] text-ink-400">{player.position ?? "--"}{player.isEstimated ? " · 估算值" : ""}{unavailable ? " · 已选用" : ""}{cardForPlayer?.overall != null ? " · 新秀卡" : ""}</span></span>
                  <span className="flex shrink-0 items-center gap-1"><span className={`shrink-0 text-[14px] font-bold tabular-nums ${typeof displayedPlayerOverall === "number" ? valueColor(displayedPlayerOverall) : "text-ink-400"}`}>{displayedPlayerOverall ?? "--"}</span>{cardForPlayer?.overall != null && <span className="rounded-[3px] bg-court-500/10 px-1 py-0.5 text-[8px] font-semibold text-court-700">新秀</span>}</span>
                </button>
              );
            })}
          </div> : <div className="builder-empty-state flex min-h-[300px] flex-1 flex-col items-center justify-center px-5 text-center"><span className="builder-empty-icon"><Shuffle className="h-4 w-4" /></span><div className="mt-3 text-[15px] font-semibold text-ink-700">{isManualSelection ? "先选择来源球员" : "先从一支球队开始"}</div><div className="mt-1 max-w-[310px] text-[10px] leading-5 text-ink-400">{isManualSelection ? "确认设置后搜索并选择来源球员，再为 16 个属性槽锁定属性。" : "确认球员设置后抽取球队，再从候选球员中锁定 16 个属性槽。"}</div><div className="builder-empty-steps" aria-hidden="true"><span data-current="true">设置</span><ChevronRight /><span>{isManualSelection ? "选来源" : "抽取球队"}</span><ChevronRight /><span>锁定属性</span></div></div>}

          <div className="flex min-h-11 items-center justify-between gap-2 border-t border-ink-200 bg-ink-50 px-3 py-2">
            <div className="min-w-0 truncate text-[10px] text-ink-500">{selectedPlayer ? `${getPlayerNameCN(selectedPlayer.name)} · 请选择要锁定的属性槽` : displayStatus}</div>
          </div>
        </div>

        <aside
          aria-label={isPrime ? "巅峰结果" : "新秀结果"}
          className="builder-pane builder-result-pane panel-surface min-w-0 overflow-hidden"
          data-mobile-active={isComplete}
          id="builder-pane-result"
          role="tabpanel"
        >
          {isComplete ? (
            <div className="builder-result-reveal">
              <div className="workspace-toolbar px-3 py-2.5">
                <div className="section-label">{isPrime ? "巅峰球员卡" : "新秀球员卡"}</div>
                <div className="mt-1 truncate text-[15px] font-semibold text-ink-800" data-testid="rookie-name">{rookieName}</div>
                <div className="mt-2 flex items-end justify-between">
                  <div><div className={`text-[25px] font-bold leading-none tabular-nums ${valueColor(result.initialStrength)}`} data-testid="rookie-overall">{result.initialStrength}</div><div className="mt-1 text-[9px] text-ink-400">{isPrime ? "巅峰 OVR" : "新秀 OVR"}</div></div>
                  <div className="text-right"><div className="text-[14px] font-semibold text-court-800">{position}/{secondaryPosition} · {effectiveAge}岁</div><div className="text-[10px] text-ink-500">潜力 <span className={`font-semibold tabular-nums ${valueColor(result.potential)}`} data-testid="rookie-potential">{result.potential}</span> <span className="tabular-nums text-ink-400">({result.potentialMin}-{result.potentialMax})</span></div><div className="text-[8px] text-ink-400">游戏 OVR <span className={`font-semibold tabular-nums ${valueColor(result.baseOverall)}`} data-testid="rookie-base-overall">{result.baseOverall}</span> · 无形属性 <span className={`font-semibold tabular-nums ${valueColor(result.intangibles)}`}>{result.intangibles}</span></div></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-ink-200 text-[10px]">
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">身高</span><strong className="float-right">{result.height}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">体重</span><strong className="float-right">{result.weight}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">臂展</span><strong className="float-right">{result.wingspan}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">肩宽</span><strong className="float-right">{result.shoulder}</strong></div>
              </div>
              {isPrime ? (
                <div className="border-b border-ink-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-[10px]"><span className="font-semibold text-ink-700">巅峰属性</span><span className="text-right text-ink-500">锁定值已结合体型和位置计算</span></div>
                </div>
              ) : (
                <div className="border-b border-ink-200 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between text-[10px]"><span className="font-semibold text-ink-700">成长轨迹</span><span className="font-mono text-court-700">潜力 {result.potential}<span className="text-ink-400"> ({result.potentialMin}-{result.potentialMax})</span></span></div>
                  <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 border-y border-ink-100 py-1.5 text-[9px]">
                    <div className="flex justify-between gap-2"><span className="text-ink-400">预计初始 OVR</span><strong className="tabular-nums text-ink-700">{result.initialStrength}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">巅峰年龄</span><strong className="tabular-nums text-ink-700">{result.peakStart}–{result.peakEnd}</strong></div>
                    <div className="flex justify-between gap-2"><span className="text-ink-400">成长速度</span><strong className="tabular-nums text-ink-700">+{result.progressSpeed}/年</strong></div>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-center text-[9px]"><div className="rounded-[5px] border border-court-200 bg-court-50 py-1.5 text-court-700"><strong className="block text-[12px]">{result.boom}%</strong>成长</div><div className="rounded-[5px] border border-ink-200 bg-ink-50 py-1.5 text-ink-700"><strong className="block text-[12px]">{result.normal}%</strong>平均</div><div className="rounded-[5px] border border-rose-200 bg-rose-50 py-1.5 text-rose-700"><strong className="block text-[12px]">{result.bust}%</strong>衰退</div></div>
                </div>
              )}
              <div className="border-b border-ink-200 px-3 py-2.5">
                <div className="mb-1.5 flex justify-between text-[10px]"><span className="font-semibold">{isPrime ? "巅峰徽章" : "当前徽章"}</span><span className="text-ink-400" data-testid="badge-status">{result.badgesEstimated ? "含估算" : "按属性槽继承"} · {result.badges.length}</span></div>
                <div className="flex max-h-[58px] flex-wrap gap-1 overflow-hidden">{result.badges.length ? result.badges.slice(0, 7).map((badge) => <span key={`${badge.name}:${badge.tier}`} className="border border-warning-500/20 bg-warning-50 px-1 py-0.5 text-[8px] text-warning-800">{getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier]}</span>) : <span className="text-[9px] text-ink-400">无</span>}</div>
              </div>
              <div className="border-b border-ink-200 px-3 py-2.5">
                <div className="mb-1.5 text-[10px] font-semibold">热区</div>
                <div className="grid grid-cols-3 gap-1 text-center text-[9px]"><div className="bg-blue-50 py-1.5 text-blue-700">冷 <span data-testid="cold-zone-count">{zoneCounts.冷区}</span></div><div className="bg-ink-50 py-1.5 text-ink-600">中 <span data-testid="neutral-zone-count">{zoneCounts.中性}</span></div><div className="bg-rose-50 py-1.5 text-rose-700">热 <span data-testid="hot-zone-count">{zoneCounts.热区}</span></div></div>
              </div>
              <div aria-live="polite" className="border-b border-ink-200 px-3 py-2.5" data-tendency-state={tendencyLoadState}>
                <div className="mb-1.5 flex justify-between text-[10px]"><span className="font-semibold">倾向</span><span className="text-ink-400" data-testid="tendency-status">{tendencyStatusLabel}</span></div>
                <div className="flex max-h-[58px] flex-wrap gap-1 overflow-hidden">{tendencyCount ? Object.entries(result.tendencies).slice(0, 8).map(([field, value]) => <span key={field} className="border border-court-500/20 bg-court-50 px-1 py-0.5 text-[8px] text-court-800">{getTendencyNameCN(field)} {value}</span>) : <span className="text-[9px] text-ink-400">{tendencyEmptyText}</span>}</div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <Unlock className="h-7 w-7 text-ink-300" />
              <div className="mt-3 text-[15px] font-semibold text-ink-600">尚未生成</div>
              <div className="mt-1 max-w-full truncate text-[12px] font-semibold text-ink-700">{rookieName}</div>
              <div className="mt-1 text-[10px] leading-5 text-ink-400">已锁定属性：{completed}/{bundles.length}</div>
              <div aria-valuemax={bundles.length} aria-valuemin={0} aria-valuenow={completed} className="builder-result-progress-track" role="progressbar"><div className="builder-result-progress-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, completed / bundles.length))})` }} /></div>
              <div className="mt-3 text-[11px] font-medium text-court-700">{position}/{secondaryPosition} · {effectiveAge}岁</div>
              <div className="mt-1 text-[9px] text-ink-400">{body.height} cm · {body.weight} kg · 臂展 {body.wingspan}</div>
            </div>
          )}
          <div className="flex gap-1.5 px-3 py-2.5">
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!exportReady} onClick={copyResult} type="button"><Copy className="h-3 w-3" />复制</button>
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!exportReady} onClick={downloadResult} type="button"><Download className="h-3 w-3" />导出</button>
          </div>
        </aside>
        {isComplete && (
        <section
          className="builder-pane builder-full-preview builder-result-reveal panel-surface overflow-hidden"
          data-mobile-active={isComplete}
          data-testid="full-attribute-preview"
        >
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
            <div className="section-label">属性明细</div>
            <div className="text-[10px] text-ink-400">{fullAttributeGroups.reduce((total, group) => total + group.attrs.length, 0)} 项属性</div>
          </div>
          <div className="attribute-preview-grid bg-ink-200">
            {fullAttributeGroups.map((group) => (
              <div key={group.key} className="attribute-preview-group bg-white px-3 py-2.5">
                <div className="mb-2 text-[10px] font-semibold text-court-700">{group.label}</div>
                <div className={group.key === "durability" ? "grid gap-x-5 sm:grid-cols-2" : ""}>
                  {group.attrs.map((attr) => {
                    const value = result.initialAttrs[attr];
                    const hasBodyAdjustment = bodyAdjustedAttributes.has(attr);
                    return (
                      <div key={attr} className="flex min-h-6 items-center justify-between gap-3 border-t border-ink-700/5 py-1 text-[10px]">
                        <span className="min-w-0 text-ink-500">{attrNameCN[attr] ?? attr}</span>
                        <span className="flex shrink-0 items-center gap-1" title={hasBodyAdjustment ? "该属性包含身体修正或上限" : undefined}>
                          {hasBodyAdjustment && <span className="text-[8px] font-semibold text-court-600">身体</span>}
                          <span className={`font-semibold tabular-nums ${typeof value === "number" ? valueColor(value) : "text-ink-300"}`}>{value ?? "--"}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {/* 倾向明细：按表格分类分组 */}
          {tendencyCount ? (
            <div className="border-t border-ink-200 px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between text-[10px]"><span className="font-semibold">倾向明细</span><span className="text-ink-400">{tendencyCount} 项</span></div>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {tendencyGroups.map((group) => {
                  const members = group.fields.filter((field) => result.tendencies[field] !== undefined);
                  if (!members.length) return null;
                  return (
                    <div key={group.key}>
                      <div className="mb-1 text-[9px] font-semibold text-court-700">{group.label}</div>
                      {members.map((field) => (
                        <div key={field} className="flex min-h-5 items-center justify-between gap-3 border-t border-ink-700/5 py-0.5 text-[10px]">
                          <span className="min-w-0 text-ink-500">{getTendencyNameCN(field)}</span>
                          <span className={`shrink-0 font-semibold tabular-nums ${typeof result.tendencies[field] === "number" ? valueColor(result.tendencies[field]) : "text-ink-300"}`}>{result.tendencies[field] ?? "--"}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {/* 热区明细：按表格分类分组 */}
          <div className="border-t border-ink-200 px-3 py-2.5">
            <div className="mb-2 text-[10px] font-semibold">热区明细</div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
              {hotZoneCNGroups.map((group) => {
                // 兼容两种来源：生成器中文 key（result.hotZones）与 DB2K 卡英文 key（card.hotZones）
                const entries = group.keys.flatMap((cnKey) => {
                  const state = result.hotZones[cnKey];
                  if (state !== undefined) return [[cnKey, state] as const];
                  const enKey = Object.entries(hotZoneLabelCN).find(([, label]) => label === cnKey)?.[0];
                  const enState = enKey ? result.hotZones[enKey] : undefined;
                  return enState !== undefined ? [[cnKey, enState] as const] : [];
                });
                if (!entries.length) return null;
                return (
                  <div key={group.key}>
                    <div className="mb-1 text-[9px] font-semibold text-court-700">{group.label}</div>
                    {entries.map(([cnKey, state]) => (
                      <div key={cnKey} className="flex min-h-5 items-center justify-between gap-3 border-t border-ink-700/5 py-0.5 text-[10px]">
                        <span className="min-w-0 text-ink-500">{cnKey}</span>
                        <span className={`shrink-0 font-semibold ${state === "热区" ? "text-rose-600" : state === "冷区" ? "text-blue-600" : "text-ink-500"}`}>{state}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 徽章明细：按表格分类分组 */}
          {result.badges.length || result.peakBadges.length ? (
            <div className="border-t border-ink-200 px-3 py-2.5">
              <div className="mb-2 text-[10px] font-semibold">徽章明细</div>
              {!isPrime && result.badges.length ? (
                <div className="mb-3">
                  <div className="mb-1 text-[9px] font-semibold text-court-700">当前徽章（按 {result.rookieTier} 档调整）</div>
                  {renderBadgeGroups(result.badges)}
                </div>
              ) : null}
              <div>
                <div className="mb-1 text-[9px] font-semibold text-court-700">{isPrime ? "巅峰徽章" : "巅峰徽章（按属性槽继承）"}</div>
                {renderBadgeGroups(result.peakBadges.length ? result.peakBadges : result.badges)}
              </div>
            </div>
          ) : null}
        </section>
        )}
      </div>
      {playerVersionGroup && (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
          <section aria-label={`选择${getPlayerNameCN(playerVersionGroup.representative.name)}的来源版本`} aria-modal="true" className="dialog-surface w-full max-w-[520px] overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl" ref={customDialogRef} role="dialog">
            <div className="workspace-toolbar flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <PlayerHeadshot name={playerVersionGroup.representative.name} priority />
                <div className="min-w-0">
                  <div className="section-label">选择来源版本</div>
                  <div className="truncate text-[14px] font-semibold text-ink-800">{getPlayerNameCN(playerVersionGroup.representative.name)}</div>
                  <div className="truncate text-[9px] text-ink-400">{playerVersionGroup.representative.name} · {playerVersionGroup.variants.length} 个版本可选</div>
                </div>
              </div>
              <button aria-label="关闭版本选择" className="dialog-close-button flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-ink-500 hover:bg-ink-200 hover:text-ink-800" onClick={() => setPlayerVersionGroupKey(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[58vh] space-y-1.5 overflow-y-auto border-t border-ink-200 p-3">
              {playerVersionGroup.variants.map((variant) => {
                const id = playerId(variant);
                const selected = selectedPlayerId === id;
                const cardForVariant = !isPrime ? lookupRookieCard(rookieCards, variant.name) : null;
                const displayedVariantOverall = cardForVariant?.overall ?? variant.overall;
                return (
                  <button
                    aria-pressed={selected}
                    className={`interactive-card flex w-full items-center gap-2 rounded-[5px] border px-2.5 py-2 text-left ${selected ? "border-court-600 bg-court-50 shadow-[inset_3px_0_0_#2b8969]" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`}
                    key={id}
                    onClick={() => choosePlayer(variant)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-semibold text-ink-800">{playerVariantLabel(variant)}</span>
                      <span className="mt-0.5 block truncate text-[9px] text-ink-400">{variant.position ?? "--"} · {variant.height ?? "身高未记录"}{variant.isEstimated ? " · 部分属性为估算值" : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`text-[16px] font-bold tabular-nums ${typeof displayedVariantOverall === "number" ? valueColor(displayedVariantOverall) : "text-ink-400"}`}>{displayedVariantOverall ?? "--"}</span>
                      {cardForVariant?.overall != null && <span className="rounded-[3px] bg-court-500/10 px-1 py-0.5 text-[8px] font-semibold text-court-700">新秀</span>}
                      {selected ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-court-600" /> : <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-300" />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-ink-200 bg-ink-50 px-3 py-2.5 text-[10px] text-ink-500">
              选定版本后返回属性槽，再点击目标属性完成锁定。
            </div>
          </section>
        </div>
      )}
      {customizingBundle && (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
          <section aria-label={`手动设置${customizingBundle.label}`} aria-modal="true" className="dialog-surface w-full max-w-[430px] overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl" ref={customDialogRef} role="dialog">
            <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
              <div className="section-label">手动设置{customizingBundle.label}</div>
              <button aria-label="关闭设置" className="dialog-close-button flex h-7 w-7 items-center justify-center rounded-[5px] text-ink-500 hover:bg-ink-200 hover:text-ink-800" onClick={() => setCustomizingBundleId(null)} type="button"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3">
              {customizingBundle.attrs.map((attr) => (
                <label key={attr} className="min-w-0">
                  <span className="mb-1 block truncate text-[9px] font-semibold text-ink-500" title={attrNameCN[attr] ?? attr}>{attrNameCN[attr] ?? attr}</span>
                  <input
                    aria-label={`设置${attrNameCN[attr] ?? attr}`}
                    className="h-9 w-full rounded-[5px] border border-ink-200 bg-ink-50 px-2 text-center text-[13px] font-semibold tabular-nums text-ink-800 outline-none focus:border-court-500 focus:bg-white"
                    inputMode="numeric"
                    onChange={(event) => setCustomDraft((current) => ({ ...current, [attr]: event.target.value }))}
                    pattern="[0-9]*"
                    type="text"
                    value={customDraft[attr] ?? ""}
                  />
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-ink-200 bg-ink-50 px-3 py-2.5">
              <div className="flex gap-2">
                <button className="action-button px-3 py-1.5 text-[10px]" onClick={() => setCustomizingBundleId(null)} type="button">取消</button>
                <button className="action-button primary-action px-3 py-1.5 text-[10px]" disabled={!customDraftIsValid} onClick={confirmCustomLock} type="button"><Check className="h-3.5 w-3.5" />保存设置</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default RookieBuilder;
