import { createClient } from "@supabase/supabase-js";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { sanitizeNickname } from "./personality.js";
import {
  applyValidatedStateUpdate,
  decayTemperament,
  defaultRelationship,
  defaultTemperament,
  prismaMoods,
  safeRelationshipSummary,
  type PrismaMood,
  type PrismaRelationship,
  type PrismaStateUpdate,
  type PrismaTemperament,
  type PrismaUserState,
} from "./state.js";

export type { PrismaMood, PrismaRelationship, PrismaStateUpdate, PrismaTemperament, PrismaUserState } from "./state.js";

export type UserSettings = { nickname: string; allowMentions: boolean; memoryEnabled: boolean; spontaneousInteractions: boolean };
export type HistoryItem = { discordId: string; channelId: string; role: "user" | "assistant"; content: string; createdAt: string };
export type UsageItem = { discordId: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; estimatedCostBrl: number; createdAt: string };
type SpontaneousEvent = { discordId: string; createdAt: string };
type Database = {
  settings: Record<string, UserSettings>;
  relationships: Record<string, PrismaRelationship>;
  temperaments: Record<string, PrismaTemperament>;
  history: HistoryItem[];
  usage: UsageItem[];
  spontaneous: SpontaneousEvent[];
};

const defaults: UserSettings = { nickname: "", allowMentions: true, memoryEnabled: true, spontaneousInteractions: false };
const privacySafeDefaults: UserSettings = { nickname: "", allowMentions: false, memoryEnabled: false, spontaneousInteractions: false };
const file = path.resolve("data", "ai-module.json");
const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
let localQueue = Promise.resolve();
const stateQueues = new Map<string, Promise<void>>();
const stateRevisions = new Map<string, number>();
const historyQueues = new Map<string, Promise<void>>();
const historyRevisions = new Map<string, number>();

