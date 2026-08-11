import type { Bundle } from "./createResult.ts";
import type { RookieCard, RookieCardLookup } from "./rookieCards.ts";

/** 卡池中的全部年份（降序，最新在前）。 */
export function yearsInLookup(lookup: RookieCardLookup | null | undefined): number[] {
  if (!lookup) return [];
  const years = new Set<number>();
  for (const card of lookup.values()) {
    if (Number.isFinite(card.year) && card.year > 0) years.add(card.year);
  }
  return [...years].sort((a, b) => b - a);
}

/** 指定年份的全部新秀卡（按 OVR 降序，无 OVR 排最后）。 */
export function cardsByYear(lookup: RookieCardLookup | null | undefined, year: number): RookieCard[] {
  if (!lookup) return [];
  return [...lookup.values()]
    .filter((card) => card.year === year)
    .sort((a, b) => {
      const ao = a.overall ?? -1;
      const bo = b.overall ?? -1;
      if (ao !== bo) return bo - ao;
      return a.name.localeCompare(b.name);
    });
}

/** 槽位对应属性值：bundle attrs 中卡有真实值的均值（取整），无任何值时返回 null。 */
export function slotValueForCard(card: RookieCard, bundle: Bundle): number | null {
  if (bundle.id === "potential") {
    return typeof card.potential?.current === "number" && Number.isFinite(card.potential.current)
      ? card.potential.current
      : null;
  }
  const values = bundle.attrs
    .map((attr) => card.detailed[attr])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** 槽位属性显示文案：多属性槽位列出各属性值。 */
export function slotAttrsForCard(card: RookieCard, bundle: Bundle): Array<{ attr: string; value: number | null }> {
  if (bundle.id === "potential") {
    return [
      { attr: "潜力", value: typeof card.potential?.current === "number" ? card.potential.current : null },
      { attr: "最低", value: typeof card.potential?.min === "number" ? card.potential.min : null },
      { attr: "最高", value: typeof card.potential?.max === "number" ? card.potential.max : null },
    ];
  }
  return bundle.attrs.map((attr) => ({ attr, value: typeof card.detailed[attr] === "number" ? card.detailed[attr] : null }));
}
