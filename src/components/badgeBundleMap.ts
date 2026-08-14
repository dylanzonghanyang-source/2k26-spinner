// Badge name -> attribute bundle (slot) mapping for the multi-slot builder.
// Each slot inherits badges from the player locked into that slot, mirroring
// how tendencies are inherited via tendencyBundleMap. A badge belongs to one
// primary slot(s); the same badge from multiple slots keeps the highest tier.
//
// Slot ids match RookieBuilder bundles: three, mid, face, post, dunk, handle,
// passing, perimeter, interior, steal, block, rebound, athletic, stability.

export const badgeBundleMap: Record<string, string | string[]> = {
  // —— 三分 (three) ——
  "Set Shot Specialist": ["three", "mid"],
  Deadeye: ["three", "mid"],
  "Limitless Range": "three",
  "Mini Marksman": ["three", "mid"],
  "Shifty Shooter": ["three", "mid"],
  "Slippery Off-Ball": ["three", "mid"],

  // —— 面框 (face) ——
  "Float Game": "face",
  "Layup Mixmaster": "face",
  "Paint Prodigy": "face",
  "Physical Finisher": "face",

  // —— 背身 (post) ——
  "Hook Specialist": "post",
  "Post Fade Phenom": "post",
  "Post Powerhouse": "post",
  "Post-Up Poet": "post",

  // —— 扣篮 (dunk) ——
  Posterizer: "dunk",
  "Rise Up": "dunk",
  "Aerial Wizard": ["dunk", "rebound"], // 迁移 (Slot Semantics V2, 2026-08-14): athletic → dunk + rebound

  // —— 控球 (handle) ——
  "Ankle Assassin": "handle",
  "Handles For Days": "handle",
  "Strong Handle": "handle",
  Unpluckable: "handle",
  "Lightning Launch": "handle", // 迁移 (Slot Semantics V2, 2026-08-14): athletic → handle

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
  "Immovable Enforcer": ["interior", "strength"], // 迁移 (Slot Semantics V2, 2026-08-14): interior 保留 + strength 共享
  "Post Lockdown": "interior",
  "Brick Wall": ["interior", "strength"], // 迁移 (Slot Semantics V2, 2026-08-14): interior 保留 + strength 共享

  // —— 篮板 (rebound) ——
  "Boxout Beast": "rebound",
  "Rebound Chaser": "rebound",
  // Pogo Stick 保持 Block only（Slot Semantics V2 2026-08-14 未冻结 Block+Rebound 共享）
};
