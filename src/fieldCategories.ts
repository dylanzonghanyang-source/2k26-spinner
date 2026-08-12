/**
 * 球员卡字段分类（对齐用户「2k26 球员全部字段」表格的 6 大分类结构）。
 *
 * 表格列结构：资料 / 身体 / 属性 / 倾向 / 热区 / 徽章
 * 其中属性、倾向、热区、徽章内部还有子分类（如倾向分为跳投/上篮和扣篮/切入/传球/背身/自由发挥/防守）。
 * 导出文本和结果卡 UI 共用本模块的分组定义。
 */

/** 属性子分类（35 标准属性 + 16 耐久） */
export type AttributeGroup = { key: string; label: string; attrs: string[] };

export const durabilityAttrKeys = [
  "Head Durability", "Neck Durability", "Back Durability",
  "Left Shoulder Durability", "Right Shoulder Durability",
  "Left Elbow Durability", "Right Elbow Durability",
  "Left Hip Durability", "Right Hip Durability",
  "Left Knee Durability", "Right Knee Durability",
  "Left Ankle Durability", "Right Ankle Durability",
  "Left Foot Durability", "Right Foot Durability",
  "Overall Durability",
] as const;

export const attributeGroups: AttributeGroup[] = [
  {
    key: "offense", label: "进攻",
    attrs: ["Layup", "Post Fade", "Post Hook", "Post Control", "Draw Foul", "Close Shot",
      "Mid-Range Shot", "Three-Point Shot", "Free Throw", "Ball Handle", "Pass IQ",
      "Pass Accuracy", "Offensive Rebound", "Standing Dunk", "Driving Dunk", "Shot IQ",
      "Pass Vision", "Hands"],
  },
  { key: "defense", label: "防守", attrs: ["Defensive Rebound", "Interior Defense", "Perimeter Defense", "Block", "Steal"] },
  { key: "athletic", label: "运动", attrs: ["Speed", "Speed with Ball", "Vertical", "Stamina", "Hustle", "Agility"] },
  { key: "strength", label: "力量", attrs: ["Strength"] },
  { key: "durability", label: "耐久", attrs: [...durabilityAttrKeys] },
  { key: "mental", label: "精神", attrs: ["Pass Perception", "Defensive Consistency", "Help Defense IQ", "Offensive Consistency"] },
  { key: "misc", label: "杂项", attrs: ["Intangibles", "Potential", "Potential Min", "Potential Max"] },
];

/** 倾向子分类（对齐表格：跳投/上篮和扣篮/切入/传球/背身/自由发挥/防守） */
export type TendencyGroup = { key: string; label: string; fields: string[] };

