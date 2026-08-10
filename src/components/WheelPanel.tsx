import { useMemo, useState } from "react";
import SpinWheel, { type SpinWheelItem } from "./SpinWheel";
import { filterWheelPlayers, parseLabels, playerWheelLabel, validateNumberRange } from "../wheelPanelLogic";
import { safeGetStorageItem, safeSetStorageItem } from "../storage";
import type { RookieBuilderTeam } from "./RookieBuilder";

type WheelMode = "numbers" | "labels" | "players";

type WheelPanelProps = {
  teams: RookieBuilderTeam[];
};

const NUMBERS_KEY = "2kspinner-wheel-numbers";
const LABELS_KEY = "2kspinner-wheel-labels";
const PLAYERS_KEY = "2kspinner-wheel-players";

function loadJSON<T>(key: string, fallback: T): T {
  const raw = safeGetStorageItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function WheelPanel({ teams }: WheelPanelProps) {
  const [mode, setMode] = useState<WheelMode>("numbers");
  const [spinning, setSpinning] = useState(false);

  // --- numbers ---
  const [numberMin, setNumberMin] = useState(() => loadJSON<{ min: string; max: string }>(NUMBERS_KEY, { min: "1", max: "60" }));
  const numberItems = useMemo<SpinWheelItem[]>(() => {
    const { min, max, error } = validateNumberRange(numberMin.min, numberMin.max);
    if (error) return [];
    const items: SpinWheelItem[] = [];
    for (let value = min; value <= max; value += 1) items.push({ id: String(value), label: String(value) });
    return items;
  }, [numberMin]);

  // --- labels ---
  const [labelText, setLabelText] = useState(() => safeGetStorageItem(LABELS_KEY) ?? "");
  const labelItems = useMemo<SpinWheelItem[]>(
    () => parseLabels(labelText).map((label) => ({ id: label, label })),
    [labelText],
  );

  // --- players ---
  const [playerFilter, setPlayerFilter] = useState(() => loadJSON<{ teams: string[] | null }>(PLAYERS_KEY, { teams: null }));
  const [playerQuery, setPlayerQuery] = useState("");
  const teamIds = useMemo(() => teams.map((team) => team.id), [teams]);
  const playerResult = useMemo(
    () => filterWheelPlayers(teams, { selectedTeamIds: playerFilter.teams, query: playerQuery }),
    [playerFilter.teams, playerQuery, teams],
  );
  const playerItems = useMemo<SpinWheelItem[]>(
    () => playerResult.players.map((player) => ({ id: player.id ?? player.slug ?? player.name, label: playerWheelLabel(player) })),
    [playerResult.players],
  );

  const saveNumbers = (next: { min: string; max: string }) => {
    setNumberMin(next);
    safeSetStorageItem(NUMBERS_KEY, JSON.stringify(next));
  };
  const saveLabels = (next: string) => {
    setLabelText(next);
    safeSetStorageItem(LABELS_KEY, next);
  };
  const toggleTeam = (teamId: string) => {
    const next = playerFilter.teams === null
      ? teamIds.filter((id) => id !== teamId)
      : playerFilter.teams.includes(teamId)
        ? playerFilter.teams.filter((id) => id !== teamId)
        : [...playerFilter.teams, teamId];
    const normalized = next.length === 0 ? null : next.length >= teamIds.length ? null : next;
    setPlayerFilter((current) => ({ ...current, teams: normalized }));
    safeSetStorageItem(PLAYERS_KEY, JSON.stringify({ teams: normalized }));
  };
  const selectAllTeams = () => {
    setPlayerFilter((current) => ({ ...current, teams: null }));
    safeSetStorageItem(PLAYERS_KEY, JSON.stringify({ teams: null }));
  };

  const numberError = validateNumberRange(numberMin.min, numberMin.max).error;
  const parsedLabels = parseLabels(labelText);
  const labelExceeded = parsedLabels.length < parseLabels(labelText, Number.POSITIVE_INFINITY).length;
  const activeItems = mode === "numbers" ? numberItems : mode === "labels" ? labelItems : playerItems;
  const inputDisabled = spinning;

  return (
    <div className="wheel-panel">
      <div className="mode-nav" role="tablist" aria-label="转盘模式">
        <button
          aria-selected={mode === "numbers"}
          className={`mode-nav-button ${mode === "numbers" ? "mode-active" : ""}`}
          onClick={() => setMode("numbers")}
          role="tab"
          type="button"
        >数字</button>
        <button
          aria-selected={mode === "labels"}
          className={`mode-nav-button ${mode === "labels" ? "mode-active" : ""}`}
          onClick={() => setMode("labels")}
          role="tab"
          type="button"
        >标签</button>
        <button
          aria-selected={mode === "players"}
          className={`mode-nav-button ${mode === "players" ? "mode-active" : ""}`}
          onClick={() => setMode("players")}
          role="tab"
          type="button"
        >球员</button>
      </div>

      <div className="wheel-panel-input">
        {mode === "numbers" && (
          <div className="wheel-number-input">
            <label htmlFor="wheel-min">最小值</label>
            <input
              disabled={inputDisabled}
              id="wheel-min"
              inputMode="numeric"
              max="9999"
              min="0"
              onChange={(event) => saveNumbers({ ...numberMin, min: event.target.value })}
              type="number"
              value={numberMin.min}
            />
            <label htmlFor="wheel-max">最大值</label>
            <input
              disabled={inputDisabled}
              id="wheel-max"
              inputMode="numeric"
              max="9999"
              min="0"
              onChange={(event) => saveNumbers({ ...numberMin, max: event.target.value })}
              type="number"
              value={numberMin.max}
            />
            {numberError && <span className="wheel-input-error">{numberError}</span>}
          </div>
        )}
        {mode === "labels" && (
          <div className="wheel-label-input">
            <textarea
              aria-label="标签列表（每行一个）"
              disabled={inputDisabled}
              onChange={(event) => saveLabels(event.target.value)}
              placeholder="每行一个标签，例如：&#10;吃火锅&#10;看电影&#10;打篮球"
              rows={4}
              value={labelText}
            />
            {labelExceeded && <span className="wheel-input-error">仅保留前 100 个标签</span>}
          </div>
        )}
        {mode === "players" && (
          <div className="wheel-player-input">
            <div className="wheel-team-filter">
              <button disabled={inputDisabled} onClick={selectAllTeams} type="button">全选球队</button>
              <div className="wheel-team-list">
                {teams.map((team) => {
                  const selected = playerFilter.teams === null || playerFilter.teams.includes(team.id);
                  return (
                    <button
                      aria-pressed={selected}
                      className={selected ? "wheel-team-selected" : ""}
                      disabled={inputDisabled}
                      key={team.id}
                      onClick={() => toggleTeam(team.id)}
                      type="button"
                    >{team.name}</button>
                  );
                })}
              </div>
            </div>
            <input
              disabled={inputDisabled}
              onChange={(event) => setPlayerQuery(event.target.value)}
              placeholder="搜索球员（中英文名）"
              type="search"
              value={playerQuery}
            />
            <span className="wheel-player-count">
              {playerResult.truncated
                ? `命中 ${playerResult.total} 人，仅保留前 60 人，请收窄筛选`
                : `当前候选 ${playerResult.total} 人`}
            </span>
          </div>
        )}
      </div>

      <SpinWheel
        disabled={mode === "players" && (playerResult.total === 0 || playerResult.truncated)}
        emptyText={mode === "numbers" ? "请输入有效的数字范围" : mode === "labels" ? "请输入至少一个标签" : "没有匹配的球员"}
        items={activeItems}
        onPhaseChange={(phase) => setSpinning(phase === "spinning")}
        title={mode === "numbers" ? "数字转盘" : mode === "labels" ? "标签转盘" : "球员转盘"}
      />
    </div>
  );
}

export default WheelPanel;
