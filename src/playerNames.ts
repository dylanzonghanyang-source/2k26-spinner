import playerNamesCN from "./data/playerNamesCN.json";

const names = playerNamesCN as Record<string, string>;
const normalizedNames = new Map(
  Object.entries(names).map(([english, chinese]) => [normalizeName(english), chinese]),
);

function normalizeName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function getPlayerNameCN(name: string) {
  return names[name] ?? normalizedNames.get(normalizeName(name)) ?? name;
}
