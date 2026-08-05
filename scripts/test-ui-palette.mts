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
  elite: "#6b3a0f",
  good: "#145a45",
  solid: "#1d4f91",
  fair: "#62438f",
  low: "#a33d4f",
};
const lightRatings: [string, string, string][] = [
  ["90+ light-elite", lightRatingColors.elite, white],
  ["80+ light-good", lightRatingColors.good, white],
  ["70+ light-solid", lightRatingColors.solid, white],
  ["60+ light-fair", lightRatingColors.fair, white],
  ["<60 light-low", lightRatingColors.low, white],
];
for (const [label, fg, bg] of lightRatings) {
  const ratio = contrastRatio(fg, bg);
  assert(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 on white (need ≥4.5)`);
}

// Dark mode rating colors — must pass AA (≥4.5) on dark panel
const darkRatingColors: Record<string, string> = {
  elite: "#ffd36a",
  good: "#6fdbab",
  solid: "#8db8ff",
  fair: "#c3a5f5",
  low: "#ff9b9f",
};
const darkRatings: [string, string, string][] = [
  ["90+ dark-elite", darkRatingColors.elite, darkPanel],
  ["80+ dark-good", darkRatingColors.good, darkPanel],
  ["70+ dark-solid", darkRatingColors.solid, darkPanel],
  ["60+ dark-fair", darkRatingColors.fair, darkPanel],
  ["<60 dark-low", darkRatingColors.low, darkPanel],
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
    elite: Number(contrastRatio(lightRatingColors.elite, white).toFixed(2)),
    good: Number(contrastRatio(lightRatingColors.good, white).toFixed(2)),
    solid: Number(contrastRatio(lightRatingColors.solid, white).toFixed(2)),
    fair: Number(contrastRatio(lightRatingColors.fair, white).toFixed(2)),
    low: Number(contrastRatio(lightRatingColors.low, white).toFixed(2)),
  },
  ratingDark: {
    elite: Number(contrastRatio(darkRatingColors.elite, darkPanel).toFixed(2)),
    good: Number(contrastRatio(darkRatingColors.good, darkPanel).toFixed(2)),
    solid: Number(contrastRatio(darkRatingColors.solid, darkPanel).toFixed(2)),
    fair: Number(contrastRatio(darkRatingColors.fair, darkPanel).toFixed(2)),
    low: Number(contrastRatio(darkRatingColors.low, darkPanel).toFixed(2)),
  },
}, null, 2));
