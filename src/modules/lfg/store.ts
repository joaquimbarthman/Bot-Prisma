import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { LfgGameKey } from "./config.js";
import { config } from "../../config.js";

export type LfgStatus = "open" | "completed" | "closed" | "expired" | "deleted";
export type LfgSession = {
  id: string; guildId: string; channelId: string; messageId: string | null; roleMentionMessageId: string | null; creatorId: string;
  game: LfgGameKey; maxPlayers: number; participants: string[];
  note: string; status: LfgStatus;
  createdAt: string; updatedAt: string; expiresAt: string;
};
type Database = { sessions: LfgSession[] };
const file = path.resolve(config.dataDir, "lfg-module.json");
let queue = Promise.resolve();
const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;

function fromRemote(row: Record<string, unknown>): LfgSession {
  return {
    id: String(row.id), guildId: String(row.guild_id), channelId: String(row.channel_id),
    messageId: typeof row.message_id === "string" ? row.message_id : null,
    roleMentionMessageId: typeof row.role_mention_message_id === "string" ? row.role_mention_message_id : null,
    creatorId: String(row.creator_id), game: row.game as LfgGameKey, maxPlayers: Number(row.max_players),
    participants: Array.isArray(row.participants) ? row.participants.filter((id): id is string => typeof id === "string") : [],
    note: typeof row.note === "string" ? row.note : "",
    status: row.status as LfgStatus, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    expiresAt: String(row.expires_at),
  };
}

function toRemote(session: LfgSession) {
  return {
    id: session.id, guild_id: session.guildId, channel_id: session.channelId, message_id: session.messageId,
    role_mention_message_id: session.roleMentionMessageId, creator_id: session.creatorId, game: session.game,
    max_players: session.maxPlayers, participants: session.participants, note: session.note,
    status: session.status, created_at: session.createdAt,
    updated_at: session.updatedAt, expires_at: session.expiresAt,
  };
}

async function readRemote(): Promise<Database> {
  const { data, error } = await supabase!.from("lfg_sessions").select("*");
  if (error) throw new Error(`[LFG] Falha ao ler sessões no Supabase: ${error.message}`);
  return { sessions: (data ?? []).map((row) => fromRemote(row)) };
}

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
  queue = queue.catch(() => undefined).then(async () => { try {
    if (supabase) {
      const db = await readRemote();
      const previousIds = new Set(db.sessions.map((session) => session.id));
      const value = await fn(db);
      db.sessions = db.sessions.filter((session) => session.status !== "deleted");
      const currentIds = new Set(db.sessions.map((session) => session.id));
      if (db.sessions.length) {
        const { error } = await supabase.from("lfg_sessions").upsert(db.sessions.map(toRemote), { onConflict: "id" });
        if (error) throw new Error(`[LFG] Falha ao salvar sessões no Supabase: ${error.message}`);
      }
      const removedIds = [...previousIds].filter((id) => !currentIds.has(id));
      if (removedIds.length) {
        const { error } = await supabase.from("lfg_sessions").delete().in("id", removedIds);
        if (error) throw new Error(`[LFG] Falha ao apagar sessões no Supabase: ${error.message}`);
      }
      resolve(value); return;
    }
    const db = await read(); const value = await fn(db);
    db.sessions = db.sessions.filter((session) => session.status !== "deleted");
    await write(db); resolve(value);
  } catch (error) { reject(error); } });
  await queue; return result;
}
export async function sessions(): Promise<LfgSession[]> { await queue; return supabase ? (await readRemote()).sessions : (await read()).sessions; }
