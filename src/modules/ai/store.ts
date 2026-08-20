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
  safePreferredStyle,
  safeAboutMe,
  safeRecentMilestones,
  safeRelationshipSummary,
  type PrismaMood,
  type PrismaRelationship,
  type PrismaStateUpdate,
  type PrismaTemperament,
  type PrismaUserState,
} from "./state.js";
import { applyEmotionalUpdate, clampEmotion, decayEmotionalState, defaultEmotionalState, type PrismaEmotionalState, type PrismaEmotionalUpdate } from "./emotional-state.js";

export type { PrismaMood, PrismaRelationship, PrismaStateUpdate, PrismaTemperament, PrismaUserState } from "./state.js";

export type UserSettings = { nickname: string; aboutMe: string; allowMentions: boolean; memoryEnabled: boolean; spontaneousInteractions: boolean };
export type HistoryItem = { discordId: string; channelId: string; role: "user" | "assistant"; content: string; createdAt: string };
export type PrismaProfile = { userId: string; displayName: string | null; profileSummary: string | null; communicationStyle: string | null; interests: string[]; knownPreferences: string[] };
export type PrismaMemory = { id?: number; userId: string; memoryType: string; content: string; importance: number; confidence: number; sourceMessageId?: string | null };
export type PrismaMessage = { messageId: string; guildId: string; channelId: string; userId: string; content: string; authorIsPrisma: boolean; replyToMessageId?: string | null; createdAt: string };
export type PrismaDailySummary = { userId: string; summaryDate: string; summary: string; updatedAt?: string };
export type UsageItem = { discordId: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; estimatedCostBrl: number; createdAt: string };
type SpontaneousEvent = { discordId: string; createdAt: string };
type Database = {
  settings: Record<string, UserSettings>;
  relationships: Record<string, PrismaRelationship>;
  temperaments: Record<string, PrismaTemperament>;
  history: HistoryItem[];
  usage: UsageItem[];
  spontaneous: SpontaneousEvent[];
  profiles?: Record<string, PrismaProfile>;
  memories?: PrismaMemory[];
  emotionalStates?: Record<string, PrismaEmotionalState>;
  prismaMessages?: PrismaMessage[];
  dailySummaries?: PrismaDailySummary[];
};

const defaults: UserSettings = { nickname: "", aboutMe: "", allowMentions: true, memoryEnabled: true, spontaneousInteractions: false };
const privacySafeDefaults: UserSettings = { nickname: "", aboutMe: "", allowMentions: false, memoryEnabled: false, spontaneousInteractions: false };
const file = path.resolve(config.dataDir, "ai-module.json");
const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
let localQueue = Promise.resolve();
let warnedMissingStateRpc = false;
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
    aboutMe: safeAboutMe(value.aboutMe) ?? "",
    allowMentions: booleanOrDefault(value.allowMentions, defaults.allowMentions),
    memoryEnabled: booleanOrDefault(value.memoryEnabled, defaults.memoryEnabled),
    spontaneousInteractions: booleanOrDefault(value.spontaneousInteractions, defaults.spontaneousInteractions),
  };
}

function fromSettings(row: Record<string, unknown> | null): UserSettings {
  if (!row) return { ...defaults };
  return normalizeSettings({
    nickname: row.nickname as string,
    aboutMe: row.about_me as string,
    allowMentions: row.allow_mentions as boolean,
    memoryEnabled: row.memory_enabled as boolean,
    spontaneousInteractions: row.spontaneous_interactions as boolean,
  });
}

function toSettings(id: string, value: UserSettings) {
  return {
    discord_id: id,
    nickname: value.nickname,
    about_me: value.aboutMe,
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
    preferredStyle: safePreferredStyle(row.preferred_style ?? row.preferredStyle) ?? null,
    relationshipSummary: safeRelationshipSummary(row.relationship_summary ?? row.relationshipSummary) ?? null,
    recentMilestones: safeRecentMilestones(row.recent_milestones ?? row.recentMilestones) ?? [],
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
    p_recent_milestones: state.relationship.recentMilestones ?? [],
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
      profiles: parsed.profiles ?? {}, memories: parsed.memories ?? [],
      emotionalStates: parsed.emotionalStates ?? {}, prismaMessages: parsed.prismaMessages ?? [], dailySummaries: parsed.dailySummaries ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { settings: {}, relationships: {}, temperaments: {}, history: [], usage: [], spontaneous: [], profiles: {}, memories: [], emotionalStates: {}, prismaMessages: [], dailySummaries: [] };
    }
    throw error;
  }
}

