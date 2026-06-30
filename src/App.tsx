import { Download, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlayerWheel from "./components/PlayerWheel";
import {
  attributeGroups,
  attrGroupMap,
  attrNameCN,
  buildWheelItems,
  createDraftFromSources,
  createRandomSourceMap,
  getWheelTargetRotation,
  normalizeSourceMap,
  allHeights,
  randomWheelIndex,
  randomPosition,
  randomHeight,
  randomShoulderWidth,
  randomWingspan,
  randomWeight,
  type PlayerSource,
  type AttributeGroupKey,
  type BodyTemplate,
  type PlayerDraft,
  type SourceMap
} from "./domain";
import playerDatabase from "./data/players.json";

const appVersion = "v0.1";
const lastUpdated = "2026-06-30";

function formatPlayerName(name: string): string {
  const suffixMap: Record<string, string> = {
    jr: "Jr",
    sr: "Sr",
    ii: "II",
    iii: "III",
    iv: "IV",
    v: "V",
  };

  return name
    .trim()
    .split(/\s+/)
    .map((part) =>
      part
        .split(/([-'])/)
        .map((segment) => {
          if (segment === "-" || segment === "'") return segment;
          const lower = segment.toLowerCase();
          if (lower in suffixMap) return suffixMap[lower];
          return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
        })
        .join("")
    )
    .join(" ");
}

const chineseAliases: Record<string, string[]> = {
  "LeBron James": ["勒布朗", "詹姆斯", "詹皇"],
  "Stephen Curry": ["库里", "斯蒂芬库里"],
  "Kevin Durant": ["杜兰特", "KD"],
  "Nikola Jokic": ["约基奇", "约老师"],
  "Luka Doncic": ["东契奇", "卢卡"],
  "Giannis Antetokounmpo": ["字母哥", "阿德托昆博"],
  "Victor Wembanyama": ["文班亚马", "文班"],
  "Shai Gilgeous Alexander": ["亚历山大", "SGA"],
  "Jayson Tatum": ["塔图姆"],
  "Jaylen Brown": ["杰伦布朗"],
  "Anthony Davis": ["戴维斯", "浓眉"],
  "James Hardin": ["哈登", "大胡子"],
  "Kyrie Irving": ["欧文"],
  "Joel Embiid": ["恩比德"],
  "Ja Morant": ["莫兰特"],
  "Anthony Edwards": ["爱德华兹", "华子"],
  "Devin Booker": ["布克"],
  "Trae Young": ["特雷杨", "杨"],
  "Damian Lillard": ["利拉德"],
  "Jimmy Butler": ["巴特勒"],
  "Kawhi Leonard": ["莱昂纳德", "伦纳德"],
  "Paul George": ["乔治"],
  "Zion Williamson": ["锡安"],
  "LaMelo Ball": ["拉梅洛"],
  "Cade Cunningham": ["康宁汉姆"],
  "Donovan Mitchell": ["米切尔"],
  "Jalen Brunson": ["布伦森"],
  "Tyrese Haliburton": ["哈利伯顿"],
  "Bam Adebayo": ["阿德巴约"],
  "Chet Holmgren": ["霍姆格伦"],
  "Cooper Flagg": ["弗拉格"],
  "Bronny James": ["布朗尼"],
  "Draymond Green": ["追梦", "格林"],
  "Klay Thompson": ["克莱", "汤普森"],
  "Karl Anthony Towns": ["唐斯"],
  "Rudy Gobert": ["戈贝尔"],
  "Pascal Siakam": ["西亚卡姆"],
  "Domantas Sabonis": ["小萨博尼斯", "萨博尼斯"],
  "DeAaron Fox": ["福克斯"],
  "Darius Garland": ["加兰"],
  "Evan Mobley": ["莫布里"],
  "Donovan Clingan": ["克林根"],
  "Alperen Sengun": ["申京"],
  "Franz Wagner": ["小瓦格纳", "瓦格纳"],
  "Paolo Banchero": ["班凯罗"],
  "Scottie Barnes": ["巴恩斯"],
  "Jalen Green": ["杰伦格林"],
  "Tyrese Maxey": ["马克西"],
  "Jaren Jackson Jr": ["小贾伦", "贾伦杰克逊"],
  "Desmond Bane": ["贝恩"],
  "Lauri Markkanen": ["马尔卡宁"],
  "Mikal Bridges": ["布里奇斯", "大桥"],
  "Jalen Williams": ["杰伦威廉姆斯", "杰威"],
  "Jarrett Allen": ["阿伦"],
  "Nikola Vucevic": ["武切维奇"],
  "Jamal Murray": ["穆雷"],
  "Aaron Gordon": ["戈登"],
  "Brandon Miller": ["米勒"],
  "Brandon Ingram": ["英格拉姆", "莺歌"],
  "Ausar Thompson": ["奥萨尔汤普森"],
  "Amen Thompson": ["阿门汤普森"],
  "Scoot Henderson": ["亨德森"],
  "Shaedon Sharpe": ["夏普"],
  "Reed Sheppard": ["谢泼德"],
  "Rob Dillingham": ["迪林厄姆"],
  "Alexandre Sarr": ["萨尔"],
  "Zaccharie Risacher": ["里萨谢"],
  "Stephon Castle": ["卡斯尔"],
  "Cam Whitmore": ["惠特摩尔"],
  "Keyonte George": ["基昂特乔治"],
  "Walker Kessler": ["凯斯勒"],
  "Rui Hachimura": ["八村塁", "八村"],
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.'’\-]/g, "");
}

function matchesPlayerSearch(playerName: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const normalizedName = normalizeSearchText(playerName);
  if (normalizedName.includes(normalizedQuery)) return true;
  const aliases = chineseAliases[playerName] ?? [];
  return aliases.some((alias) => normalizeSearchText(alias).includes(normalizedQuery));
}

const playerPool = (playerDatabase as PlayerSource[]).map((player) => ({
  ...player,
  name: formatPlayerName(player.name),
}));
const spinDurationMs = 4200;

type PhysicalWheelKey = "position" | "height" | "shoulder" | "wingspan" | "weight";
type WheelKey = AttributeGroupKey | PhysicalWheelKey;
type WheelTab = { key: WheelKey; name: string; isPhysical: boolean };
type SaveFilePicker = (options?: {
  suggestedName?: string;
  types?: Array<{
    description: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<{
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}>;

const physicalWheelNames: Record<PhysicalWheelKey, string> = {
  position: "位置",
  height: "身高",
  shoulder: "肩宽",
  wingspan: "臂展",
  weight: "体重",
};

const initialWheelRotations: Record<WheelKey, number> = {
  shooting: 0,
  athleticism: 0,
  playmaking: 0,
  defense: 0,
  inside: 0,
  position: 0,
  height: 0,
  shoulder: 0,
  wingspan: 0,
  weight: 0,
};

function isAttributeGroupKey(key: WheelKey): key is AttributeGroupKey {
  return attributeGroups.some((group) => group.key === key);
}

function isPhysicalWheelKey(key: WheelKey): key is PhysicalWheelKey {
  return key in physicalWheelNames;
}

function getStatusValueSuffix(key: PhysicalWheelKey): string {
  if (key === "height") return " cm";
  if (key === "weight") return " kg";
  return "";
}

function createDraftText(draft: PlayerDraft): string {
  return [
    `球员模板: ${draft.position} / ${draft.height}`,
    `体型: ${draft.weight ?? "--"} kg | ${draft.wingspan} 臂展 | ${draft.shoulderWidth} 肩宽`,
    `来源: ${draft.sourceNames.join(" / ")}`,
    "",
    `投篮: ${draft.shooting}`,
    `运动: ${draft.athleticism}`,
    `组织: ${draft.playmaking}`,
    `防守: ${draft.defense}`,
    `内线: ${draft.inside}`,
    "",
    `Close Shot: ${draft.closeShot ?? "--"}`,
    `Mid-Range Shot: ${draft.midRangeShot ?? "--"}`,
    `Three-Point Shot: ${draft.threePointShot ?? "--"}`,
    `Free Throw: ${draft.freeThrow ?? "--"}`,
    `Offensive Consistency: ${draft.offensiveConsistency ?? "--"}`,
    `Shot IQ: ${draft.shotIQ ?? "--"}`,
    `Speed: ${draft.speed}`,
    `Agility: ${draft.agility ?? "--"}`,
    `Vertical: ${draft.vertical}`,
    `Strength: ${draft.strength}`,
    `Hustle: ${draft.hustle ?? "--"}`,
    `Stamina: ${draft.stamina ?? "--"}`,
    `Overall Durability: ${draft.overallDurability ?? "--"}`,
    `Ball Handle: ${draft.ballHandle ?? "--"}`,
    `Speed with Ball: ${draft.speedWithBall ?? "--"}`,
    `Pass Accuracy: ${draft.passAccuracy ?? "--"}`,
    `Pass Vision: ${draft.passVision ?? "--"}`,
    `Pass IQ: ${draft.passIQ ?? "--"}`,
    `Block: ${draft.block ?? "--"}`,
    `Steal: ${draft.steal ?? "--"}`,
    `Pass Perception: ${draft.passPerception ?? "--"}`,
    `Interior Defense: ${draft.interiorDefense ?? "--"}`,
    `Perimeter Defense: ${draft.perimeterDefense ?? "--"}`,
    `Defensive Consistency: ${draft.defensiveConsistency ?? "--"}`,
    `Help Defense IQ: ${draft.helpDefenseIQ ?? "--"}`,
    `Layup: ${draft.layup ?? "--"}`,
    `Driving Dunk: ${draft.drivingDunk ?? "--"}`,
    `Standing Dunk: ${draft.standingDunk ?? "--"}`,
    `Post Hook: ${draft.postHook ?? "--"}`,
    `Post Fade: ${draft.postFade ?? "--"}`,
    `Post Control: ${draft.postControl ?? "--"}`,
    `Draw Foul: ${draft.drawFoul ?? "--"}`,
    `Hands: ${draft.hands ?? "--"}`,
    `Offensive Rebound: ${draft.offensiveRebound ?? "--"}`,
    `Defensive Rebound: ${draft.defensiveRebound ?? "--"}`,
    `Intangibles: ${draft.intangibles ?? "--"}`
  ].join("\n");
}

const initialBodyTemplate: BodyTemplate = {
  position: "PG",
  height: "150",
  weight: 50,
  wingspan: "1",
  shoulderWidth: "1",
};

function createEmptyDraft(body: BodyTemplate = initialBodyTemplate): PlayerDraft {
  return {
    ...body,
    sourceNames: [],
    shooting: 0, athleticism: 0, playmaking: 0, defense: 0, inside: 0,
    closeShot: null, midRangeShot: null, threePointShot: null, freeThrow: null,
    offensiveConsistency: null, shotIQ: null,
    speed: 0, agility: null, vertical: 0, strength: 0, hustle: null, stamina: null, overallDurability: null,
    ballHandle: null, speedWithBall: null, passAccuracy: null, passVision: null, passIQ: null,
    block: null, steal: null, passPerception: null, interiorDefense: null, perimeterDefense: null,
    defensiveConsistency: null, helpDefenseIQ: null,
    layup: null, drivingDunk: null, standingDunk: null, postHook: null, postFade: null, postControl: null,
    drawFoul: null, hands: null, offensiveRebound: null, defensiveRebound: null, intangibles: null,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseRangeInput(value: string, fallback: number) {
  if (value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function RangeSlider({
  label,
  min,
  max,
  onMinChange,
  onMaxChange,
  absoluteMin,
  absoluteMax,
  color,
  disabled = false,
}: {
  label: string;
  min: number;
  max: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
  absoluteMin: number;
  absoluteMax: number;
  color: string;
  disabled?: boolean;
}) {
  const handleMinInput = (value: string) => {
    const next = clampNumber(parseRangeInput(value, min), absoluteMin, max);
    onMinChange(next);
  };

  const handleMaxInput = (value: string) => {
    const next = clampNumber(parseRangeInput(value, max), min, absoluteMax);
    onMaxChange(next);
  };

  return (
    <div className={`flex flex-col gap-2 rounded-md border border-ink-700/10 bg-white/60 px-3 py-2 select-none ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] leading-none">
        <span className="shrink-0 font-medium text-ink-700">{label}</span>
        <div className="flex items-center gap-1.5">
          <input
            aria-label={`${label}下限`}
            className="h-6 w-14 rounded border border-ink-700/10 bg-white px-1 text-center text-[11px] font-semibold tabular-nums text-ink-900 outline-none transition focus:border-court-500/50 focus:ring-2 focus:ring-court-300/30 disabled:cursor-not-allowed"
            disabled={disabled}
            inputMode="numeric"
            max={max}
            min={absoluteMin}
            onChange={(e) => handleMinInput(e.target.value)}
            style={{ color }}
            type="number"
            value={min}
          />
          <span className="text-ink-400">–</span>
          <input
            aria-label={`${label}上限`}
            className="h-6 w-14 rounded border border-ink-700/10 bg-white px-1 text-center text-[11px] font-semibold tabular-nums text-ink-900 outline-none transition focus:border-court-500/50 focus:ring-2 focus:ring-court-300/30 disabled:cursor-not-allowed"
            disabled={disabled}
            inputMode="numeric"
            max={absoluteMax}
            min={min}
            onChange={(e) => handleMaxInput(e.target.value)}
            style={{ color }}
            type="number"
            value={max}
          />
        </div>
      </div>
      <div className="relative h-7">
        {/* 背景条 */}
        <div
          className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full pointer-events-none"
          style={{
            background: `linear-gradient(to right,
              rgba(38,71,83,0.13) 0%,
              rgba(38,71,83,0.13) ${((min - absoluteMin) / (absoluteMax - absoluteMin)) * 100}%,
              ${color} ${((min - absoluteMin) / (absoluteMax - absoluteMin)) * 100}%,
              ${color} ${((max - absoluteMin) / (absoluteMax - absoluteMin)) * 100}%,
              rgba(38,71,83,0.13) ${((max - absoluteMin) / (absoluteMax - absoluteMin)) * 100}%
            )`,
          }}
        />
        {/* 最小值滑块 */}
        <input
          type="range"
          className="absolute top-0 left-0 z-10 h-full w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--slider-thumb)] [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(31,73,86,0.28)] [&::-webkit-slider-track]:appearance-none [&::-webkit-slider-track]:bg-transparent"
          style={{ "--slider-thumb": color, background: "transparent" } as React.CSSProperties}
          min={absoluteMin}
          max={max}
          value={min}
          disabled={disabled}
          onChange={(e) => onMinChange(Number(e.target.value))}
        />
        {/* 最大值滑块 */}
        <input
          type="range"
          className="absolute top-0 left-0 z-20 h-full w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--slider-thumb)] [&::-webkit-slider-thumb]:shadow-[0_2px_10px_rgba(31,73,86,0.28)] [&::-webkit-slider-track]:appearance-none [&::-webkit-slider-track]:bg-transparent"
          style={{ "--slider-thumb": color, background: "transparent" } as React.CSSProperties}
          min={min}
          max={absoluteMax}
          value={max}
          disabled={disabled}
          onChange={(e) => onMaxChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

const App = () => {
  const [draft, setDraft] = useState<PlayerDraft>(() => createEmptyDraft());
  const [selectedPool, setSelectedPool] = useState<string[]>([]);
  const [activeGroupKey, setActiveGroupKey] = useState<WheelKey>("shooting");
  const [sourceMap, setSourceMap] = useState<SourceMap | null>(null);
  const [bodyTemplate, setBodyTemplate] = useState<BodyTemplate>(initialBodyTemplate);
  const [poolSearch, setPoolSearch] = useState("");
  const [wheelRotations, setWheelRotations] = useState<Record<WheelKey, number>>(initialWheelRotations);
  const [isSpinning, setIsSpinning] = useState(false);
  const [statusText, setStatusText] = useState("先选球员，再转轮盘");
  const spinTimerRef = useRef<number | null>(null);

  const [positionVal, setPositionVal] = useState(initialBodyTemplate.position);
  const [heightVal, setHeightVal] = useState(initialBodyTemplate.height);
  const [shoulderVal, setShoulderVal] = useState(initialBodyTemplate.shoulderWidth);
  const [wingspanVal, setWingspanVal] = useState(initialBodyTemplate.wingspan);
  const [weightVal, setWeightVal] = useState(String(initialBodyTemplate.weight));
  const [weightMin, setWeightMin] = useState(50);
  const [weightMax, setWeightMax] = useState(200);


  // Range sliders for physical attributes
  const [heightMin, setHeightMin] = useState(150);
  const [heightMax, setHeightMax] = useState(300);
  const [shoulderMin, setShoulderMin] = useState(1);
  const [shoulderMax, setShoulderMax] = useState(100);
  const [wingspanMin, setWingspanMin] = useState(1);
  const [wingspanMax, setWingspanMax] = useState(100);
  const [posFilter, setPosFilter] = useState<string[]>(["PG", "SG", "SF", "PF", "C"]);

  const availablePlayers = useMemo(
    () => selectedPool.length > 0
      ? playerPool.filter((player) => selectedPool.includes(player.name))
      : [],
    [selectedPool]
  );

  const activeGroup = isAttributeGroupKey(activeGroupKey)
    ? attributeGroups.find((g) => g.key === activeGroupKey) ?? attributeGroups[0]
    : attributeGroups[0];
  const activeSource = sourceMap && isAttributeGroupKey(activeGroupKey) ? sourceMap[activeGroupKey] : undefined;

  const allTabs = useMemo<WheelTab[]>(() => [
    ...attributeGroups.map((g) => ({ key: g.key, name: g.name, isPhysical: false })),
    { key: "position", name: physicalWheelNames.position, isPhysical: true },
    { key: "height", name: physicalWheelNames.height, isPhysical: true },
    { key: "shoulder", name: physicalWheelNames.shoulder, isPhysical: true },
    { key: "wingspan", name: physicalWheelNames.wingspan, isPhysical: true },
    { key: "weight", name: physicalWheelNames.weight, isPhysical: true },
  ], []);

  const activeTab = allTabs.find((t) => t.key === activeGroupKey) ?? allTabs[0];
  const activeWheelRotation = wheelRotations[activeGroupKey] ?? 0;


  const attrDefs = useMemo(() => {
    return [
      ["Close Shot", "closeShot", draft.closeShot],
      ["Mid-Range Shot", "midRangeShot", draft.midRangeShot],
      ["Three-Point Shot", "threePointShot", draft.threePointShot],
      ["Free Throw", "freeThrow", draft.freeThrow],
      ["Offensive Consistency", "offensiveConsistency", draft.offensiveConsistency],
      ["Shot IQ", "shotIQ", draft.shotIQ],
      ["Speed", "speed", draft.speed],
      ["Strength", "strength", draft.strength],
      ["Agility", "agility", draft.agility],
      ["Vertical", "vertical", draft.vertical],
      ["Hustle", "hustle", draft.hustle],
      ["Stamina", "stamina", draft.stamina],
      ["Overall Durability", "overallDurability", draft.overallDurability],
      ["Ball Handle", "ballHandle", draft.ballHandle],
      ["Speed with Ball", "speedWithBall", draft.speedWithBall],
      ["Pass Accuracy", "passAccuracy", draft.passAccuracy],
      ["Pass Vision", "passVision", draft.passVision],
      ["Pass IQ", "passIQ", draft.passIQ],
      ["Block", "block", draft.block],
      ["Steal", "steal", draft.steal],
      ["Pass Perception", "passPerception", draft.passPerception],
      ["Interior Defense", "interiorDefense", draft.interiorDefense],
      ["Perimeter Defense", "perimeterDefense", draft.perimeterDefense],
      ["Defensive Consistency", "defensiveConsistency", draft.defensiveConsistency],
      ["Help Defense IQ", "helpDefenseIQ", draft.helpDefenseIQ],
      ["Layup", "layup", draft.layup],
      ["Driving Dunk", "drivingDunk", draft.drivingDunk],
      ["Standing Dunk", "standingDunk", draft.standingDunk],
      ["Post Hook", "postHook", draft.postHook],
      ["Post Fade", "postFade", draft.postFade],
      ["Post Control", "postControl", draft.postControl],
      ["Draw Foul", "drawFoul", draft.drawFoul],
      ["Hands", "hands", draft.hands],
      ["Offensive Rebound", "offensiveRebound", draft.offensiveRebound],
      ["Defensive Rebound", "defensiveRebound", draft.defensiveRebound],
      ["Intangibles", "intangibles", draft.intangibles],
    ].sort((a, b) => ((b[2] as number) ?? 0) - ((a[2] as number) ?? 0));
  }, [draft]);

  const detailedAttrs: {label: string; value: string | number | null}[] = attrDefs.map(([label, , value]) => ({ label: label as string, value }));
  const sourceEntries = attributeGroups.map((group) => ({
    group,
    player: sourceMap?.[group.key] ?? null,
  }));

  const filteredHeights = useMemo(() => {
    return allHeights().filter((h) => {
      const cm = parseInt(h, 10);
      return cm >= heightMin && cm <= heightMax;
    });
  }, [heightMin, heightMax]);

  const filteredShoulders = useMemo(() => {
    return Array.from({length: shoulderMax - shoulderMin + 1}, (_, i) => `${shoulderMin + i}`);
  }, [shoulderMin, shoulderMax]);

  const filteredWingspans = useMemo(() => {

    return Array.from({length: wingspanMax - wingspanMin + 1}, (_, i) => `${wingspanMin + i}`);
  }, [wingspanMin, wingspanMax]);


  const filteredWeights = useMemo(() => {
    return Array.from({length: weightMax - weightMin + 1}, (_, i) => `${weightMin + i}`);
  }, [weightMin, weightMax]);

  const posOpts = useMemo(() => posFilter, [posFilter]);

  const physicalOptionsByKey = useMemo<Record<PhysicalWheelKey, string[]>>(() => ({
    position: posOpts,
    height: filteredHeights,
    shoulder: filteredShoulders,
    wingspan: filteredWingspans,
    weight: filteredWeights,
  }), [filteredHeights, filteredShoulders, filteredWeights, filteredWingspans, posOpts]);

  const activeWheelItems = useMemo(() => {
    if (isPhysicalWheelKey(activeTab.key)) {
      return buildWheelItems(physicalOptionsByKey[activeTab.key]);
    }

    return buildWheelItems(availablePlayers.map((player) => player.name));
  }, [activeTab.key, availablePlayers, physicalOptionsByKey]);

  const activeCurrentLabel = isPhysicalWheelKey(activeTab.key)
    ? activeTab.key === "position"
      ? positionVal
      : activeTab.key === "height"
        ? heightVal
        : activeTab.key === "shoulder"
          ? shoulderVal
          : activeTab.key === "wingspan"
            ? wingspanVal
            : weightVal
    : activeSource?.name;
  const hasDraftBody = bodyTemplate.position !== initialBodyTemplate.position
    || bodyTemplate.height !== initialBodyTemplate.height
    || bodyTemplate.weight !== initialBodyTemplate.weight
    || bodyTemplate.wingspan !== initialBodyTemplate.wingspan
    || bodyTemplate.shoulderWidth !== initialBodyTemplate.shoulderWidth;
  const hasGeneratedDraft = hasDraftBody || draft.sourceNames.length > 0;

  const applyBody = useCallback((pos: string, ht: string, sw: string, ws: string, wt: string) => {
    const parsedWeight = Number.parseInt(wt, 10);
    const template: BodyTemplate = {
      position: pos,
      height: ht,
      weight: Number.isFinite(parsedWeight) ? parsedWeight : bodyTemplate.weight,
      wingspan: ws,
      shoulderWidth: sw
    };
    setBodyTemplate(template);
    setDraft((current) => sourceMap ? createDraftFromSources(sourceMap, template) : { ...current, ...template });
  }, [bodyTemplate.weight, sourceMap]);

  const chooseRandom = useCallback(<T,>(options: readonly T[], fallback: T): T => {
    return options.length > 0 ? options[Math.floor(Math.random() * options.length)] : fallback;
  }, []);

  const clearSpinTimer = useCallback(() => {
    if (spinTimerRef.current !== null) {
      window.clearTimeout(spinTimerRef.current);
      spinTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearSpinTimer();
  }, [clearSpinTimer]);

  const togglePool = (name: string) => {
    if (isSpinning) return;
    const nextPool = selectedPool.includes(name)
      ? selectedPool.filter((e) => e !== name)
      : [...selectedPool, name];
    setSelectedPool(nextPool);
    if (nextPool.length === 0) {
      setSourceMap(null);
      setDraft(createEmptyDraft(bodyTemplate));
      setStatusText("球员池已清空");
      return;
    }
    const normalized = sourceMap ? normalizeSourceMap(nextPool, sourceMap, playerPool) : createRandomSourceMap(nextPool, playerPool);
    setSourceMap(normalized);
    setDraft(createDraftFromSources(normalized, bodyTemplate));
    setStatusText("球员池已更新");
  };

  const selectAllPlayers = () => {
    if (isSpinning) return;
    const nextPool = playerPool.map((p) => p.name);
    const normalized = sourceMap ? normalizeSourceMap(nextPool, sourceMap, playerPool) : createRandomSourceMap(nextPool, playerPool);
    setSelectedPool(nextPool);
    setSourceMap(normalized);
    setDraft(createDraftFromSources(normalized, bodyTemplate));
    setStatusText("已全选");
  };

  const clearPool = () => {
    if (isSpinning) return;
    setSelectedPool([]);
    setSourceMap(null);
    setDraft(createEmptyDraft(bodyTemplate));
    setStatusText("球员池已清空");
  };

  const startWheelSpin = useCallback(({
    itemCount,
    key,
    onFinish,
    spins = 5,
    status,
    targetIndex,
  }: {
    itemCount: number;
    key: WheelKey;
    onFinish: () => void;
    spins?: number;
    status?: string;
    targetIndex: number;
  }) => {
    if (isSpinning || itemCount <= 0 || targetIndex < 0) return;

    const currentRotation = wheelRotations[key] ?? 0;
    const nextRotation = getWheelTargetRotation({
      currentRotation,
      fullTurns: spins,
      itemCount,
      targetIndex,
    });

    clearSpinTimer();
    setWheelRotations((current) => ({ ...current, [key]: nextRotation }));
    setIsSpinning(true);
    if (status) setStatusText(status);

    spinTimerRef.current = window.setTimeout(() => {
      onFinish();
      setIsSpinning(false);
      spinTimerRef.current = null;
    }, spinDurationMs);
  }, [clearSpinTimer, isSpinning, wheelRotations]);

  const spinPhysicalWheel = useCallback((key: PhysicalWheelKey) => {
    const options = physicalOptionsByKey[key];
    const winnerIndex = randomWheelIndex(options.length);
    const value = options[winnerIndex];
    if (!value) return;

    startWheelSpin({
      itemCount: options.length,
      key,
      status: `正在抽取「${physicalWheelNames[key]}」`,
      targetIndex: winnerIndex,
      spins: 4 + Math.floor(Math.random() * 2),
      onFinish: () => {
        if (key === "position") {
          setPositionVal(value);
          applyBody(value, heightVal, shoulderVal, wingspanVal, weightVal);
        } else if (key === "height") {
          setHeightVal(value);
          applyBody(positionVal, value, shoulderVal, wingspanVal, weightVal);
        } else if (key === "shoulder") {
          setShoulderVal(value);
          applyBody(positionVal, heightVal, value, wingspanVal, weightVal);
        } else if (key === "wingspan") {
          setWingspanVal(value);
          applyBody(positionVal, heightVal, shoulderVal, value, weightVal);
        } else {
          setWeightVal(value);
          applyBody(positionVal, heightVal, shoulderVal, wingspanVal, value);
        }

        setStatusText(`${physicalWheelNames[key]} → ${value}${getStatusValueSuffix(key)}`);
      },
    });
  }, [applyBody, heightVal, physicalOptionsByKey, positionVal, shoulderVal, startWheelSpin, weightVal, wingspanVal]);

  const spinCurrentGroup = useCallback(() => {
    if (!isAttributeGroupKey(activeGroupKey) || availablePlayers.length === 0) return;

    const winnerIndex = randomWheelIndex(availablePlayers.length);
    const target = availablePlayers[winnerIndex];
    if (!target) return;

    startWheelSpin({
      itemCount: availablePlayers.length,
      key: activeGroupKey,
      status: `正在转出「${activeGroup.name}」来源`,
      targetIndex: winnerIndex,
      spins: 5 + Math.floor(Math.random() * 2),
      onFinish: () => {
        const nextSources = {
          ...(sourceMap ?? createRandomSourceMap(selectedPool, playerPool)),
          [activeGroupKey]: target,
        } as SourceMap;
        setSourceMap(nextSources);
        setDraft(createDraftFromSources(nextSources, bodyTemplate));
        setStatusText(`${activeGroup.name} → ${target.name}`);
      },
    });
  }, [activeGroup.name, activeGroupKey, availablePlayers, bodyTemplate, selectedPool, sourceMap, startWheelSpin]);

  const handleActiveWheelSpin = useCallback(() => {
    if (isPhysicalWheelKey(activeGroupKey)) {
      spinPhysicalWheel(activeGroupKey);
      return;
    }

    spinCurrentGroup();
  }, [activeGroupKey, spinCurrentGroup, spinPhysicalWheel]);

  const randomizeAll = () => {
    if (isSpinning || playerPool.length === 0) return;
    const nextSources = createRandomSourceMap(selectedPool, playerPool);
    const pos = chooseRandom(posOpts, randomPosition());
    const ht = chooseRandom(filteredHeights, randomHeight());
    const sw = chooseRandom(filteredShoulders, randomShoulderWidth());
    const ws = chooseRandom(filteredWingspans, randomWingspan());
    const wt = chooseRandom(filteredWeights, randomWeight());

    const template: BodyTemplate = { position: pos, height: ht, weight: parseInt(wt, 10), wingspan: ws, shoulderWidth: sw };
    setPositionVal(pos);
    setHeightVal(ht);
    setShoulderVal(sw);
    setWingspanVal(ws);
    setWeightVal(wt);

    setSourceMap(nextSources);
    setBodyTemplate(template);
    setDraft(createDraftFromSources(nextSources, template));

    const activeTargetIndex = isPhysicalWheelKey(activeTab.key)
      ? activeWheelItems.findIndex((item) => item.label === (activeTab.key === "position" ? pos : activeTab.key === "height" ? ht : activeTab.key === "shoulder" ? sw : activeTab.key === "wingspan" ? ws : wt))
      : activeWheelItems.findIndex((item) => item.label === nextSources[activeGroupKey as AttributeGroupKey]?.name);

    if (activeTargetIndex >= 0 && activeWheelItems.length > 0) {
      setWheelRotations((current) => ({
        ...current,
        [activeTab.key]: getWheelTargetRotation({
          currentRotation: current[activeTab.key] ?? 0,
          fullTurns: 2 + Math.floor(Math.random() * 2),
          itemCount: activeWheelItems.length,
          targetIndex: activeTargetIndex,
        }),
      }));
    }

    setStatusText("已重新洗牌");
  };

  const exportDraft = async () => {
    await navigator.clipboard.writeText(createDraftText(draft));
    setStatusText("清单已复制");
  };

  const fallbackDownloadDraftFile = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "2k26-spinner-draft.txt";
    anchor.rel = "noopener";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadDraftFile = async () => {
    const blob = new Blob([createDraftText(draft)], { type: "text/plain;charset=utf-8" });
    const showSaveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

    if (showSaveFilePicker) {
      try {
        const handle = await showSaveFilePicker({
          suggestedName: "2k26-spinner-draft.txt",
          types: [
            {
              description: "Text file",
              accept: { "text/plain": [".txt"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setStatusText("文件已导出");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setStatusText("已取消导出");
          return;
        }
      }
    }

    fallbackDownloadDraftFile(blob);
    setStatusText("文件已导出");
  };

  return (
    <main className="min-h-screen text-ink-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-3 px-3 py-3 sm:px-4">

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700/10 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-court-500/20 bg-court-100 text-[10px] font-bold text-court-800">
              2K
            </div>
            <h1 className="text-[15px] font-semibold tracking-[-0.01em]">球员轮盘生成器</h1>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            <span className="text-ink-700/60">混合能力 · 快速出卡</span>
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium text-ink-600">{appVersion} · {lastUpdated}</span>
            <span className="font-medium text-court-700">{statusText}</span>
          </div>
        </header>

        {/* TOP HALF — two columns: left=ranges, right=wheel */}
        <div className="grid gap-x-4 gap-y-3 md:grid-cols-[288px_1fr] md:grid-rows-[1fr_auto]">

          {/* Left column — range sliders + player pool */}
          <aside className="flex flex-col gap-3 h-full">
            {/* Range sliders */}
            <div className="panel-surface px-4 py-3.5">
              <div className="section-label mb-3.5">身材抽奖范围</div>
              <div className="grid gap-3">
                <RangeSlider
                  label="身高 (cm)"
                  min={heightMin}
                  max={heightMax}
                  onMinChange={setHeightMin}
                  onMaxChange={setHeightMax}
                  absoluteMin={150}
                  absoluteMax={300}
                  color="#4b83b8"
                  disabled={isSpinning}
                />
                <RangeSlider
                  label="肩宽"
                  min={shoulderMin}
                  max={shoulderMax}
                  onMinChange={setShoulderMin}
                  onMaxChange={setShoulderMax}
                  absoluteMin={1}
                  absoluteMax={100}
                  color="#b86f5a"
                  disabled={isSpinning}
                />
                <RangeSlider
                  label="臂展"
                  min={wingspanMin}
                  max={wingspanMax}
                  onMinChange={setWingspanMin}
                  onMaxChange={setWingspanMax}
                  absoluteMin={1}
                  absoluteMax={100}
                  color="#2f9d83"
                  disabled={isSpinning}
                />
                <RangeSlider
                  label="体重 (kg)"
                  min={weightMin}
                  max={weightMax}
                  onMinChange={setWeightMin}
                  onMaxChange={setWeightMax}
                  absoluteMin={50}
                  absoluteMax={200}
                  color="#8f72be"
                  disabled={isSpinning}
                />
              </div>
            </div>

            {/* Position filter */}
            <div className="panel-surface px-4 py-3.5">
              <div className="section-label mb-3">位置抽奖池</div>
              <div className="grid grid-cols-5 gap-1.5">
                {["PG", "SG", "SF", "PF", "C"].map((pos) => {
                  const active = posFilter.includes(pos);
                  return (
                    <button
                      key={pos}
                      className={`flex h-7 min-w-0 items-center justify-center rounded text-[11px] font-medium transition ${
                        active
                          ? "border border-court-500/25 bg-court-100 text-court-800"
                          : "border border-ink-700/10 bg-white text-ink-600 hover:border-court-500/22 hover:bg-court-50 hover:text-ink-900"
                      }`}
                      onClick={() => {
                        setPosFilter((prev) => {
                          if (!prev.includes(pos)) return [...prev, pos];
                          if (prev.length === 1) return prev;
                          return prev.filter((p) => p !== pos);
                        });
                      }}
                      disabled={isSpinning}
                      type="button"
                    >
                      {pos}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Player pool */}
            <div className="panel-surface flex flex-col">
              <div className="flex items-center gap-2 border-b border-ink-700/10 px-3 py-2">
                <input
                  className="flex-1 bg-transparent text-[13px] text-ink-900 placeholder:text-ink-500/60 outline-none"
                  placeholder="搜索球员 / 中文名 / 外号..."
                  value={poolSearch}
                  onChange={(e) => setPoolSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 border-b border-ink-700/10 px-3 py-1.5">
                <span className="text-[11px] text-ink-600">{selectedPool.length}/{playerPool.length}</span>
                <span className="text-[10px] text-ink-300">|</span>
                <button
                  className="text-[11px] text-ink-600 transition hover:text-ink-900 disabled:opacity-40"
                  disabled={isSpinning}
                  onClick={selectAllPlayers}
                  type="button"
                >
                  全选
                </button>
                <button
                  className="text-[11px] text-ink-600 transition hover:text-ink-900 disabled:opacity-40"
                  disabled={isSpinning || selectedPool.length === 0}
                  onClick={clearPool}
                  type="button"
                >
                  清空
                </button>
              </div>
              <div className="overflow-y-auto max-h-[320px]">
                {playerPool
                  .filter((p) => matchesPlayerSearch(p.name, poolSearch))

                  .map((player) => {
                    const active = selectedPool.includes(player.name);
                    return (
                      <button
                        key={player.name}
                        className={`flex w-full items-center justify-between border-b border-ink-700/5 px-3 py-1 text-left text-sm transition ${
                          active ? "bg-court-50 text-court-900" : "text-ink-700 hover:bg-ink-100/60"
                        }`}
                        disabled={isSpinning}
                        onClick={() => togglePool(player.name)}
                        type="button"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className={"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition " + (active ? "border-court-600 bg-court-600" : "border-ink-400/40 bg-white")}>
                {active && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
              </span>
                          {player.name}
                        </span>
                        {active && <span className="shrink-0 text-[10px] text-court-700">已选</span>}
                      </button>
                    );
                  })}
              </div>
            </div>
          </aside>

          {/* Right — wheel + physical wheels + draft card */}
          <section className="flex flex-col gap-3 h-full">
            {/* All tabs — ability + physical */}
            <div className="panel-surface">
              <div className="flex flex-wrap">
                {allTabs.map((tab) => {
                  const active = tab.key === activeGroupKey;
                  return (
                    <button
                      key={tab.key}
                      className={`flex-1 py-2 text-center text-[11px] transition ${
                        active
                          ? (tab.isPhysical ? "bg-ink-100 text-ink-900 font-medium" : "bg-court-100 text-court-900 font-medium")
                          : "bg-white/50 text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                      }`}
                      disabled={isSpinning}
                      onClick={() => { setActiveGroupKey(tab.key); setStatusText(tab.name); }}
                      type="button"
                    >
                      {tab.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Wheel — full width, adapts to active tab */}
            <div className="panel-surface flex flex-1 flex-col p-4">
              <PlayerWheel
                activeGroupName={activeTab.name}
                currentLabel={activeCurrentLabel}
                disabled={activeWheelItems.length === 0}
                emptyText={activeTab.isPhysical ? "没有可用范围" : "先选择球员"}
                isSpinning={isSpinning}
                items={activeWheelItems}
                mode={activeTab.isPhysical ? "physical" : "ability"}
                onSpin={handleActiveWheelSpin}
                rotation={activeWheelRotation}
                spinLabel={activeTab.isPhysical ? "开始" : "转盘"}
              />
            </div>
            {/* Player card + actions — horizontal bar */}
            <div className="panel-surface md:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-stretch">
                {/* Draft card */}
                <div className="flex-[2] border-b border-ink-700/10 bg-gradient-to-r from-court-50 to-transparent px-4 py-3 sm:border-b-0 sm:border-r">
                  <div className="section-label">球员卡片</div>
                  {hasGeneratedDraft ? (
                    <>
                      <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{draft.position} / {draft.height}</div>
                      <div className="text-[12px] text-ink-600">
                        {draft.wingspan} 臂展 · {draft.weight ?? "--"} kg · {draft.shoulderWidth} 肩宽
                      </div>
                      <div className="text-[11px] text-ink-500">
                        {draft.sourceNames.length > 0 ? draft.sourceNames.join(" · ") : "来源待抽取"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em] text-ink-500">待抽取</div>
                      <div className="text-[12px] text-ink-500">身高、臂展、体重与来源待抽取</div>
                      <div className="text-[11px] text-ink-400">点击转盘开始生成球员卡片</div>
                    </>
                  )}
                </div>

                {/* Buttons */}
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:py-0">
                  <button
                    className="action-button px-3 py-2 text-[13px]"
                    onClick={exportDraft} disabled={isSpinning} type="button"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    复制清单
                  </button>
                  <button
                    className="action-button px-3 py-2 text-[13px]"
                    onClick={downloadDraftFile} disabled={isSpinning} type="button"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出文件
                  </button>
                  <button
                    className="action-button px-3 py-2 text-[13px]"
                    onClick={randomizeAll} disabled={isSpinning} type="button"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    全部重抽
                  </button>
                </div>
              </div>

            </div>
          </section>

          {/* BOTTOM — full width */}
          <div className="flex flex-col gap-3 md:col-span-2 pt-3">
            <div className="panel-surface">
              <div className="section-label border-b border-ink-700/10 px-3 py-2">
                来源分配
              </div>
              <div className="grid grid-cols-2 gap-px bg-ink-200/70 sm:grid-cols-3 lg:grid-cols-5">
                {sourceEntries.map(({ group, player }) => (
                  <div key={group.key} className="bg-white px-3 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-[0.1em] text-ink-500">{group.name}</div>
                    <div className={`mt-0.5 truncate text-[12px] font-medium ${player ? "text-ink-900" : "text-ink-400"}`}>
                      {player?.name ?? "待抽取"}
                    </div>
                  </div>

                ))}
              </div>
            </div>
            <div className="panel-surface">
              <div className="section-label border-b border-ink-700/10 px-3 py-2">
                详细属性 · {detailedAttrs.length} 项
              </div>
              <div className="grid gap-px bg-ink-200/70 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                {(["shooting","athleticism","playmaking","defense","inside"] as const).map((groupKey: "shooting" | "athleticism" | "playmaking" | "defense" | "inside") => {
                  const group = attrGroupMap[groupKey];
                  const groupAttrs: typeof detailedAttrs = detailedAttrs.filter((a: {label: string}) => (group.attrs as string[]).includes(a.label));
                  if (groupAttrs.length === 0) return null;
                  return (
                    <div key={groupKey} className="bg-white">
                      <div
                        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                        style={{ color: group.color, backgroundColor: group.color + "10" }}
                      >
                        {group.name}
                      </div>
                      <div className="divide-y divide-ink-700/8">
                        {groupAttrs.map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between px-3 py-1.5">
                            <span className="text-[12px] text-ink-600">{attrNameCN[label] ?? label}</span>
                            <span className="text-xs font-semibold text-ink-900 tabular-nums">{value != null ? String(value) : "--"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <footer className="panel-surface px-3 py-2.5 text-[11px] leading-5 text-ink-600">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  非 NBA、2K 或 2K Sports 官方项目，仅供娱乐和自用测试；球员数据与属性翻译可能存在误差。
                </p>
                <p className="shrink-0 text-ink-500">
                  反馈入口：中文名、属性翻译或球员缺失可以直接把截图和建议发给作者。
                </p>
              </div>
            </footer>

        </div>
        </div>

      </div>

    </main>
  );
}

export default App;