export const tendencyGroups: TendencyGroup[] = [
  {
    key: "jumpshot", label: "跳投",
    // 字段顺序对齐 DB2K「2k26 球员全部字段」表（跨步跳投在前，区域按底角-45°-弧顶展开）。
    fields: ["Step Through Shot", "Shot Under Basket", "Shot Close", "Shot Close Left", "Shot Close Middle", "Shot Close Right",
      "Shot Mid-Range", "Spot Up Shot Mid-Range", "Off-Screen Shot Mid-Range",
      "Shot Mid Left", "Shot Mid Left-Center", "Shot Mid Center", "Shot Mid Right-Center", "Shot Mid Right",
      "Shot Three", "Spot Up Shot Three", "Off-Screen Shot Three",
      "Shot Three Left", "Shot Three Left-Center", "Shot Three Center", "Shot Three Right-Center", "Shot Three Right",
      "Contested Jumper Three", "Contested Jumper Mid-Range", "Stepback Three Point Shot",
      "Stepback Jumper Mid-Range", "Spin Jumper", "Transition Pull-Up Three Point Shot",
      "Drive Pull-Up Three", "Drive Pull-Up Mid-Range", "Use Glass"],
  },
  {
    key: "finish", label: "上篮和扣篮",
    // 对齐表格顺序：上篮 → 扣篮系列 → 空接/补篮/冲抢 → 转身/跳步/欧洲步/抛投。
    fields: ["Driving Layup", "Standing Dunk", "Driving Dunk", "Flashy Dunk",
      "Alley-Oop", "Putback", "Crash", "Spin Layup", "Hop Step Layup", "Euro Step Layup", "Floater"],
  },
  {
    key: "drive", label: "切入",
    // 对齐表格顺序：三威胁 → 运球调整 → 突破系列（变向→转身→后撤步→半转身→二次变相→…）。
    fields: ["Triple Threat Pump Fake", "Triple Threat Jab Step", "Triple Threat Idle", "Triple Threat Shoot",
      "Setup With Sizeup", "Setup With Hesitation", "No Setup Dribble",
      "Drive", "Spot Up Drive", "Off-Screen Drive", "Drive Right",
      "Driving Crossover", "Driving Spin", "Driving Stepback", "Driving Half Spin",
      "Driving Double Crossover", "Driving Behind the Back", "Driving Dribble Hesitation", "Driving In & Out",
      "No Driving Dribble Move", "Attack Strong on Drive"],
  },
  { key: "pass", label: "传球", fields: ["Dish to Open Man", "Flashy Pass", "Alley-Oop Pass"] },
  {
    key: "post", label: "背身",
    // 对齐表格顺序：单打 → 晃肩 → 面框 → 低位推进 → 强力单打 → 禁区投篮 → 勾手/后仰 → 上下步 → 后撤步 → 切入/转身/沉底步/跳步。
    fields: ["Post Up", "Post Shimmy Shot", "Post Face Up", "Post Back Down", "Post Aggressive Backdown",
      "Shoot From Post", "Post Hook Left", "Post Hook Right", "Post Fade Left", "Post Fade Right",
      "Post Up & Under", "Post Stepback Shot", "Post Drive", "Post Spin", "Post Drop Step", "Post Hop Step"],
  },
  {
    key: "iso", label: "自由发挥",
    fields: ["Shot", "Touches", "Roll vs Pop", "Transition Spot Up vs Cut to the Basket",
      "Iso vs Elite Defender", "Iso vs Good Defender", "Iso vs Average Defender", "Iso vs Poor Defender",
      "Play Discipline"],
  },
  {
    key: "defense", label: "防守",
    // 对齐表格顺序：干扰传球 → 制造进攻犯规 → 持球抢断 → 干扰投篮 → 盖帽 → 犯规 → 强硬犯规。
    fields: ["Pass Interception", "Take Charge", "On-Ball Steal", "ContestShot", "Block Shot", "Foul", "Hard Foul"],
  },
];

/** 热区子分类（篮下 / 中距离 / 三分） */
export type HotZoneGroup = { key: string; label: string; zones: string[] };

export const hotZoneGroups: HotZoneGroup[] = [
  { key: "inside", label: "篮下", zones: ["underBasket", "closeLeft", "closeMiddle", "closeRight"] },
  { key: "mid", label: "中距离", zones: ["midLeft", "midLeftCenter", "midCenter", "midRightCenter", "midRight"] },
  { key: "three", label: "三分", zones: ["threeLeft", "threeLeftCenter", "threeCenter", "threeRightCenter", "threeRight"] },
];

/**
 * 徽章子分类（对齐表格：内线得分/外线得分/组织/防守/运动能力/篮板/个性）。
 * 值使用 badge 英文名（badgeNameCN 的 key 形态），匹配时需 normalize。
 */
export type BadgeGroup = { key: string; label: string; badges: string[] };

export const badgeGroups: BadgeGroup[] = [
  { key: "inside", label: "内线得分", badges: ["Float Game", "Posterizer", "Bully", "Aerial Wizard", "Hook Specialist", "Layup Mixmaster", "Paint Prodigy", "Physical Finisher", "Post Powerhouse", "Post-Up Poet"] },
  { key: "outside", label: "外线得分", badges: ["Post Fade Phenom", "Deadeye", "Limitless Range", "Slippery Off-Ball", "Mini Marksman", "Set Shot Specialist", "Shifty Shooter"] },
  { key: "playmaking", label: "组织", badges: ["Bail Out", "Break Starter", "Dimer", "Handles For Days", "Unpluckable", "Versatile Visionary", "Ankle Assassin", "Lightning Launch", "Strong Handle"] },
  { key: "defense", label: "防守", badges: ["Post Lockdown", "Off-Ball Pest", "Pick Dodger", "Glove", "Interceptor", "High-Flying Denier", "On-Ball Menace", "Chasedown Artist", "Paint Patroller", "Challenger", "Pogo Stick", "Immovable Enforcer"] },
  { key: "athleticism", label: "运动能力", badges: ["Brick Wall", "Anchor"] },
  { key: "rebounding", label: "篮板", badges: ["Boxout Beast", "Rebound Chaser"] },
  { key: "personality", label: "个性", badges: ["Quiet", "Friendly", "Team Player", "Confident", "Vocal", "Pat My Back", "Expressive", "Moody", "Cool", "Media Friendly", "Warm Weather Fan", "Financially Savvy", "Alpha Dog", "Enforcer", "Strong Work Ethic", "Marketability"] },
];
