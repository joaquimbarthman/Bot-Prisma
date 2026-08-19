import { config } from "../../config.js";

export const LFG_VOICE_CATEGORY_ID = config.lfg.voiceCategoryId;

export const LFG_GAMES = {
  fortnite: { name: "Fortnite", roleId: "1538650428189712414", img: "https://i.pinimg.com/474x/4b/ab/34/4bab34086b84ee2a0e1b66b1e82ed0be.jpg" },
  valorant: { name: "Valorant", roleId: "1538650013033566328", img: "https://i.pinimg.com/564x/f5/dd/24/f5dd24b3418701f617275cfa6a265ac8.jpg" },
  roblox: { name: "Roblox", roleId: "1538650640086204456", img: "https://upload.wikimedia.org/wikipedia/commons/4/48/Roblox_Logo_2021.png?utm_source=pt.wikipedia.org&utm_campaign=index&utm_content=original" },
  overwatch: { name: "Overwatch", roleId: "1538650794989985842", img: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTBvW-KFP8g3QUJEhi6YFTr6pX7v84ehqAxJ5zVdQDFUsnLTD8tRgITjXcp&s=10" },
  league_of_legends: { name: "League of Legends", roleId: "1538651122749939752", img: "https://wiki.leagueoflegends.com/en-us/images/League_of_Legends_icon.png?d9446" },
  minecraft: { name: "Minecraft", roleId: "1538651346385764454", img: "https://i.pinimg.com/236x/2b/9f/b9/2b9fb9043dc5fa89a89ccc23b88427b2.jpg" },
  marvel_rivals: { name: "Marvel Rivals", roleId: "1538651862985867414", img: "https://cdn2.steamgriddb.com/icon_thumb/5151b8757a4afb16e18c0bd6f3e69e32.png" },
  dead_by_daylight: { name: "Dead by Daylight", roleId: "1538652466894213182", img: "https://cdn2.steamgriddb.com/icon/29ec8066dea8748449b852688c46ee5a/32/256x256.png" },
} as const;

export type LfgGameKey = keyof typeof LFG_GAMES;
