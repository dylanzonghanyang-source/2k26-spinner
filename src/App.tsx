import { Award, Moon, Sun, UserRoundPlus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import RookieBuilder, { type RookieBuilderTeam } from "./components/RookieBuilder";
import appLogo from "./assets/2kspinner-logo.png";
import {
  type PlayerSource,
  type PlayerBadge,
} from "./domain";
import rosterCatalog2k26 from "./data/versions/2k26/rosterCatalog.json";
import rosterCatalog2k27 from "./data/versions/2k27-play-now/rosterCatalog.json";
import badgeProfiles2k26 from "./data/versions/2k26/badges.json";
import detailedPlayers2k26 from "./data/versions/2k26/players.json";

const appVersion = "v0.6.2";
const lastUpdated = "2026-08-02";

type AppMode = "rookie" | "prime" | "custom";
type Theme = "light" | "dark";

const themeStorageKey = "2kspinner-theme";
const legacyThemeStorageKey = "2k26-spinner-theme";
type DataVersion = "2k26" | "2k27";

function getInitialDataVersion(): DataVersion {
  return "2k26";
}

// Some browsers/contexts (privacy sandbox, restricted iframes, certain
// enterprise policies) throw SecurityError on any Storage access. Both
// the initial read and the subsequent write in the effect must survive.
function safeGetStorageItem(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeSetStorageItem(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

function safeRemoveStorageItem(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* storage blocked */ }
}

function getInitialTheme(): Theme {
  const savedTheme = safeGetStorageItem(themeStorageKey)
    ?? safeGetStorageItem(legacyThemeStorageKey);
  if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
  return "dark";
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

type RosterCategory = "current" | "classic" | "allTime";
type RosterCatalogPlayer = {
  id: string;
  name: string;
  position: string | null;
  height: string | null;
  overall: number | null;
  potential?: number | null;
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
  potential?: number | null;
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
type RosterCatalogData = {
  version: string;
  source: string;
  generatedAt: string;
  teams: RosterCatalogTeam[];
};

function canonicalPlayerName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const peakPotentialByName = (() => {
  const result = new Map<string, number>();
  const catalogs = [rosterCatalog2k26 as RosterCatalogData, rosterCatalog2k27 as RosterCatalogData];
  for (const catalog of catalogs) {
    for (const team of catalog.teams) {
      for (const player of team.players) {
        if (typeof player.overall !== "number" || !Number.isFinite(player.overall)) continue;
        const key = canonicalPlayerName(player.name);
        const previous = result.get(key) ?? 0;
        result.set(key, Math.max(previous, player.overall));
      }
    }
  }
  return result;
})();
type VersionData = {
  label: string;
  rosterCatalog: RosterCatalogData;
  badgeProfiles: BadgeProfileMap;
  detailedPlayers: DetailedPlayerRecord[];
  tendenciesAvailable: boolean;
};

// 2K26 data is always loaded (it's the default/only open version).
// 2K27 badge/player data is lazy-loaded only when the user switches to 2K27,
// keeping ~615 KB of chunks out of the initial page load.
const versionData2k26: VersionData = {
  label: "NBA 2K26 数据 · 最新阵容",
  rosterCatalog: rosterCatalog2k27 as RosterCatalogData,
  badgeProfiles: badgeProfiles2k26 as BadgeProfileMap,
  detailedPlayers: detailedPlayers2k26 as DetailedPlayerRecord[],
  tendenciesAvailable: true,
};

let versionData2k27Promise: Promise<VersionData> | null = null;
function loadVersionData2k27(): Promise<VersionData> {
  versionData2k27Promise ??= Promise.all([
    import("./data/versions/2k27-play-now/badges.json"),
    import("./data/versions/2k27-play-now/players.json"),
  ]).then(([badgesModule, playersModule]) => ({
    label: "NBA 2K27 数据 · 最新阵容",
    rosterCatalog: rosterCatalog2k27 as RosterCatalogData,
    badgeProfiles: badgesModule.default as BadgeProfileMap,
    detailedPlayers: playersModule.default as DetailedPlayerRecord[],
    tendenciesAvailable: false,
  }));
  return versionData2k27Promise;
}


function clampRating(value: number) {
  return Math.max(25, Math.min(99, Math.round(value)));
}

function rosterPlayerSource(
  team: RosterCatalogTeam,
  player: RosterCatalogPlayer,
  badgeProfiles: BadgeProfileMap,
  detailedPlayerBySlug: Map<string, DetailedPlayerRecord>,
): PlayerSource {
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
    badges: badgeProfiles[player.id] ?? [],
    badgesKnown: Object.hasOwn(badgeProfiles, player.id),
    overall,
    potential: player.potential
      ?? detailedPlayer?.potential
      ?? peakPotentialByName.get(canonicalPlayerName(player.name))
      ?? null,
    team: team.name,
    position: player.position,
    archetype: null,
    height: player.height,
    // Detailed-player body measurements (players.json) feed the source body
    // used by applyBodyConstraints(). Without weight/wingspan the source body
    // resolves to null and body-mismatch penalties silently never run.
    weight: detailedPlayer?.weight ?? null,
    wingspan: detailedPlayer?.wingspan ?? null,
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

const App = () => {
  const [appMode, setAppMode] = useState<AppMode>("rookie");
  const [builderFlowActive, setBuilderFlowActive] = useState(false);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const handleBuilderFlowActiveChange = useCallback((active: boolean) => {
    setBuilderFlowActive(active);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    safeSetStorageItem(themeStorageKey, theme);
    safeRemoveStorageItem(legacyThemeStorageKey);
  }, [theme]);
  const [dataVersion, setDataVersion] = useState<DataVersion>(getInitialDataVersion);
  const [versionData2k27, setVersionData2k27] = useState<VersionData | null>(null);

  // Pre-fetch 2K27 data in the background once the builder is idle so the
  // toggle (when it opens) feels instant. Never blocks initial render.
  useEffect(() => {
    let active = true;
    loadVersionData2k27().then((data) => {
      if (active) setVersionData2k27(data);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const activeVersionData = dataVersion === "2k26"
    ? versionData2k26
    : (versionData2k27 ?? versionData2k26);
  const catalogTeams = activeVersionData.rosterCatalog.teams;
  const rosterDataVersion = activeVersionData.label;
  const sourceBadgeProfiles = activeVersionData.badgeProfiles;
  const detailedPlayerBySlug = useMemo(
    () => new Map(activeVersionData.detailedPlayers.map((player) => [player.slug, player])),
    [activeVersionData],
  );

  const defaultCurrentPlayerPool = useMemo(
    () => catalogTeams
      .filter((team) => team.category === "current")
      .flatMap((team) => team.players.map((player) => rosterPlayerSource(team, player, sourceBadgeProfiles, detailedPlayerBySlug))),
    [catalogTeams, detailedPlayerBySlug, sourceBadgeProfiles],
  );

  const historicalPlayerPool = useMemo(
    () => catalogTeams
      .filter((team) => team.category === "classic" || team.category === "allTime")
      .flatMap((team) => team.players.map((player) => rosterPlayerSource(team, player, sourceBadgeProfiles, detailedPlayerBySlug))),
    [catalogTeams, detailedPlayerBySlug, sourceBadgeProfiles],
  );

  const allPlayerPool = useMemo(
    () => [...defaultCurrentPlayerPool, ...historicalPlayerPool],
    [defaultCurrentPlayerPool, historicalPlayerPool],
  );


  const rookieBuilderTeams = useMemo<RookieBuilderTeam[]>(
    () => catalogTeams
      .filter((team) => team.category === "current" && team.players.length > 0)
      .map((team) => ({
        id: team.id,
        name: team.name,
        players: team.players.map((player) => rosterPlayerSource(team, player, sourceBadgeProfiles, detailedPlayerBySlug)),
      })),
    [catalogTeams, detailedPlayerBySlug, sourceBadgeProfiles],
  );

  return (
    <main className="min-h-screen text-ink-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1520px] flex-col gap-2.5 px-2.5 py-2.5 sm:px-4 sm:py-3">

        {/* Header */}
        <header className="app-header">
          <div className="flex min-w-0 shrink-0 items-center gap-2.5">
            <div className="brand-mark" aria-hidden="true">
              <img alt="" src={appLogo} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[14px] font-semibold text-ink-900">2KSpinner</h1>
              <div className="mt-0.5 truncate text-[9px] text-ink-500">
                {appMode === "rookie" ? "球队抽选 · 新秀构建" : appMode === "prime" ? "球队抽选 · 巅峰构建" : appMode === "custom" ? "手动选源 · 新秀构建" : "能力组合 · 球员抽选"}
              </div>
            </div>
          </div>

          <nav className="mode-nav" aria-label="选择模式">
            <button aria-pressed={appMode === "rookie"} className="mode-nav-button" data-active={appMode === "rookie"} disabled={builderFlowActive} onClick={() => setAppMode("rookie")} title={builderFlowActive ? "当前正在生成，请先点击“重新开始”" : undefined} type="button">
              <UserRoundPlus className="h-3.5 w-3.5" />
              <span className="lg:hidden">新秀</span>
              <span className="hidden lg:inline">随机新秀</span>
            </button>
            <button aria-pressed={appMode === "prime"} className="mode-nav-button" data-active={appMode === "prime"} disabled={builderFlowActive} onClick={() => setAppMode("prime")} title={builderFlowActive ? "当前正在生成，请先点击“重新开始”" : undefined} type="button">
              <Award className="h-3.5 w-3.5" />
              <span className="lg:hidden">巅峰</span>
              <span className="hidden lg:inline">生成巅峰球员</span>
            </button>
            <button aria-pressed={appMode === "custom"} className="mode-nav-button" data-active={appMode === "custom"} disabled={builderFlowActive} onClick={() => setAppMode("custom")} title={builderFlowActive ? "当前正在生成，请先点击“重新开始”" : "逐项为属性槽选择来源球员"} type="button">
              <UsersRound className="h-3.5 w-3.5" />
              <span className="lg:hidden">自选</span>
              <span className="hidden lg:inline">自选来源</span>
            </button>
          </nav>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <span className="meta-chip">最新阵容 · {dataVersion === "2k26" ? "2K26 数据" : "2K27 数据"}</span>
            <span className="meta-chip hidden sm:inline-flex">{appVersion} / {lastUpdated}</span>
            <div className="data-version-toggle" role="radiogroup" aria-label="数据版本">
              <button
                aria-checked={dataVersion === "2k26"}
                aria-label="切换到 2K26 数据"
                className={`version-option ${dataVersion === "2k26" ? "version-active" : ""}`}
                disabled={builderFlowActive}
                onClick={() => setDataVersion("2k26")}
                role="radio"
                type="button"
              >
                2K26
              </button>
              <button
                aria-checked={dataVersion === "2k27"}
                aria-label="2K27 数据（暂未开放）"
                className={`version-option ${dataVersion === "2k27" ? "version-active" : ""}`}
                disabled
                onClick={() => setDataVersion("2k27")}
                role="radio"
                title="2K27 数据暂未开放"
                type="button"
              >
                2K27
              </button>
            </div>
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
              {appMode === "rookie" ? "新秀生成" : appMode === "prime" ? "巅峰生成" : "手动选源"}
            </span>
          </div>
        </header>

        <RookieBuilder
            key={`${appMode}:${dataVersion}`}
            dataVersionLabel={rosterDataVersion}
            mode={appMode === "prime" ? "prime" : "rookie"}
            selectionMode={appMode === "custom" ? "manual" : "random"}
            availablePlayers={allPlayerPool}
            onFlowActiveChange={handleBuilderFlowActiveChange}
            overallVersion={dataVersion}
            teams={rookieBuilderTeams}
            tendencyVersion={dataVersion}
          />

      </div>

    </main>
  );
}

export default App;
