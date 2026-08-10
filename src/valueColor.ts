/** Classic game rarity scale: gold, red, purple, blue, green, then white/common. */
export function valueColor(value: number) {
  if (value >= 90) return "text-warning-800 value-rating value-rating-gold";
  if (value >= 80) return "text-rose-800 value-rating value-rating-red";
  if (value >= 70) return "text-purple-800 value-rating value-rating-purple";
  if (value >= 60) return "text-blue-800 value-rating value-rating-blue";
  if (value >= 50) return "text-court-800 value-rating value-rating-green";
  return "text-ink-900 value-rating value-rating-common";
}