function remoteFailure(operation: string, error: unknown): void {
  console.error(`[SUPABASE] ${operation} falhou; operação mantida em modo seguro:`, error);
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSettings(value: Partial<UserSettings>): UserSettings {
  return {
    nickname: sanitizeNickname(value.nickname),
    allowMentions: booleanOrDefault(value.allowMentions, defaults.allowMentions),
    memoryEnabled: booleanOrDefault(value.memoryEnabled, defaults.memoryEnabled),
    spontaneousInteractions: booleanOrDefault(value.spontaneousInteractions, defaults.spontaneousInteractions),
  };
}

function fromSettings(row: Record<string, unknown> | null): UserSettings {
  if (!row) return { ...defaults };
  return normalizeSettings({
    nickname: row.nickname as string,
    allowMentions: row.allow_mentions as boolean,
    memoryEnabled: row.memory_enabled as boolean,
    spontaneousInteractions: row.spontaneous_interactions as boolean,
  });
}

function toSettings(id: string, value: UserSettings) {
  return {
    discord_id: id,
    nickname: value.nickname,
    allow_mentions: value.allowMentions,
    memory_enabled: value.memoryEnabled,
    spontaneous_interactions: value.spontaneousInteractions,
    updated_at: new Date().toISOString(),
  };
}

function fromHistory(row: Record<string, unknown>): HistoryItem {
  return {
    discordId: row.discord_id as string,
    channelId: row.channel_id as string,
    role: row.role as "user" | "assistant",
    content: row.content as string,
    createdAt: row.created_at as string,
  };
}

function score(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function timestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function fromRelationship(id: string, row: Record<string, unknown> | null, now: string): PrismaRelationship {
  const fallback = defaultRelationship(id, now);
  if (!row) return fallback;
  return {
    discordId: id,
    familiarity: score(row.familiarity, fallback.familiarity),
    warmth: score(row.warmth, fallback.warmth),
    patience: score(row.patience, fallback.patience),
    banter: score(row.banter, fallback.banter),
    trust: score(row.trust, fallback.trust),
    preferredStyle: typeof (row.preferred_style ?? row.preferredStyle) === "string" ? String(row.preferred_style ?? row.preferredStyle).slice(0, 120) : null,
    relationshipSummary: safeRelationshipSummary(row.relationship_summary ?? row.relationshipSummary) ?? null,
    summaryUpdatedAt: typeof (row.summary_updated_at ?? row.summaryUpdatedAt) === "string" ? String(row.summary_updated_at ?? row.summaryUpdatedAt) : null,
    interactionCount: Math.max(0, Math.round(Number(row.interaction_count ?? row.interactionCount) || 0)),
    createdAt: timestamp(row.created_at ?? row.createdAt, now),
    updatedAt: timestamp(row.updated_at ?? row.updatedAt, now),
  };
}

function fromTemperament(id: string, row: Record<string, unknown> | null, now: string): PrismaTemperament {
  const fallback = defaultTemperament(id, now);
  if (!row) return fallback;
  const mood = typeof row.mood === "string" && (prismaMoods as readonly string[]).includes(row.mood) ? row.mood as PrismaMood : "neutral";
  return {
    discordId: id,
    mood,
    energy: score(row.energy, fallback.energy),
    sarcasm: score(row.sarcasm, fallback.sarcasm),
    affection: score(row.affection, fallback.affection),
    lastInteractionAt: typeof (row.last_interaction_at ?? row.lastInteractionAt) === "string" ? String(row.last_interaction_at ?? row.lastInteractionAt) : null,
    updatedAt: timestamp(row.updated_at ?? row.updatedAt, now),
  };
}

function stateRpcParameters(state: PrismaUserState) {
  return {
    p_discord_id: state.relationship.discordId,
    p_familiarity: state.relationship.familiarity,
    p_warmth: state.relationship.warmth,
    p_patience: state.relationship.patience,
    p_banter: state.relationship.banter,
    p_trust: state.relationship.trust,
    p_preferred_style: state.relationship.preferredStyle ?? null,
    p_relationship_summary: state.relationship.relationshipSummary ?? null,
    p_interaction_count: state.relationship.interactionCount,
    p_summary_updated_at: state.relationship.summaryUpdatedAt ?? null,
    p_relationship_created_at: state.relationship.createdAt,
    p_relationship_updated_at: state.relationship.updatedAt,
    p_mood: state.temperament.mood,
    p_energy: state.temperament.energy,
    p_sarcasm: state.temperament.sarcasm,
    p_affection: state.temperament.affection,
    p_last_interaction_at: state.temperament.lastInteractionAt ?? null,
    p_temperament_updated_at: state.temperament.updatedAt,
  };
}

async function withKeyedLock<T>(locks: Map<string, Promise<void>>, id: string, operation: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(id, tail);
  try { return await result; }
  finally { if (locks.get(id) === tail) locks.delete(id); }
}

async function withLocal<T>(operation: (db: Database) => Promise<T> | T, save = false): Promise<T> {
  const task = localQueue.catch(() => undefined).then(async () => {
    const db = await readLocal();
    const result = await operation(db);
    if (save) await saveLocal(db);
    return result;
  });
  localQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function readLocal(): Promise<Database> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<Database>;
    return {
      settings: parsed.settings ?? {},
      relationships: parsed.relationships ?? {},
      temperaments: parsed.temperaments ?? {},
      history: parsed.history ?? [],
      usage: parsed.usage ?? [],
      spontaneous: parsed.spontaneous ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { settings: {}, relationships: {}, temperaments: {}, history: [], usage: [], spontaneous: [] };
    }
    throw error;
  }
}

async function saveLocal(db: Database): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600).catch(() => undefined);
}

async function localPrismaState(id: string, now: Date, create: boolean): Promise<PrismaUserState> {
  return withLocal(async (db) => {
    const iso = now.toISOString();
    const relationship = fromRelationship(id, db.relationships[id] as unknown as Record<string, unknown> | null, iso);
    const temperament = decayTemperament(fromTemperament(id, db.temperaments[id] as unknown as Record<string, unknown> | null, iso), now);
    if (create && (!db.relationships[id] || !db.temperaments[id])) {
      db.relationships[id] = relationship;
      db.temperaments[id] = temperament;
    }
    return { relationship, temperament, revision: stateRevisions.get(id) ?? 0 };
  }, create);
}

