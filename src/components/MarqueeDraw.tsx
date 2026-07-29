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

function nearbyItems(
  items: MarqueeDrawItem[],
  selectedIndex: number,
  precedingItems: number,
  revealWinner: boolean,
) {
  if (items.length === 0) return [];
  if (selectedIndex < 0) {
    return items.slice(0, Math.min(3, items.length)).map((item, index) => ({
      ...item,
      railId: `${index}:${item.id}`,
      selected: false,
    }));
  }

  // Longer rails feel more random when the animation duration is extended.
  const itemCount = Math.max(9, precedingItems + 8);
  return Array.from({ length: itemCount }, (_, index) => {
    const sourceIndex = (selectedIndex - precedingItems + index + items.length * itemCount) % items.length;
    return {
      ...items[sourceIndex],
      railId: `${index}:${items[sourceIndex].id}`,
      // Keep the winner in the center slot for animation, but only mark it
      // as selected after the draw settles so the result is not leaked early.
      selected: revealWinner && index === precedingItems,
    };
  });
}

function MarqueeDraw({
  currentLabel,
  dataKind,
  disabled = false,
  durationMs = 3200,
  drawLabel = "抽取",
  emptyText,
  isDrawing,
  items,
  onDraw,
  precedingItems = 8,
  selectedId,
  title,
}: MarqueeDrawProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const [settled, setSettled] = useState(!isDrawing);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const revealWinner = settled && !isDrawing;
  const railItems = useMemo(
    () => nearbyItems(items, selectedIndex, precedingItems, revealWinner),
    [items, precedingItems, revealWinner, selectedIndex],
  );
  const hasItems = items.length > 0;
  const hasSelection = selectedIndex >= 0;
  const canDraw = Boolean(onDraw) && !disabled && !isDrawing && hasItems;
  const statusText = isDrawing || (hasSelection && !settled)
    ? "正在筛选"
    : hasSelection
      ? currentLabel ?? emptyText
      : "待抽取";
  const liveStatus = isDrawing || (hasSelection && !settled)
    ? `${title}正在筛选`
    : hasSelection
      ? `${title}结果：${currentLabel ?? selectedId}`
      : `${title}待抽取`;

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

    if (!isDrawing) {
      setSettled(true);
      alignSelection();
      const resizeObserver = new ResizeObserver(alignSelection);
      resizeObserver.observe(track);
      return () => resizeObserver.disconnect();
    }

    setSettled(false);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      alignSelection();
      setSettled(true);
      return;
    }

    // Anchor on the center rail slot (index === precedingItems), not on the
    // highlighted winner, so animation still targets the correct card while
    // the selected style stays hidden until settle.
    const target = rail.children[precedingItems];
    if (!(target instanceof HTMLDivElement)) return;
    selectedRef.current = target;
    rail.style.transform = "translateX(0)";
    const trackRect = track.getBoundingClientRect();
    const selectedRect = target.getBoundingClientRect();
    const finalOffset = trackRect.left + trackRect.width / 2 - (selectedRect.left + selectedRect.width / 2);
    // Travel farther across the rail so the spin reads as a real random roll.
    const startOffset = finalOffset + Math.max(
      selectedRect.left - rail.getBoundingClientRect().left,
      Math.min(1480, Math.max(720, trackRect.width * 2.4)),
    );
    rail.style.transform = `translateX(${startOffset}px)`;
    // Most of the spin is the long coast; keep the final overshoot short so
    // the framed winner does not sway left/right for long after landing.
    animationRef.current = rail.animate([
      { transform: `translateX(${startOffset}px)` },
      { transform: `translateX(${finalOffset + Math.min(360, trackRect.width * 0.48)}px)`, offset: 0.72 },
      { transform: `translateX(${finalOffset - 12}px)`, offset: 0.9 },
      { transform: `translateX(${finalOffset + 4}px)`, offset: 0.96 },
      { transform: `translateX(${finalOffset}px)` },
    ], {
      duration: durationMs,
      easing: "cubic-bezier(0.12, 0.78, 0.08, 1)",
      fill: "forwards",
    });
    // Reveal shortly after framing the winner, without waiting out the whole sway.
    const settleTimer = window.setTimeout(() => setSettled(true), durationMs * 0.9);

    return () => {
      window.clearTimeout(settleTimer);
      animationRef.current?.cancel();
      animationRef.current = null;
    };
  }, [durationMs, hasItems, hasSelection, isDrawing, precedingItems, selectedId]);

  return (
    <div
      aria-busy={isDrawing || (hasSelection && !settled)}
      className="marquee-draw"
      data-drawing={isDrawing || (hasSelection && !settled)}
      data-has-selection={hasSelection}
      data-kind={dataKind}
      data-settled={settled && !isDrawing}
      data-testid="marquee-draw"
    >
      <span aria-live="polite" className="sr-only" role="status">
        {liveStatus}
      </span>
      <div className="marquee-draw-header">
        <span>{title}</span>
        <span className="marquee-draw-status">{statusText}</span>
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
