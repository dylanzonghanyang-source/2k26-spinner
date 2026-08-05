import config from "../tailwind.config.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function relativeLuminance(hex: string) {
  const normalized = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const colors = config.theme.extend.colors as Record<string, Record<number, string>>;
const white = "#ffffff";
const darkPanel = "#1c211f";

const lightRatingColors: Record<string, string> = {
  gold: "#6b3a0f",
  red: "#a33d4f",
  purple: "#62438f",
  blue: "#1d4f91",
  green: "#1b6b46",
  common: "#4f5752",
};
const lightRatings: [string, string, string][] = [
  ["90-99 light-gold", lightRatingColors.gold, white],
  ["80-89 light-red", lightRatingColors.red, white],
  ["70-79 light-purple", lightRatingColors.purple, white],
  ["60-69 light-blue", lightRatingColors.blue, white],
  ["50-59 light-green", lightRatingColors.green, white],
  ["<50 light-common", lightRatingColors.common, white],
];
for (const [label, fg, bg] of lightRatings) {
  const ratio = contrastRatio(fg, bg);
  assert(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 on white (need ≥4.5)`);
}

// Dark mode rating colors — must pass AA (≥4.5) on dark panel
const darkRatingColors: Record<string, string> = {
  gold: "#ffd36a",
  red: "#ff9b9f",
  purple: "#c3a5f5",
  blue: "#8db8ff",
  green: "#82dfaa",
  common: "#f3f7f4",
};
const darkRatings: [string, string, string][] = [
  ["90-99 dark-gold", darkRatingColors.gold, darkPanel],
  ["80-89 dark-red", darkRatingColors.red, darkPanel],
  ["70-79 dark-purple", darkRatingColors.purple, darkPanel],
  ["60-69 dark-blue", darkRatingColors.blue, darkPanel],
  ["50-59 dark-green", darkRatingColors.green, darkPanel],
  ["<50 dark-common", darkRatingColors.common, darkPanel],
];
for (const [label, fg, bg] of darkRatings) {
  const ratio = contrastRatio(fg, bg);
  assert(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 on dark panel (need ≥4.5)`);
}

// Core semantic palette
assert(colors.warning, "the UI palette needs a semantic warning scale");
assert(contrastRatio(colors.court[500], white) >= 5.0, "court-500 on white should be strong AA");
assert(contrastRatio(colors.warning[500], white) >= 5.0, "warning-500 on white should be strong AA");
assert(contrastRatio(colors.ink[500], white) >= 4.5, "ink-500 must remain readable on white");

console.log(JSON.stringify({
  status: "passed",
  court500Contrast: Number(contrastRatio(colors.court[500], white).toFixed(2)),
  warning500Contrast: Number(contrastRatio(colors.warning[500], white).toFixed(2)),
  ink500Contrast: Number(contrastRatio(colors.ink[500], white).toFixed(2)),
  ratingLight: {
    gold: Number(contrastRatio(lightRatingColors.gold, white).toFixed(2)),
    red: Number(contrastRatio(lightRatingColors.red, white).toFixed(2)),
    purple: Number(contrastRatio(lightRatingColors.purple, white).toFixed(2)),
    blue: Number(contrastRatio(lightRatingColors.blue, white).toFixed(2)),
    green: Number(contrastRatio(lightRatingColors.green, white).toFixed(2)),
    common: Number(contrastRatio(lightRatingColors.common, white).toFixed(2)),
  },
  ratingDark: {
    gold: Number(contrastRatio(darkRatingColors.gold, darkPanel).toFixed(2)),
    red: Number(contrastRatio(darkRatingColors.red, darkPanel).toFixed(2)),
    purple: Number(contrastRatio(darkRatingColors.purple, darkPanel).toFixed(2)),
    blue: Number(contrastRatio(darkRatingColors.blue, darkPanel).toFixed(2)),
    green: Number(contrastRatio(darkRatingColors.green, darkPanel).toFixed(2)),
    common: Number(contrastRatio(darkRatingColors.common, darkPanel).toFixed(2)),
  },
}, null, 2));
