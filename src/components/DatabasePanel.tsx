import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Database, Search } from "lucide-react";
import { loadRookieCards, type RookieCard, type RookieCardLookup } from "../rookieCards";
import rosterCatalog from "../data/versions/2k27-play-now/rosterCatalog.json";
import { attrNameCN } from "../domain";
import { badgeTierCN } from "../badgeTiers";
import { getBadgeNameCN } from "../badges";
import { getTendencyNameCN } from "../tendencyNames";
import { attributeGroups, badgeGroups, hotZoneGroups, tendencyGroups } from "../fieldCategories";
import { buildPositionMap, filterCards, positionCN, positionForCard, summarizeCard, yearsWithCards } from "../databaseLogic";
import { getPlayerNameCN } from "../playerNames";
import { valueColor } from "../valueColor";

const ZONE_CN: Record<string, string> = {
  underBasket: "篮下",
  closeLeft: "近距离左侧", closeMiddle: "近距离中央", closeRight: "近距离右侧",
  midLeft: "中距离左侧底角", midLeftCenter: "中距离左侧45度", midCenter: "中距离弧顶",
  midRightCenter: "中距离右侧45度", midRight: "中距离右侧底角",
  threeLeft: "三分左侧底角", threeLeftCenter: "三分左侧45度", threeCenter: "三分弧顶",
  threeRightCenter: "三分右侧45度", threeRight: "三分右侧底角",
};

const ZONE_STATE_CN: Record<string, string> = {
  Hot: "热区", Neutral: "中性", Cold: "冷区",
};

/** attributeGroups 的耐久英文名 → card.durability 的 camelCase key */
const DURABILITY_KEY: Record<string, string> = {
  "Head Durability": "head",
  "Neck Durability": "neck",
  "Back Durability": "back",
  "Left Shoulder Durability": "leftShoulder",
  "Right Shoulder Durability": "rightShoulder",
  "Left Elbow Durability": "leftElbow",
  "Right Elbow Durability": "rightElbow",
  "Left Hip Durability": "leftHip",
  "Right Hip Durability": "rightHip",
  "Left Knee Durability": "leftKnee",
  "Right Knee Durability": "rightKnee",
  "Left Ankle Durability": "leftAnkle",
  "Right Ankle Durability": "rightAnkle",
  "Left Foot Durability": "leftFoot",
  "Right Foot Durability": "rightFoot",
  "Overall Durability": "overall",
};

const rosterPlayers = (rosterCatalog as { teams: Array<{ players: Array<{ name: string; position: string | null }> }> }).teams
  .flatMap((team) => team.players);
const positionMap = buildPositionMap(rosterPlayers);

function inchesToCm(inches: number | null): string {
  if (inches == null) return "--";
  return `${Math.round(inches * 2.54)}cm`;
}

