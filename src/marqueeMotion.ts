export type MarqueeReelSource = {
  id: string;
};

export type MarqueeReelItem<T extends MarqueeReelSource> = T & {
  landing: boolean;
  railId: string;
  selected: boolean;
};

export type MarqueeReelOptions = {
  precedingItems: number;
  random?: () => number;
  revealWinner: boolean;
  trailingItems?: number;
};

function randomIndex(length: number, random: () => number) {
  const value = Math.max(0, Math.min(0.999999, random()));
  return Math.floor(value * length);
}

export function buildMarqueeReel<T extends MarqueeReelSource>(
  items: readonly T[],
  selectedId: string | undefined,
  {
    precedingItems,
    random = Math.random,
    revealWinner,
    trailingItems = 6,
  }: MarqueeReelOptions,
): Array<MarqueeReelItem<T>> {
  if (items.length === 0) return [];

  const winner = selectedId ? items.find((item) => item.id === selectedId) : undefined;
  if (!winner) {
    return items.slice(0, Math.min(3, items.length)).map((item, index) => ({
      ...item,
      landing: false,
      railId: `idle:${index}:${item.id}`,
      selected: false,
    }));
  }

  const visualPool = items.filter((item) => item.id !== winner.id);
  if (visualPool.length === 0) {
    return [{
      ...winner,
      landing: true,
      railId: `landing:0:${winner.id}`,
      selected: revealWinner,
    }];
  }

  let previousId: string | undefined;
  const drawVisualItem = (index: number, phase: "lead" | "trail") => {
    const candidates = visualPool.length > 1 && previousId
      ? visualPool.filter((item) => item.id !== previousId)
      : visualPool;
    const item = candidates[randomIndex(candidates.length, random)];
    previousId = item.id;
    return {
      ...item,
      landing: false,
      railId: `${phase}:${index}:${item.id}`,
      selected: false,
    };
  };

  const leadIn = Array.from(
    { length: Math.max(0, precedingItems) },
    (_, index) => drawVisualItem(index, "lead"),
  );
  const trailing = Array.from(
    { length: Math.max(0, trailingItems) },
    (_, index) => drawVisualItem(index, "trail"),
  );

  return [
    ...leadIn,
    {
      ...winner,
      landing: true,
      railId: `landing:${precedingItems}:${winner.id}`,
      selected: revealWinner,
    },
    ...trailing,
  ];
}
