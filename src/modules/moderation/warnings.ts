import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";

type Warning = { at: string; reason: string; moderator: string };
type Database = Record<string, Record<string, Warning[]>>;
const file = path.resolve(config.dataDir, "warnings.json");
let queue = Promise.resolve();

async function read(): Promise<Database> {
  try { return JSON.parse(await readFile(file, "utf8")) as Database; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function save(data: Database): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await rename(temporary, file);
}

export async function addWarning(guildId: string, userId: string, warning: Warning): Promise<number> {
  let count = 0;
  queue = queue.then(async () => {
    const db = await read();
    const warnings = (db[guildId] ??= {})[userId] ??= [];
    warnings.push(warning);
    count = warnings.length;
    await save(db);
  });
  await queue;
  return count;
}

export async function getWarnings(guildId: string, userId: string): Promise<Warning[]> {
  await queue;
  return (await read())[guildId]?.[userId] ?? [];
}

export async function clearWarnings(guildId: string, userId: string): Promise<void> {
  queue = queue.then(async () => {
    const db = await read();
    if (db[guildId]) delete db[guildId][userId];
    await save(db);
  });
  await queue;
}
