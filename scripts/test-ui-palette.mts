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

assert(colors.warning, "the UI palette needs a semantic warning scale distinct from destructive rose");
assert(contrastRatio(colors.court[500], white) >= 4.5, "court-500 must remain readable when used as text or an icon on white");
assert(contrastRatio(colors.warning[500], white) >= 4.5, "warning-500 must remain readable on white");
assert(contrastRatio(colors.ink[500], white) >= 4.5, "ink-500 must remain readable on white");

console.log(JSON.stringify({
  status: "passed",
  court500Contrast: Number(contrastRatio(colors.court[500], white).toFixed(2)),
  warning500Contrast: Number(contrastRatio(colors.warning[500], white).toFixed(2)),
  ink500Contrast: Number(contrastRatio(colors.ink[500], white).toFixed(2)),
}, null, 2));
