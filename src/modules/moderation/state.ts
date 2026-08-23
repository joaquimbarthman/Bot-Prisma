import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";

export type WarningRecord = { at: string; reason: string; moderator: string };
export type ModerationState = {
  userId: string;
  guildId: string;
  warnings: number;
  trust: number;
  aiMonitorUntil: string | null;
  warningHistory: WarningRecord[];
};

const file = path.resolve(config.dataDir, "moderation-states.json");
const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
let queue = Promise.resolve();

function initial(guildId: string, userId: string): ModerationState {
  return { guildId, userId, warnings: 0, trust: 100, aiMonitorUntil: null, warningHistory: [] };
}

export function trustForWarnings(warnings: number): number {
  return Math.max(0, 100 - Math.floor(Math.max(0, warnings) / 3) * 50);
}

function fromRow(guildId: string, userId: string, row: Record<string, unknown> | null): ModerationState {
  if (!row) return initial(guildId, userId);
  return {
    guildId, userId,
    warnings: Number(row.warnings ?? 0),
    trust: Number(row.trust ?? 100),
    aiMonitorUntil: typeof row.ai_monitor_until === "string" ? row.ai_monitor_until : null,
    warningHistory: Array.isArray(row.warning_history) ? row.warning_history as WarningRecord[] : [],
  };
}

async function readLocal(): Promise<Record<string, Record<string, ModerationState>>> {
  try { return JSON.parse(await readFile(file, "utf8")) as Record<string, Record<string, ModerationState>>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
}

async function saveLocal(data: Record<string, Record<string, ModerationState>>): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await rename(temporary, file);
}

export async function getModerationState(guildId: string, userId: string): Promise<ModerationState> {
  await queue;
  if (supabase) {
    const { data, error } = await supabase.from("moderation_user_states").select("*").eq("guild_id", guildId).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return fromRow(guildId, userId, data);
  }
  return (await readLocal())[guildId]?.[userId] ?? initial(guildId, userId);
}

export async function recordWarning(guildId: string, userId: string, warning: WarningRecord): Promise<ModerationState> {
  if (supabase) {
    const { data, error } = await supabase.rpc("record_moderation_warning", { p_guild_id: guildId, p_user_id: userId, p_warning: warning }).single();
    if (error) throw error;
    return fromRow(guildId, userId, data as Record<string, unknown>);
  }
  let result = initial(guildId, userId);
  queue = queue.then(async () => {
    const db = await readLocal();
    const current = (db[guildId] ??= {})[userId] ?? initial(guildId, userId);
    current.warningHistory.push(warning);
    current.warnings += 1;
    current.trust = trustForWarnings(current.warnings);
    current.aiMonitorUntil = new Date(Date.now() + 60 * 60_000).toISOString();
    (db[guildId] ??= {})[userId] = current;
    await saveLocal(db);
    result = current;
  });
  await queue;
  return result;
}

export async function resetModerationState(guildId: string, userId: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("moderation_user_states").upsert({ guild_id: guildId, user_id: userId, warnings: 0, trust: 100, ai_monitor_until: null, warning_history: [], updated_at: new Date().toISOString() }, { onConflict: "guild_id,user_id" });
    if (error) throw error;
    return;
  }
  queue = queue.then(async () => { const db = await readLocal(); (db[guildId] ??= {})[userId] = initial(guildId, userId); await saveLocal(db); });
  await queue;
}

export function isAiMonitoringActive(state: ModerationState, now = Date.now()): boolean {
  return state.aiMonitorUntil !== null && Date.parse(state.aiMonitorUntil) > now;
}
