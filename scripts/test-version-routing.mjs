import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const appSource = readFileSync(join(root, "src/App.tsx"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const version26Block = appSource.match(/"2k26":\s*\{([\s\S]*?)\n\s*\},\n\s*"2k27":/i)?.[1] ?? "";
assert(version26Block.includes("rosterCatalog: rosterCatalog2k27"), "2K26 must use the latest 2K27 Play Now roster catalog");
assert(!version26Block.includes("rosterCatalog: rosterCatalog2k26"), "2K26 must not use the old 2K26 roster catalog");
assert(/function getInitialDataVersion\(\): DataVersion\s*\{\s*return "2k26";/.test(appSource), "2K27 must not be restored from persisted browser state while disabled");
assert(/aria-label="2K27 数据（暂未开放）"[\s\S]*?disabled/.test(appSource), "the 2K27 UI entry must remain disabled");
assert(appSource.includes("availablePlayers={allPlayerPool}"), "manual mode must receive the shared latest-roster player pool");
assert(appSource.includes('selectionMode={appMode === "custom" ? "manual" : "random"}'), "custom mode must use manual source selection");

console.log("version routing OK: shared latest roster, 2K27 entry disabled, manual pool wired");
