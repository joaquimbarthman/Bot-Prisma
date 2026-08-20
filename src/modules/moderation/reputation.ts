import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
type Database = Record<string, Record<string, number>>;
const file = path.resolve(config.dataDir, "reputations.json");
let queue = Promise.resolve();
async function read(): Promise<Database> {
  try { return JSON.parse(await readFile(file, "utf8")) as Database; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}
async function save(data: Database): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await rename(temporary, file);
}
export async function getReputation(guildId: string, userId: string): Promise<number> {
  await queue; return (await read())[guildId]?.[userId] ?? 100;
}
export async function decreaseReputation(guildId: string, userId: string): Promise<number> {
  let reputation = 100;
  queue = queue.then(async () => {
    const db = await read(); const guild = db[guildId] ??= {};
    reputation = Math.max(0, (guild[userId] ?? 100) - 25);
    guild[userId] = reputation; await save(db);
  });
  await queue; return reputation;
}
export async function resetReputation(guildId: string, userId: string): Promise<void> {
  queue = queue.then(async () => { const db = await read(); (db[guildId] ??= {})[userId] = 100; await save(db); });
  await queue;
}
