import { useEffect, useMemo, useRef, useState } from "react";
import { indexForRotation, sliceAngle, targetRotation, TAU } from "../wheelMath";

export type SpinWheelItem = {
  id: string;
  label: string;
};

type SpinWheelProps = {
  items: SpinWheelItem[];
  disabled?: boolean;
  durationMs?: number;
  emptyText?: string;
  minSpins?: number;
  onPhaseChange?: (phase: "idle" | "spinning" | "settled") => void;
  onSettled?: (item: SpinWheelItem) => void;
  reducedMotion?: boolean;
  size?: number;
  spinLabel?: string;
  title?: string;
};

const PALETTE = [
  "#e74c3c", "#f39c12", "#2ecc71", "#3498db", "#9b59b6", "#1abc9c",
  "#e67e22", "#27ae60", "#2980b9", "#c0392b", "#f1c40f", "#16a085",
];

const prefersReducedMotion = () =>
  typeof window !== "undefined"
  && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function drawWheel(canvas: HTMLCanvasElement, items: SpinWheelItem[], size: number) {
  const dpr = Math.min(2, window.devicePixelRatio ?? 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const n = items.length;
  const cx = size / 2;
  const r = size / 2 - 1;
  const s = sliceAngle(n);
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  const border = dark ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.85)";
  const textColor = "#ffffff";

  for (let i = 0; i < n; i += 1) {
    const start = -Math.PI / 2 + i * s;
    ctx.beginPath();
    ctx.moveTo(cx, cx);
    ctx.arc(cx, cx, r, start, start + s);
    ctx.closePath();
    ctx.fillStyle = PALETTE[i % PALETTE.length];
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Labels along the slice midline, from the center outward.
  const radialMax = r * 0.46;
  for (let i = 0; i < n; i += 1) {
    const mid = -Math.PI / 2 + (i + 0.5) * s;
    const label = items[i].label;
    const fontSize = Math.max(8, Math.min(14, radialMax / Math.max(1, label.length * 0.62)));
    const maxChars = Math.max(1, Math.floor(radialMax / (fontSize * 0.62)));
    const shown = label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;

    ctx.save();
    ctx.translate(cx, cx);
    ctx.rotate(mid);
    ctx.fillStyle = textColor;
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(shown, r - 4, 0);
    ctx.restore();
  }
}

function SpinWheel({
  items,
  disabled = false,
  durationMs = 3600,
  emptyText = "暂无候选项",
  minSpins = 5,
  onPhaseChange,
  onSettled,
  reducedMotion,
  size = 420,
  spinLabel = "开始旋转",
  title = "转盘",
}: SpinWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationRef = useRef(0);
  const animationRef = useRef<Animation | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const completionRef = useRef(onSettled);
  const phaseRef = useRef(onPhaseChange);
  const [settledItem, setSettledItem] = useState<SpinWheelItem | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const reduced = reducedMotion ?? prefersReducedMotion();
  const hasItems = items.length > 0;
  const canSpin = !disabled && !isSpinning && hasItems;

  useEffect(() => {
    completionRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    phaseRef.current = onPhaseChange;
  }, [onPhaseChange]);

  const setPhase = (phase: "idle" | "spinning" | "settled") => {
    phaseRef.current?.(phase);
  };

  useEffect(() => {
    setPhase(settledItem ? "settled" : isSpinning ? "spinning" : "idle");
  }, [isSpinning, settledItem]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawWheel(canvas, items, size);
  }, [items, size]);

  useEffect(() => () => {
    animationRef.current?.cancel();
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  const spin = () => {
    if (!canSpin) return;
    const n = items.length;
    const index = Math.floor(Math.random() * n);
    const extra = Math.random();
    const target = targetRotation(rotationRef.current, index, n, minSpins, extra);
    const deltaDeg = ((target - rotationRef.current) * 180) / Math.PI;
    rotationRef.current = target;
    const winner = items[index];
    setSettledItem(null);
    setIsSpinning(true);

    const finish = () => {
      setSettledItem(winner);
      setIsSpinning(false);
      settleTimerRef.current = window.setTimeout(() => {
        completionRef.current?.(winner);
      }, 220);
    };

    const canvas = canvasRef.current;
    if (!canvas || reduced) {
      finish();
      return;
    }

    const animation = canvas.animate(
      [
        { transform: `rotate(0deg)` },
        { transform: `rotate(${deltaDeg}deg)` },
      ],
      {
        duration: durationMs,
        easing: "cubic-bezier(0.17, 0.67, 0.12, 0.99)",
        fill: "forwards",
      },
    );
    animationRef.current = animation;
    animation.addEventListener("finish", finish, { once: true });
  };

  const statusText = isSpinning
    ? "正在旋转…"
    : settledItem
      ? `已抽中：${settledItem.label}`
      : "尚未开始";
  const liveStatus = isSpinning ? title : settledItem ? `已抽取：${settledItem.label}` : `${title}，尚未开始`;

  return (
    <div
      aria-busy={isSpinning}
      className="spin-wheel"
      data-has-items={hasItems}
      data-spinning={isSpinning}
      data-testid="spin-wheel"
    >
      <div className="spin-wheel-header">
        <span>{title}</span>
        <span className="spin-wheel-status">{statusText}</span>
      </div>
      <span aria-live="polite" className="sr-only" role="status">{liveStatus}</span>
      <div className="spin-wheel-stage" style={{ width: size, maxWidth: "100%" }}>
        <div className="spin-wheel-pointer" aria-hidden="true">▼</div>
        <canvas
          aria-label={`${title}：${items.map((item) => item.label).join("、")}`}
          className="spin-wheel-canvas"
          data-testid="spin-wheel-canvas"
          ref={canvasRef}
          role="img"
          style={{ transformOrigin: "50% 50%" }}
        />
      </div>
      <div className="spin-wheel-footer">
        <span>{hasItems ? `${items.length} 个候选` : emptyText}</span>
        <button disabled={!canSpin} onClick={spin} type="button">
          {isSpinning ? "旋转中…" : spinLabel}
        </button>
      </div>
    </div>
  );
}

export default SpinWheel;
