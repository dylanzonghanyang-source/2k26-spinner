import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Users, X } from "lucide-react";
import type { Bundle } from "../createResult";
import type { RookieCard, RookieCardLookup } from "../rookieCards";
import { cardsByYear, slotAttrsForCard, slotValueForCard, yearsInLookup } from "../rookieCardBrowser";
import { getPlayerNameCN } from "../playerNames";
import { valueColor } from "../valueColor";

type SlotPickerProps = {
  bundle: Bundle;
  rookieCards: RookieCardLookup | null;
  onClose: () => void;
  onPick: (card: RookieCard) => void;
};

type EntryTab = "rookie" | "all" | "classic";

function SlotPicker({ bundle, rookieCards, onClose, onPick }: SlotPickerProps) {
  const years = useMemo(() => yearsInLookup(rookieCards), [rookieCards]);
  const [tab, setTab] = useState<EntryTab>("rookie");
  const [year, setYear] = useState<number | null>(years[0] ?? null);
  const [query, setQuery] = useState("");

  // 数据加载完成后默认选中最新年份
  useEffect(() => {
    if (year === null && years.length > 0) setYear(years[0]);
  }, [year, years]);

  const yearCards = useMemo(
    () => (year !== null ? cardsByYear(rookieCards, year) : []),
    [rookieCards, year],
  );

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return yearCards;
    return yearCards.filter((card) =>
      card.name.toLowerCase().includes(q)
      || getPlayerNameCN(card.name).toLowerCase().includes(q),
    );
  }, [query, yearCards]);

  const disabledTab = (entry: EntryTab) => entry !== "rookie";

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-ink-900/35 px-4 py-6" role="presentation">
      <section
        aria-label={`为${bundle.label}槽位选择球员`}
        aria-modal="true"
        className="dialog-surface flex w-full max-w-[560px] h-[min(82vh,860px)] flex-col overflow-hidden rounded-[7px] border border-ink-300 bg-white shadow-xl"
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
            <div className="flex max-h-[28vh] flex-wrap gap-1.5 overflow-y-auto border-b border-ink-200 px-3 py-2" style={{ WebkitOverflowScrolling: "touch" }}>
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
              {filteredCards.length === 0 && (
                <div className="py-8 text-center text-[11px] text-ink-400">
                  {year === null ? "暂无新秀卡数据" : `${year} 届没有匹配的新秀`}
                </div>
              )}
              {filteredCards.map((card) => {
                const slotValue = slotValueForCard(card, bundle);
                const attrs = slotAttrsForCard(card, bundle);
                return (
                  <button
                    className="interactive-card flex w-full items-center gap-2 rounded-[5px] border border-ink-200 bg-white px-2.5 py-2 text-left hover:border-ink-400 hover:bg-ink-50"
                    key={card.slug}
                    onClick={() => onPick(card)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate text-[11px] font-semibold text-ink-800">{card.name}</span>
                        <span className="truncate text-[9px] text-ink-400">{getPlayerNameCN(card.name)}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] text-ink-400">
                        {attrs.map(({ attr, value }) => `${attr}: ${value ?? "--"}`).join(" · ")}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {slotValue !== null && (
                        <span className={`text-[13px] font-bold tabular-nums ${valueColor(slotValue)}`}>{slotValue}</span>
                      )}
                      <span className={`text-[15px] font-bold tabular-nums ${card.overall != null ? valueColor(card.overall) : "text-ink-400"}`}>{card.overall ?? "--"}</span>
                      <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-ink-300" />
                    </span>
                  </button>
                );
              })}
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
