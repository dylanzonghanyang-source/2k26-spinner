// Tendency field -> attribute bundle (slot) mapping.
// Each of the 13 builder bundles inherits tendencies from the player locked
// into that bundle: e.g. the "终结" (finishing) slot inherits driving-layup,
// close-shot, floater tendencies from its source player.
//
// Field names follow the ATD 2K26 tendency workbook
// (src/data/tendencyProfiles.json). Fields not listed here are not inherited.

export const tendencyBundleMap: Record<string, string> = {
  // —— 三分 (three) ——
  "Shot Three": "three",
  "Spot Up Shot Three": "three",
  "Off-Screen Shot Three": "three",
  "Shot Three Left": "three",
  "Shot Three Left-Center": "three",
  "Shot Three Center": "three",
  "Shot Three Right-Center": "three",
  "Shot Three Right": "three",
  "Contested Jumper Three": "three",
  "Stepback Three Point Shot": "three",
  "Transition Pull-Up Three Point Shot": "three",
  "Drive Pull-Up Three": "three",

  // —— 中投 (mid) ——
  "Shot Mid-Range": "mid",
  "Spot Up Shot Mid-Range": "mid",
  "Off-Screen Shot Mid-Range": "mid",
  "Shot Mid Left": "mid",
  "Shot Mid Left-Center": "mid",
  "Shot Mid Center": "mid",
  "Shot Mid Right-Center": "mid",
  "Shot Mid Right": "mid",
  "Contested Jumper Mid-Range": "mid",
  "Stepback Jumper Mid-Range": "mid",
  "Spin Jumper": "mid",
  "Drive Pull-Up Mid-Range": "mid",

  // —— 终结 (finishing) ——
  "Shot Close": "finishing",
  "Shot Under Basket": "finishing",
  "Shot Close Left": "finishing",
  "Shot Close Middle": "finishing",
  "Shot Close Right": "finishing",
  "Driving Layup": "finishing",
  "Spin Layup": "finishing",
  "Euro Step Layup": "finishing",
  "Hop Step Layup": "finishing",
  "Floater": "finishing",
  "Step Through Shot": "finishing",
  "Use Glass": "finishing",
  "Alley-Oop": "finishing",
  "Putback": "finishing",
  "Post Up": "finishing",
  "Post Back Down": "finishing",
  "Post Aggressive Backdown": "finishing",
  "Post Face Up": "finishing",
  "Post Spin": "finishing",
  "Post Drive": "finishing",
  "Post Drop Step": "finishing",
  "Shoot From Post": "finishing",
  "Post Hook Left": "finishing",
  "Post Hook Right": "finishing",
  "Post Fade Left": "finishing",
  "Post Fade Right": "finishing",
  "Post Shimmy Shot": "finishing",
  "Post Hop Step": "finishing",
  "Post Stepback Shot": "finishing",
  "Post Up & Under": "finishing",

  // —— 扣篮 (dunk) ——
  "Standing Dunk": "dunk",
  "Driving Dunk": "dunk",
  "Flashy Dunk": "dunk",

  // —— 控球 (handle) ——
  "Drive": "handle",
  "Spot Up Drive": "handle",
  "Off-Screen Drive": "handle",
  "Drive Right": "handle",
  "Triple Threat Pump Fake": "handle",
  "Triple Threat Jab Step": "handle",
  "Triple Threat Idle": "handle",
  "Triple Threat Shoot": "handle",
  "Setup With Sizeup": "handle",
  "Setup With Hesitation": "handle",
  "No Setup Dribble": "handle",
  "Driving Crossover": "handle",
  "Driving Double Crossover": "handle",
  "Driving Spin": "handle",
  "Driving Half Spin": "handle",
  "Driving Stepback": "handle",
  "Driving Behind the Back": "handle",
  "Driving Dribble Hesitation": "handle",
  "Driving In & Out": "handle",
  "No Driving Dribble Move": "handle",
  "Attack Strong on Drive": "handle",

  // —— 传球 (passing) ——
  "Dish to Open Man": "passing",
  "Flashy Pass": "passing",
  "Alley-Oop Pass": "passing",
  "Roll vs Pop": "passing",
  "Transition Spot Up vs Cut to the Basket": "passing",

  // —— 外防 (perimeter) ——
  "Take Charge": "perimeter",
  "Foul": "perimeter",
  "Hard Foul": "perimeter",

  // —— 抢断 (steal) ——
  "On-Ball Steal": "steal",
  "Pass Interception": "steal",

  // —— 盖帽 (block) ——
  "Block Shot": "block",

  // —— 篮板 (rebound) ——
  "Crash": "rebound",

  // —— 稳定性 (stability) ——
  "Shot": "stability",
  "Touches": "stability",
  "Play Discipline": "stability",
  "Iso vs Elite Defender": "stability",
  "Iso vs Good Defender": "stability",
  "Iso vs Average Defender": "stability",
  // Iso vs Poor Defender exists in some game UIs / older maps but is not in
  // the current ATD 96-field table (tendencyProfiles.min.json).
};

/** All bundle ids that appear in the map (in bundles order). */
export const tendencyBundleIds = Array.from(new Set(Object.values(tendencyBundleMap)));
