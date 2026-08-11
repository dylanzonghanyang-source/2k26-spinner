import type { PlayerSource } from "./domain.ts";
import type { RookieCard } from "./rookieCards.ts";

/** Rookie card → PlayerSource adapter for manual slot selection. */
export function cardToPlayerSource(card: RookieCard): PlayerSource {
  const avg = (keys: string[], fallback = 75) => {
    const values = keys
      .map((key) => card.detailed[key])
      .filter((value): value is number => typeof value === "number");
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : fallback;
  };

  return {
    id: `card:${card.slug}`,
    name: card.name,
    slug: card.slug,
    position: card.position ?? "",
    overall: card.overall ?? null,
    shooting: avg(["Three-Point Shot", "Mid-Range Shot", "Free Throw", "Offensive Consistency", "Shot IQ"]),
    athleticism: avg(["Speed", "Strength", "Agility", "Vertical", "Hustle", "Stamina"]),
    playmaking: avg(["Ball Handle", "Speed with Ball", "Pass Accuracy", "Pass IQ", "Pass Vision"]),
    defense: avg(["Block", "Steal", "Pass Perception", "Interior Defense", "Perimeter Defense", "Defensive Consistency", "Help Defense IQ"]),
    inside: avg(["Layup", "Driving Dunk", "Standing Dunk", "Post Hook", "Post Fade", "Post Control", "Draw Foul", "Hands", "Offensive Rebound", "Defensive Rebound"]),
    detailed: card.detailed,
    badges: [],
    badgesKnown: true,
  };
}
