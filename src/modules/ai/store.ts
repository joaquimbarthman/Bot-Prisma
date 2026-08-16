import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { normalizePersonality, sanitizeNickname, type Personality } from "./personality.js";

export type UserSettings = { nickname: string; personality: Personality; humorLevel: number; allowMentions: boolean; memoryEnabled: boolean; spontaneousInteractions: boolean };
export type HistoryItem = { discordId: string; channelId: string; role: "user" | "assistant"; content: string; createdAt: string };
export type UsageItem = { discordId: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; estimatedCostBrl: number; createdAt: string };
type SpontaneousEvent = { discordId: string; createdAt: string };
export type SocialSignalType = "insult" | "apology" | "kindness" | "affection" | "gratitude" | "humor" | "vulnerability";
type SocialSignal = { discordId: string; type: SocialSignalType; createdAt: string };
type Database = { settings: Record<string, UserSettings>; history: HistoryItem[]; usage: UsageItem[]; spontaneous: SpontaneousEvent[]; social: SocialSignal[] };

const defaults: UserSettings = { nickname: "", personality: "prisma_default", humorLevel: 3, allowMentions: true, memoryEnabled: true, spontaneousInteractions: false };
const file = path.resolve("data", "ai-module.json");
const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
let queue = Promise.resolve();

