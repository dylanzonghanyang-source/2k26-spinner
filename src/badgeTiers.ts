export type BadgeTier = "Bronze" | "Silver" | "Gold" | "HOF" | "Legendary";

export const badgeTierRank: Record<BadgeTier, number> = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  HOF: 4,
  Legendary: 5,
};

export const badgeTierCN: Record<BadgeTier, string> = {
  Bronze: "铜",
  Silver: "银",
  Gold: "金",
  HOF: "名人堂",
  Legendary: "传奇",
};
