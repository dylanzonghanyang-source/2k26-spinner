import { createRookieCardLookup, corePlayerName, lookupRookieCard, loadRookieCards } from "../src/rookieCards.ts";
import current from "../src/data/rookieCardIndex-current.min.json" with { type: "json" };

const lookup = createRookieCardLookup(current as never);
console.log("current keys:", (current as never as { keys: unknown[] }).keys.length);
console.log("coreName('R.J. Barrett'):", JSON.stringify(corePlayerName("R.J. Barrett")));
console.log("coreName('RJ Barrett'):", JSON.stringify(corePlayerName("RJ Barrett")));
console.log("lookup R.J. Barrett:", lookupRookieCard(lookup as never, "R.J. Barrett")?.slug ?? "NULL");
console.log("lookup RJ Barrett:", lookupRookieCard(lookup as never, "RJ Barrett")?.slug ?? "NULL");
console.log("direct map get 'rj barrett':", lookup.get("rj barrett")?.slug ?? "NULL");
console.log("direct map get 'r j barrett':", lookup.get("r j barrett")?.slug ?? "NULL");
