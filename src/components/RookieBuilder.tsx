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
  Info,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { normalizePlayerSearch, matchesPlayerSearch } from "../playerSearch";
import { valueColor } from "../valueColor";
import { badgeTierCN, getBadgeNameCN, normalizeBadgeName } from "../badges";
import MarqueeDraw, { type MarqueeDrawItem } from "./MarqueeDraw";
import { attrNameCN, type PlayerSource } from "../domain";
import {
  ages,
  bodyBases,
  bundles,
  clamp,
  hash,
  createResult,
  evaluateAll,
  evaluateAllPreview,
  makeRandom,
  positions,
  secondaryPositionShare,
  type Bundle,
  type BundleLock,
  type Evaluation,
  type LockState,
  type Position,
  type SlotInput,
  applyBundleLock,
  applyBundleLockTransaction,
} from "../createResult";
import {
  loadTendencyLookup,
  type TendencyDataVersion,
  type TendencyLookup,
} from "../tendencies";
import { hasRookieCard, loadRookieCards, lookupRookieCard, type RookieCard, type RookieCardLookup } from "../rookieCards";
import SlotPicker from "./SlotPicker";
import { getTendencyNameCN } from "../tendencyNames";
import { getPlayerHeadshotSources, prefetchPlayerHeadshots } from "../playerHeadshots";
import { getPlayerNameCN } from "../playerNames";
import { type OverallDataVersion } from "../rookieOverall";
import { cardToPlayerSource } from "../rookieCardSource";
import { generateRookieFirstName, generateRookieLastName } from "../rookieNames";
import { type BuilderBody as BodySettings } from "../rookieBodyConstraints";
import { attributeGroups, badgeGroups, hotZoneGroups, tendencyGroups } from "../fieldCategories";
import { createExportText } from "../exportText";
import { useModalBehavior } from "../useModalBehavior";
import { clearDraft, loadDraft, saveDraft, type RookieDraft } from "../draftStore";
import { clearEntrySet, entryFieldKey, loadEntrySet, saveEntrySet, toggleEntrySet } from "../entryProgress";
import { tendencyBundleMap } from "./tendencyBundleMap";
import { badgeBundleMap } from "./badgeBundleMap";

export type RookieBuilderTeam = {
  id: string;
  name: string;
  players: PlayerSource[];
};

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

type PositionPickerProps = {
  position: Position;
  secondaryPosition: Position;
  secondaryEnabled?: boolean;
  disabled?: boolean;
  onChangePrimary: (next: Position) => void;
  onChangeSecondary: (next: Position) => void;
  onToggleSecondary?: (enabled: boolean) => void;
};

