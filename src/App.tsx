import { Award, BookOpen, Dice5, Disc3, Download, Moon, Sparkles, Sun, Upload, UserRoundPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarqueeDraw, { type MarqueeDrawItem } from "./components/MarqueeDraw";
import RookieBuilder, { type RookieBuilderTeam } from "./components/RookieBuilder";
import { badgeTierCN, getBadgeNameCN } from "./badges";
import { getPlayerNameCN } from "./playerNames";
import { getPlayerHeadshot, prefetchPlayerHeadshots } from "./playerHeadshots";
import rookieLogo from "./assets/rookie-26-logo.svg";
import {
  attributeGroups,
  attrGroupMap,
  attrNameCN,
  createDraftFromSources,
  createRandomSourceMap,
  normalizeSourceMap,
  allHeights,
  randomWheelIndex,
  randomPosition,
  randomHeight,
  randomShoulderWidth,
  randomWingspan,
  randomWeight,
  playerSourceKey,
  defaultCareerProfile,
  type PlayerSource,
  type AttributeGroupKey,
  type BodyTemplate,
  type CareerProfile,
  type PlayerDraft,
  type PlayerBadge,
  type RookieTier,
  type SourceMap
} from "./domain";
import rosterCatalog from "./data/rosterCatalog.json";
import badgeProfiles2k27 from "./data/badgeProfiles.2k27.json";
import detailedPlayers from "./data/players.json";

const appVersion = "v0.6.2";
const lastUpdated = "2026-08-02";
const rosterDataVersion = "NBA 2K27 Play Now";
const usageGuides = {
  rookie: [
    { title: "设定新秀", detail: "选择主次位置、年龄、潜力和身体" },
    { title: "抽取球队", detail: "每轮展示 7 人，可切换 3 次球员" },
    { title: "锁定属性", detail: "球员锁定或自定义；↓ 表示位置衰减" },
    { title: "生成清单", detail: "完成 13 项后查看、复制或导出" },
  ],
  prime: [
    { title: "设定球员", detail: "选择主次位置和身体，年龄固定 28 岁" },
    { title: "抽取球队", detail: "每轮展示 7 人，可切换 3 次球员" },
    { title: "锁定属性", detail: "球员锁定或自定义；↓ 表示位置衰减" },
    { title: "生成清单", detail: "完成 13 项后直接生成巅峰属性" },
  ],
  wheel: [
    { title: "设定范围", detail: "调整身体范围和生涯阶段" },
    { title: "选择球员池", detail: "按阵容类型筛选可抽球员" },
    { title: "跑马灯抽取", detail: "依次抽取身体与能力来源" },
    { title: "保存结果", detail: "复制清单、导出文件或全部重抽" },
  ],
} as const;

type AppMode = keyof typeof usageGuides;
type Theme = "light" | "dark";

const themeStorageKey = "2k26-spinner-theme";

function getInitialTheme(): Theme {
  const savedTheme = window.localStorage.getItem(themeStorageKey);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function formatPlayerName(name: string): string {
  const suffixMap: Record<string, string> = {
    jr: "Jr",
    sr: "Sr",
    ii: "II",
    iii: "III",
    iv: "IV",
    v: "V",
  };

  return name
    .trim()
    .split(/\s+/)
    .map((part) =>
      part
        .split(/([-'])/)
        .map((segment) => {
          if (segment === "-" || segment === "'") return segment;
          const lower = segment.toLowerCase();
          if (lower in suffixMap) return suffixMap[lower];
          return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
        })
        .join("")
    )
    .join(" ");
}

const chineseAliases: Record<string, string[]> = {
  "LeBron James": ["勒布朗", "詹姆斯", "詹皇"],
  "Stephen Curry": ["库里", "斯蒂芬库里"],
  "Kevin Durant": ["杜兰特", "KD"],
  "Nikola Jokic": ["约基奇", "约老师"],
  "Luka Doncic": ["东契奇", "卢卡"],
  "Giannis Antetokounmpo": ["字母哥", "阿德托昆博"],
  "Victor Wembanyama": ["文班亚马", "文班"],
  "Shai Gilgeous Alexander": ["亚历山大", "SGA"],
  "Jayson Tatum": ["塔图姆"],
  "Jaylen Brown": ["杰伦布朗"],
  "Anthony Davis": ["戴维斯", "浓眉"],
  "James Hardin": ["哈登", "大胡子"],
  "Kyrie Irving": ["欧文"],
  "Joel Embiid": ["恩比德"],
  "Ja Morant": ["莫兰特"],
  "Anthony Edwards": ["爱德华兹", "华子"],
  "Devin Booker": ["布克"],
  "Trae Young": ["特雷杨", "杨"],
  "Damian Lillard": ["利拉德"],
  "Jimmy Butler": ["巴特勒"],
  "Kawhi Leonard": ["莱昂纳德", "伦纳德"],
  "Paul George": ["乔治"],
  "Zion Williamson": ["锡安"],
  "LaMelo Ball": ["拉梅洛"],
  "Cade Cunningham": ["康宁汉姆"],
  "Donovan Mitchell": ["米切尔"],
  "Jalen Brunson": ["布伦森"],
  "Tyrese Haliburton": ["哈利伯顿"],
  "Bam Adebayo": ["阿德巴约"],
  "Chet Holmgren": ["霍姆格伦"],
  "Cooper Flagg": ["弗拉格"],
  "Bronny James": ["布朗尼"],
  "Draymond Green": ["追梦", "格林"],
  "Klay Thompson": ["克莱", "汤普森"],
  "Karl Anthony Towns": ["唐斯"],
  "Rudy Gobert": ["戈贝尔"],
  "Pascal Siakam": ["西亚卡姆"],
  "Domantas Sabonis": ["小萨博尼斯", "萨博尼斯"],
  "DeAaron Fox": ["福克斯"],
  "Darius Garland": ["加兰"],
  "Evan Mobley": ["莫布里"],
  "Donovan Clingan": ["克林根"],
  "Alperen Sengun": ["申京"],
  "Franz Wagner": ["小瓦格纳", "瓦格纳"],
  "Paolo Banchero": ["班凯罗"],
  "Scottie Barnes": ["巴恩斯"],
  "Jalen Green": ["杰伦格林"],
  "Tyrese Maxey": ["马克西"],
  "Jaren Jackson Jr": ["小贾伦", "贾伦杰克逊"],
  "Desmond Bane": ["贝恩"],
  "Lauri Markkanen": ["马尔卡宁"],
  "Mikal Bridges": ["布里奇斯", "大桥"],
  "Jalen Williams": ["杰伦威廉姆斯", "杰威"],
  "Jarrett Allen": ["阿伦"],
  "Nikola Vucevic": ["武切维奇"],
  "Jamal Murray": ["穆雷"],
  "Aaron Gordon": ["戈登"],
  "Brandon Miller": ["米勒"],
  "Brandon Ingram": ["英格拉姆", "莺歌"],
  "Ausar Thompson": ["奥萨尔汤普森"],
  "Amen Thompson": ["阿门汤普森"],
  "Scoot Henderson": ["亨德森"],
  "Shaedon Sharpe": ["夏普"],
  "Reed Sheppard": ["谢泼德"],
  "Rob Dillingham": ["迪林厄姆"],
  "Alexandre Sarr": ["萨尔"],
  "Zaccharie Risacher": ["里萨谢"],
  "Stephon Castle": ["卡斯尔"],
  "Cam Whitmore": ["惠特摩尔"],
  "Keyonte George": ["基昂特乔治"],
  "Walker Kessler": ["凯斯勒"],
  "Rui Hachimura": ["八村塁", "八村"],
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.'’\-]/g, "");
}

function matchesPlayerSearch(playerName: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const normalizedName = normalizeSearchText(playerName);
  if (normalizedName.includes(normalizedQuery)) return true;
  if (normalizeSearchText(getPlayerNameCN(playerName)).includes(normalizedQuery)) return true;
  const aliases = chineseAliases[playerName] ?? [];
  return aliases.some((alias) => normalizeSearchText(alias).includes(normalizedQuery));
}

type RosterCategory = "current" | "classic" | "allTime";
type RosterScope = "current" | "currentClassic" | "currentAllTime" | "all";
type RosterCatalogPlayer = {
  id: string;
  name: string;
  position: string | null;
  height: string | null;
  overall: number | null;
  threePoint: number | null;
  drivingDunk: number | null;
};
type RosterCatalogTeam = {
  id: string;
  name: string;
  category: RosterCategory;
  players: RosterCatalogPlayer[];
};
type BadgeProfileMap = Record<string, PlayerBadge[]>;
type DetailedPlayerRecord = {
  slug: string;
  shooting: number | null;
  athleticism: number | null;
  playmaking: number | null;
  defense: number | null;
  inside: number | null;
  detailed: Record<string, number | null>;
};

const sourceBadgeProfiles = rosterDataVersion.startsWith("NBA 2K27")
  ? badgeProfiles2k27 as BadgeProfileMap
  : {};
const detailedPlayerBySlug = new Map(
  (detailedPlayers as DetailedPlayerRecord[]).map((player) => [player.slug, player]),
);

const scopeOptions: Array<{ key: RosterScope; label: string }> = [
  { key: "current", label: "现役" },
  { key: "currentClassic", label: "现役 + 经典" },
  { key: "currentAllTime", label: "现役 + All-Time" },
  { key: "all", label: "所有球员" },
];

const rookieTierOptions: Array<{ key: RookieTier; label: string }> = [
  { key: "rotation", label: "轮换新秀" },
  { key: "lottery", label: "乐透新秀" },
  { key: "generational", label: "天赋怪" },
];

const badgeTierStyles: Record<PlayerBadge["tier"], string> = {
  Legendary: "border-cyan-500/30 bg-cyan-50 text-cyan-900",
  HOF: "border-fuchsia-500/25 bg-fuchsia-50 text-fuchsia-800",
  Gold: "border-amber-500/25 bg-amber-50 text-amber-800",
  Silver: "border-slate-400/25 bg-slate-100 text-slate-700",
  Bronze: "border-orange-700/20 bg-orange-50 text-orange-800",
};

function BadgeTokens({ badges, emptyText }: { badges: PlayerBadge[]; emptyText: string }) {
  if (badges.length === 0) {
    return <span className="text-[11px] text-ink-400">{emptyText}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={`${badge.name}:${badge.tier}`}
          className={`border px-1.5 py-0.5 text-[10px] font-medium leading-4 ${badgeTierStyles[badge.tier]}`}
          title={badgeTierCN[badge.tier]}
        >
          {getBadgeNameCN(badge.name)}
        </span>
      ))}
    </div>
  );
}

function clampRating(value: number) {
  return Math.max(25, Math.min(99, Math.round(value)));
}

function rosterPlayerSource(team: RosterCatalogTeam, player: RosterCatalogPlayer): PlayerSource {
  const detailedPlayer = detailedPlayerBySlug.get(player.id);
  const overall = player.overall ?? 72;
  const threePoint = player.threePoint ?? Math.max(45, overall - 14);
  const drivingDunk = player.drivingDunk ?? Math.max(35, overall - 20);
  const primaryPosition = player.position?.split("/")[0] ?? "SF";
  const guardBonus = primaryPosition === "PG" ? 12 : primaryPosition === "SG" ? 7 : primaryPosition === "SF" ? 2 : -4;
  const bigBonus = primaryPosition === "C" ? 11 : primaryPosition === "PF" ? 6 : 0;
  const shooting = clampRating(threePoint * 0.62 + overall * 0.38);
  const inside = clampRating(drivingDunk * 0.54 + overall * 0.46 + bigBonus);
  const athleticism = clampRating(overall * 0.72 + drivingDunk * 0.24 + 4);
  const playmaking = clampRating(overall * 0.68 + guardBonus);
  const defense = clampRating(overall * 0.76 + bigBonus * 0.7);

  return {
    id: `${team.category}:${team.id}:${player.id}`,
    name: formatPlayerName(player.name),
    slug: player.id,
    rosterCategory: team.category,
    rosterTeam: team.name,
    isEstimated: !detailedPlayer,
    badges: sourceBadgeProfiles[player.id] ?? [],
    badgesKnown: Object.hasOwn(sourceBadgeProfiles, player.id),
    overall,
    team: team.name,
    position: player.position,
    archetype: null,
    height: player.height,
    weight: null,
    wingspan: null,
    shooting: detailedPlayer?.shooting ?? shooting,
    athleticism: detailedPlayer?.athleticism ?? athleticism,
    playmaking: detailedPlayer?.playmaking ?? playmaking,
    defense: detailedPlayer?.defense ?? defense,
    inside: detailedPlayer?.inside ?? inside,
    detailed: detailedPlayer?.detailed ?? {
      "Close Shot": clampRating(inside - 3),
      "Mid-Range Shot": clampRating((shooting + overall) / 2),
      "Three-Point Shot": threePoint,
      "Free Throw": clampRating(shooting - 4),
      "Offensive Consistency": clampRating(overall - 3),
      "Shot IQ": clampRating(overall),
      "Speed": clampRating(athleticism - bigBonus),
      "Strength": clampRating(overall * 0.72 + bigBonus * 1.4),
      "Agility": clampRating(athleticism + guardBonus * 0.35),
      "Vertical": clampRating(athleticism + drivingDunk * 0.16),
      "Hustle": clampRating(overall - 2),
      "Stamina": clampRating(overall + 2),
      "Overall Durability": clampRating(overall - 5),
      "Ball Handle": clampRating(playmaking + guardBonus * 0.65),
      "Speed with Ball": clampRating(playmaking + guardBonus * 0.45),
      "Pass Accuracy": clampRating(playmaking),
      "Pass Vision": clampRating(playmaking - 4),
      "Pass IQ": clampRating(playmaking - 2),
      "Block": clampRating(defense + bigBonus * 1.2 - 16),
      "Steal": clampRating(defense + guardBonus * 0.45 - 5),
      "Pass Perception": clampRating(defense - 2),
      "Interior Defense": clampRating(defense + bigBonus),
      "Perimeter Defense": clampRating(defense + guardBonus * 0.3 - bigBonus * 0.35),
      "Defensive Consistency": clampRating(defense - 1),
      "Help Defense IQ": clampRating(defense),
      "Layup": clampRating(inside - 2),
      "Driving Dunk": drivingDunk,
      "Standing Dunk": clampRating(drivingDunk - 18 + bigBonus),
      "Post Hook": clampRating(inside - 16 + bigBonus),
      "Post Fade": clampRating((inside + shooting) / 2 - 8),
      "Post Control": clampRating(inside - 5 + bigBonus),
      "Draw Foul": clampRating(inside - 3),
      "Hands": clampRating(overall + 2),
      "Offensive Rebound": clampRating(defense - 12 + bigBonus),
      "Defensive Rebound": clampRating(defense - 7 + bigBonus),
      "Intangibles": clampRating(overall),
    },
  };
}

const catalogTeams = (rosterCatalog.teams as RosterCatalogTeam[]) ?? [];
const rookieBuilderTeams: RookieBuilderTeam[] = catalogTeams
  .filter((team) => team.category === "current" && team.players.length > 0)
  .map((team) => ({
    id: team.id,
    name: team.name,
    players: team.players.map((player) => rosterPlayerSource(team, player)),
  }));
const currentPlayerPool = catalogTeams
  .filter((team) => team.category === "current")
  .flatMap((team) => team.players.map((player) => rosterPlayerSource(team, player)));
const historicalPlayerPool = catalogTeams
  .filter((team) => team.category === "classic" || team.category === "allTime")
  .flatMap((team) => team.players.map((player) => rosterPlayerSource(team, player)));

const allPlayerPool = [...currentPlayerPool, ...historicalPlayerPool];

function playersForScope(scope: RosterScope): PlayerSource[] {
  if (scope === "current") return currentPlayerPool;
  if (scope === "currentClassic") return allPlayerPool.filter((player) => player.rosterCategory !== "allTime");
  if (scope === "currentAllTime") return allPlayerPool.filter((player) => player.rosterCategory !== "classic");
  return allPlayerPool;
}

function playerPoolLabel(player: PlayerSource): string {
  const name = getPlayerNameCN(player.name);
  if (player.rosterCategory === "current") return name;
  return player.rosterTeam ? `${name} · ${player.rosterTeam}` : name;
}

const marqueeDrawDurationMs = 3200;

type PhysicalWheelKey = "position" | "height" | "shoulder" | "wingspan" | "weight";
type WheelKey = AttributeGroupKey | PhysicalWheelKey;
type WheelTab = { key: WheelKey; name: string; isPhysical: boolean };
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

const physicalWheelNames: Record<PhysicalWheelKey, string> = {
  position: "位置",
  height: "身高",
  shoulder: "肩宽",
  wingspan: "臂展",
  weight: "体重",
};

function isAttributeGroupKey(key: WheelKey): key is AttributeGroupKey {
  return attributeGroups.some((group) => group.key === key);
}

function isPhysicalWheelKey(key: WheelKey): key is PhysicalWheelKey {
  return key in physicalWheelNames;
}

function getStatusValueSuffix(key: PhysicalWheelKey): string {
  if (key === "height") return " cm";
  if (key === "weight") return " kg";
  return "";
}

function createDraftText(draft: PlayerDraft, sources: SourceMap | null): string {
  const sourceLines = attributeGroups.map((group) => {
    const player = sources?.[group.key];
    if (!player) return `${group.name}: --`;
    const estimateTag = player.isEstimated ? " [估算]" : "";
    return `${group.name}: ${getPlayerNameCN(player.name)}${estimateTag}`;
  });
  const hasEstimatedSource = attributeGroups.some((group) => sources?.[group.key]?.isEstimated);
  return [
    `球员模板: ${draft.position} / ${draft.height}`,
    `体型: ${draft.weight ?? "--"} kg | ${draft.wingspan} 臂展 | ${draft.shoulderWidth} 肩宽`,
    `创建阶段: ${draft.careerStage === "rookie" ? "生涯起点" : "巅峰模板"}${draft.careerStage === "rookie" ? ` | 潜力 ${draft.potential}` : ""}`,
    `数据版本: ${rosterDataVersion}`,
    `来源: ${draft.sourceNames.map(getPlayerNameCN).join(" / ") || "--"}`,
    `来源估算: ${hasEstimatedSource || draft.badgesEstimated ? "含估算属性/徽章" : "均为详细属性来源"}`,
    ...sourceLines,
    `当前徽章: ${draft.badges.map((badge) => `${getBadgeNameCN(badge.name)} (${badgeTierCN[badge.tier]})`).join(" / ") || "--"}`,
    `巅峰徽章: ${draft.peakBadges.map((badge) => `${getBadgeNameCN(badge.name)} (${badgeTierCN[badge.tier]})`).join(" / ") || "--"}`,
    "",
    `投篮: ${draft.shooting}`,
    `运动: ${draft.athleticism}`,
    `组织: ${draft.playmaking}`,
    `防守: ${draft.defense}`,
    `内线: ${draft.inside}`,
    "",
    `Close Shot: ${draft.closeShot ?? "--"}`,
    `Mid-Range Shot: ${draft.midRangeShot ?? "--"}`,
    `Three-Point Shot: ${draft.threePointShot ?? "--"}`,
    `Free Throw: ${draft.freeThrow ?? "--"}`,
    `Offensive Consistency: ${draft.offensiveConsistency ?? "--"}`,
    `Shot IQ: ${draft.shotIQ ?? "--"}`,
    `Speed: ${draft.speed}`,
    `Agility: ${draft.agility ?? "--"}`,
    `Vertical: ${draft.vertical}`,
    `Strength: ${draft.strength}`,
    `Hustle: ${draft.hustle ?? "--"}`,
    `Stamina: ${draft.stamina ?? "--"}`,
    `Overall Durability: ${draft.overallDurability ?? "--"}`,
    `Ball Handle: ${draft.ballHandle ?? "--"}`,
    `Speed with Ball: ${draft.speedWithBall ?? "--"}`,
    `Pass Accuracy: ${draft.passAccuracy ?? "--"}`,
    `Pass Vision: ${draft.passVision ?? "--"}`,
    `Pass IQ: ${draft.passIQ ?? "--"}`,
    `Block: ${draft.block ?? "--"}`,
    `Steal: ${draft.steal ?? "--"}`,
    `Pass Perception: ${draft.passPerception ?? "--"}`,
    `Interior Defense: ${draft.interiorDefense ?? "--"}`,
    `Perimeter Defense: ${draft.perimeterDefense ?? "--"}`,
    `Defensive Consistency: ${draft.defensiveConsistency ?? "--"}`,
    `Help Defense IQ: ${draft.helpDefenseIQ ?? "--"}`,
    `Layup: ${draft.layup ?? "--"}`,
    `Driving Dunk: ${draft.drivingDunk ?? "--"}`,
    `Standing Dunk: ${draft.standingDunk ?? "--"}`,
    `Post Hook: ${draft.postHook ?? "--"}`,
    `Post Fade: ${draft.postFade ?? "--"}`,
    `Post Control: ${draft.postControl ?? "--"}`,
    `Draw Foul: ${draft.drawFoul ?? "--"}`,
    `Hands: ${draft.hands ?? "--"}`,
    `Offensive Rebound: ${draft.offensiveRebound ?? "--"}`,
    `Defensive Rebound: ${draft.defensiveRebound ?? "--"}`,
    `Intangibles: ${draft.intangibles ?? "--"}`
  ].join("\n");
}

const initialBodyTemplate: BodyTemplate = {
  position: "PG",
  height: "150",
  weight: 50,
  wingspan: "1",
  shoulderWidth: "1",
};

function createEmptyDraft(
  body: BodyTemplate = initialBodyTemplate,
  profile: CareerProfile = defaultCareerProfile,
): PlayerDraft {
  return {
    ...body,
    careerStage: profile.stage,
    rookieTier: profile.rookieTier,
    potential: 0,
    badges: [],
    peakBadges: [],
    badgesEstimated: false,
    sourceNames: [],
    shooting: 0, athleticism: 0, playmaking: 0, defense: 0, inside: 0,
    closeShot: null, midRangeShot: null, threePointShot: null, freeThrow: null,
    offensiveConsistency: null, shotIQ: null,
    speed: 0, agility: null, vertical: 0, strength: 0, hustle: null, stamina: null, overallDurability: null,
    ballHandle: null, speedWithBall: null, passAccuracy: null, passVision: null, passIQ: null,
    block: null, steal: null, passPerception: null, interiorDefense: null, perimeterDefense: null,
    defensiveConsistency: null, helpDefenseIQ: null,
    layup: null, drivingDunk: null, standingDunk: null, postHook: null, postFade: null, postControl: null,
    drawFoul: null, hands: null, offensiveRebound: null, defensiveRebound: null, intangibles: null,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseRangeInput(value: string, fallback: number) {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function RangeSlider({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
  absoluteMin,
  absoluteMax,
  color,
  disabled = false,
  onRandomize,
}: {
  label: string;
  min: number;
  max: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
  absoluteMin: number;
  absoluteMax: number;
  color: string;
  disabled?: boolean;
  onRandomize?: () => void;
}) {
  const [minInput, setMinInput] = useState(String(min));
  const [maxInput, setMaxInput] = useState(String(max));
  const [activeThumb, setActiveThumb] = useState<"min" | "max" | null>(null);
  const span = Math.max(1, absoluteMax - absoluteMin);
  const minPercent = ((min - absoluteMin) / span) * 100;
  const maxPercent = ((max - absoluteMin) / span) * 100;

  useEffect(() => {
    setMinInput(String(min));
  }, [min]);

  useEffect(() => {
    setMaxInput(String(max));
  }, [max]);

  const commitMin = (value: number) => {
    onMinChange(clampNumber(value, absoluteMin, max));
  };

  const commitMax = (value: number) => {
    onMaxChange(clampNumber(value, min, absoluteMax));
  };

  const handleMinInput = (value: string) => {
    commitMin(parseRangeInput(value, min));
  };

  const handleMaxInput = (value: string) => {
    commitMax(parseRangeInput(value, max));
  };

  const syncMinWhileTyping = (value: string) => {
    const parsed = Number(value);
    if (value.trim() !== "" && Number.isFinite(parsed) && parsed >= absoluteMin && parsed <= max) {
      commitMin(Math.round(parsed));
    }
  };

  const syncMaxWhileTyping = (value: string) => {
    const parsed = Number(value);
    if (value.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= absoluteMax) {
      commitMax(Math.round(parsed));
    }
  };

  return (
    <div className={`flex select-none flex-col gap-2 rounded-[6px] border border-ink-200 bg-ink-50 px-3 py-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] leading-none">
        <span className="shrink-0 font-medium text-ink-700">{label}</span>
        <div className="flex items-center gap-1.5">
          {onRandomize && (
            <button
              aria-label={`${label}全范围随机`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] border border-ink-200 bg-white text-court-700 transition hover:border-ink-400 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={disabled}
              onClick={onRandomize}
              title={`在完整可选范围内随机${label}`}
              type="button"
            >
              <Dice5 className="h-3.5 w-3.5" />
            </button>
          )}
          <input
            aria-label={`${label}下限`}
            className="h-6 w-14 rounded-[5px] border border-ink-200 bg-white px-1 text-center text-[11px] font-semibold tabular-nums text-ink-900 outline-none transition focus:border-court-500 disabled:cursor-not-allowed"
            disabled={disabled}
            inputMode="numeric"
            max={max}
            min={absoluteMin}
            onBlur={(e) => handleMinInput(e.currentTarget.value)}
            onChange={(e) => {
              setMinInput(e.target.value);
              syncMinWhileTyping(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            style={{ color }}
            type="number"
            value={minInput}
          />
          <span className="text-ink-400">–</span>
          <input
            aria-label={`${label}上限`}
            className="h-6 w-14 rounded-[5px] border border-ink-200 bg-white px-1 text-center text-[11px] font-semibold tabular-nums text-ink-900 outline-none transition focus:border-court-500 disabled:cursor-not-allowed"
            disabled={disabled}
            inputMode="numeric"
            max={absoluteMax}
            min={min}
            onBlur={(e) => handleMaxInput(e.currentTarget.value)}
            onChange={(e) => {
              setMaxInput(e.target.value);
              syncMaxWhileTyping(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            style={{ color }}
            type="number"
            value={maxInput}
          />
        </div>
      </div>
      <div className="relative h-7">
        <div
          className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            background: `linear-gradient(to right,
              rgba(38,71,83,0.13) 0%,
              rgba(38,71,83,0.13) ${minPercent}%,
              ${color} ${minPercent}%,
              ${color} ${maxPercent}%,
              rgba(38,71,83,0.13) ${maxPercent}%
            )`,
          }}
        />
        {/* Min thumb sits above max on the left half so it remains draggable. */}
        <input
          type="range"
          aria-label={`${label}下限滑块`}
          className={`range-control absolute top-0 left-0 h-full w-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--slider-thumb)] [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(31,73,86,0.28)] ${activeThumb === "min" ? "z-30" : "z-20"}`}
          style={{ "--slider-thumb": color, background: "transparent" } as React.CSSProperties}
          min={absoluteMin}
          max={absoluteMax}
          value={min}
          disabled={disabled}
          onPointerDown={() => setActiveThumb("min")}
          onPointerUp={() => setActiveThumb(null)}
          onChange={(e) => commitMin(Number(e.target.value))}
        />
        <input
          type="range"
          aria-label={`${label}上限滑块`}
          className={`range-control absolute top-0 left-0 h-full w-full [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--slider-thumb)] [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(31,73,86,0.28)] ${activeThumb === "max" || activeThumb === null ? "z-30" : "z-10"}`}
          style={{ "--slider-thumb": color, background: "transparent" } as React.CSSProperties}
          min={absoluteMin}
          max={absoluteMax}
          value={max}
          disabled={disabled}
          onPointerDown={() => setActiveThumb("max")}
          onPointerUp={() => setActiveThumb(null)}
          onChange={(e) => commitMax(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

const App = () => {
  const [appMode, setAppMode] = useState<AppMode>("rookie");
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);
  const [draft, setDraft] = useState<PlayerDraft>(() => createEmptyDraft());
  const [careerProfile, setCareerProfile] = useState<CareerProfile>(defaultCareerProfile);
  const [rosterScope, setRosterScope] = useState<RosterScope>("current");
  const [selectedPool, setSelectedPool] = useState<string[]>(() => currentPlayerPool.map(playerSourceKey));
  const [activeGroupKey, setActiveGroupKey] = useState<WheelKey>("shooting");
  const [sourceMap, setSourceMap] = useState<SourceMap | null>(null);
  const [bodyTemplate, setBodyTemplate] = useState<BodyTemplate>(initialBodyTemplate);
  const [poolSearch, setPoolSearch] = useState("");
  const [wheelDraw, setWheelDraw] = useState<{ key: WheelKey; selectedId: string } | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [statusText, setStatusText] = useState("已载入 2KRatings 最新现役 roster");
  const spinTimerRef = useRef<number | null>(null);

  const [positionVal, setPositionVal] = useState(initialBodyTemplate.position);
  const [heightVal, setHeightVal] = useState(initialBodyTemplate.height);
  const [shoulderVal, setShoulderVal] = useState(initialBodyTemplate.shoulderWidth);
  const [wingspanVal, setWingspanVal] = useState(initialBodyTemplate.wingspan);
  const [weightVal, setWeightVal] = useState(String(initialBodyTemplate.weight));
  const [weightMin, setWeightMin] = useState(50);
  const [weightMax, setWeightMax] = useState(200);


  // Range sliders for physical attributes
  const [heightMin, setHeightMin] = useState(150);
  const [heightMax, setHeightMax] = useState(300);
  const [shoulderMin, setShoulderMin] = useState(1);
  const [shoulderMax, setShoulderMax] = useState(100);
  const [wingspanMin, setWingspanMin] = useState(1);
  const [wingspanMax, setWingspanMax] = useState(100);
  const [posFilter, setPosFilter] = useState<string[]>(["PG", "SG", "SF", "PF", "C"]);

  const scopedPlayers = useMemo(() => playersForScope(rosterScope), [rosterScope]);

  const availablePlayers = useMemo(
    () => selectedPool.length > 0
      ? allPlayerPool.filter((player) => selectedPool.includes(playerSourceKey(player)))
      : [],
    [selectedPool]
  );

  const activeGroup = isAttributeGroupKey(activeGroupKey)
    ? attributeGroups.find((g) => g.key === activeGroupKey) ?? attributeGroups[0]
    : attributeGroups[0];
  const activeSource = sourceMap && isAttributeGroupKey(activeGroupKey) ? sourceMap[activeGroupKey] : undefined;

  const allTabs = useMemo<WheelTab[]>(() => [
    ...attributeGroups.map((g) => ({ key: g.key, name: g.name, isPhysical: false })),
    { key: "position", name: physicalWheelNames.position, isPhysical: true },
    { key: "height", name: physicalWheelNames.height, isPhysical: true },
    { key: "shoulder", name: physicalWheelNames.shoulder, isPhysical: true },
    { key: "wingspan", name: physicalWheelNames.wingspan, isPhysical: true },
    { key: "weight", name: physicalWheelNames.weight, isPhysical: true },
  ], []);

  const activeTab = allTabs.find((t) => t.key === activeGroupKey) ?? allTabs[0];


  const attrDefs = useMemo(() => {
    return [
      ["Close Shot", "closeShot", draft.closeShot],
      ["Mid-Range Shot", "midRangeShot", draft.midRangeShot],
      ["Three-Point Shot", "threePointShot", draft.threePointShot],
      ["Free Throw", "freeThrow", draft.freeThrow],
      ["Offensive Consistency", "offensiveConsistency", draft.offensiveConsistency],
      ["Shot IQ", "shotIQ", draft.shotIQ],
      ["Speed", "speed", draft.speed],
      ["Strength", "strength", draft.strength],
      ["Agility", "agility", draft.agility],
      ["Vertical", "vertical", draft.vertical],
      ["Hustle", "hustle", draft.hustle],
      ["Stamina", "stamina", draft.stamina],
      ["Overall Durability", "overallDurability", draft.overallDurability],
      ["Ball Handle", "ballHandle", draft.ballHandle],
      ["Speed with Ball", "speedWithBall", draft.speedWithBall],
      ["Pass Accuracy", "passAccuracy", draft.passAccuracy],
      ["Pass Vision", "passVision", draft.passVision],
      ["Pass IQ", "passIQ", draft.passIQ],
      ["Block", "block", draft.block],
      ["Steal", "steal", draft.steal],
      ["Pass Perception", "passPerception", draft.passPerception],
      ["Interior Defense", "interiorDefense", draft.interiorDefense],
      ["Perimeter Defense", "perimeterDefense", draft.perimeterDefense],
      ["Defensive Consistency", "defensiveConsistency", draft.defensiveConsistency],
      ["Help Defense IQ", "helpDefenseIQ", draft.helpDefenseIQ],
      ["Layup", "layup", draft.layup],
      ["Driving Dunk", "drivingDunk", draft.drivingDunk],
      ["Standing Dunk", "standingDunk", draft.standingDunk],
      ["Post Hook", "postHook", draft.postHook],
      ["Post Fade", "postFade", draft.postFade],
      ["Post Control", "postControl", draft.postControl],
      ["Draw Foul", "drawFoul", draft.drawFoul],
      ["Hands", "hands", draft.hands],
      ["Offensive Rebound", "offensiveRebound", draft.offensiveRebound],
      ["Defensive Rebound", "defensiveRebound", draft.defensiveRebound],
      ["Intangibles", "intangibles", draft.intangibles],
    ].sort((a, b) => ((b[2] as number) ?? 0) - ((a[2] as number) ?? 0));
  }, [draft]);

  const detailedAttrs: {label: string; value: string | number | null}[] = attrDefs.map(([label, , value]) => ({ label: label as string, value }));
  const sourceEntries = attributeGroups.map((group) => ({
    group,
    player: sourceMap?.[group.key] ?? null,
  }));

  const filteredHeights = useMemo(() => {
    const low = Math.min(heightMin, heightMax);
    const high = Math.max(heightMin, heightMax);
    return allHeights().filter((h) => {
      const cm = parseInt(h, 10);
      return cm >= low && cm <= high;
    });
  }, [heightMin, heightMax]);

  const filteredShoulders = useMemo(() => {
    const low = Math.min(shoulderMin, shoulderMax);
    const high = Math.max(shoulderMin, shoulderMax);
    return Array.from({ length: high - low + 1 }, (_, i) => `${low + i}`);
  }, [shoulderMin, shoulderMax]);

  const filteredWingspans = useMemo(() => {
    const low = Math.min(wingspanMin, wingspanMax);
    const high = Math.max(wingspanMin, wingspanMax);
    return Array.from({ length: high - low + 1 }, (_, i) => `${low + i}`);
  }, [wingspanMin, wingspanMax]);

  const filteredWeights = useMemo(() => {
    const low = Math.min(weightMin, weightMax);
    const high = Math.max(weightMin, weightMax);
    return Array.from({ length: high - low + 1 }, (_, i) => `${low + i}`);
  }, [weightMin, weightMax]);

  const posOpts = useMemo(() => posFilter, [posFilter]);

  const physicalOptionsByKey = useMemo<Record<PhysicalWheelKey, string[]>>(() => ({
    position: posOpts,
    height: filteredHeights,
    shoulder: filteredShoulders,
    wingspan: filteredWingspans,
    weight: filteredWeights,
  }), [filteredHeights, filteredShoulders, filteredWeights, filteredWingspans, posOpts]);

  const activeMarqueeItems = useMemo<MarqueeDrawItem[]>(() => {
    const key = activeTab.key;
    if (isPhysicalWheelKey(key)) {
      return physicalOptionsByKey[key].map((value) => ({
        id: value,
        label: `${value}${getStatusValueSuffix(key)}`,
        mark: key === "position" ? value : undefined,
        meta: physicalWheelNames[key],
      }));
    }

    return availablePlayers.map((player) => ({
      id: playerSourceKey(player),
      label: playerPoolLabel(player),
      imageSrc: getPlayerHeadshot(player.name),
      mark: player.position?.split("/")[0] ?? "NBA",
      meta: [
        typeof player.overall === "number" ? `${player.overall} OVR` : null,
        player.isEstimated ? "估算" : null,
      ].filter(Boolean).join(" · ") || undefined,
    }));
  }, [activeTab.key, availablePlayers, physicalOptionsByKey]);

  // Warm headshots for the current ability pool so marquee cards paint faster.
  useEffect(() => {
    if (activeTab.isPhysical || availablePlayers.length === 0) return;
    prefetchPlayerHeadshots(availablePlayers.slice(0, 48).map((player) => player.name));
  }, [activeTab.isPhysical, availablePlayers]);

  const activeCurrentLabel = isPhysicalWheelKey(activeTab.key)
    ? activeTab.key === "position"
      ? positionVal
      : activeTab.key === "height"
        ? heightVal
        : activeTab.key === "shoulder"
          ? shoulderVal
          : activeTab.key === "wingspan"
            ? wingspanVal
            : weightVal
    : activeSource
      ? `${playerPoolLabel(activeSource)}${activeSource.isEstimated ? " · 估算" : ""}`
      : undefined;
  const activePhysicalValue = isPhysicalWheelKey(activeTab.key)
    ? activeTab.key === "position"
      ? positionVal
      : activeTab.key === "height"
        ? heightVal
        : activeTab.key === "shoulder"
          ? shoulderVal
          : activeTab.key === "wingspan"
            ? wingspanVal
            : weightVal
    : undefined;
  const activeMarqueeSelectedId = isSpinning && wheelDraw?.key === activeGroupKey
    ? wheelDraw.selectedId
    : activePhysicalValue ?? (activeSource ? playerSourceKey(activeSource) : undefined);
  const hasDraftBody = bodyTemplate.position !== initialBodyTemplate.position
    || bodyTemplate.height !== initialBodyTemplate.height
    || bodyTemplate.weight !== initialBodyTemplate.weight
    || bodyTemplate.wingspan !== initialBodyTemplate.wingspan
    || bodyTemplate.shoulderWidth !== initialBodyTemplate.shoulderWidth;
  const hasGeneratedDraft = hasDraftBody || draft.sourceNames.length > 0;

  const applyBody = useCallback((pos: string, ht: string, sw: string, ws: string, wt: string) => {
    const parsedWeight = Number.parseInt(wt, 10);
    const template: BodyTemplate = {
      position: pos,
      height: ht,
      weight: Number.isFinite(parsedWeight) ? parsedWeight : bodyTemplate.weight,
      wingspan: ws,
      shoulderWidth: sw
    };
    setBodyTemplate(template);
    setDraft((current) => sourceMap ? createDraftFromSources(sourceMap, template, careerProfile) : { ...current, ...template });
  }, [bodyTemplate.weight, careerProfile, sourceMap]);

  // When candidate ranges shrink, keep drawn values only if they remain
  // selectable; otherwise clear them so the UI never shows an unreachable result.
  useEffect(() => {
    if (isSpinning) return;

    const nextPos = posOpts.includes(positionVal) ? positionVal : initialBodyTemplate.position;
    const nextHeight = filteredHeights.includes(heightVal) ? heightVal : initialBodyTemplate.height;
    const nextShoulder = filteredShoulders.includes(shoulderVal) ? shoulderVal : initialBodyTemplate.shoulderWidth;
    const nextWingspan = filteredWingspans.includes(wingspanVal) ? wingspanVal : initialBodyTemplate.wingspan;
    const nextWeight = filteredWeights.includes(weightVal) ? weightVal : String(initialBodyTemplate.weight);

    const cleared: string[] = [];
    if (nextPos !== positionVal && positionVal !== initialBodyTemplate.position) cleared.push("位置");
    if (nextHeight !== heightVal && heightVal !== initialBodyTemplate.height) cleared.push("身高");
    if (nextShoulder !== shoulderVal && shoulderVal !== initialBodyTemplate.shoulderWidth) cleared.push("肩宽");
    if (nextWingspan !== wingspanVal && wingspanVal !== initialBodyTemplate.wingspan) cleared.push("臂展");
    if (nextWeight !== weightVal && weightVal !== String(initialBodyTemplate.weight)) cleared.push("体重");
    if (cleared.length === 0) return;

    setPositionVal(nextPos);
    setHeightVal(nextHeight);
    setShoulderVal(nextShoulder);
    setWingspanVal(nextWingspan);
    setWeightVal(nextWeight);
    applyBody(nextPos, nextHeight, nextShoulder, nextWingspan, nextWeight);
    setStatusText(`候选范围已变更，已清除超出范围的结果：${cleared.join("、")}`);
  }, [
    applyBody,
    filteredHeights,
    filteredShoulders,
    filteredWeights,
    filteredWingspans,
    heightVal,
    isSpinning,
    posOpts,
    positionVal,
    shoulderVal,
    weightVal,
    wingspanVal,
  ]);

  const randomizeFullBodyValue = useCallback((key: "height" | "shoulder" | "wingspan") => {
    if (isSpinning) return;

    if (key === "height") {
      const value = randomHeight();
      setHeightVal(value);
      applyBody(positionVal, value, shoulderVal, wingspanVal, weightVal);
      setStatusText(`身高 → ${value} cm（全范围随机）`);
      return;
    }

    if (key === "shoulder") {
      const value = randomShoulderWidth();
      setShoulderVal(value);
      applyBody(positionVal, heightVal, value, wingspanVal, weightVal);
      setStatusText(`肩宽 → ${value}（全范围随机）`);
      return;
    }

    const value = randomWingspan();
    setWingspanVal(value);
    applyBody(positionVal, heightVal, shoulderVal, value, weightVal);
    setStatusText(`臂展 → ${value}（全范围随机）`);
  }, [applyBody, heightVal, isSpinning, positionVal, shoulderVal, weightVal, wingspanVal]);

  const chooseRandom = useCallback(<T,>(options: readonly T[], fallback: T): T => {
    return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : fallback;
  }, []);

  const clearSpinTimer = useCallback(() => {
    if (spinTimerRef.current !== null) {
      window.clearTimeout(spinTimerRef.current);
      spinTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearSpinTimer();
  }, [clearSpinTimer]);

  const togglePool = (playerId: string) => {
    if (isSpinning) return;
    const nextPool = selectedPool.includes(playerId)
      ? selectedPool.filter((id) => id !== playerId)
      : [...selectedPool, playerId];
    setSelectedPool(nextPool);
    if (nextPool.length === 0) {
      setSourceMap(null);
      setDraft(createEmptyDraft(bodyTemplate, careerProfile));
      setStatusText("球员池已清空");
      return;
    }
    const normalized = sourceMap ? normalizeSourceMap(nextPool, sourceMap, allPlayerPool) : createRandomSourceMap(nextPool, allPlayerPool);
    setSourceMap(normalized);
    setDraft(createDraftFromSources(normalized, bodyTemplate, careerProfile));
    setStatusText("球员池已更新");
  };

  const selectAllPlayers = () => {
    if (isSpinning) return;
    const nextPool = scopedPlayers.map(playerSourceKey);
    const normalized = sourceMap ? normalizeSourceMap(nextPool, sourceMap, allPlayerPool) : createRandomSourceMap(nextPool, allPlayerPool);
    setSelectedPool(nextPool);
    setSourceMap(normalized);
    setDraft(createDraftFromSources(normalized, bodyTemplate, careerProfile));
    setStatusText("已全选");
  };

  const changeRosterScope = (scope: RosterScope) => {
    if (isSpinning) return;
    const nextPlayers = playersForScope(scope);
    const nextPool = nextPlayers.map(playerSourceKey);
    const normalized = sourceMap ? normalizeSourceMap(nextPool, sourceMap, allPlayerPool) : createRandomSourceMap(nextPool, allPlayerPool);
    setRosterScope(scope);
    setSelectedPool(nextPool);
    setSourceMap(normalized);
    setDraft(createDraftFromSources(normalized, bodyTemplate, careerProfile));
    setStatusText(`${scopeOptions.find((option) => option.key === scope)?.label ?? "球员池"}已载入`);
  };

  const updateCareerProfile = (nextProfile: CareerProfile) => {
    if (isSpinning) return;
    setCareerProfile(nextProfile);
    if (sourceMap) {
      setDraft(createDraftFromSources(sourceMap, bodyTemplate, nextProfile));
    } else {
      setDraft(createEmptyDraft(bodyTemplate, nextProfile));
    }
    setStatusText(nextProfile.stage === "rookie" ? "生涯起点已更新" : "巅峰模板已更新");
  };

  const clearPool = () => {
    if (isSpinning) return;
    setSelectedPool([]);
    setSourceMap(null);
    setDraft(createEmptyDraft(bodyTemplate, careerProfile));
    setStatusText("球员池已清空");
  };

  const startMarqueeDraw = useCallback(({
    key,
    onFinish,
    status,
    targetId,
  }: {
    key: WheelKey;
    onFinish: () => void;
    status?: string;
    targetId: string;
  }) => {
    if (isSpinning) return;

    clearSpinTimer();
    setWheelDraw({ key, selectedId: targetId });
    if (status) setStatusText(status);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onFinish();
      return;
    }

    setIsSpinning(true);
    spinTimerRef.current = window.setTimeout(() => {
      onFinish();
      setIsSpinning(false);
      spinTimerRef.current = null;
    }, marqueeDrawDurationMs);
  }, [clearSpinTimer, isSpinning]);

  const spinPhysicalWheel = useCallback((key: PhysicalWheelKey) => {
    const options = physicalOptionsByKey[key];
    const winnerIndex = randomWheelIndex(options.length);
    const value = options[winnerIndex];
    if (!value) return;

    startMarqueeDraw({
      key,
      status: `正在抽取「${physicalWheelNames[key]}」`,
      targetId: value,
      onFinish: () => {
        if (key === "position") {
          setPositionVal(value);
          applyBody(value, heightVal, shoulderVal, wingspanVal, weightVal);
        } else if (key === "height") {
          setHeightVal(value);
          applyBody(positionVal, value, shoulderVal, wingspanVal, weightVal);
        } else if (key === "shoulder") {
          setShoulderVal(value);
          applyBody(positionVal, heightVal, value, wingspanVal, weightVal);
        } else if (key === "wingspan") {
          setWingspanVal(value);
          applyBody(positionVal, heightVal, shoulderVal, value, weightVal);
        } else {
          setWeightVal(value);
          applyBody(positionVal, heightVal, shoulderVal, wingspanVal, value);
        }

        setStatusText(`${physicalWheelNames[key]} → ${value}${getStatusValueSuffix(key)}`);
      },
    });
  }, [applyBody, heightVal, physicalOptionsByKey, positionVal, shoulderVal, startMarqueeDraw, weightVal, wingspanVal]);

  const spinCurrentGroup = useCallback(() => {
    if (!isAttributeGroupKey(activeGroupKey) || availablePlayers.length === 0) return;

    const winnerIndex = randomWheelIndex(availablePlayers.length);
    const target = availablePlayers[winnerIndex];
    if (!target) return;

    startMarqueeDraw({
      key: activeGroupKey,
      status: `正在转出「${activeGroup.name}」来源`,
      targetId: playerSourceKey(target),
      onFinish: () => {
        const nextSources = {
          ...(sourceMap ?? createRandomSourceMap(selectedPool, allPlayerPool)),
          [activeGroupKey]: target,
        } as SourceMap;
        setSourceMap(nextSources);
        setDraft(createDraftFromSources(nextSources, bodyTemplate, careerProfile));
        setStatusText(`${activeGroup.name} → ${getPlayerNameCN(target.name)}`);
      },
    });
  }, [activeGroup.name, activeGroupKey, availablePlayers, bodyTemplate, careerProfile, selectedPool, sourceMap, startMarqueeDraw]);

  const handleActiveWheelSpin = useCallback(() => {
    if (isPhysicalWheelKey(activeGroupKey)) {
      spinPhysicalWheel(activeGroupKey);
      return;
    }

    spinCurrentGroup();
  }, [activeGroupKey, spinCurrentGroup, spinPhysicalWheel]);

  const randomizeAll = () => {
    if (isSpinning) return;
    if (selectedPool.length === 0) {
      setStatusText("请先选择至少一名球员");
      return;
    }
    const nextSources = createRandomSourceMap(selectedPool, allPlayerPool);
    const pos = chooseRandom(posOpts, randomPosition());
    const ht = chooseRandom(filteredHeights, randomHeight());
    const sw = chooseRandom(filteredShoulders, randomShoulderWidth());
    const ws = chooseRandom(filteredWingspans, randomWingspan());
    const wt = chooseRandom(filteredWeights, randomWeight());

    const template: BodyTemplate = { position: pos, height: ht, weight: parseInt(wt, 10), wingspan: ws, shoulderWidth: sw };
    setPositionVal(pos);
    setHeightVal(ht);
    setShoulderVal(sw);
    setWingspanVal(ws);
    setWeightVal(wt);

    setSourceMap(nextSources);
    setBodyTemplate(template);
    setDraft(createDraftFromSources(nextSources, template, careerProfile));

    const activeSelection = isPhysicalWheelKey(activeTab.key)
      ? activeTab.key === "position" ? pos : activeTab.key === "height" ? ht : activeTab.key === "shoulder" ? sw : activeTab.key === "wingspan" ? ws : wt
      : playerSourceKey(nextSources[activeGroupKey as AttributeGroupKey]);
    setWheelDraw({ key: activeTab.key, selectedId: activeSelection });

    setStatusText("已重新洗牌");
  };

  const exportDraft = async () => {
    await navigator.clipboard.writeText(createDraftText(draft, sourceMap));
    setStatusText("清单已复制");
  };

  const fallbackDownloadDraftFile = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "2k26-spinner-draft.txt";
    anchor.rel = "noopener";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadDraftFile = async () => {
    const blob = new Blob([createDraftText(draft, sourceMap)], { type: "text/plain;charset=utf-8" });
    const showSaveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

    if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: "2k26-spinner-draft.txt",
          types: [
            {
              description: "Text file",
              accept: { "text/plain": [".txt"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatusText("文件已导出");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatusText("已取消导出");
          return;
        }
      }
    }

    fallbackDownloadDraftFile(blob);
    setStatusText("文件已导出");
  };

  return (
    <main className="min-h-screen text-ink-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1520px] flex-col gap-2.5 px-2.5 py-2.5 sm:px-4 sm:py-3">

        {/* Header */}
        <header className="app-header">
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="brand-mark" aria-hidden="true">
              <img alt="" src={rookieLogo} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-semibold text-ink-900">2K26 球员生成器</h1>
              <div className="mt-0.5 truncate text-[9px] text-ink-500">
                {appMode === "rookie" ? "球队抽选 / 新秀构建" : appMode === "prime" ? "球队抽选 / 巅峰构建" : "能力混合 / 球员转盘"}
              </div>
            </div>
          </div>

          <nav className="mode-nav" aria-label="生成模式">
            <button aria-pressed={appMode === "rookie"} className="mode-nav-button" data-active={appMode === "rookie"} disabled={isSpinning} onClick={() => setAppMode("rookie")} type="button">
              <UserRoundPlus className="h-3.5 w-3.5" />
              <span className="lg:hidden">新秀</span>
              <span className="hidden lg:inline">生成我的新秀</span>
            </button>
            <button aria-pressed={appMode === "prime"} className="mode-nav-button" data-active={appMode === "prime"} disabled={isSpinning} onClick={() => setAppMode("prime")} type="button">
              <Award className="h-3.5 w-3.5" />
              <span className="lg:hidden">巅峰</span>
              <span className="hidden lg:inline">生成巅峰球员</span>
            </button>
            <button aria-pressed={appMode === "wheel"} className="mode-nav-button" data-active={appMode === "wheel"} disabled={isSpinning} onClick={() => setAppMode("wheel")} type="button">
              <Disc3 className="h-3.5 w-3.5" />
              <span className="lg:hidden">转盘</span>
              <span className="hidden lg:inline">球员转盘</span>
            </button>
          </nav>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <span className="meta-chip">{appVersion} / {lastUpdated}</span>
            <button
              aria-label={theme === "light" ? "切换深色模式" : "切换浅色模式"}
              aria-pressed={theme === "dark"}
              className="theme-toggle"
              onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
              title={theme === "light" ? "切换深色模式" : "切换浅色模式"}
              type="button"
            >
              {theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            </button>
            <span className="hidden items-center gap-1.5 text-[10px] font-medium text-ink-600 xl:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-court-500" />
              {appMode === "rookie" ? "新秀构建" : appMode === "prime" ? "巅峰构建" : statusText}
            </span>
          </div>
        </header>

        {appMode === "wheel" && <section className="panel-surface overflow-hidden" aria-label="使用指南">
          <div className="workspace-toolbar flex items-center justify-between px-3 py-2">
            <div className="section-label flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-court-700" />
              使用指南
            </div>
            <span className="text-[9px] text-ink-400">球员转盘</span>
          </div>
          <ol className="grid grid-cols-2 gap-px bg-ink-200 md:grid-cols-4">
            {usageGuides.wheel.map((step, index) => (
              <li key={step.title} className="flex min-w-0 items-start gap-2 bg-white px-3 py-2.5">
                <span className="shrink-0 font-mono text-[10px] font-semibold text-court-700">0{index + 1}</span>
                <span className="min-w-0">
                  <strong className="block text-[11px] font-semibold text-ink-800">{step.title}</strong>
                  <span className="mt-0.5 block text-[9px] leading-4 text-ink-500">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>}

        {appMode === "wheel" ? (
        /* TOP HALF — two columns: left=ranges, right=wheel */
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 md:grid-cols-[300px_minmax(0,1fr)] md:grid-rows-[1fr_auto]">

          {/* Left column — range sliders + player pool */}
          <aside className="contents md:flex md:h-full md:flex-col md:gap-2.5">
            {/* Range sliders */}
            <div className="panel-surface order-1 overflow-hidden md:order-none">
              <div className="workspace-toolbar px-3 py-2.5"><div className="section-label">身材抽奖范围</div></div>
              <div className="grid gap-2.5 p-3">
                <RangeSlider
                  label="身高 (cm)"
                  min={heightMin}
                  max={heightMax}
                  onMinChange={setHeightMin}
                  onMaxChange={setHeightMax}
                  absoluteMin={150}
                  absoluteMax={300}
                  color="#4b83b8"
                  disabled={isSpinning}
                  onRandomize={() => randomizeFullBodyValue("height")}
                />
                <RangeSlider
                  label="肩宽"
                  min={shoulderMin}
                  max={shoulderMax}
                  onMinChange={setShoulderMin}
                  onMaxChange={setShoulderMax}
                  absoluteMin={1}
                  absoluteMax={100}
                  color="#b86f5a"
                  disabled={isSpinning}
                  onRandomize={() => randomizeFullBodyValue("shoulder")}
                />
                <RangeSlider
                  label="臂展"
                  min={wingspanMin}
                  max={wingspanMax}
                  onMinChange={setWingspanMin}
                  onMaxChange={setWingspanMax}
                  absoluteMin={1}
                  absoluteMax={100}
                  color="#2f9d83"
                  disabled={isSpinning}
                  onRandomize={() => randomizeFullBodyValue("wingspan")}
                />
                <RangeSlider
                  label="体重 (kg)"
                  min={weightMin}
                  max={weightMax}
                  onMinChange={setWeightMin}
                  onMaxChange={setWeightMax}
                  absoluteMin={50}
                  absoluteMax={200}
                  color="#8f72be"
                  disabled={isSpinning}
                />
              </div>
            </div>

            {/* Position filter */}
            <div className="panel-surface order-2 overflow-hidden md:order-none">
              <div className="workspace-toolbar px-3 py-2.5"><div className="section-label">位置抽奖池</div></div>
              <div className="grid grid-cols-5 gap-1.5 p-3">
                {["PG", "SG", "SF", "PF", "C"].map((pos) => {
                  const active = posFilter.includes(pos);
                  return (
                    <button
                      key={pos}
                      className={`flex h-7 min-w-0 items-center justify-center rounded-[5px] text-[11px] font-medium transition ${
                        active
                          ? "border border-ink-900 bg-ink-900 text-white"
                          : "border border-ink-200 bg-white text-ink-600 hover:border-ink-400 hover:bg-ink-50 hover:text-ink-900"
                      }`}
                      onClick={() => {
                        setPosFilter((prev) => {
                          if (!prev.includes(pos)) return [...prev, pos];
                          if (prev.length === 1) return prev;
                          return prev.filter((p) => p !== pos);
                        });
                      }}
                      disabled={isSpinning}
                      type="button"
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Player pool */}
            <div className="panel-surface order-4 flex flex-col overflow-hidden md:order-none">
              <div className="workspace-toolbar px-3 py-2.5">
                <div className="section-label mb-2">生涯设定</div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-ink-700/10 bg-ink-700/10">
                  {([
                    { key: "rookie", label: "生涯起点" },
                    { key: "prime", label: "巅峰模板" },
                  ] as const).map((option) => {
                    const active = careerProfile.stage === option.key;
                    return (
                      <button
                        key={option.key}
                        className={`min-h-8 px-2 py-1.5 text-[11px] font-medium transition ${
                          active ? "bg-court-100 text-court-900" : "bg-white text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                        }`}
                        disabled={isSpinning}
                        onClick={() => updateCareerProfile({ ...careerProfile, stage: option.key })}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {careerProfile.stage === "rookie" && (
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {rookieTierOptions.map((option) => {
                      const active = careerProfile.rookieTier === option.key;
                      return (
                        <button
                          key={option.key}
                          className={`min-h-7 border px-1 text-[10px] font-medium transition ${
                            active
                              ? "border-court-500/25 bg-court-50 text-court-800"
                              : "border-ink-700/10 bg-white text-ink-600 hover:border-court-500/22 hover:text-ink-900"
                          }`}
                          disabled={isSpinning}
                          onClick={() => updateCareerProfile({ ...careerProfile, rookieTier: option.key })}
                          type="button"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-px border-b border-ink-700/10 bg-ink-700/10">
                {scopeOptions.map((option) => {
                  const active = rosterScope === option.key;
                  return (
                    <button
                      key={option.key}
                      className={`min-h-8 px-2 py-1.5 text-[10px] font-medium transition ${
                        active
                          ? "bg-court-100 text-court-900"
                          : "bg-white text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                      }`}
                      disabled={isSpinning}
                      onClick={() => changeRosterScope(option.key)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 border-b border-ink-700/10 px-3 py-2">
                <input
                  className="flex-1 bg-transparent text-[13px] text-ink-900 placeholder:text-ink-500/60 outline-none"
                  placeholder="搜索球员 / 中文名 / 外号..."
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 border-b border-ink-700/10 px-3 py-1.5">
                <span className="text-[11px] text-ink-600">{selectedPool.length}/{scopedPlayers.length}</span>
                <span className="text-[10px] text-ink-300">|</span>
                <button
                  className="text-[11px] text-ink-600 transition hover:text-ink-900 disabled:opacity-40"
                  disabled={isSpinning}
                  onClick={selectAllPlayers}
                  type="button"
                >
                  全选
                </button>
                <button
                  className="text-[11px] text-ink-600 transition hover:text-ink-900 disabled:opacity-40"
                  disabled={isSpinning || selectedPool.length === 0}
                  onClick={clearPool}
                  type="button"
                >
                  清空
                </button>
              </div>
              <div className="overflow-y-auto max-h-[320px]">
                {scopedPlayers
                  .filter((p) => matchesPlayerSearch(p.name, poolSearch))

                  .map((player) => {
                    const playerId = playerSourceKey(player);
                    const active = selectedPool.includes(playerId);
                    return (
                      <button
                        key={playerId}
                        className={`flex w-full items-center justify-between border-b border-ink-700/5 px-3 py-1 text-left text-sm transition ${
                          active ? "bg-court-50 text-court-900" : "text-ink-700 hover:bg-ink-100/60"
                        }`}
                        disabled={isSpinning}
                        onClick={() => togglePool(playerId)}
                        type="button"
                      >
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition " + (active ? "border-court-600 bg-court-600" : "border-ink-400/40 bg-white")}>
                {active && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
                          <span className="truncate">
                            {playerPoolLabel(player)}
                            {player.isEstimated && <span className="ml-1 text-[10px] font-medium text-amber-700">估算</span>}
                          </span>
                        </span>
                        {active && <span className="shrink-0 text-[10px] text-court-700">已选</span>}
                      </button>
                    );
                  })}
              </div>
            </div>
          </aside>

          {/* Right — wheel + physical wheels + draft card */}
          <section className="order-3 flex h-full flex-col gap-2.5 md:order-none">
            {/* All tabs — ability + physical */}
            <div className="panel-surface overflow-hidden p-1">
              <div className="flex flex-wrap gap-1">
                {allTabs.map((tab) => {
                  const active = tab.key === activeGroupKey;
                  return (
                    <button
                      key={tab.key}
                      className={`flex-1 rounded-[5px] py-2 text-center text-[11px] transition ${
                        active
                          ? "bg-ink-900 font-semibold text-white"
                          : "bg-white text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                      }`}
                      disabled={isSpinning}
                      onClick={() => { setActiveGroupKey(tab.key); setStatusText(tab.name); }}
                      type="button"
                    >
                      {tab.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Marquee draw — full width, adapts to active tab */}
            <div className="panel-surface overflow-hidden p-3 sm:p-4">
              <MarqueeDraw
                currentLabel={activeCurrentLabel}
                dataKind="wheel"
                disabled={activeMarqueeItems.length === 0}
                drawLabel={activeTab.isPhysical ? "抽取" : "抽取来源"}
                emptyText={activeTab.isPhysical ? "没有可用范围" : "先选择球员"}
                isDrawing={isSpinning}
                items={activeMarqueeItems}
                onDraw={handleActiveWheelSpin}
                selectedId={activeMarqueeSelectedId}
                title={activeTab.isPhysical ? `${activeTab.name} 抽取` : `${activeTab.name} 来源抽取`}
              />
            </div>
            {/* Player card + actions — horizontal bar */}
            <div className="panel-surface overflow-hidden md:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-stretch">
                {/* Draft card */}
                <div className="flex-[2] border-b border-ink-200 bg-ink-50 px-4 py-3 sm:border-b-0 sm:border-r">
                  <div className="section-label">球员卡片</div>
                  {hasGeneratedDraft ? (
                    <>
                      <div className="mt-1 text-[17px] font-semibold">{draft.position} / {draft.height}</div>
                      <div className="text-[12px] text-ink-600">
                        {draft.wingspan} 臂展 · {draft.weight ?? "--"} kg · {draft.shoulderWidth} 肩宽
                      </div>
                      <div className="text-[11px] font-medium text-court-700">
                        {draft.careerStage === "rookie"
                          ? `${rookieTierOptions.find((option) => option.key === draft.rookieTier)?.label ?? "新秀"} · 潜力 ${draft.potential}`
                          : "巅峰模板"}
                      </div>
                      <div className="text-[11px] text-ink-500">
                        {draft.sourceNames.length > 0 ? draft.sourceNames.map(getPlayerNameCN).join(" · ") : "来源待抽取"}
                        {(draft.badgesEstimated || sourceEntries.some(({ player }) => player?.isEstimated)) && (
                          <span className="ml-1 text-amber-700">· 含估算来源</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-1 text-[17px] font-semibold text-ink-500">待抽取</div>
                      <div className="text-[12px] text-ink-500">身高、臂展、体重与来源待抽取</div>
                      <div className="text-[11px] text-ink-400">点击转盘开始生成球员卡片</div>
                    </>
                  )}
                </div>

                {/* Buttons */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:py-0">
                  <button
                    className="action-button px-3 py-2 text-[13px]"
                    onClick={exportDraft} disabled={isSpinning} type="button"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    复制清单
                  </button>
                  <button
                    className="action-button px-3 py-2 text-[13px]"
                    onClick={downloadDraftFile} disabled={isSpinning} type="button"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出文件
                  </button>
                  <button
                    className="action-button px-3 py-2 text-[13px]"
                    onClick={randomizeAll} disabled={isSpinning} type="button"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    全部重抽
                  </button>
                </div>
              </div>

            </div>
          </section>

          {/* BOTTOM — full width */}
          <div className="order-5 flex flex-col gap-2.5 pt-1 md:order-none md:col-span-2">
            <div className="panel-surface overflow-hidden">
              <div className="workspace-toolbar flex items-center justify-between px-3 py-2.5">
                <div className="section-label flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5 text-court-700" />
                  徽章
                </div>
                {draft.sourceNames.length > 0 && (
                  <span className="text-[10px] text-ink-500">
                    {draft.badgesEstimated || sourceEntries.some(({ player }) => player?.isEstimated)
                      ? "含估算属性/徽章"
                      : "2KRatings 详细属性来源"}
                  </span>
                )}
              </div>
              <div className="grid gap-px bg-ink-200 md:grid-cols-2">
                <div className="bg-white px-3 py-2.5">
                  <div className="mb-2 text-[10px] font-semibold text-ink-500">当前徽章</div>
                  <BadgeTokens badges={draft.badges} emptyText="待抽取" />
                </div>
                <div className="bg-white px-3 py-2.5">
                  <div className="mb-2 text-[10px] font-semibold text-ink-500">巅峰徽章</div>
                  <BadgeTokens badges={draft.peakBadges} emptyText="待抽取" />
                </div>
              </div>
            </div>
            <div className="panel-surface overflow-hidden">
              <div className="workspace-toolbar section-label px-3 py-2.5">
                来源分配
              </div>
              <div className="grid grid-cols-2 gap-px bg-ink-200 sm:grid-cols-3 lg:grid-cols-5">
                {sourceEntries.map(({ group, player }) => (
                  <div key={group.key} className="bg-white px-3 py-2 text-center">
                    <div className="text-[10px] font-semibold text-ink-500">{group.name}</div>
                    <div className={`mt-0.5 truncate text-[12px] font-medium ${player ? "text-ink-900" : "text-ink-400"}`}>
                      {player ? getPlayerNameCN(player.name) : "待抽取"}
                    </div>
                    {player?.isEstimated && (
                      <div className="mt-0.5 text-[9px] font-medium text-amber-700">估算属性</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="panel-surface overflow-hidden">
              <div className="workspace-toolbar section-label px-3 py-2.5">
                详细属性 · {detailedAttrs.length} 项
              </div>
              <div className="grid gap-px bg-ink-200 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                {(["shooting","athleticism","playmaking","defense","inside"] as const).map((groupKey: "shooting" | "athleticism" | "playmaking" | "defense" | "inside") => {
                  const group = attrGroupMap[groupKey];
                  const groupAttrs: typeof detailedAttrs = detailedAttrs.filter((a: {label: string}) => (group.attrs as string[]).includes(a.label));
                  if (groupAttrs.length === 0) return null;
                  return (
                    <div key={groupKey} className="bg-white">
                      <div
                        className="px-3 py-1.5 text-[10px] font-semibold"
                        style={{ color: group.color, backgroundColor: group.color + "10" }}
                      >
                        {group.name}
                      </div>
                      <div className="divide-y divide-ink-700/8">
                        {groupAttrs.map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between px-3 py-1.5">
                            <span className="text-[12px] text-ink-600">{attrNameCN[label] ?? label}</span>
                            <span className="text-xs font-semibold text-ink-900 tabular-nums">{value != null ? String(value) : "--"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <footer className="border-t border-ink-200 px-1 py-2.5 text-[10px] leading-5 text-ink-500">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  现役球队名单基于 {lastUpdated} 的 {rosterDataVersion} roster；经典与历史最佳球队保留原存档。无详细属性表的球员会标记为「估算」，由 OVR / 三分 / 扣篮等公开字段推导。
                </p>
                <p className="shrink-0 text-ink-500">
                  反馈入口：中文名、属性翻译或球员缺失可以直接把截图和建议发给作者。
                </p>
              </div>
            </footer>

        </div>
        </div>
        ) : (
          <RookieBuilder key={appMode} mode={appMode} teams={rookieBuilderTeams} />
        )}

      </div>

    </main>
  );
}

export default App;