function feetInches(inches: number | null): string {
  if (inches == null) return "--";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function DatabasePanel() {
  const [cards, setCards] = useState<RookieCardLookup | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadRookieCards().then((lookup) => {
      if (active) setCards(lookup);
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, []);

  const years = useMemo(() => yearsWithCards(cards), [cards]);
  const rows = useMemo(() => filterCards(cards, { year, query }), [cards, query, year]);

  const totalCards = cards?.size ?? 0;

  return (
    <div className="database-panel flex min-h-0 flex-col gap-2.5">
      <div className="panel-surface overflow-hidden">
        <div className="workspace-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="draw-status-icon"><Database className="h-3.5 w-3.5" /></span>
              <h2 className="text-[14px] font-semibold text-ink-900">新秀卡数据库</h2>
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-ink-400">
              {loadError ? "新秀卡数据加载失败" : cards ? `共 ${totalCards} 名球员 · ${years.length} 届 · 当前显示 ${rows.length} 名` : "正在加载新秀卡数据…"}
            </div>
          </div>
          <div className="flex min-w-[220px] flex-1 items-center gap-1.5 sm:max-w-[320px]">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            <input
              aria-label="搜索球员"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink-900 outline-none placeholder:text-ink-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索中英文名…"
              type="search"
              value={query}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-ink-200 px-3 py-2">
          <button
            aria-pressed={year === null}
            className={`h-6 rounded-full px-2.5 text-[10px] font-semibold ${year === null ? "bg-court-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}
            onClick={() => setYear(null)}
            type="button"
          >全部</button>
          {years.map((option) => (
            <button
              aria-pressed={year === option}
              className={`h-6 rounded-full px-2.5 text-[10px] font-semibold ${year === option ? "bg-court-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}
              key={option}
              onClick={() => setYear(option)}
              type="button"
            >{option}</button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pb-1">
        {!cards && !loadError && (
          <div className="flex min-h-[240px] items-center justify-center text-[11px] text-ink-400">加载中…</div>
        )}
        {loadError && (
          <div className="flex min-h-[240px] items-center justify-center text-[11px] text-rose-600">新秀卡数据加载失败，请刷新重试</div>
        )}
        {cards && rows.length === 0 && (
          <div className="flex min-h-[240px] items-center justify-center text-[11px] text-ink-400">没有匹配的球员</div>
        )}
        {rows.map((card) => {
          const summary = summarizeCard(card);
          const position = positionCN(positionForCard(card, positionMap));
          const key = `${card.year}:${card.slug}`;
          const expanded = expandedKey === key;
          return (
            <div
              className={`overflow-hidden rounded-[5px] border transition ${expanded ? "border-court-500/40 bg-court-50/40" : "border-ink-200 bg-white"}`}
              key={key}
            >
              <button
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-ink-50"
                onClick={() => setExpandedKey(expanded ? null : key)}
                type="button"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[12px] font-semibold text-ink-800">{summary.name}</span>
                    <span className="truncate text-[9px] text-ink-400">{summary.nameCN}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[9px] text-ink-400">
                    {summary.year} 届{position ? ` · ${position}` : ""}{summary.draftPick != null ? ` · 第 ${summary.draftPick} 顺位` : ""}{summary.team ? ` · ${summary.team}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`text-[15px] font-bold tabular-nums ${summary.overall != null ? valueColor(summary.overall) : "text-ink-400"}`}>{summary.overall ?? "--"}</span>
                  {expanded ? <ChevronDown className="h-3.5 w-3.5 text-ink-300" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-300" />}
                </span>
              </button>
              {expanded && <CardDetails card={card} position={position} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CardDetails({ card, position }: { card: RookieCard; position: string | null }) {
  const summary = summarizeCard(card);
  const handCN = summary.dominantHand === "Left" ? "左手" : summary.dominantHand === "Right" ? "右手" : null;

  return (
    <div className="space-y-3 border-t border-ink-200 bg-ink-50/60 px-3 py-3">
      {/* 资料 + 身体 */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-ink-700">
        <span><b className="text-ink-400">位置：</b>{position ?? "--"}</span>
        <span><b className="text-ink-400">身高：</b>{feetInches(summary.heightInches)}（{inchesToCm(summary.heightInches)}）</span>
        <span><b className="text-ink-400">体重：</b>{summary.weightLb != null ? `${Math.round(summary.weightLb * 0.453592)}kg（${summary.weightLb}lb）` : "--"}</span>
        <span><b className="text-ink-400">臂展：</b>{summary.wingspanCm != null ? `${summary.wingspanCm}cm` : "--"}</span>
        <span><b className="text-ink-400">顺位：</b>{summary.draftPick != null ? `第 ${summary.draftPick} 顺位` : "--"}</span>
        <span><b className="text-ink-400">惯用手：</b>{handCN ?? "--"}</span>
        <span><b className="text-ink-400">新秀球队：</b>{summary.team ?? "--"}</span>
      </div>

      {/* 属性 */}
      <div className="space-y-2">
        <div className="text-[9px] font-semibold text-ink-400">属性</div>
        {attributeGroups.map((group) => {
          const values = group.attrs
            .map((attr) => ({
              attr,
              value: group.key === "durability" ? card.durability[DURABILITY_KEY[attr] ?? ""] : card.detailed[attr],
            }))
            .filter(({ value }) => typeof value === "number");
          if (values.length === 0) return null;
          return (
            <div key={group.key}>
              <div className="mb-0.5 text-[9px] font-semibold text-court-700">{group.label}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                {values.map(({ attr, value }) => (
                  <div className="flex items-center justify-between gap-2" key={attr}>
                    <span className="truncate text-[9px] text-ink-500">{attrNameCN[attr] ?? attr}</span>
                    <span className="shrink-0 text-[10px] font-bold tabular-nums text-ink-700">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 倾向 */}
      <div className="space-y-2">
        <div className="text-[9px] font-semibold text-ink-400">倾向</div>
        {tendencyGroups.map((group) => {
          const values = group.fields
            .map((field) => ({ field, value: card.tendencies[field] }))
            .filter(({ value }) => typeof value === "number");
          if (values.length === 0) return null;
          return (
            <div key={group.key}>
              <div className="mb-0.5 text-[9px] font-semibold text-court-700">{group.label}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
                {values.map(({ field, value }) => (
                  <div className="flex items-center justify-between gap-2" key={field}>
                    <span className="truncate text-[9px] text-ink-500">{getTendencyNameCN(field)}</span>
                    <span className="shrink-0 text-[10px] font-bold tabular-nums text-ink-700">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 热区 */}
      <div className="space-y-1.5">
        <div className="text-[9px] font-semibold text-ink-400">热区</div>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {hotZoneGroups.map((group) => (
            <div key={group.key}>
              <div className="mb-0.5 text-[9px] font-semibold text-court-700">{group.label}</div>
              <div className="space-y-0.5">
                {group.zones.map((zone) => {
                  const state = card.hotZones[zone] ?? "Neutral";
                  const stateCN = ZONE_STATE_CN[state] ?? state;
                  const cls = state === "Hot" ? "text-rose-600 font-semibold" : state === "Cold" ? "text-blue-600" : "text-ink-400";
                  return (
                    <div className="flex items-center justify-between gap-3 border-t border-ink-700/5 py-0.5 text-[9px]" key={zone}>
                      <span className="text-ink-500">{ZONE_CN[zone] ?? zone}</span>
                      <span className={`${cls} w-6 text-right`}>{stateCN}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 徽章 */}
      <div className="space-y-2">
        <div className="text-[9px] font-semibold text-ink-400">徽章</div>
        {card.badges.length === 0 && <div className="text-[9px] text-ink-400">无</div>}
        {badgeGroups.map((group) => {
          const matched = card.badges.filter((badge) => group.badges.includes(badge.name));
          if (matched.length === 0) return null;
          return (
            <div key={group.key}>
              <div className="mb-0.5 text-[9px] font-semibold text-court-700">{group.label}</div>
              <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
                {matched.map((badge) => (
                  <span className="flex items-center justify-between gap-2 rounded-[3px] bg-ink-100 px-2 py-1 text-[9px] font-semibold text-ink-600" key={badge.name}>
                    <span className="truncate">{getBadgeNameCN(badge.name)}</span>
                    <span className="shrink-0 text-ink-400">{badgeTierCN[badge.tier as keyof typeof badgeTierCN] ?? badge.tier}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DatabasePanel;