async function readRemotePrismaState(id: string, now: Date): Promise<{ state: PrismaUserState; missing: boolean } | null> {
  if (!supabase) return null;
  const [relationshipResult, temperamentResult] = await Promise.all([
    supabase.from("prisma_relationships").select("*").eq("discord_id", id).maybeSingle(),
    supabase.from("prisma_temperament").select("*").eq("discord_id", id).maybeSingle(),
  ]);
  if (relationshipResult.error || temperamentResult.error) {
    remoteFailure("ler estado relacional", relationshipResult.error?.message ?? temperamentResult.error?.message);
    return null;
  }
  const iso = now.toISOString();
  return {
    state: {
      relationship: fromRelationship(id, relationshipResult.data, iso),
      temperament: decayTemperament(fromTemperament(id, temperamentResult.data, iso), now),
      revision: stateRevisions.get(id) ?? 0,
    },
    missing: !relationshipResult.data || !temperamentResult.data,
  };
}

async function writeRemotePrismaState(state: PrismaUserState): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("apply_prisma_state", stateRpcParameters(state));
  if (!error) return true;
  remoteFailure("atualizar estado relacional", error.message);
  return false;
}

export function isSupabaseConfigured(): boolean {
  return !!supabase;
}

export async function checkSupabaseConnection(): Promise<boolean> {
  if (!supabase) {
    console.warn("[SUPABASE] Não configurado; Prisma IA usando armazenamento local privado.");
    return false;
  }
  const checks = await Promise.all([
    supabase.from("user_settings").select("discord_id").limit(1),
    supabase.from("conversation_history").select("id").limit(1),
    supabase.from("ai_usage").select("id").limit(1),
    supabase.from("ai_events").select("id").limit(1),
    supabase.from("prisma_relationships").select("discord_id").limit(1),
    supabase.from("prisma_temperament").select("discord_id").limit(1),
  ]);
  const tables = ["user_settings", "conversation_history", "ai_usage", "ai_events", "prisma_relationships", "prisma_temperament"];
  const failures = checks.map((result, index) => result.error ? `${tables[index]}: ${result.error.message}` : null).filter(Boolean);
  if (failures.length) {
    console.error(`[SUPABASE] Schema incompleto:\n${failures.join("\n")}`);
    return false;
  }
  console.log("[SUPABASE] Conectado; 6 tabelas acessíveis.");
  return true;
}

export async function getSettings(id: string): Promise<UserSettings> {
  if (supabase) {
    const { data, error } = await supabase.from("user_settings").select("*").eq("discord_id", id).maybeSingle();
    if (!error) return fromSettings(data);
    remoteFailure("ler preferências", error.message);
    return { ...privacySafeDefaults };
  }
  return withLocal((db) => db.settings[id] ? normalizeSettings(db.settings[id]) : { ...defaults });
}

export async function updateSettings(id: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  if (supabase) {
    const { data, error: readError } = await supabase.from("user_settings").select("*").eq("discord_id", id).maybeSingle();
    if (readError) { remoteFailure("ler preferências para atualização", readError.message); throw new Error("Não foi possível salvar sua preferência agora."); }
    const result = normalizeSettings({ ...fromSettings(data), ...patch });
    const { error } = await supabase.from("user_settings").upsert(toSettings(id, result), { onConflict: "discord_id" });
    if (error) { remoteFailure("salvar preferências", error.message); throw new Error("Não foi possível salvar sua preferência agora."); }
    return result;
  }
  return withLocal((db) => {
    const result = normalizeSettings({ ...(db.settings[id] ?? defaults), ...patch });
    db.settings[id] = result;
    return result;
  }, true);
}

export async function clearNickname(id: string): Promise<void> {
  let remoteError: string | null = null;
  if (supabase) {
    const { error } = await supabase.from("user_settings").update({ nickname: "", updated_at: new Date().toISOString() }).eq("discord_id", id);
    if (error) { remoteFailure("remover apelido", error.message); remoteError = error.message; }
  }
  await withLocal((db) => { if (db.settings[id]) db.settings[id] = { ...db.settings[id], nickname: "" }; }, true);
  if (remoteError) throw new Error("Não foi possível remover seu apelido no Supabase agora.");
}

export async function getPrismaState(id: string, now = new Date()): Promise<PrismaUserState> {
  if (supabase) {
    const remote = await readRemotePrismaState(id, now);
    if (!remote) return { relationship: defaultRelationship(id, now.toISOString()), temperament: defaultTemperament(id, now.toISOString()), revision: stateRevisions.get(id) ?? 0 };
    if (remote.missing) await writeRemotePrismaState(remote.state);
    return remote.state;
  }
  return localPrismaState(id, now, true);
}

