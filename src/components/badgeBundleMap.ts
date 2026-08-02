// Badge name -> attribute bundle (slot) mapping for the 13-slot builder.
// Each slot inherits badges from the player locked into that slot, mirroring
// how tendencies are inherited via tendencyBundleMap. A badge belongs to one
// primary slot; the same badge from two slots keeps the highest tier.
//
// Slot ids match RookieBuilder bundles: three, mid, finishing, dunk, handle,
// passing, perimeter, interior, steal, block, rebound, athletic, stability.

export const badgeBundleMap: Record<string, string> = {
  // —— 三分 (three) ——
  "Set Shot Specialist": "three",
  Deadeye: "three",
  "Limitless Range": "three",
  "Mini Marksman": "three",
  "Shifty Shooter": "three",
  "Slippery Off-Ball": "three",

  // —— 终结 (finishing) ——
  "Float Game": "finishing",
  "Layup Mixmaster": "finishing",
  "Paint Prodigy": "finishing",
  "Physical Finisher": "finishing",
  "Hook Specialist": "finishing",
  "Post Fade Phenom": "finishing",
  "Post Powerhouse": "finishing",
  "Post-Up Poet": "finishing",

  // —— 扣篮 (dunk) ——
  Posterizer: "dunk",
  "Rise Up": "dunk",

  // —— 控球 (handle) ——
  "Ankle Assassin": "handle",
  "Handles For Days": "handle",
  "Strong Handle": "handle",
  Unpluckable: "handle",

  // —— 传球 (passing) ——
  "Bail Out": "passing",
  "Break Starter": "passing",
  Dimer: "passing",
  "Versatile Visionary": "passing",

  // —— 外防 (perimeter) ——
  Challenger: "perimeter",
  "On-Ball Menace": "perimeter",
  "Off-Ball Pest": "perimeter",
  "Pick Dodger": "perimeter",

  // —— 抢断 (steal) ——
  Glove: "steal",
  Interceptor: "steal",

  // —— 盖帽 (block) ——
  "High-Flying Denier": "block",
  "Pogo Stick": "block",

  // —— 内防 (interior) ——
  "Paint Patroller": "interior",
  "Immovable Enforcer": "interior",
  "Post Lockdown": "interior",
  "Brick Wall": "interior",

  // —— 篮板 (rebound) ——
  "Boxout Beast": "rebound",
  "Rebound Chaser": "rebound",

  // —— 运动 (athletic) ——
  "Aerial Wizard": "athletic",
  "Lightning Launch": "athletic",
};