/** 主/次位置选择器：随机模式主面板与自选模式设置弹窗共用。 */
function PositionPicker({ position, secondaryPosition, secondaryEnabled = true, disabled = false, onChangePrimary, onChangeSecondary, onToggleSecondary }: PositionPickerProps) {
  const secondaryLocked = disabled || !secondaryEnabled;
  return (
    <>
      <div className="min-w-0 sm:col-span-2">
        <div className="section-label mb-1">主位置</div>
        <div aria-label="主位置" className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
          {positions.map((option) => {
            const selected = position === option;
            const stateClass = selected
              ? "bg-ink-900 text-white"
              : disabled
                ? "bg-ink-50 text-ink-300"
                : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800";
            return (
              <button key={option} aria-label={`主位置 ${option}`} aria-pressed={selected} className={`segmented-button h-full min-w-0 flex-1 px-1 text-[11px] font-semibold disabled:cursor-not-allowed ${stateClass}`} disabled={disabled} onClick={() => onChangePrimary(option)} type="button">{option}</button>
            );
          })}
        </div>
      </div>
      <div className="min-w-0 sm:col-start-2 sm:row-start-3">
        <div className="section-label mb-1 flex items-center gap-1.5">
          次要位置
          {onToggleSecondary && (
            <label className="flex cursor-pointer items-center gap-1 text-[9px] font-normal text-ink-500">
              <input checked={secondaryEnabled} className="h-3 w-3 accent-court-600" disabled={disabled} onChange={(event) => onToggleSecondary(event.target.checked)} type="checkbox" />
              启用
            </label>
          )}
        </div>
        <div aria-label="次要位置" className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200" role="group">
          {positions.map((option) => {
            const isPrimary = option === position;
            const selected = secondaryPosition === option;
            const natural = !isPrimary && isNaturalSecondaryPosition(position, option);
            const stateClass = selected
              ? !secondaryEnabled
                ? "bg-ink-100 text-ink-400"
                : natural ? "bg-court-700 text-white" : "bg-warning-600 text-white"
              : secondaryLocked || isPrimary
                ? "bg-ink-50 text-ink-300"
                : natural
                  ? "bg-white text-ink-600 hover:bg-court-50 hover:text-court-800"
                  : "bg-warning-50/70 text-warning-600 hover:bg-warning-100 hover:text-warning-800";
            return (
              <button key={option} aria-label={`次要位置 ${option}`} aria-pressed={selected} className={`segmented-button h-full min-w-0 flex-1 px-1 text-[11px] font-semibold disabled:cursor-not-allowed ${stateClass}`} disabled={secondaryLocked || isPrimary} onClick={() => onChangeSecondary(option)} title={isPrimary ? "次要位置不能与主位置相同" : natural ? "常规搭配" : "非常规搭配：仍会结合来源属性和体型计算"} type="button">{option}</button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function blendedPositionWeight(position: Position, secondary: Position | null, bundleId: string) {
  if (!secondary) return positionWeights[position][bundleId];
  return positionWeights[position][bundleId] * (1 - secondaryPositionShare) + positionWeights[secondary][bundleId] * secondaryPositionShare;
}

function displayedPositionWeight(position: Position, secondary: Position | null, bundleId: string) {
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
function renderBadgeGroups(
  badges: { name: string; tier: string }[],
  entrySet?: ReadonlySet<string>,
  onToggleEntry?: (key: string) => void,
) {
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
          {members.map((badge) => {
            const entryKey = entryFieldKey("徽章", badge.name);
            const entered = entrySet?.has(entryKey) ?? false;
            return (
              <button
                className={`border px-1 py-0.5 text-[8px] ${entered
                  ? "border-court-500/40 bg-court-50 text-court-800"
                  : "border-warning-500/20 bg-warning-50 text-warning-800 hover:bg-warning-100"}`}
                key={`${group.key}:${badge.name}:${badge.tier}`}
                onClick={onToggleEntry ? () => onToggleEntry(entryKey) : undefined}
                role={onToggleEntry ? "checkbox" : undefined}
                type="button"
              >
                {getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}
              </button>
            );
          })}
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
          {ungrouped.map((badge) => {
            const entryKey = entryFieldKey("徽章", badge.name);
            const entered = entrySet?.has(entryKey) ?? false;
            return (
              <button
                className={`border px-1 py-0.5 text-[8px] ${entered
                  ? "border-court-500/40 bg-court-50 text-court-800"
                  : "border-ink-200 bg-ink-50 text-ink-600 hover:bg-ink-100"}`}
                key={`other:${badge.name}:${badge.tier}`}
                onClick={onToggleEntry ? () => onToggleEntry(entryKey) : undefined}
                role={onToggleEntry ? "checkbox" : undefined}
                type="button"
              >
                {getBadgeNameCN(badge.name)} · {badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}
              </button>
            );
          })}
        </div>
      </div>,
    );
  }
  return <>{rows}</>;
}

// PG-SF and PF weights are adapted from the supplied mobile-game tables.
// Strength is kept separate from athleticism so body weight can constrain it independently.
// The missing C table is conservatively inferred from the PF distribution.
// 注意：本表仅作历史参考，已不再展示；实际位置影响由 createResult 的
// 位置交叉修正算法计算，不存在单一百分比权重。
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
  tendencyVersion = "2k26",
  overallVersion = "2k26",
  dataVersionLabel = "NBA 2K26",
  selectionMode = "random",
  availablePlayers = [],
  onFlowActiveChange,
}: {
  teams: RookieBuilderTeam[];
  selectionMode?: SourceSelectionMode;
  availablePlayers?: PlayerSource[];
  tendencyVersion?: TendencyDataVersion;
  overallVersion?: OverallDataVersion;
  dataVersionLabel?: string;
  onFlowActiveChange?: (active: boolean) => void;
}) {
  const isManualSelection = selectionMode === "manual";
  const [manualSetupDone, setManualSetupDone] = useState(false);
  const [skipBodyConstraints, setSkipBodyConstraints] = useState(false);
  const [pickerBundleId, setPickerBundleId] = useState<string | null>(null);
  const [cardSources, setCardSources] = useState<Map<string, PlayerSource>>(new Map());
  const [firstName, setFirstName] = useState<string>(() => generateRookieFirstName());
  const [lastName, setLastName] = useState<string>(() => generateRookieLastName());
  const rookieName = `${firstName} ${lastName}`.trim();
  const [position, setPosition] = useState<Position>("PG");
  const [secondaryPosition, setSecondaryPosition] = useState<Position>(() => defaultSecondaryPosition("PG"));
  const [secondaryEnabled, setSecondaryEnabled] = useState(true);
  const effectiveSecondaryPosition = secondaryEnabled ? secondaryPosition : null;
  const [age, setAge] = useState(19);

  const [body, setBody] = useState<BodySettings>(() => createBodySettings("PG", Date.now()));
  const [settingsLocked, setSettingsLocked] = useState(false);
  const [manualFinalize, setManualFinalize] = useState(false);
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
  const [status, setStatus] = useState(`确认${"新秀"}设置后开始生成`);

  const pendingTeamDrawRef = useRef<{ round: TeamRound; completionStatus: string } | null>(null);
  const customDialogRef = useRef<HTMLElement | null>(null);
  const manualDialogRef = useRef<HTMLElement | null>(null);
  const [setupDialogOpen, setSetupDialogOpen] = useState(true);

  // --- 录入进度（结果签名命名空间，localStorage 持久化） ---
  const resultSignature = useMemo(() => {
    const lockPart = bundles.map((bundle) => {
      const lock = locks[bundle.id];
      return lock?.kind === "player" ? lock.playerId : lock?.kind === "custom" ? JSON.stringify(lock.values) : "-";
    }).join("|");
    return String(hash(`${lockPart}|${JSON.stringify(body)}|${age}|${position}|${effectiveSecondaryPosition ?? ""}`));
  }, [age, body, locks, position, effectiveSecondaryPosition]);
  const [entrySet, setEntrySet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setEntrySet(loadEntrySet(resultSignature));
  }, [resultSignature]);
  const toggleEntry = (key: string) => {
    setEntrySet((current) => {
      const next = toggleEntrySet(current, key);
      saveEntrySet(resultSignature, next);
      return next;
    });
  };
  const clearEntries = () => {
    clearEntrySet(resultSignature);
    setEntrySet(new Set());
  };
  // --- 草稿恢复（刷新/Safari 回收不丢流程） ---
  const [availableDraft, setAvailableDraft] = useState<RookieDraft | null>(() => loadDraft());
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  // Mirrors the latest committed lock state so rapid successive commits
  // expand from the newest state instead of a stale render closure.
  const locksRef = useRef<LockState>({});
  /** 同步事务镜像：已锁定的来源球员（同一球员一次，跨槽位）。 */
  const usedPlayerIdsRef = useRef<Set<string>>(new Set());
  /** 同步事务锁：防同一事件循环内的 lock/draw 并发提交。 */
  const lockMutationRef = useRef(false);

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
    if (rookieCards || rookieCardLoadError) return;
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
  }, [rookieCardLoadError, rookieCards]);

  // 共享 Modal 行为：焦点进入、Tab 循环、Escape 关闭、焦点恢复、背景 inert、
  // body scroll lock（aria-modal 与真实交互一致）。
  const customDialogOpen = Boolean(customizingBundleId || playerVersionGroupKey);
  useModalBehavior(customDialogOpen, customDialogRef, () => {
    if (customizingBundleId) setCustomizingBundleId(null);
    else setPlayerVersionGroupKey(null);
  });
  useModalBehavior(
    isManualSelection && !manualSetupDone && setupDialogOpen,
    manualDialogRef,
    () => setSetupDialogOpen(false),
  );

  // --- 草稿自动保存（防抖）：流程中关键状态变化后写入 localStorage ---
  useEffect(() => {
    if (settingsLocked === false && Object.keys(locks).length === 0 && !manualSetupDone) return;
    const timer = window.setTimeout(() => {
      saveDraft({
        version: 1,
        savedAt: Date.now(),
        firstName,
        lastName,
        position,
        secondaryPosition: effectiveSecondaryPosition,
        secondaryEnabled,
        age,
        body,
        settingsLocked,
        manualFinalize,
        locks,
        switchesLeft,
        manualSetupDone,
        skipBodyConstraints,
        round: { teamId: round.teamId, offset: round.offset, playerOrder: round.playerOrder },
        status,
      });
      setDraftNotice(null);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [age, body, effectiveSecondaryPosition, firstName, lastName, locks, manualFinalize, manualSetupDone, position, round, secondaryEnabled, settingsLocked, skipBodyConstraints, status, switchesLeft]);

  // 流程结束后清理草稿
  useEffect(() => {
    if (settingsLocked && Object.keys(locks).length === bundles.length && (manualFinalize || !isManualSelection)) {
      clearDraft();
    }
  }, [isManualSelection, locks, manualFinalize, settingsLocked]);

  // 活跃流程离页保护（浏览器原生确认，非阻塞式）
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (settingsLocked && Object.keys(locks).length < bundles.length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [locks, settingsLocked]);

  const restoreDraft = () => {
    const draft = availableDraft;
    if (!draft) return;
    setFirstName(draft.firstName);
    setLastName(draft.lastName);
    setPosition(draft.position);
    setSecondaryPosition(draft.secondaryPosition ?? defaultSecondaryPosition(draft.position));
    setSecondaryEnabled(draft.secondaryEnabled);
    setAge(draft.age);
    setBody(draft.body);
    setSettingsLocked(draft.settingsLocked);
    setManualFinalize(draft.manualFinalize);
    setLocks(draft.locks);
    locksRef.current = draft.locks;
    usedPlayerIdsRef.current = new Set(
      Object.values(draft.locks)
        .filter((lock): lock is { kind: "player"; playerId: string } => lock.kind === "player")
        .map((lock) => lock.playerId),
    );
    setSwitchesLeft(draft.switchesLeft);
    setManualSetupDone(draft.manualSetupDone);
    setSetupDialogOpen(!draft.manualSetupDone);
    setSkipBodyConstraints(draft.skipBodyConstraints);
    if (draft.round && teams.some((team) => team.id === draft.round?.teamId)) {
      setRound({ teamId: draft.round.teamId, offset: draft.round.offset, playerOrder: draft.round.playerOrder });
    }
    setStatus(draft.status || "已恢复草稿");
    setDraftRestored(true);
    setAvailableDraft(null);
    setDraftNotice("已恢复上次未完成的生成流程");
  };

  const discardDraft = () => {
    clearDraft();
    setAvailableDraft(null);
    setDraftNotice("草稿已清空");
  };

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
  const rookieCardsReady = rookieCards !== null;
  // Roster pool + manual-mode rookie-card pseudo sources share one id space.
  const allSourcesById = useMemo(() => {
    const merged = new Map(playersById);
    for (const [id, source] of cardSources) merged.set(id, source);
    return merged;
  }, [cardSources, playersById]);
  // Keyed by the concrete roster version id, not by normalized identity: the
  // same player's different versions (current / classic / all-time) are
  // intentionally allowed to lock different slots.
  const usedBy = useMemo(() => new Map(Object.entries(locks).flatMap(([bundleId, lock]) => {
    if (lock.kind !== "player") return [];
    return [[lock.playerId, bundleId] as const];
  })), [locks]);
  const evaluations = useMemo(() => {
    const inputs: SlotInput[] = [];
    for (const bundle of bundles) {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        inputs.push({ bundle, player: null, customValues: lock.values });
        continue;
      }
      const player = lock?.kind === "player" ? allSourcesById.get(lock.playerId) : undefined;
      if (player) {
        const card = lookupRookieCard(rookieCards, player.name);
        inputs.push({ bundle, player, card });
      }
    }
    return evaluateAll(inputs, body, {
      targetPosition: position,
      secondaryPosition: effectiveSecondaryPosition,
      skipBody: skipBodyConstraints,
    });
  }, [allSourcesById, body, locks, position, rookieCards, effectiveSecondaryPosition, skipBodyConstraints]);
  const selectedEvaluations = useMemo(() => {
    if (!selectedPlayer) return {};
    const currentInputs: SlotInput[] = [];
    for (const bundle of bundles) {
      const lock = locks[bundle.id];
      if (lock?.kind === "custom") {
        currentInputs.push({ bundle, player: null, customValues: lock.values });
        continue;
      }
      const player = lock?.kind === "player" ? allSourcesById.get(lock.playerId) : undefined;
      if (player) {
        const card = lookupRookieCard(rookieCards, player.name);
        currentInputs.push({ bundle, player, card });
      }
    }
    const preview: Record<string, Evaluation> = {};
    for (const bundle of bundles) {
      if (locks[bundle.id]) continue;
      const evaluation = evaluateAllPreview(
        currentInputs,
        {
          bundle,
          player: selectedPlayer,
          card: lookupRookieCard(rookieCards, selectedPlayer.name),
        },
        body,
        { targetPosition: position, secondaryPosition: effectiveSecondaryPosition, skipBody: skipBodyConstraints },
      );
      if (evaluation) preview[bundle.id] = evaluation;
    }
    return preview;
  }, [allSourcesById, body, locks, position, rookieCards, effectiveSecondaryPosition, selectedPlayer, skipBodyConstraints]);
  const bodyAdjustedAttributes = useMemo(() => new Set(
    bundles.flatMap((bundle) => {
      const evaluation = evaluations[bundle.id];
      if (!evaluation) return [];
      return bundle.attrs.filter((attr) => (
        (evaluation.bodyAdjustments[attr] ?? 0) !== 0
        || Object.prototype.hasOwnProperty.call(evaluation.bodyCaps, attr)
        || Object.prototype.hasOwnProperty.call(evaluation.supportAdjustments ?? {}, attr)
      ));
    }),
  ), [evaluations]);
  const effectiveAge = age;
  const positionLabel = secondaryEnabled ? `${position}/${secondaryPosition}` : position;
  const result = useMemo(
    () => createResult(
      locks,
      effectiveAge,
      position,
      effectiveSecondaryPosition,
      body,
      allSourcesById,
      tendencyLookup,
      overallVersion,
      rookieCards,
      { skipBody: skipBodyConstraints },
    ),
[allSourcesById, body, effectiveAge, locks, overallVersion, position, effectiveSecondaryPosition, rookieCards, skipBodyConstraints, tendencyLookup],
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
  // 录入进度总数：属性 + 倾向 + 热区 + 徽章（行级单位）
  const entryTotal = result
    ? fullAttributeGroups.reduce((total, group) => total + group.attrs.length, 0)
      + tendencyCount
      + Object.keys(result.hotZones).length
      + (result.badges.length || result.peakBadges.length)
    : 0;
  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };
  /** 属性 → 所属槽位 → 来源球员名（用于最终页来源追踪） */
  const attrSourceName = (attr: string): string | null => {
    const bundle = bundles.find((b) => b.attrs.includes(attr));
    if (!bundle) return null;
    const lock = locks[bundle.id];
    if (lock?.kind !== "player") return null;
    const player = allSourcesById.get(lock.playerId);
    return player ? getPlayerNameCN(player.name) : null;
  };
  // --- 槽位字段映射 info（属性/倾向/徽章） ---
  const [infoBundleId, setInfoBundleId] = useState<string | null>(null);
  const [infoPos, setInfoPos] = useState<{ top: number; left: number } | null>(null);
  const toggleInfo = (bundleId: string, anchor: HTMLElement) => {
    if (infoBundleId === bundleId) {
      setInfoBundleId(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    setInfoBundleId(bundleId);
    setInfoPos({
      top: Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 280)),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
    });
  };
  const infoBundle = infoBundleId ? bundles.find((b) => b.id === infoBundleId) ?? null : null;
  const infoSummary = infoBundle
    ? {
      attrs: infoBundle.attrs,
      tendencies: Object.entries(tendencyBundleMap)
        .filter(([, slot]) => slot === infoBundle.id)
        .map(([field]) => field),
      badges: Object.entries(badgeBundleMap)
        .filter(([, slots]) => (Array.isArray(slots) ? slots : [slots]).includes(infoBundle.id))
        .map(([name]) => name),
    }
    : null;
  const completed = Object.keys(locks).length;
  const isComplete = completed === bundles.length && (!isManualSelection || manualFinalize);
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

  const randomizeFirstName = () => {
    if (settingsLocked) return;
    setFirstName(generateRookieFirstName());
  };

  const randomizeLastName = () => {
    if (settingsLocked) return;
    setLastName(generateRookieLastName());
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
    if (!rookieCardsReady) {
      setStatus(rookieCardLoadError ? "新秀卡数据加载失败，请刷新后重试" : "正在加载新秀卡数据，请稍候…");
      return;
    }
    setFirstName((current) => current.trim().replace(/\s+/g, " ") || generateRookieFirstName());
    setLastName((current) => current.trim().replace(/\s+/g, " ") || generateRookieLastName());
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
    if (!settingsLocked || isTeamDrawing || (!isManualSelection && (usedBy.has(id) || !hasRookieCard(rookieCards, player.name)))) return;
    setSelectedPlayerId(id);
    setPlayerVersionGroupKey(null);
    setStatus(`已选择${getPlayerNameCN(player.name)}`);
  };

  const openPlayerVersionPicker = (group: ManualPlayerGroup) => {
    if (!settingsLocked || isTeamDrawing || isComplete) return;
    setCustomizingBundleId(null);
    setPlayerVersionGroupKey(group.key);
  };

  const finishLock = (bundleId: string, lock: BundleLock) => {
    // 同步事务：同 tick 的并发提交必须在提交层串行化（UI disable 层无法
    // 阻止旧 render 的 usedBy 放行）。规则见 applyBundleLockTransaction：
    // 目标槽未锁 + 同 playerId 未使用；一次提交只触发一次 drawNextTeam。
    if (lockMutationRef.current) return;
    const transaction = applyBundleLockTransaction(locksRef.current, bundleId, lock, usedPlayerIdsRef.current);
    if (!transaction.accepted) return;
    lockMutationRef.current = true;
    try {
      locksRef.current = transaction.next;
      usedPlayerIdsRef.current = transaction.usedPlayerIds;
      setLocks(transaction.next);
      setSelectedPlayerId(null);
      setPlayerVersionGroupKey(null);
      setCustomizingBundleId(null);
      if (Object.keys(transaction.next).length === bundles.length) {
        setStatus(`新秀已生成`);
      } else if (isManualSelection) {
        setStatus("已锁定。请继续为下一个属性槽选择来源球员");
      } else {
        drawNextTeam();
      }
    } finally {
      lockMutationRef.current = false;
    }
  };

  const clickBundle = (bundle: Bundle) => {
    const existing = locks[bundle.id];
    if (existing || !settingsLocked || isTeamDrawing || !selectedPlayer || usedBy.has(playerId(selectedPlayer)) || !hasRookieCard(rookieCards, selectedPlayer.name)) return;
    finishLock(bundle.id, { kind: "player", playerId: playerId(selectedPlayer) });
  };

  const unlockBundle = (bundleId: string) => {
    if (!isManualSelection || !locksRef.current[bundleId]) return;
    const released = locksRef.current[bundleId];
    const nextLocks = { ...locksRef.current };
    delete nextLocks[bundleId];
    locksRef.current = nextLocks;
    if (released.kind === "player") {
      const stillUsed = Object.values(nextLocks).some(
        (lock) => lock.kind === "player" && lock.playerId === released.playerId,
      );
      if (!stillUsed) usedPlayerIdsRef.current.delete(released.playerId);
    }
    setLocks(nextLocks);
    setStatus("已解锁，可重新为该槽位选择球员");
  };

  const openSlotPicker = (bundle: Bundle) => {
    if (!settingsLocked || isTeamDrawing || locks[bundle.id]) return;
    setPickerBundleId(bundle.id);
  };

  const pickCard = (card: RookieCard) => {
    if (!pickerBundleId || locks[pickerBundleId]) return;
    const source = cardToPlayerSource(card);
    const id = source.id!;
    setCardSources((current) => new Map(current).set(id, source));
    finishLock(pickerBundleId, { kind: "player", playerId: id });
    setPickerBundleId(null);
  };

  const confirmManualSetup = () => {
    if (!rookieCardsReady) {
      setStatus(rookieCardLoadError ? "新秀卡数据加载失败，请刷新后重试" : "正在加载新秀卡数据，请稍候…");
      return;
    }
    setManualSetupDone(true);
    setSetupDialogOpen(false);
    setSettingsLocked(true);
    setStatus(skipBodyConstraints ? "已关闭身体适配校正，请点击左侧属性槽选择新秀球员" : "请点击左侧属性槽，为每个槽位选择新秀球员");
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
    finishLock(customizingBundle.id, { kind: "custom", values });
  };

  const reset = () => {
    const seed = Date.now();
    pendingTeamDrawRef.current = null;
    setFirstName(generateRookieFirstName());
    setLastName(generateRookieLastName());
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
    locksRef.current = {};
    usedPlayerIdsRef.current = new Set();
    lockMutationRef.current = false;
    setSwitchesLeft(playerSwitchLimit);
    setSelectedPlayerId(null);
    setPlayerVersionGroupKey(null);
    setCustomizingBundleId(null);
    setCustomDraft({});
    setPlayerSearch("");
    setManualSetupDone(false);
    setSetupDialogOpen(true);
    setSkipBodyConstraints(false);
    setPickerBundleId(null);
    setCardSources(new Map());
    // 完整恢复默认状态（公测审计：进入流程后这些状态可能残留）
    setSecondaryEnabled(true);
    setManualFinalize(false);
    setTendencyLoadError(false);
    setRookieCardLoadError(false);
    setStatus(`确认新秀设置后开始生成`);
  };

  const copyResult = async () => {
    try {
      await copyText(createExportText(rookieName, result, locks, evaluations, allSourcesById, tendencyLoadState, dataVersionLabel));
      setStatus("已复制生成报告");
    } catch {
      setStatus("复制失败，请手动复制");
    }
  };

  const downloadResult = async () => {
    const blob = new Blob([createExportText(rookieName, result, locks, evaluations, allSourcesById, tendencyLoadState, dataVersionLabel)], { type: "text/plain;charset=utf-8" });
    const nameSlug = rookieName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const suggestedName = `2k26-rookie-${nameSlug || position.toLowerCase()}.txt`;
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
    setStatus("已发起下载，请查看浏览器保存位置");
  };

  const pickerBundle = bundles.find((bundle) => bundle.id === pickerBundleId);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2.5">
      {rookieCardLoadError && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[5px] border border-warning/25 bg-warning-soft px-3 py-2 text-[11px] font-medium text-warning" role="alert">
          <span>新秀卡数据加载失败（网络或资源问题）。请重新加载应用重试；若持续失败请稍后再试。</span>
          <button className="action-button px-2 py-1 text-[10px]" onClick={() => window.location.reload()} type="button"><RefreshCw className="h-3 w-3" />重新加载应用</button>
        </div>
      )}
      {(availableDraft || draftNotice) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[5px] border border-court-500/30 bg-court-500/10 px-3 py-2 text-[11px] font-medium text-court-800" role="status">
          <span>{draftNotice ?? "检测到未完成的新秀生成草稿，是否恢复？"}</span>
          {availableDraft && !draftRestored && (
            <div className="flex items-center gap-1.5">
              <button className="action-button primary-action px-2 py-1 text-[10px]" onClick={restoreDraft} type="button"><RefreshCw className="h-3 w-3" />恢复草稿</button>
              <button className="action-button px-2 py-1 text-[10px]" onClick={discardDraft} type="button">清空草稿</button>
            </div>
          )}
        </div>
      )}
      {isManualSelection && !manualSetupDone && setupDialogOpen && (
        <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
          <section aria-label="自选生成设置" aria-modal="true" className="dialog-surface w-full max-w-[460px] overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl" ref={manualDialogRef} role="dialog">
            <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
              <div className="section-label">自选生成设置</div>
              <span className="text-[9px] text-ink-400">按槽位选择新秀球员</span>
            </div>
            <div className="space-y-3 border-t border-ink-200 p-3">
              <div>
                <div className="mb-1.5 text-[10px] font-semibold text-ink-700">位置（影响位置交叉惩罚）</div>
                <div className="space-y-2">
                  <PositionPicker
                    onChangePrimary={changePosition}
                    onChangeSecondary={changeSecondaryPosition}
                    onToggleSecondary={setSecondaryEnabled}
                    position={position}
                    secondaryEnabled={secondaryEnabled}
                    secondaryPosition={secondaryPosition}
                  />
                </div>
                {skipBodyConstraints && <div className="mt-1.5 text-[9px] text-ink-400">已关闭身体适配校正，位置仍可选择，仅不参与交叉惩罚计算</div>}
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold text-ink-700">身体设定（参与适配校正）</div>
                <div className="grid grid-cols-2 gap-2">
                  <BodyNumberInput disabled={false} label="身高" max={300} min={150} onChange={(value) => updateBody("height", value)} unit="cm" value={body.height} />
                  <BodyNumberInput disabled={false} label="体重" max={200} min={50} onChange={(value) => updateBody("weight", value)} unit="kg" value={body.weight} />
                </div>
                {skipBodyConstraints && <div className="mt-1.5 text-[9px] text-ink-400">已关闭身体适配校正，身高体重仍可填写并显示在结果中，仅不参与属性计算</div>}
              </div>
              <label className="flex cursor-pointer items-start gap-2 rounded-[5px] border border-ink-200 bg-ink-50 p-2.5">
                <input
                  checked={skipBodyConstraints}
                  className="mt-0.5 h-3.5 w-3.5 accent-court-600"
                  onChange={(event) => setSkipBodyConstraints(event.target.checked)}
                  type="checkbox"
                />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-ink-800">身体适配校正</span>
                  <span className="mt-0.5 block text-[9px] leading-4 text-ink-400">不套用身高体重差异与位置交叉惩罚，新秀属性原值继承（位置与身体数据仍可填写，仅不参与计算）</span>
                </span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-3 py-2.5">
              <span className="mr-auto text-[9px] text-ink-400">进入后点击左侧属性槽选择球员</span>
              <button className="action-button primary-action px-3 py-1.5 text-[10px]" disabled={!rookieCardsReady} onClick={confirmManualSetup} title={!rookieCardsReady ? (rookieCardLoadError ? "新秀卡数据加载失败，请刷新后重试" : "正在加载新秀卡数据") : undefined} type="button"><Check className="h-3.5 w-3.5" />进入自选生成</button>
            </div>
          </section>
        </div>
      )}
      <div
        aria-labelledby="builder-step-settings"
        className="builder-setup panel-surface overflow-hidden"
        data-mobile-active={!settingsLocked}
        id="builder-pane-settings"
        role="tabpanel"
        style={(isManualSelection && settingsLocked) ? { display: "none" } : undefined}
      >
        <div className="builder-setup-grid">
          <section aria-labelledby="player-identity-label" className="builder-setup-identity bg-white px-3 py-3">
            <div className="section-label mb-2" id="player-identity-label">球员信息</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <div className="section-label mb-1">{"新秀名"}</div>
                <div className="flex h-8 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
                  <input
                    aria-label={`${"新秀"}英文名（First Name）`}
                    className="min-w-0 flex-1 bg-transparent px-2.5 text-[12px] font-semibold text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
                    disabled={settingsLocked}
                    maxLength={24}
                    onChange={(event) => setFirstName(event.target.value)}
                    placeholder="First"
                    spellCheck={false}
                    type="text"
                    value={firstName}
                  />
                  <button aria-label="随机生成英文名" className="icon-button flex w-8 shrink-0 items-center justify-center border-l border-ink-200 text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300" disabled={settingsLocked} onClick={randomizeFirstName} title="随机生成名" type="button"><RefreshCw className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="min-w-0">
                <div className="section-label mb-1">{"新秀姓"}</div>
                <div className="flex h-8 overflow-hidden rounded-[5px] border border-ink-200 bg-ink-50 focus-within:border-court-500 focus-within:bg-white">
                  <input
                    aria-label={`${"新秀"}英文姓（Last Name）`}
                    className="min-w-0 flex-1 bg-transparent px-2.5 text-[12px] font-semibold text-ink-800 outline-none disabled:cursor-not-allowed disabled:text-ink-400"
                    disabled={settingsLocked}
                    maxLength={24}
                    onChange={(event) => setLastName(event.target.value)}
                    placeholder="Last"
                    spellCheck={false}
                    type="text"
                    value={lastName}
                  />
                  <button aria-label="随机生成英文姓" className="icon-button flex w-8 shrink-0 items-center justify-center border-l border-ink-200 text-ink-500 hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:text-ink-300" disabled={settingsLocked} onClick={randomizeLastName} title="随机生成姓" type="button"><RefreshCw className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="min-w-0 sm:col-start-1 sm:row-start-3">
                <div className="section-label mb-1">年龄</div>
                <div className="flex h-8 w-full gap-px overflow-hidden rounded-[5px] border border-ink-200 bg-ink-200">
                  {ages.map((option) => (
                    <button key={option} className={`segmented-button h-full min-w-0 flex-1 px-1.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-55 ${age === option ? "bg-ink-900 text-white" : "bg-white text-ink-500 hover:bg-ink-50 hover:text-ink-800"}`} disabled={settingsLocked} onClick={() => setAge(option)} type="button">{option}</button>
                  ))}
                </div>
              </div>
              <PositionPicker
                onChangePrimary={changePosition}
                onChangeSecondary={changeSecondaryPosition}
                onToggleSecondary={setSecondaryEnabled}
                position={position}
                secondaryEnabled={secondaryEnabled}
                secondaryPosition={secondaryPosition}
              />
            </div>
          </section>


          <section aria-labelledby="body-settings-label" className="builder-setup-body bg-white px-3 py-3">
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
              {!settingsLocked && !isManualSelection && (
                <button className="action-button primary-action justify-center px-3 py-1.5 text-[11px] font-semibold" disabled={!rookieCardsReady} onClick={confirmSettings} title={!rookieCardsReady ? (rookieCardLoadError ? "新秀卡数据加载失败，请刷新后重试" : "正在加载新秀卡数据") : undefined} type="button">
                  <Check className="h-3.5 w-3.5" />确认并抽取
                </button>
              )}
              <button className="action-button justify-center px-3 py-1.5 text-[11px]" onClick={reset} type="button">
                <RefreshCw className="h-3.5 w-3.5" />{settingsLocked ? "重新开始" : "重置"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="builder-workspace" data-manual={isManualSelection}>
        <aside
          aria-label="属性槽"
          className="builder-pane builder-attributes-pane panel-surface min-w-0 overflow-hidden"
          data-mobile-active={settingsLocked && !isComplete}
          id="builder-pane-attributes"
          role="tabpanel"
        >
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
            <span className="section-label">属性槽</span>
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-[130px] truncate text-[9px] font-medium text-ink-500">{selectedPlayer ? getPlayerNameCN(selectedPlayer.name) : "尚未选择球员"}</span>
              {settingsLocked && (
                <button className="action-button px-2 py-1.5 text-[10px]" onClick={reset} title={isComplete ? "清空当前结果，重新生成一名新秀" : "退出本次生成，重新开始"} type="button"><RefreshCw className="h-3 w-3" />{isComplete ? "再生成一名" : "重新开始"}</button>
              )}
              {isManualSelection && settingsLocked && !isComplete && (
                <button className="action-button primary-action px-2.5 py-1.5 text-[10px]" disabled={completed < bundles.length} onClick={() => setManualFinalize(true)} title={completed < bundles.length ? `还需锁定 ${bundles.length - completed} 个槽位` : "锁定全部槽位后生成结果"} type="button"><Check className="h-3 w-3" />完成选择</button>
              )}
            </div>
          </div>
          <div className="builder-mobile-summary mb-2 flex items-center gap-3 rounded-[5px] border border-ink-200 bg-ink-50/70 px-2.5 py-2 lg:hidden">
            <div className="flex shrink-0 flex-col items-center">
              <span className="text-[22px] font-bold leading-none tabular-nums text-ink-300">--</span>
              <span className="mt-1 text-[8px] font-medium text-ink-400">总评</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-[9px] font-semibold text-ink-500">
                <span className="truncate">{positionLabel} · {effectiveAge}岁</span>
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
              const lockedPlayer = lock?.kind === "player" ? allSourcesById.get(lock.playerId) : undefined;
              const lockedEvaluation = evaluations[bundle.id];
              const preview = selectedEvaluations[bundle.id];
              const value = lockedEvaluation?.adjusted ?? preview?.adjusted;
              const activeEvaluation = lockedEvaluation ?? preview;
              const bodyAdjustment = lockedEvaluation?.bodyAdjustment ?? preview?.bodyAdjustment ?? 0;
              const sourceLabel = lock?.kind === "custom" ? "手动设置" : lockedPlayer ? getPlayerNameCN(lockedPlayer.name) : (isManualSelection ? "点击选择" : (selectedPlayer ? "可锁定" : "等待选择"));
              const weightLabel = bundle.id === "potential"
                ? "潜力独立取值，不计入位置权重"
                : `位置影响：${bundle.label}槽位属性按主/次位置参与位置交叉修正`;
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
                    className={`flex h-full w-full min-w-0 items-center gap-1.5 px-2 pr-7 text-left transition ${lock ? "cursor-not-allowed" : isManualSelection || selectedPlayer ? "hover:bg-ink-50" : "cursor-not-allowed"}`}
                    disabled={Boolean(lock) || !settingsLocked || isTeamDrawing || (!isManualSelection && !selectedPlayer)}
                    onClick={isManualSelection ? () => openSlotPicker(bundle) : () => clickBundle(bundle)}
                    title={lock ? `${weightLabel} · 已锁定；如需修改，请重新开始` : typeof value === "number" ? `${weightLabel} · ${sourceLabel}：来源值 ${lockedEvaluation?.raw ?? preview?.raw} → 身体修正 ${bodyAdjustment > 0 ? "+" : ""}${bodyAdjustment} → 最终 ${value}${capLabels.length ? ` · ${capLabels.join(" · ")}` : ""}` : `${bundle.label} · ${weightLabel}`}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-ink-800">{bundle.label}</span>
                      <span className="block truncate text-[8px] text-ink-400">{sourceLabel}{typeof value === "number" && bodyAdjustment !== 0 ? ` · ${lockedEvaluation?.raw ?? preview?.raw}→${value}` : bodyAdjustmentLabel ? ` · ${bodyAdjustmentLabel}` : ""}</span>
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
                  <button
                    aria-label={`查看${bundle.label}槽位字段`}
                    className="absolute right-7 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-ink-300 transition hover:bg-ink-200 hover:text-ink-700"
                    onClick={(event) => toggleInfo(bundle.id, event.currentTarget)}
                    title="查看该槽位包含的属性/倾向/徽章字段"
                    type="button"
                  >
                    <Info className="h-3 w-3" />
                  </button>
                  {lock && <Check className="absolute left-1 top-1 h-2.5 w-2.5 text-court-600" />}
                  {lock && isManualSelection && (
                    <button
                      aria-label={`解锁${bundle.label}`}
                      className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-[4px] text-ink-400 transition hover:bg-ink-200 hover:text-ink-800"
                      onClick={() => unlockBundle(bundle.id)}
                      title={`解锁${bundle.label}，重新选择球员`}
                      type="button"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
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
          style={isManualSelection ? { display: "none" } : undefined}
        >
          <div className="workspace-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <div>
              <div className="flex items-center gap-2"><span className="draw-status-icon" data-active={isTeamDrawing}><UsersRound className="h-3.5 w-3.5" /></span><h2 className="text-[14px] font-semibold text-ink-900">{isManualSelection ? "自选来源" : isTeamDrawing ? "随机球队" : team ? teamNamesCN[team.name] ?? team.name : "等待开始"}</h2></div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-400">{!settingsLocked ? "等待确认基础设置" : isManualSelection ? isComplete ? `已完成 · ${completed}/${bundles.length}` : "点击槽位，从新秀卡池选择球员" : isTeamDrawing ? teamDrawPhase === "landing" ? "结果已确定" : "正在抽取球队" : isComplete ? `已完成 · ${completed}/${bundles.length}` : `第 ${completed + 1} 轮 · 已展示 ${shownPlayers.length}/${team?.players.length ?? 0}`}</div>
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
                          ? "本次生成更换次数已用完"
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
            <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center px-5 text-center">
              <span className="builder-empty-icon"><UsersRound className="h-4 w-4" /></span>
              <div className="mt-3 text-[15px] font-semibold text-ink-700">点击左侧属性槽选择球员</div>
              <div className="mt-1 max-w-[320px] text-[10px] leading-5 text-ink-400">每个属性槽独立选择一名新秀球员：点击槽位 → 选择年份 → 浏览该届新秀与对应槽位属性 → 点击新秀继承其属性。全部 16 个槽位锁定后生成结果。</div>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[9px] text-ink-400">
                <span className="rounded-[3px] bg-court-500/10 px-1.5 py-0.5 font-semibold text-court-700">新秀</span>按年份浏览全部新秀卡
                <span className="mx-1 text-ink-300">/</span>
                <span className="rounded-[3px] bg-ink-100 px-1.5 py-0.5 font-semibold text-ink-400">全部球员</span>暂无数据
                <span className="mx-1 text-ink-300">/</span>
                <span className="rounded-[3px] bg-ink-100 px-1.5 py-0.5 font-semibold text-ink-400">经典球员</span>暂无数据
              </div>
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
              const cardForPlayer = lookupRookieCard(rookieCards, player.name);
              const missingRookieCard = cardForPlayer === null;
              const unavailable = usedBy.has(id) || missingRookieCard;
              const selected = selectedPlayerId === id;
              const displayedPlayerOverall = cardForPlayer?.overall ?? player.overall;
              return (
                <button key={id} className={`interactive-card flex min-w-0 items-center gap-2 rounded-[6px] border px-2 text-left ${selected ? "border-ink-700 bg-ink-50 shadow-[inset_3px_0_0_#2b8969]" : unavailable || isComplete ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-40" : "border-ink-200 bg-white hover:border-ink-400 hover:bg-ink-50"}`} disabled={unavailable || isComplete} onClick={() => choosePlayer(player)} title={missingRookieCard ? "暂无新秀卡数据，不能用于生成" : undefined} type="button">
                  <PlayerHeadshot name={player.name} priority />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(player.name)}</span><span className="block text-[9px] text-ink-400">{player.position ?? "--"}{player.isEstimated ? " · 估算值" : ""}{usedBy.has(id) ? " · 已选用" : ""}{missingRookieCard ? " · 暂无新秀卡" : ""}{cardForPlayer?.overall != null ? " · 新秀卡" : ""}</span></span>
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
          aria-label={"新秀结果"}
          className="builder-pane builder-result-pane panel-surface min-w-0 overflow-hidden"
          data-mobile-active={isComplete}
          id="builder-pane-result"
          role="tabpanel"
          style={(isManualSelection && !isComplete) ? { display: "none" } : undefined}
        >
          {isComplete ? (
            <div className="builder-result-reveal">
              <div className="workspace-toolbar px-3 py-2.5">
                <div className="section-label">{"新秀球员卡"}</div>
                <div className="mt-1 truncate text-[15px] font-semibold text-ink-800" data-testid="rookie-name">{rookieName}</div>
                <div className="mt-2 flex items-end justify-between">
                  <div><div className={`text-[25px] font-bold leading-none tabular-nums ${valueColor(result.initialStrength)}`} data-testid="rookie-overall">{result.initialStrength}</div><div className="mt-1 text-[9px] text-ink-400">模型估算综评</div></div>
                  <div className="text-right"><div className="text-[14px] font-semibold text-court-800">{positionLabel} · {effectiveAge}岁</div><div className="text-[10px] text-ink-500">潜力 <span className={`font-semibold tabular-nums ${valueColor(result.potential)}`} data-testid="rookie-potential">{result.potential}</span></div><div className="text-[8px] text-ink-400">非官方推测值 · 模型 OVR <span className={`font-semibold tabular-nums ${valueColor(result.baseOverall)}`} data-testid="rookie-base-overall">{result.baseOverall}</span> · 无形属性 <span className={`font-semibold tabular-nums ${valueColor(result.intangibles)}`}>{result.intangibles}</span></div></div>
                </div>
                <div className="mt-2 rounded-[5px] border border-warning-500/20 bg-warning-500/10 px-2 py-1.5 text-[9px] leading-4 text-warning-700">综评由本工具按最终属性、徽章和无形属性估算，不是 2K 实机读取的真实官方综评。</div>
              </div>
              <div className="grid grid-cols-2 gap-px bg-ink-200 text-[10px]">
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">身高</span><strong className="float-right">{result.height}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">体重</span><strong className="float-right">{result.weight}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">臂展</span><strong className="float-right">{result.wingspan}</strong></div>
                <div className="bg-white px-2.5 py-2"><span className="text-ink-400">肩宽</span><strong className="float-right">{result.shoulder}</strong></div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <Unlock className="h-7 w-7 text-ink-300" />
              <div className="mt-3 text-[15px] font-semibold text-ink-600">尚未生成</div>
              <div className="mt-1 max-w-full truncate text-[12px] font-semibold text-ink-700">{rookieName}</div>
              <div className="mt-1 text-[10px] leading-5 text-ink-400">已锁定属性：{completed}/{bundles.length}</div>
              <div aria-valuemax={bundles.length} aria-valuemin={0} aria-valuenow={completed} className="builder-result-progress-track" role="progressbar"><div className="builder-result-progress-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(1, completed / bundles.length))})` }} /></div>
              <div className="mt-3 text-[11px] font-medium text-court-700">{positionLabel} · {effectiveAge}岁</div>
              <div className="mt-1 text-[9px] text-ink-400">{body.height} cm · {body.weight} kg · 臂展 {body.wingspan}</div>
            </div>
          )}
          <div className="flex gap-1.5 px-3 py-2.5">
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!exportReady} onClick={copyResult} type="button"><Copy className="h-3 w-3" />复制</button>
            <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" disabled={!exportReady} onClick={downloadResult} type="button"><Download className="h-3 w-3" />导出</button>
            {isComplete && (
              <button className="action-button flex-1 justify-center px-1.5 py-1.5 text-[10px]" onClick={reset} title="清空当前结果，重新生成一名新秀" type="button"><RefreshCw className="h-3 w-3" />再生成一名</button>
            )}
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
            <div className="flex items-center gap-2 text-[10px] text-ink-400">
              {entryTotal > 0 && (
                <span className="tabular-nums">已录入 <b className="font-semibold text-court-700">{entrySet.size}</b> / {entryTotal}</span>
              )}
              {entrySet.size > 0 && (
                <button className="rounded-[4px] border border-ink-200 bg-ink-50 px-1.5 py-0.5 text-[9px] font-semibold text-ink-600 hover:bg-ink-100" onClick={clearEntries} type="button">清除进度</button>
              )}
              <span>{fullAttributeGroups.reduce((total, group) => total + group.attrs.length, 0)} 项属性</span>
            </div>
          </div>
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-ink-200 bg-white/95 px-3 py-1.5 backdrop-blur">
            {[["entry-attrs", "属性"], ["entry-tendencies", "倾向"], ["entry-hotzones", "热区"], ["entry-badges", "徽章"]].map(([id, label]) => (
              <button
                className="h-6 rounded-full bg-ink-100 px-2.5 text-[10px] font-semibold text-ink-600 hover:bg-ink-200"
                key={id}
                onClick={() => scrollToSection(id)}
                type="button"
              >{label}</button>
            ))}
          </div>
          <div className="attribute-preview-grid bg-ink-200" id="entry-attrs">
            {fullAttributeGroups.map((group) => (
              <div key={group.key} className="attribute-preview-group bg-white px-3 py-2.5">
                <div className="mb-2 text-[10px] font-semibold text-court-700">{group.label}</div>
                <div className={group.key === "durability" ? "grid gap-x-5 sm:grid-cols-2" : ""}>
                  {group.attrs.map((attr) => {
                    // 潜力范围不在 initialAttrs 里，从 result 取
                    const value = attr === "Potential Min"
                      ? result.potentialMin
                      : attr === "Potential Max"
                        ? result.potentialMax
                        : result.initialAttrs[attr];
                    const hasBodyAdjustment = bodyAdjustedAttributes.has(attr);
                    const entryKey = entryFieldKey("属性", attr);
                    const entered = entrySet.has(entryKey);
                    const sourceName = attrSourceName(attr);
                    return (
                      <div
                        className={`flex min-h-6 cursor-pointer select-none items-center justify-between gap-3 border-t border-ink-700/5 py-1 text-[10px] ${entered ? "bg-court-500/5" : "hover:bg-ink-50"}`}
                        key={attr}
                        onClick={() => toggleEntry(entryKey)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleEntry(entryKey); }
                        }}
                        role="button"
                        style={entered ? { boxShadow: "inset 2px 0 0 #2b8969" } : undefined}
                        tabIndex={0}
                        title={sourceName || hasBodyAdjustment ? `${sourceName ?? ""}${hasBodyAdjustment ? " · 含身体修正或上限" : ""}`.trim() : undefined}
                      >
                        <span className="min-w-0 truncate text-ink-500">{attr === "Potential Min" ? "最低潜力" : attr === "Potential Max" ? "最高潜力" : attrNameCN[attr] ?? attr}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          {hasBodyAdjustment && <span className="text-[8px] font-semibold text-court-600">身体</span>}
                          {sourceName && <span className="max-w-[64px] truncate text-[8px] text-ink-300">{sourceName}</span>}
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
            <div className="border-t border-ink-200 px-3 py-2.5" id="entry-tendencies">
              <div className="mb-2 flex items-center justify-between text-[10px]"><span className="font-semibold">倾向明细</span><span className="text-ink-400">{tendencyCount} 项</span></div>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {tendencyGroups.map((group) => {
                  const members = group.fields.filter((field) => result.tendencies[field] !== undefined);
                  if (!members.length) return null;
                  return (
                    <div key={group.key}>
                      <div className="mb-1 text-[9px] font-semibold text-court-700">{group.label}</div>
                      {members.map((field) => {
                        const entryKey = entryFieldKey("倾向", field);
                        const entered = entrySet.has(entryKey);
                        return (
                          <div
                            className={`flex min-h-5 cursor-pointer select-none items-center justify-between gap-3 border-t border-ink-700/5 py-0.5 text-[10px] ${entered ? "bg-court-500/5" : "hover:bg-ink-50"}`}
                            key={field}
                            onClick={() => toggleEntry(entryKey)}
                            role="button"
                            style={entered ? { boxShadow: "inset 2px 0 0 #2b8969" } : undefined}
                            tabIndex={0}
                          >
                            <span className="min-w-0 text-ink-500">{getTendencyNameCN(field)}</span>
                            <span className={`shrink-0 font-semibold tabular-nums ${typeof result.tendencies[field] === "number" ? valueColor(result.tendencies[field]) : "text-ink-300"}`}>{result.tendencies[field] ?? "--"}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {/* 热区明细：按表格分类分组 */}
          <div className="border-t border-ink-200 px-3 py-2.5" id="entry-hotzones">
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
                    {entries.map(([cnKey, state]) => {
                      const entryKey = entryFieldKey("热区", cnKey);
                      const entered = entrySet.has(entryKey);
                      return (
                        <div
                          className={`flex min-h-5 cursor-pointer select-none items-center justify-between gap-3 border-t border-ink-700/5 py-0.5 text-[10px] ${entered ? "bg-court-500/5" : "hover:bg-ink-50"}`}
                          key={cnKey}
                          onClick={() => toggleEntry(entryKey)}
                          role="button"
                          style={entered ? { boxShadow: "inset 2px 0 0 #2b8969" } : undefined}
                          tabIndex={0}
                        >
                          <span className="min-w-0 text-ink-500">{cnKey}</span>
                          <span className={`shrink-0 font-semibold ${state === "热区" ? "text-rose-600" : state === "冷区" ? "text-blue-600" : "text-ink-500"}`}>{state}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 徽章明细：直接继承结果，按表格分类分组 */}
          {result.badges.length || result.peakBadges.length ? (
            <div className="border-t border-ink-200 px-3 py-2.5" id="entry-badges">
              <div className="mb-2 text-[10px] font-semibold">徽章明细</div>
              <div>
                <div className="mb-1 text-[9px] font-semibold text-court-700">{"徽章"}</div>
                {renderBadgeGroups(result.badges.length ? result.badges : result.peakBadges, entrySet, toggleEntry)}
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
                const cardForVariant = lookupRookieCard(rookieCards, variant.name);
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
      {pickerBundle && (
        <SlotPicker
          body={body}
          bundle={pickerBundle}
          onClose={() => setPickerBundleId(null)}
          onPick={pickCard}
          rookieCards={rookieCards}
          secondaryPosition={effectiveSecondaryPosition}
          skipBody={skipBodyConstraints}
          targetPosition={position}
        />
      )}
      {infoBundle && infoSummary && infoPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setInfoBundleId(null)} role="presentation" />
          <div className="fixed z-50 max-h-[280px] w-[240px] overflow-y-auto rounded-[6px] border border-ink-300 bg-white p-2.5 shadow-xl" style={{ top: infoPos.top, left: infoPos.left }}>
            <div className="mb-1.5 text-[10px] font-semibold text-ink-800">{infoBundle.label}槽位 · 字段映射</div>
            {infoSummary.attrs.length > 0 && (
              <div className="mb-1.5">
                <div className="mb-0.5 text-[8px] font-semibold text-court-700">属性</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-ink-600">
                  {infoSummary.attrs.map((attr) => <span key={attr}>{attrNameCN[attr] ?? attr}</span>)}
                </div>
              </div>
            )}
            {infoSummary.tendencies.length > 0 && (
              <div className="mb-1.5">
                <div className="mb-0.5 text-[8px] font-semibold text-court-700">倾向</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-ink-600">
                  {infoSummary.tendencies.map((field) => <span key={field}>{getTendencyNameCN(field)}</span>)}
                </div>
              </div>
            )}
            {infoSummary.badges.length > 0 && (
              <div>
                <div className="mb-0.5 text-[8px] font-semibold text-court-700">徽章</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-ink-600">
                  {infoSummary.badges.map((name) => <span key={name}>{getBadgeNameCN(name)}</span>)}
                </div>
              </div>
            )}
          </div>
        </>
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
