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
  "#4f8f78",
  "#557da4",
  "#bf755b",
  "#6c8d55",
  "#8a6c9f",
  "#b39143",
];

const SEGMENT_COLORS_PHYSICAL = [
  "#3e7f72",
  "#607ea0",
  "#b46850",
  "#6a8f62",
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
    <div className="flex flex-1 flex-col justify-start gap-3 pt-4 sm:pt-6">
      <div className="relative mx-auto aspect-square w-full max-w-[430px]" aria-live="polite">
        <div className="absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-1">
          <ChevronDown className="h-8 w-8 fill-white text-ink-900 drop-shadow-[0_2px_2px_rgba(32,32,29,0.18)]" />
        </div>

        <div className="absolute inset-0 rounded-full border border-ink-300 bg-ink-50 p-[3%] shadow-glow">
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
            <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-black/10" />

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
                  <span className="block max-w-[120px] truncate rounded-[4px] border border-ink-300 bg-white px-2.5 py-1 text-center text-[11px] font-semibold leading-none text-ink-900 shadow-[0_1px_2px_rgba(32,32,29,0.1)]">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="absolute inset-[36%] flex items-center justify-center rounded-full border border-ink-300 bg-white shadow-[0_4px_12px_rgba(32,32,29,0.14)]">
            {isPhysical ? (
              <div className="flex w-[88%] flex-col items-center text-center">
                <div className="max-w-full truncate text-[20px] font-semibold text-ink-900 tabular-nums">{currentLabel ?? "--"}</div>
                <button
                  className="mt-1 inline-flex min-h-6 items-center justify-center rounded-full border border-ink-900 bg-ink-900 px-2.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="inline-flex min-h-14 min-w-14 items-center justify-center rounded-full border border-ink-900 bg-ink-900 px-2 text-[12px] font-semibold text-white shadow-[0_3px_8px_rgba(32,32,29,0.2)] transition hover:scale-[1.02] hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="mx-auto min-h-5 max-w-[420px] truncate text-center font-mono text-[9px] font-medium text-ink-500">
        {count > 0 ? `${activeGroupName} · ${statusLabel} · ${count} 个选项` : emptyText}
      </div>
    </div>
  );
}

export default PlayerWheel;