export async function getPrismaProfile(userId: string): Promise<PrismaProfile | null> {
  if (supabase) {
    const { data, error } = await supabase.from("prisma_user_profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) { remoteFailure("ler perfil aprendido", error.message); return null; }
    return data ? { userId, displayName: data.display_name, profileSummary: data.profile_summary, communicationStyle: data.communication_style, interests: data.interests ?? [], knownPreferences: data.known_preferences ?? [] } : null;
  }
  return withLocal(db => db.profiles?.[userId] ?? null);
}

export async function getRelevantPrismaMemories(userId: string, limit = 8, currentMessage = ""): Promise<PrismaMemory[]> {
  const terms = new Set(currentMessage.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const rank = (memory: PrismaMemory) => memory.importance * 2 + memory.confidence + [...terms].filter(term => memory.content.toLocaleLowerCase("pt-BR").includes(term)).length * 50;
  if (supabase) {
    const { data, error } = await supabase.from("prisma_memories").select("*").eq("user_id", userId).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(limit);
    if (error) { remoteFailure("ler memórias", error.message); return []; }
    return (data ?? []).map(row => ({ id: row.id, userId, memoryType: row.memory_type, content: row.content, importance: score(row.importance, 50), confidence: score(row.confidence, 60), sourceMessageId: row.source_message_id })).sort((a, b) => rank(b) - rank(a));
  }
  return withLocal(db => (db.memories ?? []).filter(memory => memory.userId === userId).sort((a,b) => rank(b) - rank(a)).slice(0, limit));
}

function safeMemoryText(value: unknown, maximum = 300): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  if (text.length < 3 || /(?:https?:\/\/|<@!?\d+>|\b(?:token|senha|password|api[ _-]?key|cpf|telefone|e-?mail)\b)/i.test(text)) return null;
  return text;
}

export async function upsertPrismaProfile(profile: PrismaProfile & { guildId?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  if (supabase) {
    const { error } = await supabase.from("prisma_user_profiles").upsert({ user_id: profile.userId, guild_id: profile.guildId ?? null, display_name: profile.displayName, profile_summary: safeMemoryText(profile.profileSummary), communication_style: safeMemoryText(profile.communicationStyle, 160), interests: profile.interests.slice(0, 12), known_preferences: profile.knownPreferences.slice(0, 12), last_interaction_at: now, updated_at: now }, { onConflict: "user_id" });
    if (error) remoteFailure("salvar perfil aprendido", error.message);
    return;
  }
  await withLocal(db => { (db.profiles ??= {})[profile.userId] = profile; }, true);
}

export async function upsertPrismaMemory(memory: PrismaMemory): Promise<void> {
  const content = safeMemoryText(memory.content);
  if (!content) return;
  const candidate = { ...memory, content, importance: score(memory.importance, 50), confidence: score(memory.confidence, 60) };
  if (supabase) {
    const { data: existing, error: readError } = await supabase.from("prisma_memories").select("id,importance,confidence").eq("user_id", candidate.userId).ilike("content", candidate.content).maybeSingle();
    if (readError) { remoteFailure("procurar memória existente", readError.message); return; }
    const row = { memory_type: candidate.memoryType, content: candidate.content, importance: Math.max(candidate.importance, score(existing?.importance, 0)), confidence: Math.max(candidate.confidence, score(existing?.confidence, 0)), source_message_id: candidate.sourceMessageId ?? null, updated_at: new Date().toISOString() };
    const { error } = existing
      ? await supabase.from("prisma_memories").update(row).eq("id", existing.id).eq("user_id", candidate.userId)
      : await supabase.from("prisma_memories").insert({ user_id: candidate.userId, ...row });
    if (error) remoteFailure("salvar memória", error.message);
    return;
  }
  await withLocal(db => {
    const memories = db.memories ??= [];
    const current = memories.find(item => item.userId === candidate.userId && item.content.toLocaleLowerCase("pt-BR") === candidate.content.toLocaleLowerCase("pt-BR"));
    if (current) Object.assign(current, candidate, { importance: Math.max(current.importance, candidate.importance), confidence: Math.max(current.confidence, candidate.confidence) });
    else memories.push(candidate);
  }, true);
}

export async function listPrismaMemories(userId: string): Promise<PrismaMemory[]> {
  return getRelevantPrismaMemories(userId, 30);
}

export async function deletePrismaMemory(userId: string, memoryId: number): Promise<boolean> {
  if (!Number.isInteger(memoryId) || memoryId < 1) return false;
  if (supabase) {
    const { error, count } = await supabase.from("prisma_memories").delete({ count: "exact" }).eq("id", memoryId).eq("user_id", userId);
    if (error) { remoteFailure("apagar memória", error.message); return false; }
    return (count ?? 0) > 0;
  }
  return withLocal(db => {
    const memories = db.memories ?? [];
    const index = memories.findIndex(item => item.id === memoryId && item.userId === userId);
    if (index < 0) return false;
    memories.splice(index, 1); return true;
  }, true);
}

export async function deletePrismaUserData(userId: string, scope: "history" | "memories" | "relationship" | "all"): Promise<void> {
  if (!userId.trim()) throw new Error("Usuário inválido.");
  if (supabase) {
    const { error } = await supabase.rpc("delete_prisma_user_data", { p_user_id: userId, p_scope: scope });
    if (error) { remoteFailure("apagar dados Prisma", error.message); throw new Error("Não foi possível apagar seus dados agora."); }
  }
  await withLocal(db => {
    if (scope === "history" || scope === "all") { db.history = db.history.filter(item => item.discordId !== userId); db.prismaMessages = (db.prismaMessages ?? []).filter(item => item.userId !== userId); }
    if (scope === "memories" || scope === "all") { if (db.profiles) delete db.profiles[userId]; db.memories = (db.memories ?? []).filter(item => item.userId !== userId); db.dailySummaries = (db.dailySummaries ?? []).filter(item => item.userId !== userId); }
    if (scope === "relationship" || scope === "all") { delete db.relationships[userId]; delete db.temperaments[userId]; if (db.emotionalStates) delete db.emotionalStates[userId]; }
  }, true);
}

export async function getEmotionalState(userId: string, now = new Date()): Promise<PrismaEmotionalState> {
  if (supabase) {
    const { data, error } = await supabase.from("prisma_emotional_states").select("*").eq("user_id", userId).maybeSingle();
    if (error) { remoteFailure("ler estado emocional", error.message); return defaultEmotionalState(userId, now.toISOString()); }
    const state = data ? { userId, happiness: clampEmotion(data.happiness, 50), sadness: clampEmotion(data.sadness), anger: clampEmotion(data.anger), irritation: clampEmotion(data.irritation), affection: clampEmotion(data.affection, 30), curiosity: clampEmotion(data.curiosity, 50), excitement: clampEmotion(data.excitement, 30), boredom: clampEmotion(data.boredom), confidence: clampEmotion(data.confidence, 50), energy: clampEmotion(data.energy, 50), updatedAt: timestamp(data.updated_at, now.toISOString()) } : defaultEmotionalState(userId, now.toISOString());
    return decayEmotionalState(state, now);
  }
  return withLocal(db => decayEmotionalState(db.emotionalStates?.[userId] ?? defaultEmotionalState(userId, now.toISOString()), now));
}

export async function updateEmotionalState(userId: string, update: PrismaEmotionalUpdate): Promise<void> {
  const next = applyEmotionalUpdate(await getEmotionalState(userId), update);
  if (supabase) {
    const { error } = await supabase.from("prisma_emotional_states").upsert({ user_id: userId, happiness: next.happiness, sadness: next.sadness, anger: next.anger, irritation: next.irritation, affection: next.affection, curiosity: next.curiosity, excitement: next.excitement, boredom: next.boredom, confidence: next.confidence, energy: next.energy, updated_at: next.updatedAt }, { onConflict: "user_id" });
    if (error) remoteFailure("salvar estado emocional", error.message);
    return;
  }
  await withLocal(db => { (db.emotionalStates ??= {})[userId] = next; }, true);
}

export async function addPrismaMessage(message: PrismaMessage): Promise<void> {
  const content = message.content.trim().slice(0, 4_000);
  if (!content || !message.messageId) return;
  if (supabase) {
    const { error } = await supabase.from("prisma_messages").upsert({ message_id: message.messageId, guild_id: message.guildId, channel_id: message.channelId, user_id: message.userId, content, author_is_prisma: message.authorIsPrisma, reply_to_message_id: message.replyToMessageId ?? null, created_at: message.createdAt }, { onConflict: "message_id", ignoreDuplicates: true });
    if (error) remoteFailure("salvar mensagem Prisma", error.message);
    return;
  }
  await withLocal(db => { const messages = db.prismaMessages ??= []; if (!messages.some(item => item.messageId === message.messageId)) messages.push({ ...message, content }); }, true);
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
  const missingRpc = /apply_prisma_state|schema cache|function .*does not exist/i.test(error.message);
  if (!missingRpc) {
    remoteFailure("atualizar estado relacional", error.message);
    return false;
  }
  if (!warnedMissingStateRpc) {
    console.warn("[SUPABASE] RPC apply_prisma_state ausente; usando fallback direto até as migrações serem aplicadas.");
    warnedMissingStateRpc = true;
  }

  const params = stateRpcParameters(state);
  const relationship = {
    discord_id: params.p_discord_id,
    familiarity: params.p_familiarity,
    warmth: params.p_warmth,
    patience: params.p_patience,
    banter: params.p_banter,
    trust: params.p_trust,
    preferred_style: params.p_preferred_style,
    relationship_summary: params.p_relationship_summary,
    recent_milestones: params.p_recent_milestones,
    interaction_count: params.p_interaction_count,
    summary_updated_at: params.p_summary_updated_at,
    created_at: params.p_relationship_created_at,
    updated_at: params.p_relationship_updated_at,
  };
  let relationshipResult = await supabase.from("prisma_relationships").upsert(relationship, { onConflict: "discord_id" });
  if (relationshipResult.error && /recent_milestones|schema cache|column .* does not exist/i.test(relationshipResult.error.message)) {
    const { recent_milestones: _ignored, ...legacyRelationship } = relationship;
    relationshipResult = await supabase.from("prisma_relationships").upsert(legacyRelationship, { onConflict: "discord_id" });
  }
  const temperamentResult = await supabase.from("prisma_temperament").upsert({
    discord_id: params.p_discord_id,
    mood: params.p_mood,
    energy: params.p_energy,
    sarcasm: params.p_sarcasm,
    affection: params.p_affection,
    last_interaction_at: params.p_last_interaction_at,
    updated_at: params.p_temperament_updated_at,
  }, { onConflict: "discord_id" });
  if (relationshipResult.error || temperamentResult.error) {
    remoteFailure("fallback direto do estado relacional", relationshipResult.error?.message ?? temperamentResult.error?.message);
    return false;
  }
  return true;
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
    supabase.from("prisma_user_profiles").select("user_id").limit(1),
    supabase.from("prisma_memories").select("id").limit(1),
    supabase.from("prisma_messages").select("id").limit(1),
    supabase.from("prisma_emotional_states").select("user_id").limit(1),
    supabase.from("prisma_daily_summaries").select("id").limit(1),
  ]);
  const tables = ["user_settings", "conversation_history", "ai_usage", "ai_events", "prisma_relationships", "prisma_temperament", "prisma_user_profiles", "prisma_memories", "prisma_messages", "prisma_emotional_states", "prisma_daily_summaries"];
  const failures = checks.map((result, index) => result.error ? `${tables[index]}: ${result.error.message}` : null).filter(Boolean);
  if (failures.length) {
    console.error(`[SUPABASE] Schema incompleto:\n${failures.join("\n")}`);
    return false;
  }
  console.log("[SUPABASE] Conectado; tabelas da Prisma acessíveis.");
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
    if (error) {
      remoteFailure("salvar preferências", error.message);
      if (/about_me|schema cache/i.test(error.message)) throw new Error("A coluna about_me ainda não existe no Supabase. Aplique a migração 20260817_prisma_about_me.sql.");
      throw new Error("Não foi possível salvar sua preferência agora.");
    }
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
