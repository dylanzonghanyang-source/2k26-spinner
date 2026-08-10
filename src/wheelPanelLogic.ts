import type { PlayerSource } from "./domain.ts";
import { normalizePlayerSearch } from "./playerSearch.ts";
import { getPlayerNameCN } from "./playerNames.ts";

/** 标签模式：每行一项，trim、去空行、去重（保留首现）。 */
export function parseLabels(text: string, limit = 100): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    result.push(line);
    if (result.length >= limit) break;
  }
  return result;
}

/** 数字模式校验：整数、min < max、扇区数 ≤ 60。返回错误文案或 null。 */
export function validateNumberRange(minRaw: string, maxRaw: string, limit = 60): { min: number; max: number; error: string | null } {
  const min = Number.parseInt(minRaw, 10);
  const max = Number.parseInt(maxRaw, 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min, max, error: "请输入整数" };
  if (min >= max) return { min, max, error: "最小值必须小于最大值" };
  if (max - min + 1 > limit) return { min, max, error: `范围过大，最多 ${limit} 个数字` };
  return { min, max, error: null };
}

export type WheelPlayerFilter = {
  selectedTeamIds: string[] | null; // null = 全部球队
  query: string;
};

/** 球员模式过滤：球队多选（null=全部）+ 搜索（英文名/中文名/位置/球队）。 */
export function filterWheelPlayers(
  teams: Array<{ id: string; players: PlayerSource[] }>,
  filter: WheelPlayerFilter,
  limit = 60,
): { players: PlayerSource[]; total: number; truncated: boolean } {
  const q = normalizePlayerSearch(filter.query);
  const all = teams
    .filter((team) => filter.selectedTeamIds === null || filter.selectedTeamIds.includes(team.id))
    .flatMap((team) => team.players);
  const matched = q
    ? all.filter((player) => {
      const haystack = normalizePlayerSearch(`${player.name} ${getPlayerNameCN(player.name)} ${player.position ?? ""}`);
      return haystack.includes(q);
    })
    : all;
  return {
    players: matched.slice(0, limit),
    total: matched.length,
    truncated: matched.length > limit,
  };
}

/** 球员转盘条目：中文名 + OVR。 */
export function playerWheelLabel(player: PlayerSource): string {
  const cn = getPlayerNameCN(player.name);
  const overall = typeof player.overall === "number" ? player.overall : null;
  return overall !== null ? `${cn} ${overall}` : cn;
}
