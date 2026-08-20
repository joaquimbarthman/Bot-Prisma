import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LfgGameKey } from "./config.js";
import { config } from "../../config.js";

export type LfgStatus = "open" | "completed" | "closed" | "expired" | "deleted";
export type LfgSession = {
  id: string; guildId: string; channelId: string; messageId: string | null; roleMentionMessageId: string | null; creatorId: string;
  game: LfgGameKey; maxPlayers: number; participants: string[];
  note: string; autoVoiceEnabled: boolean; voiceChannelId: string | null; temporaryRoleId: string | null; status: LfgStatus;
  createdAt: string; updatedAt: string; expiresAt: string; deleteVoiceWhenEmpty: boolean;
};
type Database = { sessions: LfgSession[] };
const file = path.resolve(config.dataDir, "lfg-module.json");
let queue = Promise.resolve();

async function read(): Promise<Database> {
  try {
    const content = await readFile(file, "utf8");
    if (!content.trim()) return { sessions: [] };
    const value = JSON.parse(content) as Partial<Database>;
    return { sessions: Array.isArray(value.sessions) ? value.sessions : [] };
  }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [] }; throw error; }
}
async function write(db: Database): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, file); await chmod(file, 0o600).catch(() => undefined);
}
export async function mutate<T>(fn: (db: Database) => Promise<T> | T): Promise<T> {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const result = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  queue = queue.then(async () => { try { const db = await read(); const value = await fn(db); await write(db); resolve(value); } catch (error) { reject(error); } });
  await queue; return result;
}
export async function sessions(): Promise<LfgSession[]> { return (await read()).sessions; }
