import { createRookieCardLookup, lookupRookieCard } from "../src/rookieCards.ts";
import current from "../src/data/rookieCardIndex-current.min.json" with { type: "json" };

const lookup = createRookieCardLookup(current as never);
const names = ["Rj Barrett", "RJ Barrett", "R.J. Barrett", "Vj Edgecombe", "VJ Edgecombe", "Aj Green", "Kj Simpson", "Gg Jackson"];
for (const n of names) {
  const card = lookupRookieCard(lookup as never, n);
  console.log(`${n.padEnd(15)} -> ${card ? card.slug + " / OVR " + card.overall : "MISS"}`);
}
