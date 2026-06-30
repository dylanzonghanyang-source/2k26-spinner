import { ChevronDown } from "lucide-react";
import { useMemo } from "react";
import type { WheelItem } from "../domain";

type PlayerWheelProps = {
  activeGroupName: string;
  currentLabel?: string;
  disabled?: boolean;
  emptyText?: string;
  isSpinning: boolean;
  items: WheelItem[];
  mode: "ability" | "physical";
  onSpin: () => void;
  rotation: number;
  spinLabel: string;
};

const SEGMENT_COLORS_ABILITY = [
  "rgba(92,169,156,0.9)",
  "rgba(96,146,193,0.9)",
  "rgba(194,128,98,0.88)",
  "rgba(88,177,128,0.88)",
  "rgba(148,125,190,0.86)",
  "rgba(209,171,89,0.84)",
];

const SEGMENT_COLORS_PHYSICAL = [
  "rgba(83,159,149,0.9)",
  "rgba(91,139,184,0.9)",
  "rgba(190,127,92,0.88)",
  "rgba(72,157,132,0.88)",
];

const MAX_LABELS = 28;

function PlayerWheel({
  activeGroupName,
  currentLabel,
  disabled = false,
  emptyText = "暂无可抽取项目",
  isSpinning,
  items,
  mode,
  onSpin,
  rotation,
  spinLabel,
}: PlayerWheelProps) {
  const count = items.length;
  const segmentDeg = count > 0 ? 360 / count : 360;
  const isPhysical = mode === "physical";
  const canSpin = !disabled && !isSpinning && count > 0;
  const statusLabel = currentLabel ?? emptyText;

  const conicStops = useMemo(() => {
    if (count === 0) return "rgba(38,71,83,0.08)";
    const colors = isPhysical ? SEGMENT_COLORS_PHYSICAL : SEGMENT_COLORS_ABILITY;
    const dividerWidth = count > 80 ? 0.16 : count > 36 ? 0.28 : 0.55;

    return items
      .map((_, i) => {
        const start = i * segmentDeg;
        const end = (i + 1) * segmentDeg;
        const color = colors[i % colors.length];
        const divider = "rgba(255,255,255,0.55)";
        return [
          `${divider} ${start}deg`,
          `${color} ${start}deg`,
          `${color} ${Math.max(start, end - dividerWidth)}deg`,
          `${divider} ${Math.max(start, end - dividerWidth)}deg`,
          `${divider} ${end}deg`,
        ].join(",");
      })
      .join(",");
  }, [count, isPhysical, items, segmentDeg]);

  const visibleLabels = useMemo(() => {
    if (count === 0) return [];
    if (count <= MAX_LABELS) {
      return items.map((item, index) => ({ item, index }));
    }

    const labelCount = isPhysical ? 12 : 8;
    const step = Math.max(1, Math.floor(count / labelCount));
    const labels = [];

    for (let index = 0; index < count; index += step) {
      labels.push({ item: items[index], index });
      if (labels.length >= labelCount) break;
    }

    if (labels.at(-1)?.index !== count - 1) {
      labels.push({ item: items[count - 1], index: count - 1 });
    }

    return labels;
  }, [count, isPhysical, items]);

  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <div className="relative mx-auto aspect-square w-full max-w-[440px]" aria-live="polite">
        <div className="absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-1">
          <ChevronDown className="h-8 w-8 text-court-700 drop-shadow-[0_3px_8px_rgba(31,73,86,0.28)]" />
        </div>

        <div className="absolute inset-0 rounded-full border border-ink-700/10 bg-white/80 p-[3%] shadow-glow">
          <div
            className="relative h-full w-full overflow-hidden rounded-full transition-transform duration-[4200ms]"
            style={{
              transform: `rotate(${rotation}deg)`,
              background: `conic-gradient(${conicStops})`,
              transitionTimingFunction: isSpinning
                ? "cubic-bezier(0.12,0.75,0.1,1)"
                : "ease-out",
            }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.18),transparent_28%,rgba(255,255,255,0.08)_62%,rgba(23,43,48,0.13)_100%)]" />
            <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/60" />

            {visibleLabels.map(({ item, index }) => {
              const angle = index * segmentDeg + segmentDeg / 2;
              const radian = (angle * Math.PI) / 180;
              const radius = count > 60 ? 39 : 34;
              const x = 50 + radius * Math.sin(radian);
              const y = 50 - radius * Math.cos(radian);
              const labelRotation = angle + 90 + (angle > 90 && angle < 270 ? 180 : 0);

              return (
                <div
                  key={item.id}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: `translate(-50%, -50%) rotate(${labelRotation}deg)`,
                  }}
                >
                  <span className="block max-w-[120px] truncate rounded border border-ink-700/10 bg-white/88 px-3 py-1 text-center text-[12px] font-semibold leading-none text-ink-900 shadow-sm backdrop-blur">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="absolute inset-[36%] flex items-center justify-center rounded-full border border-ink-700/10 bg-[radial-gradient(circle,rgba(255,255,255,0.98),rgba(226,246,240,0.96))] shadow-[0_10px_24px_rgba(31,73,86,0.18)]">
            {isPhysical ? (
              <div className="flex w-[88%] flex-col items-center text-center">
                <div className="max-w-full truncate text-[20px] font-semibold text-ink-900 tabular-nums">{currentLabel ?? "--"}</div>
                <button
                  className="mt-1 inline-flex min-h-6 items-center justify-center rounded-full border border-court-600/20 bg-court-50 px-2.5 text-[10px] font-semibold text-court-900 shadow-sm transition hover:bg-court-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSpin}
                  onClick={onSpin}
                  type="button"
                >
                  {isSpinning ? "抽取中" : spinLabel}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <button
                  className="inline-flex min-h-14 min-w-14 items-center justify-center rounded-full border border-court-600/20 bg-court-50 px-2 text-[12px] font-semibold text-court-900 shadow-[0_10px_24px_rgba(31,73,86,0.16)] transition hover:scale-[1.03] hover:bg-court-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canSpin}
                  onClick={onSpin}
                  type="button"
                >
                  {isSpinning ? "抽取中" : spinLabel}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto min-h-5 max-w-[420px] truncate text-center text-[11px] font-medium text-ink-500">
        {count > 0 ? `${activeGroupName} · ${statusLabel} · ${count} 个选项` : emptyText}
      </div>
    </div>
  );
}

export default PlayerWheel;