export async function applyPrismaStateUpdate(id: string, baseState: PrismaUserState, update: PrismaStateUpdate, now = new Date()): Promise<boolean> {
  return withKeyedLock(stateQueues, id, async () => {
    if ((baseState.revision ?? 0) !== (stateRevisions.get(id) ?? 0)) return false;
    if (supabase) {
      const remote = await readRemotePrismaState(id, now);
      if (!remote || (baseState.revision ?? 0) !== (stateRevisions.get(id) ?? 0)) return false;
      return writeRemotePrismaState(applyValidatedStateUpdate(remote.state, update, now));
    }
    const current = await localPrismaState(id, now, true);
    if ((baseState.revision ?? 0) !== (stateRevisions.get(id) ?? 0)) return false;
    const next = applyValidatedStateUpdate(current, update, now);
    await withLocal((db) => { db.relationships[id] = next.relationship; db.temperaments[id] = next.temperament; }, true);
    return true;
  });
}

export function captureHistoryRevision(id: string): number {
  return historyRevisions.get(id) ?? 0;
}

export async function addHistoryTurn(items: HistoryItem[], expectedRevision: number): Promise<boolean> {
  const id = items[0]?.discordId;
  if (!id || items.some((item) => item.discordId !== id)) return false;
  return withKeyedLock(historyQueues, id, async () => {
    if (expectedRevision !== (historyRevisions.get(id) ?? 0)) return false;
    if (supabase) {
      const rows = items.map((item) => ({ discord_id: item.discordId, channel_id: item.channelId, role: item.role, content: item.content, created_at: item.createdAt }));
      const { error } = await supabase.from("conversation_history").insert(rows);
      if (error) { remoteFailure("salvar histórico", error.message); return false; }
      return true;
    }
    await withLocal((db) => { db.history.push(...items); }, true);
    return true;
  });
}

export async function addHistory(item: HistoryItem): Promise<void> {
  await addHistoryTurn([item], captureHistoryRevision(item.discordId));
}

export function selectRecentHistory(items: HistoryItem[], id: string, channelId: string, limit: number, maxChars: number, now = new Date()): HistoryItem[] {
  const cutoff = now.getTime() - 48 * 60 * 60_000;
  const eligible = items
    .filter((item) => item.discordId === id && item.channelId === channelId && Date.parse(item.createdAt) >= cutoff)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(-Math.max(0, limit));
  let remaining = Math.max(0, maxChars);
  const selected: HistoryItem[] = [];
  for (const item of [...eligible].reverse()) {
    if (remaining <= 0) break;
    const content = item.content.slice(0, remaining);
    if (!content) break;
    selected.unshift({ ...item, content });
    remaining -= content.length;
  }
  return selected;
}

export async function recentHistory(id: string, channelId: string, limit: number, maxChars: number): Promise<HistoryItem[]> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  if (supabase) {
    const { data, error } = await supabase.from("conversation_history")
      .select("id,discord_id,channel_id,role,content,created_at")
      .eq("discord_id", id).eq("channel_id", channelId).gte("created_at", cutoff)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) { remoteFailure("ler histórico", error.message); return []; }
    return selectRecentHistory((data ?? []).map(fromHistory), id, channelId, limit, maxChars);
  }
  return withLocal((db) => selectRecentHistory(db.history, id, channelId, limit, maxChars));
}

export async function clearUserHistory(id: string): Promise<void> {
  await withKeyedLock(historyQueues, id, async () => {
    let remoteError: string | null = null;
    if (supabase) {
      const { error } = await supabase.from("conversation_history").delete().eq("discord_id", id);
      if (error) { remoteFailure("apagar histórico", error.message); remoteError = error.message; }
    }
    await withLocal((db) => { db.history = db.history.filter((item) => item.discordId !== id); }, true);
    historyRevisions.set(id, (historyRevisions.get(id) ?? 0) + 1);
    if (remoteError) throw new Error("Não foi possível apagar todo o histórico no Supabase.");
  });
}

