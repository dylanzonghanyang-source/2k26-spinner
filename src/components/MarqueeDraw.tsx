import { ChevronDown, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type MarqueeDrawItem = {
  id: string;
  imageSrc?: string;
  label: string;
  mark?: string;
  meta?: string;
};

type MarqueeDrawProps = {
  currentLabel?: string;
  dataKind: "team" | "wheel";
  disabled?: boolean;
  durationMs?: number;
  drawLabel?: string;
  emptyText: string;
  isDrawing: boolean;
  items: MarqueeDrawItem[];
  onDraw?: () => void;
  precedingItems?: number;
  selectedId?: string;
  title: string;
};

function nearbyItems(items: MarqueeDrawItem[], selectedIndex: number, precedingItems: number) {
  if (items.length === 0) return [];
  if (selectedIndex < 0) {
    return items.slice(0, Math.min(3, items.length)).map((item, index) => ({
      ...item,
      railId: `${index}:${item.id}`,
      selected: false,
    }));
  }

  const itemCount = Math.max(5, precedingItems + 5);
  return Array.from({ length: itemCount }, (_, index) => {
    const sourceIndex = (selectedIndex - precedingItems + index + items.length * itemCount) % items.length;
    return { ...items[sourceIndex], railId: `${index}:${items[sourceIndex].id}`, selected: index === precedingItems };
  });
}

function MarqueeDraw({
  currentLabel,
  dataKind,
  disabled = false,
  durationMs = 1240,
  drawLabel = "抽取",
  emptyText,
  isDrawing,
  items,
  onDraw,
  precedingItems = 4,
  selectedId,
  title,
}: MarqueeDrawProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const [settled, setSettled] = useState(!isDrawing);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const railItems = useMemo(() => nearbyItems(items, selectedIndex, precedingItems), [items, precedingItems, selectedIndex]);
  const hasItems = items.length > 0;
  const hasSelection = selectedIndex >= 0;
  const canDraw = Boolean(onDraw) && !disabled && !isDrawing && hasItems;

  useEffect(() => {
    const track = trackRef.current;
    const rail = railRef.current;
    if (!track || !rail || !hasItems) return;

    animationRef.current?.cancel();
    const alignSelection = () => {
      const selected = selectedRef.current;
      rail.style.transform = "translateX(0)";
      if (!selected) return;

      const trackRect = track.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const finalOffset = trackRect.left + trackRect.width / 2 - (selectedRect.left + selectedRect.width / 2);
      rail.style.transform = `translateX(${finalOffset}px)`;
    };

    if (!hasSelection) {
      setSettled(true);
      return;
    }

    alignSelection();
    if (!isDrawing) {
      setSettled(true);
      const resizeObserver = new ResizeObserver(alignSelection);
      resizeObserver.observe(track);
      return () => resizeObserver.disconnect();
    }

    setSettled(false);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setSettled(true);
      return;
    }

    const selected = selectedRef.current;
    if (!selected) return;
    rail.style.transform = "translateX(0)";
    const trackRect = track.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const finalOffset = trackRect.left + trackRect.width / 2 - (selectedRect.left + selectedRect.width / 2);
    const startOffset = finalOffset + Math.max(
      selectedRect.left - rail.getBoundingClientRect().left,
      Math.min(520, trackRect.width * 0.9),
    );
    rail.style.transform = `translateX(${startOffset}px)`;
    animationRef.current = rail.animate([
      { transform: `translateX(${startOffset}px)` },
      { transform: `translateX(${finalOffset - 38}px)`, offset: 0.72 },
      { transform: `translateX(${finalOffset + 12}px)`, offset: 0.87 },
      { transform: `translateX(${finalOffset}px)` },
    ], {
      duration: durationMs,
      easing: "cubic-bezier(0.2, 0.7, 0.15, 1)",
      fill: "forwards",
    });
    const settleTimer = window.setTimeout(() => setSettled(true), durationMs * 0.84);

    return () => {
      window.clearTimeout(settleTimer);
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [durationMs, hasItems, hasSelection, isDrawing, railItems]);

  return (
    <div
      aria-busy={isDrawing}
      className="marquee-draw"
      data-drawing={isDrawing}
      data-has-selection={hasSelection}
      data-kind={dataKind}
      data-settled={settled}
      data-testid="marquee-draw"
    >
      <span aria-live="polite" className="sr-only" role="status">
        {isDrawing ? `${title}正在筛选` : hasSelection ? `${title}结果：${currentLabel ?? selectedId}` : `${title}待抽取`}
      </span>
      <div className="marquee-draw-header">
        <span>{title}</span>
        <span className="marquee-draw-status">{isDrawing ? "正在筛选" : hasSelection ? currentLabel ?? emptyText : "待抽取"}</span>
      </div>
      <div className="marquee-draw-track" ref={trackRef}>
        <div className="marquee-draw-pointer" aria-hidden="true"><ChevronDown /></div>
        <div className="marquee-draw-rail" ref={railRef}>
          {railItems.map((item) => (
            <div
              className="marquee-draw-item"
              data-selected={item.selected}
              key={item.railId}
              ref={item.selected ? selectedRef : undefined}
            >
              <span className="marquee-draw-mark">
                {item.imageSrc && <img alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} src={item.imageSrc} />}
                <span>{item.mark ?? item.label.slice(0, 2)}</span>
              </span>
              <span className="marquee-draw-copy">
                <strong>{item.label}</strong>
                {item.meta && <small>{item.meta}</small>}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="marquee-draw-footer">
        <span>{hasItems ? `${items.length} 个候选` : emptyText}</span>
        {onDraw && (
          <button disabled={!canDraw} onClick={onDraw} type="button">
            <Shuffle aria-hidden="true" />
            {isDrawing ? "抽取中" : drawLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default MarqueeDraw;
