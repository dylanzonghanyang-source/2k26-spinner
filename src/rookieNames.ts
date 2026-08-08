const firstNames = [
  "Aaron", "Adrian", "Aiden", "Alex", "Andre", "Anthony", "Austin", "Ben", "Blake", "Brandon",
  "Bryce", "Caleb", "Cameron", "Carter", "Cedric", "Charles", "Chris", "Christian", "Cole", "Collin",
  "Darius", "Darren", "Derrick", "Devin", "Dominic", "Donovan", "Elijah", "Elliot", "Eric", "Ethan",
  "Evan", "Gabriel", "Grant", "Isaiah", "Jalen", "Jamal", "James", "Jared", "Jason", "Jayden",
  "Jeremiah", "Jordan", "Josiah", "Julian", "Justin", "Kai", "Kendall", "Kendrick", "Kevin", "Khalil",
  "Kyle", "Landon", "Malachi", "Malcolm", "Marcus", "Mason", "Matthew", "Micah", "Miles", "Nate",
  "Nathan", "Noah", "Quentin", "Reece", "Roman", "Ryan", "Sam", "Sean", "Terrence", "Theo",
  "Tobias", "Trevor", "Tristan", "Tyler", "Victor", "Wesley", "Xavier", "Zachary", "Zion",
] as const;

const lastNames = [
  "Adams", "Alexander", "Allen", "Anderson", "Armstrong", "Atkins", "Bailey", "Banks", "Barrett", "Bates",
  "Bell", "Bennett", "Bishop", "Black", "Boone", "Bradley", "Brooks", "Brown", "Bryant", "Burke",
  "Butler", "Campbell", "Carter", "Chambers", "Clark", "Coleman", "Collins", "Cook", "Cooper", "Crawford",
  "Daniels", "Davis", "Dawson", "Dean", "Dixon", "Douglas", "Edwards", "Ellis", "Evans", "Fields",
  "Fisher", "Fleming", "Foster", "Fox", "Franklin", "Freeman", "Garrett", "Gibson", "Gordon", "Graham",
  "Grant", "Gray", "Green", "Griffin", "Hall", "Hamilton", "Harris", "Harrison", "Hayes", "Henderson",
  "Hill", "Holland", "Howard", "Hudson", "Hughes", "Hunter", "Jackson", "James", "Jenkins", "Johnson",
  "Jones", "Jordan", "Kelly", "Kennedy", "King", "Knight", "Lawson", "Lee", "Lewis", "Marshall",
  "Martin", "Mason", "Matthews", "McDaniel", "Miller", "Mitchell", "Moore", "Morgan", "Morris", "Murphy",
  "Nelson", "Nichols", "Owens", "Parker", "Patterson", "Payne", "Perry", "Peterson", "Phillips", "Porter",
  "Powell", "Price", "Reed", "Reynolds", "Richardson", "Roberts", "Robinson", "Rogers", "Ross", "Russell",
  "Scott", "Shaw", "Simmons", "Smith", "Stewart", "Taylor", "Thomas", "Thompson", "Turner", "Walker",
  "Wallace", "Ward", "Warren", "Washington", "Watson", "Webb", "Wells", "West", "White", "Williams",
  "Wilson", "Wood", "Wright", "Young",
] as const;

function pick<T>(values: readonly T[], random: () => number) {
  return values[Math.floor(random() * values.length)];
}

export function generateRookieFirstName(random: () => number = Math.random) {
  return pick(firstNames, random);
}

export function generateRookieLastName(random: () => number = Math.random) {
  return pick(lastNames, random);
}

export function generateRookieName(random: () => number = Math.random) {
  return `${generateRookieFirstName(random)} ${generateRookieLastName(random)}`;
}