function remoteFailure(operation: string, error: unknown): void { console.error(`[SUPABASE] ${operation} falhou; usando armazenamento local:`, error); }
function normalizeHumorLevel(value: unknown): number { return Math.max(1, Math.min(5, Number(value) || defaults.humorLevel)); }
function booleanOrDefault(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function normalizeSettings(value: Partial<UserSettings>): UserSettings {
  return {
    nickname: sanitizeNickname(value.nickname),
    personality: normalizePersonality(String(value.personality ?? defaults.personality)),
    humorLevel: normalizeHumorLevel(value.humorLevel),
    allowMentions: booleanOrDefault(value.allowMentions, defaults.allowMentions),
    memoryEnabled: booleanOrDefault(value.memoryEnabled, defaults.memoryEnabled),
    spontaneousInteractions: booleanOrDefault(value.spontaneousInteractions, defaults.spontaneousInteractions),
  };
}
function fromSettings(row: Record<string, unknown> | null): UserSettings {
  if (!row) return { ...defaults };
  return normalizeSettings({
    nickname: row.nickname as string,
    personality: String(row.personality ?? defaults.personality) as Personality,
    humorLevel: row.humor_level as number,
    allowMentions: row.allow_mentions as boolean,
    memoryEnabled: row.memory_enabled as boolean,
    spontaneousInteractions: row.spontaneous_interactions as boolean,
  });
}
function toSettings(id: string, value: UserSettings) { return { discord_id: id, nickname: value.nickname, personality: value.personality, humor_level: value.humorLevel, allow_mentions: value.allowMentions, memory_enabled: value.memoryEnabled, spontaneous_interactions: value.spontaneousInteractions, updated_at: new Date().toISOString() }; }
function fromHistory(row: Record<string, unknown>): HistoryItem { return { discordId: row.discord_id as string, channelId: row.channel_id as string, role: row.role as "user" | "assistant", content: row.content as string, createdAt: row.created_at as string }; }

async function readLocal(): Promise<Database> { try { const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<Database>; return { settings: parsed.settings ?? {}, history: parsed.history ?? [], usage: parsed.usage ?? [], spontaneous: parsed.spontaneous ?? [], social: parsed.social ?? [] }; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: {}, history: [], usage: [], spontaneous: [], social: [] }; throw error; } }
async function saveLocal(db: Database): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.tmp`; await writeFile(temp, JSON.stringify(db, null, 2), "utf8"); await rename(temp, file); }

export function isSupabaseConfigured(): boolean { return !!supabase; }
export async function checkSupabaseConnection(): Promise<boolean> {
  if (!supabase) return false;
  const checks = await Promise.all([
    supabase.from("user_settings").select("discord_id").limit(1),
    supabase.from("conversation_history").select("id").limit(1),
    supabase.from("ai_usage").select("id").limit(1),
    supabase.from("ai_events").select("id").limit(1),
  ]);
  const tables = ["user_settings", "conversation_history", "ai_usage", "ai_events"];
  const failures = checks.map((result, index) => result.error ? `${tables[index]}: ${result.error.message}` : null).filter(Boolean);
  if (failures.length) { console.error(`[SUPABASE] Schema incompleto:\n${failures.join("\n")}`); return false; }
  console.log("[SUPABASE] Conectado; 4 tabelas acessíveis."); return true;
}

export async function getSettings(id: string): Promise<UserSettings> {
  if (supabase) { const { data, error } = await supabase.from("user_settings").select("*").eq("discord_id", id).maybeSingle(); if (!error) return fromSettings(data); remoteFailure("ler preferências", error.message); }
  await queue; const stored = (await readLocal()).settings[id]; return stored ? normalizeSettings(stored) : { ...defaults };
}
export async function updateSettings(id: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const result = normalizeSettings({ ...(await getSettings(id)), ...patch });
  if (supabase) { const { error } = await supabase.from("user_settings").upsert(toSettings(id, result), { onConflict: "discord_id" }); if (!error) return result; remoteFailure("salvar preferências", error.message); }
  queue = queue.then(async () => { const db = await readLocal(); db.settings[id] = result; await saveLocal(db); }); await queue; return result;
}
export async function addHistory(item: HistoryItem): Promise<void> {
  if (supabase) { const { error } = await supabase.from("conversation_history").insert({ discord_id: item.discordId, channel_id: item.channelId, role: item.role, content: item.content, created_at: item.createdAt }); if (!error) return; remoteFailure("salvar histórico", error.message); }
  queue = queue.then(async () => { const db = await readLocal(); db.history.push(item); await saveLocal(db); }); await queue;
}
export async function recentHistory(id: string, channelId: string, limit: number, maxChars: number): Promise<HistoryItem[]> {
  let items: HistoryItem[];
  const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  if (supabase) { const { data, error } = await supabase.from("conversation_history").select("discord_id,channel_id,role,content,created_at").eq("discord_id", id).eq("channel_id", channelId).gte("created_at", cutoff).order("created_at", { ascending: false }).limit(limit); if (!error) items = (data ?? []).reverse().map(fromHistory); else { remoteFailure("ler histórico", error.message); await queue; items = (await readLocal()).history.filter((x) => x.discordId === id && x.channelId === channelId && x.createdAt >= cutoff).slice(-limit); } }
  else { await queue; items = (await readLocal()).history.filter((x) => x.discordId === id && x.channelId === channelId && x.createdAt >= cutoff).slice(-limit); }
  let chars = 0; const selected: HistoryItem[] = []; for (const item of items.reverse()) { if (chars + item.content.length > maxChars) break; selected.unshift(item); chars += item.content.length; } return selected;
}
export async function addUsage(item: UsageItem): Promise<void> {
  if (supabase) { const { error } = await supabase.from("ai_usage").insert({ discord_id: item.discordId, model: item.model, input_tokens: item.inputTokens, output_tokens: item.outputTokens, total_tokens: item.totalTokens, estimated_cost_usd: item.estimatedCostUsd, estimated_cost_brl: item.estimatedCostBrl, created_at: item.createdAt }); if (!error) return; remoteFailure("salvar uso", error.message); }
  queue = queue.then(async () => { const db = await readLocal(); db.usage.push(item); await saveLocal(db); }); await queue;
}
export async function monthlyCostBrl(): Promise<number> {
  const month = new Date().toISOString().slice(0, 7); const start = `${month}-01T00:00:00.000Z`;
  if (supabase) { const { data, error } = await supabase.from("ai_usage").select("estimated_cost_brl").gte("created_at", start); if (!error) return (data ?? []).reduce((sum, x) => sum + Number(x.estimated_cost_brl), 0); remoteFailure("calcular orçamento", error.message); }
  await queue; return (await readLocal()).usage.filter((x) => x.createdAt.startsWith(month)).reduce((sum, x) => sum + x.estimatedCostBrl, 0);
}
async function spontaneousEvents(id: string): Promise<SpontaneousEvent[]> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  if (supabase) { const { data, error } = await supabase.from("ai_events").select("discord_id,created_at").eq("discord_id", id).eq("interaction_type", "spontaneous").gte("created_at", cutoff).order("created_at"); if (!error) return (data ?? []).map((x) => ({ discordId: x.discord_id, createdAt: x.created_at })); remoteFailure("ler eventos", error.message); }
  await queue; return (await readLocal()).spontaneous.filter((x) => x.discordId === id && x.createdAt >= cutoff);
}
export async function spontaneousCountToday(id: string, timezone: string): Promise<number> { const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone }); return (await spontaneousEvents(id)).filter((x) => new Date(x.createdAt).toLocaleDateString("en-CA", { timeZone: timezone }) === today).length; }
export async function lastSpontaneousAt(id: string): Promise<number> { const item = (await spontaneousEvents(id)).at(-1); return item ? Date.parse(item.createdAt) : 0; }
export async function addSpontaneous(id: string): Promise<void> { const createdAt = new Date().toISOString(); if (supabase) { const { error } = await supabase.from("ai_events").insert({ discord_id: id, interaction_type: "spontaneous", created_at: createdAt }); if (!error) return; remoteFailure("salvar evento", error.message); } queue = queue.then(async () => { const db = await readLocal(); db.spontaneous.push({ discordId: id, createdAt }); await saveLocal(db); }); await queue; }
export async function addSocialSignal(id: string, type: SocialSignalType): Promise<void> { const createdAt = new Date().toISOString(); if (supabase) { const { error } = await supabase.from("ai_events").insert({ discord_id: id, interaction_type: `social:${type}`, created_at: createdAt }); if (!error) return; remoteFailure("salvar memória social", error.message); } queue = queue.then(async () => { const db = await readLocal(); db.social.push({ discordId: id, type, createdAt }); await saveLocal(db); }); await queue; }
export async function socialMemoryContext(id: string): Promise<string> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString(); let signals: SocialSignal[];
  if (supabase) { const { data, error } = await supabase.from("ai_events").select("discord_id,interaction_type,created_at").eq("discord_id", id).like("interaction_type", "social:%").gte("created_at", cutoff).order("created_at"); if (!error) signals = (data ?? []).map((item) => ({ discordId: item.discord_id, type: String(item.interaction_type).replace("social:", "") as SocialSignalType, createdAt: item.created_at })); else { remoteFailure("ler memória social", error.message); await queue; signals = (await readLocal()).social.filter((item) => item.discordId === id && item.createdAt >= cutoff); } }
  else { await queue; signals = (await readLocal()).social.filter((item) => item.discordId === id && item.createdAt >= cutoff); }
  const count = (type: SocialSignalType) => signals.filter((item) => item.type === type).length;
  const annoyance = Math.min(3, Math.max(0, count("insult") - count("apology") * 2 - count("kindness")));
  const affection = Math.min(3, count("affection") + count("kindness") + count("gratitude") + count("apology"));
  const playfulness = Math.min(3, count("humor")); const care = Math.min(3, count("vulnerability"));
  if (!annoyance && !affection && !playfulness && !care) return "";
  return `Memória relacional temporária e individual deste usuário (48h): carinho ${affection}/3, implicância ${annoyance}/3, cumplicidade ${playfulness}/3, cuidado ${care}/3. Deixe esses tons aparecerem de modo sutil e natural, mantendo a personalidade-base. Implicância significa deboche leve, nunca hostilidade, preconceito ou perseguição. Cuidado pede acolhimento sem diagnosticar a pessoa.`;
}
export async function clearUserSocialSignals(id: string): Promise<void> { if (supabase) { const { error } = await supabase.from("ai_events").delete().eq("discord_id", id).like("interaction_type", "social:%"); if (!error) return; remoteFailure("apagar memória social", error.message); } queue = queue.then(async () => { const db = await readLocal(); db.social = db.social.filter((item) => item.discordId !== id); await saveLocal(db); }); await queue; }
export async function clearUserHistory(id: string): Promise<void> { if (supabase) { const { error } = await supabase.from("conversation_history").delete().eq("discord_id", id); if (!error) return; remoteFailure("apagar histórico", error.message); } queue = queue.then(async () => { const db = await readLocal(); db.history = db.history.filter((x) => x.discordId !== id); await saveLocal(db); }); await queue; }
export async function cleanupExpired(): Promise<void> {
  const historyCutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString(); const usageCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
  if (supabase) { const results = await Promise.all([supabase.from("conversation_history").delete().lt("created_at", historyCutoff), supabase.from("ai_events").delete().lt("created_at", historyCutoff), supabase.from("ai_usage").delete().lt("created_at", usageCutoff)]); if (results.every((x) => !x.error)) return; remoteFailure("limpeza automática", results.find((x) => x.error)?.error?.message); }
  queue = queue.then(async () => { const db = await readLocal(); db.history = db.history.filter((x) => x.createdAt >= historyCutoff); db.spontaneous = db.spontaneous.filter((x) => x.createdAt >= historyCutoff); db.social = db.social.filter((x) => x.createdAt >= historyCutoff); db.usage = db.usage.filter((x) => x.createdAt >= usageCutoff); await saveLocal(db); }); await queue;
}