export async function resetPrismaState(id: string, clearHistory = false): Promise<void> {
  await withKeyedLock(stateQueues, id, async () => {
    const operation = async () => {
      let remoteError: string | null = null;
      if (supabase) {
        const { error } = await supabase.rpc("reset_prisma_state", { p_discord_id: id, p_clear_history: clearHistory });
        if (error) { remoteFailure("reiniciar relação", error.message); remoteError = error.message; }
      }
      await withLocal((db) => {
        delete db.relationships[id];
        delete db.temperaments[id];
        if (clearHistory) db.history = db.history.filter((item) => item.discordId !== id);
      }, true);
      stateRevisions.set(id, (stateRevisions.get(id) ?? 0) + 1);
      if (clearHistory) historyRevisions.set(id, (historyRevisions.get(id) ?? 0) + 1);
      if (remoteError) throw new Error("Não foi possível reiniciar todos os dados no Supabase.");
    };
    if (clearHistory) await withKeyedLock(historyQueues, id, operation);
    else await operation();
  });
}

export async function addUsage(item: UsageItem): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("ai_usage").insert({ discord_id: item.discordId, model: item.model, input_tokens: item.inputTokens, output_tokens: item.outputTokens, total_tokens: item.totalTokens, estimated_cost_usd: item.estimatedCostUsd, estimated_cost_brl: item.estimatedCostBrl, created_at: item.createdAt });
    if (error) remoteFailure("salvar uso", error.message);
    return;
  }
  await withLocal((db) => { db.usage.push(item); }, true);
}

export async function monthlyCostBrl(): Promise<number> {
  const month = new Date().toISOString().slice(0, 7);
  const start = `${month}-01T00:00:00.000Z`;
  if (supabase) {
    const { data, error } = await supabase.from("ai_usage").select("estimated_cost_brl").gte("created_at", start);
    if (!error) return (data ?? []).reduce((sum, item) => sum + Number(item.estimated_cost_brl), 0);
    remoteFailure("calcular orçamento", error.message);
    return Number.POSITIVE_INFINITY;
  }
  return withLocal((db) => db.usage.filter((item) => item.createdAt.startsWith(month)).reduce((sum, item) => sum + item.estimatedCostBrl, 0));
}

async function spontaneousEvents(id: string): Promise<SpontaneousEvent[] | null> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  if (supabase) {
    const { data, error } = await supabase.from("ai_events").select("discord_id,created_at").eq("discord_id", id).eq("interaction_type", "spontaneous").gte("created_at", cutoff).order("created_at");
    if (!error) return (data ?? []).map((item) => ({ discordId: item.discord_id, createdAt: item.created_at }));
    remoteFailure("ler eventos espontâneos", error.message);
    return null;
  }
  return withLocal((db) => db.spontaneous.filter((item) => item.discordId === id && item.createdAt >= cutoff));
}

export async function spontaneousCountToday(id: string, timezone: string): Promise<number> {
  const events = await spontaneousEvents(id);
  if (!events) return Number.MAX_SAFE_INTEGER;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  return events.filter((item) => new Date(item.createdAt).toLocaleDateString("en-CA", { timeZone: timezone }) === today).length;
}

export async function lastSpontaneousAt(id: string): Promise<number> {
  const events = await spontaneousEvents(id);
  if (!events) return Date.now();
  const item = events.at(-1);
  return item ? Date.parse(item.createdAt) : 0;
}

export async function addSpontaneous(id: string): Promise<void> {
  const createdAt = new Date().toISOString();
  if (supabase) {
    const { error } = await supabase.from("ai_events").insert({ discord_id: id, interaction_type: "spontaneous", created_at: createdAt });
    if (error) remoteFailure("salvar evento espontâneo", error.message);
    return;
  }
  await withLocal((db) => { db.spontaneous.push({ discordId: id, createdAt }); }, true);
}

export async function cleanupExpired(): Promise<void> {
  const historyCutoff = new Date(Date.now() - 48 * 60 * 60_000).toISOString();
  const usageCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
  if (supabase) {
    const results = await Promise.all([
      supabase.from("conversation_history").delete().lt("created_at", historyCutoff),
      supabase.from("ai_events").delete().lt("created_at", historyCutoff),
      supabase.from("ai_usage").delete().lt("created_at", usageCutoff),
    ]);
    const error = results.find((result) => result.error)?.error;
    if (error) remoteFailure("limpeza automática", error.message);
  }
  await withLocal((db) => {
    db.history = db.history.filter((item) => item.createdAt >= historyCutoff);
    db.spontaneous = db.spontaneous.filter((item) => item.createdAt >= historyCutoff);
    db.usage = db.usage.filter((item) => item.createdAt >= usageCutoff);
  }, true);
}
