export const LFG_VOICE_CATEGORY_ID = "1538663337011707944";

export const LFG_GAMES = {
  fortnite: { name: "Fortnite", roleId: "1538650428189712414" },
  valorant: { name: "Valorant", roleId: "1538650013033566328" },
  roblox: { name: "Roblox", roleId: "1538650640086204456" },
  overwatch: { name: "Overwatch", roleId: "1538650794989985842" },
  league_of_legends: { name: "League of Legends", roleId: "1538651122749939752" },
  minecraft: { name: "Minecraft", roleId: "1538651346385764454" },
  marvel_rivals: { name: "Marvel Rivals", roleId: "1538651862985867414" },
  dead_by_daylight: { name: "Dead by Daylight", roleId: "1538652466894213182" },
} as const;

export type LfgGameKey = keyof typeof LFG_GAMES;
