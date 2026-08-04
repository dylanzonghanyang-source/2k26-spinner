import { buildMarqueeReel } from "../src/marqueeMotion.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sequenceRandom(values: number[]) {
  let index = 0;
  return () => values[index++ % values.length];
}

const items = [
  { id: "atl", label: "老鹰" },
  { id: "bos", label: "凯尔特人" },
  { id: "chi", label: "公牛" },
  { id: "mia", label: "热火" },
  { id: "lal", label: "湖人" },
];
const snapshot = JSON.stringify(items);

const hiddenWinner = buildMarqueeReel(items, "chi", {
  precedingItems: 8,
  trailingItems: 4,
  random: sequenceRandom([0.02, 0.31, 0.68, 0.93]),
  revealWinner: false,
});
assert(hiddenWinner.length === 13, `expected 13 reel items, received ${hiddenWinner.length}`);
assert(hiddenWinner[8]?.id === "chi", "the committed winner must occupy the terminal landing slot");
assert(hiddenWinner.filter((item) => item.id === "chi").length === 1, "the winner must not leak into the lead-in or trailing reel");
assert(hiddenWinner.every((item) => !item.selected), "winner styling must remain hidden before settle");

const revealedWinner = buildMarqueeReel(items, "chi", {
  precedingItems: 8,
  trailingItems: 4,
  random: sequenceRandom([0.02, 0.31, 0.68, 0.93]),
  revealWinner: true,
});
assert(revealedWinner.filter((item) => item.selected).length === 1, "exactly one item should be styled as the settled winner");
assert(revealedWinner[8]?.selected, "the settled winner styling must match the landing slot");

const alternateRun = buildMarqueeReel(items, "chi", {
  precedingItems: 8,
  trailingItems: 4,
  random: sequenceRandom([0.88, 0.57, 0.24, 0.05]),
  revealWinner: false,
});
assert(
  hiddenWinner.slice(0, 8).map((item) => item.id).join(",")
    !== alternateRun.slice(0, 8).map((item) => item.id).join(","),
  "consecutive runs should support genuinely different visual lead-in sequences",
);
assert(JSON.stringify(items) === snapshot, "building a reel must not mutate the candidate pool");

console.log(JSON.stringify({
  status: "passed",
  landingIndex: 8,
  reelLength: hiddenWinner.length,
  winnerOccurrences: hiddenWinner.filter((item) => item.id === "chi").length,
}, null, 2));
