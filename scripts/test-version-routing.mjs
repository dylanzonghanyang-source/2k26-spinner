import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const appSource = readFileSync(join(root, "src/App.tsx"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Refactored: versionData2k26 is now a standalone const (lazy 2K27 loading).
// Verify the 2K26 version data still uses the shared 2K27 roster catalog.
assert(appSource.includes("rosterCatalog: rosterCatalog2k27 as RosterCatalogData"), "2K26 must use the latest 2K27 Play Now roster catalog");
assert(
  appSource.includes("const versionData2k26: VersionData =") || appSource.includes("const versionData2k26 ="),
  "2K26 version data must be a named const (lazy-2K27 refactor)",
);
// 2K27 badges/players must be dynamic imports, not static top-level imports.
assert(
  /import\(["']\.\/data\/versions\/2k27-play-now\/badges\.json["']\)/.test(appSource),
  "2K27 badge data must be dynamically imported (not in the initial bundle)",
);
assert(
  /import\(["']\.\/data\/versions\/2k27-play-now\/players\.json["']\)/.test(appSource),
  "2K27 player data must be dynamically imported (not in the initial bundle)",
);
assert(!/import\s+\w+\s+from\s+["']\.\/data\/versions\/2k27-play-now\/badges\.json["']/.test(appSource), "2K27 badges must not be a static import");
assert(!/import\s+\w+\s+from\s+["']\.\/data\/versions\/2k27-play-now\/players\.json["']/.test(appSource), "2K27 players must not be a static import");
assert(/function getInitialDataVersion\(\): DataVersion\s*\{\s*return "2k26";/.test(appSource), "2K27 must not be restored from persisted browser state while disabled");
assert(/aria-label="2K27 数据（暂未开放）"[\s\S]*?disabled/.test(appSource), "the 2K27 UI entry must remain disabled");
assert(appSource.includes("availablePlayers={allPlayerPool}"), "manual mode must receive the shared latest-roster player pool");
assert(appSource.includes('selectionMode={appMode === "custom" ? "manual" : "random"}'), "custom mode must use manual source selection");

console.log("version routing OK: shared latest roster, 2K27 entry disabled, manual pool wired");
