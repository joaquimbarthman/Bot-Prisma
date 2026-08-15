import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

type Database = Record<string, Record<string, string[]>>;
const file = path.resolve("data", "punishment-role-snapshots.json");
let queue = Promise.resolve();

async function read(): Promise<Database> {
  try { return JSON.parse(await readFile(file, "utf8")) as Database; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}

async function save(data: Database): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`; await writeFile(temporary, JSON.stringify(data, null, 2), "utf8"); await rename(temporary, file);
}

export async function preserveMemberRoles(guildId: string, userId: string, roleIds: string[]): Promise<string[]> {
  let preserved: string[] = [];
  queue = queue.then(async () => {
    const db = await read(); const guild = db[guildId] ??= {};
    preserved = guild[userId] ?? [...new Set(roleIds)];
    if (!guild[userId]) { guild[userId] = preserved; await save(db); }
  });
  await queue; return preserved;
}

export async function getPreservedRoles(guildId: string, userId: string): Promise<string[]> {
  await queue; return (await read())[guildId]?.[userId] ?? [];
}

export async function clearPreservedRoles(guildId: string, userId: string): Promise<void> {
  queue = queue.then(async () => {
    const db = await read(); if (db[guildId]) delete db[guildId][userId]; await save(db);
  });
  await queue;
}
