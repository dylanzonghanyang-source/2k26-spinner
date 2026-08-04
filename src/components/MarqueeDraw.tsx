import { ChevronDown, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildMarqueeReel } from "../marqueeMotion";

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
  onPhaseChange?: (phase: "idle" | "rolling" | "landing" | "settled") => void;
  onSettled?: () => void;
  precedingItems?: number;
  selectedId?: string;
  settleHoldMs?: number;
  title: string;
};

function MarqueeDraw({
  currentLabel,
  dataKind,
  disabled = false,
  durationMs = 2400,
  drawLabel = "抽取",
  emptyText,
  isDrawing,
  items,
  onDraw,
  onPhaseChange,
  onSettled,
  precedingItems = 12,
  selectedId,
  settleHoldMs = 220,
  title,
}: MarqueeDrawProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const completionRef = useRef(onSettled);
  const [settled, setSettled] = useState(!isDrawing);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const hasItems = items.length > 0;
  const hasSelection = selectedIndex >= 0;
  const revealWinner = settled && hasSelection;
  const visualReel = useMemo(
    () => buildMarqueeReel(items, selectedId, {
      precedingItems,
      revealWinner: false,
      trailingItems: 6,
    }),
    [items, precedingItems, selectedId],
  );
  const railItems = useMemo(
    () => visualReel.map((item) => ({
      ...item,
      selected: revealWinner && item.landing,
    })),
    [revealWinner, visualReel],
  );
  const phase = !hasSelection
    ? "idle"
    : isDrawing
      ? settled ? "landing" : "rolling"
      : "settled";
  const canDraw = Boolean(onDraw) && !disabled && !isDrawing && hasItems;
  const statusText = phase === "rolling"
    ? "正在筛选"
    : phase === "landing"
      ? `已抽中：${currentLabel ?? emptyText}`
      : phase === "settled"
        ? currentLabel ?? emptyText
        : "待抽取";
  const liveStatus = phase === "rolling"
    ? `${title}正在筛选`
    : hasSelection
      ? `${title}结果：${currentLabel ?? selectedId}`
      : `${title}待抽取`;

  useEffect(() => {
    completionRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    onPhaseChange?.(phase);
  }, [onPhaseChange, phase]);

  useEffect(() => {
    const track = trackRef.current;
    const rail = railRef.current;
    if (!track || !rail || !hasItems) return;

    animationRef.current?.cancel();
    animationRef.current = null;
    let cancelled = false;
    let settleTimer: number | null = null;

    const alignSelection = () => {
      const selected = selectedRef.current;
      rail.style.transform = "translateX(0)";
      if (!selected) return 0;

      const trackRect = track.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const finalOffset = trackRect.left + trackRect.width / 2 - (selectedRect.left + selectedRect.width / 2);
      rail.style.transform = `translateX(${finalOffset}px)`;
      return finalOffset;
    };

    const finishWithoutMotion = () => {
      alignSelection();
      setSettled(true);
      queueMicrotask(() => {
        if (!cancelled) completionRef.current?.();
      });
    };

    if (!hasSelection) {
      setSettled(true);
      if (isDrawing) finishWithoutMotion();
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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishWithoutMotion();
      return () => {
        cancelled = true;
      };
    }

    const target = selectedRef.current;
    if (!target) {
      finishWithoutMotion();
      return () => {
        cancelled = true;
      };
    }

    rail.style.transform = "translateX(0)";
    const trackRect = track.getBoundingClientRect();
    const selectedRect = target.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const finalOffset = trackRect.left + trackRect.width / 2 - (selectedRect.left + selectedRect.width / 2);
    const leadDistance = Math.max(
      selectedRect.left - railRect.left,
      Math.min(1520, Math.max(820, trackRect.width * 2.35)),
    );
    const startOffset = finalOffset + leadDistance;
    const middleOffset = startOffset - leadDistance * 0.62;
    const nearOffset = finalOffset + Math.min(220, Math.max(84, trackRect.width * 0.22));
    rail.style.transform = `translateX(${startOffset}px)`;

    const animation = rail.animate([
      { transform: `translateX(${startOffset}px)`, offset: 0, easing: "linear" },
      { transform: `translateX(${middleOffset}px)`, offset: 0.46, easing: "linear" },
      { transform: `translateX(${nearOffset}px)`, offset: 0.82, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      { transform: `translateX(${finalOffset}px)`, offset: 1 },
    ], {
      duration: durationMs,
      easing: "linear",
      fill: "forwards",
    });
    animationRef.current = animation;

    animation.addEventListener("finish", () => {
      if (cancelled) return;
      rail.style.transform = `translateX(${finalOffset}px)`;
      setSettled(true);
      settleTimer = window.setTimeout(() => {
        if (!cancelled) completionRef.current?.();
      }, settleHoldMs);
    }, { once: true });

    return () => {
      cancelled = true;
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      animation.cancel();
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [durationMs, hasItems, hasSelection, isDrawing, selectedId, settleHoldMs, visualReel]);

  return (
    <div
      aria-busy={isDrawing}
      className="marquee-draw"
      data-drawing={isDrawing}
      data-has-selection={hasSelection}
      data-kind={dataKind}
      data-phase={phase}
      data-settled={settled}
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
        <div className="marquee-draw-pointer" aria-hidden="true">
          <span>落点</span>
          <ChevronDown />
        </div>
        <div className="marquee-draw-rail" ref={railRef}>
          {railItems.map((item) => (
            <div
              className="marquee-draw-item"
              data-item-id={item.id}
              data-landing={item.landing}
              data-selected={item.selected}
              key={item.railId}
              ref={item.landing ? selectedRef : undefined}
            >
              <span className="marquee-draw-mark">
                {item.imageSrc && (
                  <img
                    alt=""
                    decoding="async"
                    loading="eager"
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                    src={item.imageSrc}
                  />
                )}
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
