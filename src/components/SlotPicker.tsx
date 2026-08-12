import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Users, X } from "lucide-react";
import { evaluate, type Bundle, type Position } from "../createResult";
import type { RookieCard, RookieCardLookup } from "../rookieCards";
import { cardsByYear, slotAttrsForCard, slotValueForCard, yearsInLookup } from "../rookieCardBrowser";
import { getPlayerNameCN } from "../playerNames";
import { attrNameCN } from "../domain";
import { valueColor } from "../valueColor";
import { useModalBehavior } from "../useModalBehavior";
import { cardToPlayerSource } from "../rookieCardSource";
import type { BuilderBody } from "../rookieBodyConstraints";
import { cardSourceBody } from "../createResult";

type SlotPickerProps = {
  bundle: Bundle;
  rookieCards: RookieCardLookup | null;
  onClose: () => void;
  onPick: (card: RookieCard) => void;
  /** 目标位置/身体：用于展示该卡在生成路径下的衰减后（身体约束后）属性。 */
  targetPosition: Position;
  secondaryPosition: Position | null;
  body: BuilderBody;
  skipBody: boolean;
};

type EntryTab = "rookie" | "all" | "classic";

function SlotPicker({ bundle, rookieCards, onClose, onPick, targetPosition, secondaryPosition, body, skipBody }: SlotPickerProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useModalBehavior(true, dialogRef, onClose);
  const years = useMemo(() => yearsInLookup(rookieCards), [rookieCards]);
  const [tab, setTab] = useState<EntryTab>("rookie");
  const [year, setYear] = useState<number | null>(years[0] ?? null);
  const [query, setQuery] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("ALL");
  // 手机端（<768px）两步流程：先选选秀届，再选球员，可返回
  const [mobileStep, setMobileStep] = useState<"years" | "players">("years");

  // 数据加载完成后默认选中最新年份
  useEffect(() => {
    if (year === null && years.length > 0) setYear(years[0]);
  }, [year, years]);

  const isMobileView = typeof window !== "undefined" && window.matchMedia("(max-width: 767.98px)").matches;

  const selectYear = (next: number) => {
    setYear(next);
    if (isMobileView) setMobileStep("players");
  };

  const yearCards = useMemo(
    () => (year !== null ? cardsByYear(rookieCards, year) : []),
    [rookieCards, year],
  );

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return yearCards.filter((card) => {
      if (positionFilter !== "ALL") {        // 卡位置为单一格式（如 "PG"），按第一位置匹配，兼容未来的双位置格式
        const firstPosition = card.position?.split("/")[0]?.trim().toUpperCase();
        if (firstPosition !== positionFilter) return false;
      }
      if (q && !(card.name.toLowerCase().includes(q) || getPlayerNameCN(card.name).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [positionFilter, query, yearCards]);

  // 排序模式：顺位（默认）/ 槽位主值 / 综评 / 适配后值
  const [sortMode, setSortMode] = useState<"pick" | "slot" | "ovr" | "adapted">("pick");

  // 衰减后属性：按生成路径（目标位置/身体/skipBody + 卡自身身体）计算每个候选
  // 卡在该槽位下的身体约束后值，让"挑人"时看到的就是锁定后的实际生成值。
  const decayedBySlug = useMemo(() => {
    const map = new Map<string, { adjusted: number; raw: number; values: Record<string, number> }>();
    for (const card of filteredCards) {
      const source = cardToPlayerSource(card);
      const evaluation = evaluate(source, bundle, body, card, {
        targetPosition,
        secondaryPosition,
        skipBody,
      }, cardSourceBody(card));
      map.set(card.slug, {
        adjusted: evaluation.adjusted,
        raw: evaluation.raw,
        values: evaluation.values,
      });
    }
    return map;
  }, [body, bundle, filteredCards, secondaryPosition, skipBody, targetPosition]);

  const sortedCards = useMemo(() => {
    const cards = [...filteredCards];
    if (sortMode === "pick") {
      cards.sort((a, b) => {
        const pickOf = (card: RookieCard) => {
          const raw = Number(card.vitals?.draftPick);
          return Number.isFinite(raw) && raw > 0 ? raw : 999;
        };
        return pickOf(a) - pickOf(b) || a.name.localeCompare(b.name);
      });
    } else if (sortMode === "slot") {
      cards.sort((a, b) => (
        (slotValueForCard(b, bundle) ?? -1) - (slotValueForCard(a, bundle) ?? -1)
      ) || a.name.localeCompare(b.name));
    } else if (sortMode === "ovr") {
      cards.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.name.localeCompare(b.name));
    } else if (sortMode === "adapted") {
      const adapted = (card: RookieCard) => decayedBySlug.get(card.slug)?.adjusted ?? slotValueForCard(card, bundle) ?? -1;
      cards.sort((a, b) => adapted(b) - adapted(a) || a.name.localeCompare(b.name));
    }
    return cards;
  }, [bundle, decayedBySlug, filteredCards, sortMode]);

  const disabledTab = (entry: EntryTab) => entry !== "rookie";

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
      <section
        aria-label={`为${bundle.label}槽位选择球员`}
        aria-modal="true"
        className="dialog-surface flex w-full max-w-[640px] h-[min(82vh,860px)] flex-col overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl"
        ref={dialogRef}
        role="dialog"
      >
        <div className="workspace-toolbar flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <div className="section-label">为「{bundle.label}」槽位选择球员</div>
            <div className="truncate text-[9px] text-ink-400">点击新秀后继承其属性到该槽位</div>
          </div>
          <button aria-label="关闭球员选择" className="dialog-close-button flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-ink-500 hover:bg-ink-200 hover:text-ink-800" onClick={onClose} type="button"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-px border-t border-ink-200 bg-ink-200 px-2 pt-2" role="tablist" aria-label="球员来源">
          <button
            aria-selected={tab === "rookie"}
            className={`segmented-button h-7 flex-1 rounded-t-[5px] text-[10px] font-semibold ${tab === "rookie" ? "bg-ink-900 text-white" : "bg-white text-ink-500 hover:bg-ink-50"}`}
            onClick={() => setTab("rookie")}
            role="tab"
            type="button"
          >新秀（{years.length} 届）</button>
          <button
            aria-selected={tab === "all"}
            className="segmented-button h-7 flex-1 cursor-not-allowed rounded-t-[5px] text-[10px] font-semibold bg-ink-50 text-ink-300"
            disabled
            role="tab"
            title="暂无全量球员数据"
            type="button"
          >全部球员（暂无数据）</button>
          <button
            aria-selected={tab === "classic"}
            className="segmented-button h-7 flex-1 cursor-not-allowed rounded-t-[5px] text-[10px] font-semibold bg-ink-50 text-ink-300"
            disabled
            role="tab"
            title="暂无经典球员数据"
            type="button"
          >经典球员（暂无数据）</button>
        </div>

        {tab === "rookie" && (
          <>
            <div className="flex min-h-0 min-w-0 flex-1">
              {/* 选秀届列：桌面常驻左栏；手机端为第一步（选完进入球员列表可返回） */}
              <div className={`min-h-0 flex-col overflow-hidden border-ink-200 md:flex md:w-[190px] md:shrink-0 md:border-r ${mobileStep === "years" ? "flex flex-1" : "hidden"}`}>
                <div className="px-3 pb-1 pt-2.5 text-[9px] font-semibold text-ink-400">选秀届</div>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 md:px-2.5" style={{ WebkitOverflowScrolling: "touch" }}>
                  {years.map((option) => (
                    <button
                      aria-pressed={year === option}
                      className={`mb-1 flex h-8 w-full items-center rounded-[5px] px-2.5 text-[11px] font-semibold ${year === option ? "bg-court-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}
                      key={option}
                      onClick={() => selectYear(option)}
                      type="button"
                    >{option}</button>
                  ))}
                </div>
              </div>

              {/* 球员区：桌面常驻右栏；手机端为第二步 */}
              <div className={`min-h-0 min-w-0 flex-1 flex-col ${mobileStep === "players" ? "flex" : "hidden md:flex"}`}>
                {/* 手机端返回入口 */}
                {mobileStep === "players" && (
                  <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2 md:hidden">
                    <button
                      aria-label="返回选择选秀届"
                      className="flex h-7 items-center gap-1 rounded-[5px] border border-ink-200 bg-ink-50 px-2 text-[10px] font-semibold text-ink-600 hover:bg-ink-100"
                      onClick={() => setMobileStep("years")}
                      type="button"
                    ><ArrowLeft className="h-3.5 w-3.5" />选秀届</button>
                    <span className="truncate text-[11px] font-semibold text-ink-700">{year ?? "--"} 届新秀</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5 border-b border-ink-200 px-3 py-2">
                  <span className="shrink-0 text-[9px] font-semibold text-ink-400">位置</span>
                  {(["ALL", "PG", "SG", "SF", "PF", "C"] as const).map((pos) => (
                    <button
                      aria-pressed={positionFilter === pos}
                      className={`h-6 rounded-full px-2.5 text-[10px] font-semibold ${positionFilter === pos ? "bg-court-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}
                      key={pos}
                      onClick={() => setPositionFilter(pos)}
                      type="button"
                    >{pos === "ALL" ? "全部" : pos}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 border-b border-ink-200 px-3 py-2">
                  <span className="shrink-0 text-[9px] font-semibold text-ink-400">排序</span>
                  {([["pick", "顺位"], ["slot", "槽位主值"], ["ovr", "综评"], ["adapted", "适配后"]] as const).map(([mode, label]) => (
                    <button
                      aria-pressed={sortMode === mode}
                      className={`h-6 rounded-full px-2.5 text-[10px] font-semibold ${sortMode === mode ? "bg-court-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"}`}
                      key={mode}
                      onClick={() => setSortMode(mode)}
                      type="button"
                    >{label}</button>
                  ))}
                </div>
                <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
                  <input
                    aria-label="筛选新秀"
                    className="h-7 w-full rounded-[5px] border border-ink-200 bg-ink-50 px-2 text-[11px] text-ink-800 outline-none focus:border-court-500 focus:bg-white"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`筛选 ${year ?? "--"} 届新秀（中英文名）`}
                    type="search"
                    value={query}
                  />
                </div>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3" style={{ WebkitOverflowScrolling: "touch" }}>
                    {sortedCards.length === 0 && (
                      <div className="py-8 text-center text-[11px] text-ink-400">
                        {year === null ? "暂无新秀卡数据" : `${year} 届没有匹配的新秀`}
                      </div>
                    )}
                    {sortedCards.map((card) => {
                      const slotValue = slotValueForCard(card, bundle);
                      const attrs = slotAttrsForCard(card, bundle);
                      // 衰减后值：与生成路径一致（身体约束后）；有差异时显示 原→衰减
                      const decayed = decayedBySlug.get(card.slug);
                      const decayedAttr = (attr: string) => decayed?.values[attr] ?? null;
                      return (
                        <button
                          className="interactive-card flex w-full items-center gap-2 rounded-[5px] border border-ink-200 bg-white px-2.5 py-2 text-left hover:border-ink-400 hover:bg-ink-50"
                          key={card.slug}
                          onClick={() => onPick(card)}
                          title={decayed && decayed.adjusted !== decayed.raw ? `含身体/位置修正：${decayed.raw} → ${decayed.adjusted}` : undefined}
                          type="button"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-1.5">
                              <span className="truncate text-[12px] font-semibold text-ink-800">{getPlayerNameCN(card.name)}</span>
                              <span className="truncate text-[9px] text-ink-400">{card.name}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-[9px] text-ink-400">
                              {attrs.map(({ attr, value }) => {
                                const after = decayedAttr(attr);
                                const display = after != null && value != null && after !== value ? `${value}→${after}` : (after ?? value ?? "--");
                                return `${attrNameCN[attr] ?? attr}: ${display}`;
                              }).join(" · ")}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2.5">
                            {slotValue !== null && (
                              <span className="flex items-baseline gap-1">
                                <span className="text-[8px] font-medium text-ink-400">槽位主值</span>
                                <span className={`text-[13px] font-bold tabular-nums ${valueColor(decayed?.adjusted ?? slotValue)}`}>{decayed?.adjusted ?? slotValue}</span>
                                {decayed && decayed.adjusted !== decayed.raw && (
                                  <span className="text-[8px] tabular-nums text-ink-300">{decayed.raw}</span>
                                )}
                              </span>
                            )}
                            <span className="flex items-baseline gap-1">
                              <span className="text-[8px] font-medium text-ink-400">综评</span>
                              <span className={`text-[15px] font-bold tabular-nums ${card.overall != null ? valueColor(card.overall) : "text-ink-400"}`}>{card.overall ?? "--"}</span>
                            </span>
                            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-300" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-ink-200 bg-ink-50 px-3 py-2.5">
              <span className="flex items-center gap-1 text-[10px] text-ink-500"><Users className="h-3 w-3" />{filteredCards.length} 名新秀</span>
              <button className="action-button px-3 py-1.5 text-[10px]" onClick={onClose} type="button">取消</button>
            </div>
          </>
        )}
        {tab !== "rookie" && (
          <div className="flex flex-1 items-center justify-center py-10 text-[11px] text-ink-400">
            {tab === "all" ? "全量球员数据尚未接入，请使用「新秀」入口" : "经典球员数据尚未接入，请使用「新秀」入口"}
          </div>
        )}
      </section>
    </div>
  );
}

export default SlotPicker;
