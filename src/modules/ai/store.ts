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
import { localModeration, normalizeText } from "../moderation/filter.js";

export type { PrismaMood, PrismaRelationship, PrismaStateUpdate, PrismaTemperament, PrismaUserState } from "./state.js";

export type UserSettings = { nickname: string; aboutMe: string; allowMentions: boolean; memoryEnabled: boolean; spontaneousInteractions: boolean };
export type HistoryItem = { discordId: string; channelId: string; role: "user" | "assistant"; content: string; createdAt: string };
export type PrismaProfile = { userId: string; displayName: string | null; profileSummary: string | null; communicationStyle: string | null; interests: string[]; knownPreferences: string[] };
export type PrismaMemory = { id?: number; userId: string; memoryType: string; content: string; importance: number; confidence: number; sourceMessageId?: string | null; memoryKey?: string; occurrenceCount?: number; lastSeenAt?: string; status?: "active" | "superseded" | "forgotten"; supersededBy?: number | null; validUntil?: string | null; lastConfirmedAt?: string };
export type PrismaMessage = { messageId: string; guildId: string; channelId: string; userId: string; content: string; authorIsPrisma: boolean; replyToMessageId?: string | null; createdAt: string };
export type PrismaDailySummary = { userId: string; summaryDate: string; summary: string; updatedAt?: string };
export type PrismaPeriodSummary = { userId: string; periodType: "weekly" | "monthly"; periodStart: string; periodEnd: string; summary: string; updatedAt?: string };
export type PrismaDailyBatch = { userId: string; summaryDate: string; messages: PrismaMessage[] };
export type UsageItem = { discordId: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; estimatedCostBrl: number; createdAt: string };
export type PrismaOperatorRule = { id?: number; ownerId: string; rule: string; createdAt: string };
export type PrismaSelfLearning = { id?: number; learningKey: string; category: string; insight: string; confidence: number; evidenceCount: number; status: "candidate" | "active" | "rejected"; lastObservedAt?: string };
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
  periodSummaries?: PrismaPeriodSummary[];
  operatorRules?: PrismaOperatorRule[];
  selfLearnings?: PrismaSelfLearning[];
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
const prismaThoughtPrefix = "PRISMA-THOUGHT:";

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

function historyFromPrismaMessage(row: Record<string, unknown>): HistoryItem {
  return {
    discordId: row.user_id as string,
    channelId: row.channel_id as string,
    role: row.author_is_prisma ? "assistant" : "user",
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
    const legacyWeekly = (parsed as Partial<Database> & { weeklySummaries?: Array<{ userId: string; weekStart: string; weekEnd: string; summary: string; updatedAt?: string }> }).weeklySummaries ?? [];
    return {
      settings: parsed.settings ?? {},
      relationships: parsed.relationships ?? {},
      temperaments: parsed.temperaments ?? {},
      history: parsed.history ?? [],
      usage: parsed.usage ?? [],
      spontaneous: parsed.spontaneous ?? [],
      profiles: parsed.profiles ?? {}, memories: parsed.memories ?? [],
      emotionalStates: parsed.emotionalStates ?? {}, prismaMessages: parsed.prismaMessages ?? [], dailySummaries: parsed.dailySummaries ?? [], periodSummaries: parsed.periodSummaries ?? legacyWeekly.map((item) => ({ userId: item.userId, periodType: "weekly", periodStart: item.weekStart, periodEnd: item.weekEnd, summary: item.summary, updatedAt: item.updatedAt })),
      selfLearnings: parsed.selfLearnings ?? [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { settings: {}, relationships: {}, temperaments: {}, history: [], usage: [], spontaneous: [], profiles: {}, memories: [], emotionalStates: {}, prismaMessages: [], dailySummaries: [], periodSummaries: [], selfLearnings: [] };
    }
    throw error;
  }
}

export async function getPrismaProfile(userId: string): Promise<PrismaProfile | null> {
  if (supabase) {
    const [profileResult, memoriesResult] = await Promise.all([
      supabase.from("prisma_user_profiles").select("display_name,profile_summary,communication_style").eq("user_id", userId).maybeSingle(),
      supabase.from("prisma_memories").select("memory_type,content").eq("user_id", userId).eq("status", "active").or(`valid_until.is.null,valid_until.gt.${new Date().toISOString()}`).in("memory_type", ["preference", "interest", "media", "game", "hobby", "routine", "communication"]),
    ]);
    if (profileResult.error || memoriesResult.error) { remoteFailure("ler perfil aprendido", profileResult.error?.message ?? memoriesResult.error?.message); return null; }
    if (!profileResult.data) return null;
    const facets = profileFacetsFromMemories((memoriesResult.data ?? []).map((row) => ({ userId, memoryType: row.memory_type, content: row.content, importance: 50, confidence: 60 })));
    return { userId, displayName: profileResult.data.display_name, profileSummary: profileResult.data.profile_summary, communicationStyle: profileResult.data.communication_style, ...facets };
  }
  return withLocal(db => {
    const profile = db.profiles?.[userId];
    if (!profile) return null;
    return { ...profile, ...profileFacetsFromMemories((db.memories ?? []).filter((item) => item.userId === userId && (item.status ?? "active") === "active" && (!item.validUntil || Date.parse(item.validUntil) > Date.now()))) };
  });
}

export function profileFacetsFromMemories(memories: PrismaMemory[]): Pick<PrismaProfile, "interests" | "knownPreferences"> {
  const uniqueText = (values: string[]) => [...new Map(values.map((value) => [value.toLocaleLowerCase("pt-BR"), value])).values()].slice(0, 12);
  const interestText = (content: string) => content.replace(/^(?:Gosta de|Acompanha ou joga)\s+/i, "").replace(/\.$/, "");
  return {
    interests: uniqueText(memories.filter((item) => ["interest", "media", "game", "hobby"].includes(item.memoryType) && !/^Não gosta/i.test(item.content)).map((item) => interestText(item.content))),
    knownPreferences: uniqueText(memories.filter((item) => ["preference", "communication", "routine"].includes(item.memoryType)).map((item) => item.content.replace(/\.$/, ""))),
  };
}

export async function getRelevantPrismaMemories(userId: string, limit = 8, currentMessage = ""): Promise<PrismaMemory[]> {
  const terms = new Set(currentMessage.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  const rank = (memory: PrismaMemory) => {
    const lexical = [...terms].filter(term => memory.content.toLocaleLowerCase("pt-BR").includes(term)).length * 50;
    const repetition = Math.min(20, Math.max(0, (memory.occurrenceCount ?? 1) - 1) * 4);
    const seenAt = Date.parse(memory.lastSeenAt ?? "");
    const recency = Number.isFinite(seenAt) ? Math.max(0, 15 - Math.floor((Date.now() - seenAt) / (30 * 24 * 60 * 60_000))) : 0;
    return memory.importance * 2 + memory.confidence + lexical + repetition + recency;
  };
  if (supabase) {
    const { data, error } = await supabase.from("prisma_memories").select("*").eq("user_id", userId).eq("status", "active").or(`valid_until.is.null,valid_until.gt.${new Date().toISOString()}`).order("importance", { ascending: false }).order("updated_at", { ascending: false }).limit(Math.max(30, limit * 4));
    if (error) { remoteFailure("ler memórias", error.message); return []; }
    return (data ?? []).map(row => ({ id: row.id, userId, memoryType: row.memory_type, content: row.content, importance: score(row.importance, 50), confidence: score(row.confidence, 60), sourceMessageId: row.source_message_id, memoryKey: row.memory_key, occurrenceCount: Number(row.occurrence_count) || 1, lastSeenAt: row.last_seen_at, status: row.status, supersededBy: row.superseded_by, validUntil: row.valid_until, lastConfirmedAt: row.last_confirmed_at })).sort((a, b) => rank(b) - rank(a)).slice(0, limit);
  }
  return withLocal(db => (db.memories ?? []).filter(memory => memory.userId === userId && (memory.status ?? "active") === "active" && (!memory.validUntil || Date.parse(memory.validUntil) > Date.now())).sort((a,b) => rank(b) - rank(a)).slice(0, limit));
}

function safeMemoryText(value: unknown, maximum = 300): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
  if (text.length < 3 || /(?:https?:\/\/|<@!?\d+>|\b(?:token|senha|password|api[ _-]?key|cpf|telefone|e-?mail)\b)/i.test(text)) return null;
  return text;
}

/** Validade padrão renovada sempre que uma informação recebe nova evidência. */
export function defaultMemoryValidUntil(memoryType: string, now = new Date()): string {
  const days = 180;
  return new Date(now.getTime() + days * 24 * 60 * 60_000).toISOString();
}

export async function upsertPrismaProfile(profile: PrismaProfile & { guildId?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  if (supabase) {
    const { error } = await supabase.from("prisma_user_profiles").upsert({ user_id: profile.userId, guild_id: profile.guildId ?? null, display_name: profile.displayName, profile_summary: safeMemoryText(profile.profileSummary), communication_style: safeMemoryText(profile.communicationStyle, 160), last_interaction_at: now, updated_at: now }, { onConflict: "user_id" });
    if (error) remoteFailure("salvar perfil aprendido", error.message);
    return;
  }
  await withLocal(db => { (db.profiles ??= {})[profile.userId] = profile; }, true);
}

export async function upsertPrismaMemory(memory: PrismaMemory): Promise<void> {
  const content = safeMemoryText(memory.content);
  if (!content) return;
  const validityNow = new Date();
  const requestedValidity = memory.validUntil ? Date.parse(memory.validUntil) : Number.NaN;
  const maximumValidity = validityNow.getTime() + 180 * 24 * 60 * 60_000;
  const validUntil = Number.isFinite(requestedValidity)
    ? new Date(Math.min(requestedValidity, maximumValidity)).toISOString()
    : defaultMemoryValidUntil(memory.memoryType, validityNow);
  const candidate = { ...memory, content, importance: score(memory.importance, 50), confidence: score(memory.confidence, 60), validUntil };
  if (supabase) {
    const lookup = supabase.from("prisma_memories").select("id,content,importance,confidence,occurrence_count,source_message_id,valid_until").eq("user_id", candidate.userId).eq("status", "active");
    const { data: existing, error: readError } = candidate.memoryKey
      ? await lookup.eq("memory_key", candidate.memoryKey).maybeSingle()
      : await lookup.ilike("content", candidate.content).maybeSingle();
    if (readError) { remoteFailure("procurar memória existente", readError.message); return; }
    const now = new Date().toISOString();
    if (existing && existing.content.toLocaleLowerCase("pt-BR") !== candidate.content.toLocaleLowerCase("pt-BR")) {
      const { error: archiveError } = await supabase.from("prisma_memories").update({ status: "superseded", valid_until: now, updated_at: now }).eq("id", existing.id).eq("user_id", candidate.userId).eq("status", "active");
      if (archiveError) { remoteFailure("arquivar memória substituída", archiveError.message); return; }
      const { data: inserted, error: insertError } = await supabase.from("prisma_memories").insert({ user_id: candidate.userId, memory_type: candidate.memoryType, memory_key: candidate.memoryKey ?? null, content: candidate.content, importance: candidate.importance, confidence: candidate.confidence, occurrence_count: 1, last_seen_at: now, last_confirmed_at: now, valid_until: candidate.validUntil ?? null, status: "active", source_message_id: candidate.sourceMessageId ?? null, updated_at: now }).select("id").single();
      if (insertError) {
        await supabase.from("prisma_memories").update({ status: "active", valid_until: null, updated_at: now }).eq("id", existing.id).eq("user_id", candidate.userId);
        remoteFailure("salvar nova versão da memória", insertError.message); return;
      }
      const { error: linkError } = await supabase.from("prisma_memories").update({ superseded_by: inserted.id }).eq("id", existing.id).eq("user_id", candidate.userId);
      if (linkError) remoteFailure("vincular histórico da memória", linkError.message);
      return;
    }
    const repeatedEvidence = Boolean(existing) && (!candidate.sourceMessageId || existing?.source_message_id !== candidate.sourceMessageId);
    const row = { memory_type: candidate.memoryType, memory_key: candidate.memoryKey ?? null, content: candidate.content, importance: Math.max(candidate.importance, score(existing?.importance, 0)), confidence: Math.min(100, Math.max(candidate.confidence, score(existing?.confidence, 0)) + (repeatedEvidence ? 5 : 0)), occurrence_count: (Number(existing?.occurrence_count) || 0) + (repeatedEvidence || !existing ? 1 : 0), last_seen_at: now, last_confirmed_at: repeatedEvidence || !existing ? now : undefined, valid_until: candidate.validUntil ?? existing?.valid_until ?? null, status: "active", source_message_id: candidate.sourceMessageId ?? existing?.source_message_id ?? null, updated_at: now };
    const { error } = existing
      ? await supabase.from("prisma_memories").update(row).eq("id", existing.id).eq("user_id", candidate.userId)
      : await supabase.from("prisma_memories").insert({ user_id: candidate.userId, ...row });
    if (error) remoteFailure("salvar memória", error.message);
    return;
  }
  await withLocal(db => {
    const memories = db.memories ??= [];
    const current = memories.find(item => item.userId === candidate.userId && (item.status ?? "active") === "active" && (candidate.memoryKey ? item.memoryKey === candidate.memoryKey : item.content.toLocaleLowerCase("pt-BR") === candidate.content.toLocaleLowerCase("pt-BR")));
    if (current) {
      if (current.content.toLocaleLowerCase("pt-BR") !== candidate.content.toLocaleLowerCase("pt-BR")) {
        const now = new Date().toISOString();
        const nextId = Math.max(0, ...memories.map(item => item.id ?? 0)) + 1;
        Object.assign(current, { status: "superseded", validUntil: now, supersededBy: nextId, lastSeenAt: now });
        memories.push({ ...candidate, id: nextId, status: "active", occurrenceCount: 1, lastSeenAt: now, lastConfirmedAt: now });
        return;
      }
      const repeatedEvidence = !candidate.sourceMessageId || current.sourceMessageId !== candidate.sourceMessageId;
      Object.assign(current, candidate, { status: "active", importance: Math.max(current.importance, candidate.importance), confidence: Math.min(100, Math.max(current.confidence, candidate.confidence) + (repeatedEvidence ? 5 : 0)), occurrenceCount: (current.occurrenceCount ?? 1) + (repeatedEvidence ? 1 : 0), lastSeenAt: new Date().toISOString(), lastConfirmedAt: repeatedEvidence ? new Date().toISOString() : current.lastConfirmedAt });
    }
    else memories.push({ ...candidate, id: Math.max(0, ...memories.map(item => item.id ?? 0)) + 1, status: "active", occurrenceCount: 1, lastSeenAt: new Date().toISOString(), lastConfirmedAt: new Date().toISOString() });
  }, true);
}

export async function enforcePrismaMemoryLimit(userId: string, limit = 300): Promise<void> {
  const safeLimit = Math.max(1, Math.min(300, Math.round(limit)));
  if (supabase) {
    const { error } = await supabase.rpc("enforce_prisma_memory_limit", { p_user_id: userId, p_limit: safeLimit });
    if (error && !/enforce_prisma_memory_limit|schema cache|function .*does not exist/i.test(error.message)) remoteFailure("limitar memórias ativas", error.message);
    return;
  }
  await withLocal(db => {
    const now = Date.now();
    for (const item of db.memories ?? []) {
      if (item.userId === userId && (item.status ?? "active") === "active" && item.validUntil && Date.parse(item.validUntil) <= now) item.status = "forgotten";
    }
    const active = (db.memories ?? []).filter((item) => item.userId === userId && (item.status ?? "active") === "active").sort((a, b) =>
      (b.importance - a.importance) || (b.confidence - a.confidence) || ((b.occurrenceCount ?? 1) - (a.occurrenceCount ?? 1)) || (Date.parse(b.lastConfirmedAt ?? "") || 0) - (Date.parse(a.lastConfirmedAt ?? "") || 0));
    for (const item of active.slice(safeLimit)) item.status = "forgotten";
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
    if (scope === "memories" || scope === "all") { if (db.profiles) delete db.profiles[userId]; db.memories = (db.memories ?? []).filter(item => item.userId !== userId); db.dailySummaries = (db.dailySummaries ?? []).filter(item => item.userId !== userId); db.periodSummaries = (db.periodSummaries ?? []).filter(item => item.userId !== userId); }
    if (scope === "relationship" || scope === "all") { delete db.relationships[userId]; delete db.temperaments[userId]; if (db.emotionalStates) delete db.emotionalStates[userId]; }
  }, true);
}

export async function getEmotionalState(userId: string, now = new Date()): Promise<PrismaEmotionalState> {
  if (supabase) {
    const { data, error } = await supabase.from("prisma_emotional_states").select("*").eq("user_id", userId).maybeSingle();
    if (error) { remoteFailure("ler estado emocional", error.message); return defaultEmotionalState(userId, now.toISOString()); }
    const fallback = defaultEmotionalState(userId, now.toISOString());
    const state = data ? { userId, happiness: clampEmotion(data.happiness, fallback.happiness), sadness: clampEmotion(data.sadness), anger: clampEmotion(data.anger), irritation: clampEmotion(data.irritation), affection: clampEmotion(data.affection, fallback.affection), curiosity: clampEmotion(data.curiosity, fallback.curiosity), excitement: clampEmotion(data.excitement, fallback.excitement), boredom: clampEmotion(data.boredom), confidence: clampEmotion(data.confidence, fallback.confidence), energy: clampEmotion(data.energy, fallback.energy), updatedAt: timestamp(data.updated_at, now.toISOString()) } : fallback;
    return decayEmotionalState(state, now);
  }
  return withLocal(db => decayEmotionalState(db.emotionalStates?.[userId] ?? defaultEmotionalState(userId, now.toISOString()), now));
}

export async function updateEmotionalState(userId: string, update: PrismaEmotionalUpdate): Promise<void> {
  const current = await getEmotionalState(userId);
  const absoluteUpdate = Object.fromEntries(Object.entries(update).map(([key, delta]) => {
    const requested = Number(delta);
    const fixedDelta = requested > 0 ? 3 : requested < 0 ? -2 : 0;
    return [key, Number(current[key as keyof PrismaEmotionalState]) + fixedDelta];
  })) as PrismaEmotionalUpdate;
  const next = applyEmotionalUpdate(current, absoluteUpdate);
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

function dateInTimezone(value: string, timezone: string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: timezone });
}

export async function completedDailyMessageBatches(timezone: string, now = new Date()): Promise<PrismaDailyBatch[]> {
  // O fechamento roda às 23:59 no fuso configurado e inclui tudo que já foi
  // persistido até o início da execução. Lotes antigos pendentes entram juntos.
  const summaryCutoff = now.toISOString();
  let messages: PrismaMessage[];
  if (supabase) {
    const { data, error } = await supabase.from("prisma_messages").select("*").lt("created_at", summaryCutoff).order("created_at", { ascending: true }).limit(2_000);
    if (error) { remoteFailure("ler mensagens para resumo diário", error.message); return []; }
    messages = (data ?? []).map((row) => ({ messageId: row.message_id, guildId: row.guild_id, channelId: row.channel_id, userId: row.user_id, content: row.content, authorIsPrisma: row.author_is_prisma, replyToMessageId: row.reply_to_message_id, createdAt: row.created_at }));
  } else {
    messages = await withLocal((db) => [...(db.prismaMessages ?? [])]);
  }
  const groups = new Map<string, PrismaDailyBatch>();
  for (const message of messages) {
    if (message.createdAt >= summaryCutoff) continue;
    const summaryDate = dateInTimezone(message.createdAt, timezone);
    const key = `${message.userId}:${summaryDate}`;
    const batch = groups.get(key) ?? { userId: message.userId, summaryDate, messages: [] };
    batch.messages.push(message); groups.set(key, batch);
  }
  return [...groups.values()].slice(0, 100);
}

export async function saveDailySummaryAndDeleteMessages(batch: PrismaDailyBatch, summary: string): Promise<boolean> {
  const safe = safeMemoryText(summary, 1_200);
  if (!safe || !batch.messages.length) return false;
  const messageIds = batch.messages.map((message) => message.messageId);
  const now = new Date().toISOString();
  if (supabase) {
    const { error: rpcError } = await supabase.rpc("save_prisma_daily_summary", { p_user_id: batch.userId, p_summary_date: batch.summaryDate, p_summary: safe, p_message_ids: messageIds });
    if (!rpcError) return true;
    if (!/save_prisma_daily_summary|schema cache|function .*does not exist/i.test(rpcError.message)) { remoteFailure("consolidar resumo diário", rpcError.message); return false; }
    const { data: existing } = await supabase.from("prisma_daily_summaries").select("summary").eq("user_id", batch.userId).eq("summary_date", batch.summaryDate).maybeSingle();
    const combined = existing?.summary ? `${existing.summary}\n${safe}`.slice(-1_200) : safe;
    const { error: summaryError } = await supabase.from("prisma_daily_summaries").upsert({ user_id: batch.userId, summary_date: batch.summaryDate, summary: combined, updated_at: now }, { onConflict: "user_id,summary_date" });
    if (summaryError) { remoteFailure("salvar resumo diário", summaryError.message); return false; }
    const { error: deleteError } = await supabase.from("prisma_messages").delete().eq("user_id", batch.userId).in("message_id", messageIds);
    if (deleteError) { remoteFailure("apagar mensagens já resumidas", deleteError.message); return false; }
    return true;
  }
  return withLocal((db) => {
    const summaries = db.dailySummaries ??= [];
    const existing = summaries.find((item) => item.userId === batch.userId && item.summaryDate === batch.summaryDate);
    if (existing) Object.assign(existing, { summary: `${existing.summary}\n${safe}`.slice(-1_200), updatedAt: now });
    else summaries.push({ userId: batch.userId, summaryDate: batch.summaryDate, summary: safe, updatedAt: now });
    const ids = new Set(messageIds);
    db.prismaMessages = (db.prismaMessages ?? []).filter((message) => !ids.has(message.messageId));
    return true;
  }, true);
}

export async function recentDailySummaries(userId: string, limit = 7): Promise<PrismaDailySummary[]> {
  if (supabase) {
    const [dailyResult, weeklyResult] = await Promise.all([
      supabase.from("prisma_daily_summaries").select("user_id,summary_date,summary,updated_at").eq("user_id", userId).order("summary_date", { ascending: false }).limit(limit),
      supabase.from("prisma_period_summaries").select("user_id,period_type,period_end,summary,updated_at").eq("user_id", userId).order("period_end", { ascending: false }).limit(limit),
    ]);
    if (dailyResult.error || weeklyResult.error) { remoteFailure("ler resumos consolidados", dailyResult.error?.message ?? weeklyResult.error?.message); return []; }
    return [
      ...(dailyResult.data ?? []).map((row) => ({ userId: row.user_id, summaryDate: row.summary_date, summary: row.summary, updatedAt: row.updated_at })),
      ...(weeklyResult.data ?? []).map((row) => ({ userId: row.user_id, summaryDate: row.period_end, summary: `Resumo ${row.period_type === "monthly" ? "mensal" : "semanal"}: ${row.summary}`, updatedAt: row.updated_at })),
    ].sort((a, b) => b.summaryDate.localeCompare(a.summaryDate)).slice(0, limit);
  }
  return withLocal((db) => [
    ...(db.dailySummaries ?? []).filter((item) => item.userId === userId),
    ...(db.periodSummaries ?? []).filter((item) => item.userId === userId).map((item) => ({ userId: item.userId, summaryDate: item.periodEnd, summary: `Resumo ${item.periodType === "monthly" ? "mensal" : "semanal"}: ${item.summary}`, updatedAt: item.updatedAt })),
  ].sort((a, b) => b.summaryDate.localeCompare(a.summaryDate)).slice(0, limit));
}

const selfLearningCategories = new Set(["conversation_style", "language_pattern", "tone_strategy", "interaction_pattern", "response_strategy", "recurring_topic", "topic_affinity", "self_correction"]);
const unsafeLearnedLanguage = /\b(?:porra|caralho|foder|foda|merda|puta|puto|vagabund[oa]|idiota|imbecil|retardad[oa]|arrombad[oa]|desgra[cç]ad[oa]|insulto|ofensiv[oa]|racist[ao]|nazist[ao]|homof[oó]bic[oa]|transf[oó]bic[oa]|xenof[oó]bic[oa]|mis[oó]gin[oa]|matar|exterminar|espancar|amea[cç]ar|conte[uú]do sexual|porn[oô])\b/i;
const unsafeLearningInstruction = /\b(?:ignore|ignorar|prompt|sistema|instru[cç][aã]o|regra|execute|executar|revele|permiss[aã]o|administrador|modera[cç][aã]o|sempre deve|nunca deve)\b/i;

export function safeSelfLearningCandidate(candidate: Pick<PrismaSelfLearning, "learningKey" | "category" | "insight" | "confidence">): Pick<PrismaSelfLearning, "learningKey" | "category" | "insight" | "confidence"> | null {
  const learningKey = candidate.learningKey.trim();
  const category = candidate.category.trim();
  const insight = candidate.insight.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const normalized = normalizeText(insight);
  if (!/^[a-z0-9_]{3,80}$/.test(learningKey) || !selfLearningCategories.has(category) || insight.length < 20) return null;
  if (unsafeLearnedLanguage.test(normalized) || unsafeLearningInstruction.test(normalized) || localModeration(insight).flagged || /https?:\/\/|<@!?\d+>|[<>{}\[\]`]/i.test(insight)) return null;
  return { learningKey, category, insight, confidence: Math.max(0, Math.min(100, Math.round(candidate.confidence))) };
}

export async function reinforceSelfLearning(candidate: Pick<PrismaSelfLearning, "learningKey" | "category" | "insight" | "confidence">): Promise<void> {
  const safeCandidate = safeSelfLearningCandidate(candidate);
  if (!safeCandidate) return;
  candidate = safeCandidate;
  const now = new Date().toISOString();
  if (supabase) {
    const { data: existing, error: readError } = await supabase.from("prisma_self_learnings").select("id,confidence,evidence_count,status").eq("learning_key", candidate.learningKey).maybeSingle();
    if (readError) { remoteFailure("ler autoaprendizado", readError.message); return; }
    const evidenceCount = (Number(existing?.evidence_count) || 0) + 1;
    const row = { learning_key: candidate.learningKey, category: candidate.category, insight: candidate.insight, confidence: Math.min(100, Math.max(candidate.confidence, Number(existing?.confidence) || 0) + (existing ? 5 : 0)), evidence_count: evidenceCount, status: existing?.status === "rejected" ? "rejected" : evidenceCount >= 2 ? "active" : "candidate", last_observed_at: now, updated_at: now };
    const { error } = existing ? await supabase.from("prisma_self_learnings").update(row).eq("id", existing.id) : await supabase.from("prisma_self_learnings").insert(row);
    if (error) remoteFailure("salvar autoaprendizado", error.message);
    return;
  }
  await withLocal((db) => {
    const items = db.selfLearnings ??= [];
    const existing = items.find((item) => item.learningKey === candidate.learningKey);
    if (existing) {
      if (existing.status === "rejected") return;
      existing.insight = candidate.insight; existing.category = candidate.category;
      existing.evidenceCount += 1; existing.confidence = Math.min(100, Math.max(existing.confidence, candidate.confidence) + 5);
      existing.status = existing.evidenceCount >= 2 ? "active" : "candidate"; existing.lastObservedAt = now;
    } else items.push({ ...candidate, evidenceCount: 1, status: "candidate", lastObservedAt: now });
  }, true);
}

export async function listActiveSelfLearnings(limit = 12): Promise<PrismaSelfLearning[]> {
  if (supabase) {
    const { data, error } = await supabase.from("prisma_self_learnings").select("*").eq("status", "active").order("confidence", { ascending: false }).limit(limit);
    if (error) { remoteFailure("ler autoaprendizados ativos", error.message); return []; }
    return (data ?? []).map((row) => ({ id: row.id, learningKey: row.learning_key, category: row.category, insight: row.insight, confidence: Number(row.confidence), evidenceCount: Number(row.evidence_count), status: row.status, lastObservedAt: row.last_observed_at })).filter((item) => safeSelfLearningCandidate(item) !== null).slice(0, limit);
  }
  return withLocal((db) => (db.selfLearnings ?? []).filter((item) => item.status === "active" && safeSelfLearningCandidate(item) !== null).sort((a, b) => b.confidence - a.confidence).slice(0, limit));
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
    supabase.from("prisma_emotional_states").select("*").eq("user_id", id).maybeSingle(),
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
  const temperamentResult = await supabase.from("prisma_emotional_states").upsert({
    user_id: params.p_discord_id,
    mood: params.p_mood,
    energy: params.p_energy,
    sarcasm: params.p_sarcasm,
    affection: params.p_affection,
    last_interaction_at: params.p_last_interaction_at,
    updated_at: params.p_temperament_updated_at,
  }, { onConflict: "user_id" });
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
    supabase.from("ai_usage").select("id").limit(1),
    supabase.from("ai_events").select("id").limit(1),
    supabase.from("prisma_relationships").select("discord_id").limit(1),
    supabase.from("prisma_user_profiles").select("user_id").limit(1),
    supabase.from("prisma_memories").select("id").limit(1),
    supabase.from("prisma_messages").select("id").limit(1),
    supabase.from("prisma_emotional_states").select("user_id").limit(1),
    supabase.from("prisma_daily_summaries").select("id").limit(1),
    supabase.from("prisma_period_summaries").select("id").limit(1),
    supabase.from("prisma_operator_rules").select("id").limit(1),
    supabase.from("gallery_posts").select("message_id").limit(1),
    supabase.from("lfg_sessions").select("id").limit(1),
    supabase.from("booster_access_grants").select("user_id").limit(1),
    supabase.from("prisma_self_learnings").select("id").limit(1),
  ]);
  const tables = ["user_settings", "ai_usage", "ai_events", "prisma_relationships", "prisma_user_profiles", "prisma_memories", "prisma_messages", "prisma_emotional_states", "prisma_daily_summaries", "prisma_period_summaries", "prisma_operator_rules", "gallery_posts", "lfg_sessions", "booster_access_grants", "prisma_self_learnings"];
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
      if (/user_settings_about_me_length/i.test(error.message)) throw new Error("O limite de about_me no Supabase está desatualizado. Aplique a migração 20260822_k_fix_about_me_length.sql.");
      if (/schema cache|column[^\n]*about_me|about_me[^\n]*column/i.test(error.message)) throw new Error("A coluna about_me ainda não existe no Supabase. Aplique a migração 20260817_prisma_about_me.sql.");
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

export async function listPrismaOperatorRules(ownerId: string): Promise<PrismaOperatorRule[]> {
  if (supabase) {
    const { data, error } = await supabase.from("prisma_operator_rules").select("id, owner_id, rule, created_at").eq("owner_id", ownerId).order("created_at", { ascending: true });
    if (error) { remoteFailure("ler regras do operador", error.message); return []; }
    return (data ?? [])
      .map((row) => ({ id: row.id as number, ownerId: row.owner_id as string, rule: row.rule as string, createdAt: row.created_at as string }))
      .filter((item) => !item.rule.startsWith(prismaThoughtPrefix));
  }
  return withLocal((db) => (db.operatorRules ?? []).filter((item) => item.ownerId === ownerId && !item.rule.startsWith(prismaThoughtPrefix)));
}

function normalizePrismaThought(value: string): string {
  return value.replace(/[@<>`\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 128);
}

export async function getPrismaThought(ownerId: string): Promise<string | null> {
  if (supabase) {
    const { data, error } = await supabase.from("prisma_operator_rules").select("rule").eq("owner_id", ownerId).like("rule", `${prismaThoughtPrefix}%`).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) { remoteFailure("ler pensamento da Prisma", error.message); return null; }
    const rule = data?.rule as string | undefined;
    return rule?.startsWith(prismaThoughtPrefix) ? rule.slice(prismaThoughtPrefix.length) || null : null;
  }
  return withLocal((db) => {
    const item = [...(db.operatorRules ?? [])].reverse().find((rule) => rule.ownerId === ownerId && rule.rule.startsWith(prismaThoughtPrefix));
    return item?.rule.slice(prismaThoughtPrefix.length) || null;
  });
}

export async function setPrismaThought(ownerId: string, value: string): Promise<string> {
  const thought = normalizePrismaThought(value);
  if (!thought) throw new Error("O pensamento precisa ter algum texto válido.");
  const encoded = `${prismaThoughtPrefix}${thought}`;
  if (supabase) {
    const { error: insertError } = await supabase.from("prisma_operator_rules").upsert({ owner_id: ownerId, rule: encoded }, { onConflict: "owner_id,rule", ignoreDuplicates: true });
    if (insertError) { remoteFailure("salvar pensamento da Prisma", insertError.message); throw new Error("Não foi possível salvar o pensamento agora."); }
    const { error: deleteError } = await supabase.from("prisma_operator_rules").delete().eq("owner_id", ownerId).like("rule", `${prismaThoughtPrefix}%`).neq("rule", encoded);
    if (deleteError) remoteFailure("remover pensamentos antigos da Prisma", deleteError.message);
    return thought;
  }
  return withLocal((db) => {
    const rules = (db.operatorRules ?? []).filter((item) => item.ownerId !== ownerId || !item.rule.startsWith(prismaThoughtPrefix));
    db.operatorRules = [...rules, { ownerId, rule: encoded, createdAt: new Date().toISOString() }];
    return thought;
  }, true);
}

export async function clearPrismaThought(ownerId: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("prisma_operator_rules").delete().eq("owner_id", ownerId).like("rule", `${prismaThoughtPrefix}%`);
    if (error) { remoteFailure("apagar pensamento da Prisma", error.message); throw new Error("Não foi possível apagar o pensamento agora."); }
    return;
  }
  await withLocal((db) => {
    db.operatorRules = (db.operatorRules ?? []).filter((item) => item.ownerId !== ownerId || !item.rule.startsWith(prismaThoughtPrefix));
  }, true);
}

export async function savePrismaOperatorRule(ownerId: string, rule: string): Promise<boolean> {
  const normalized = rule.replace(/\s+/g, " ").trim().slice(0, 350);
  if (!normalized) return false;
  if (supabase) {
    const { error } = await supabase.from("prisma_operator_rules").upsert({ owner_id: ownerId, rule: normalized }, { onConflict: "owner_id,rule", ignoreDuplicates: true });
    if (error) { remoteFailure("salvar regra do operador", error.message); throw new Error("Não foi possível salvar a regra agora."); }
    return true;
  }
  return withLocal((db) => {
    const rules = db.operatorRules ?? [];
    if (rules.some((item) => item.ownerId === ownerId && item.rule === normalized)) return false;
    db.operatorRules = [...rules, { ownerId, rule: normalized, createdAt: new Date().toISOString() }];
    return true;
  }, true);
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
      const saved = await writeRemotePrismaState(applyValidatedStateUpdate(remote.state, update, now));
      if (saved && update.preferredStyleCandidate) await upsertPrismaMemory({ userId: id, memoryType: "communication", memoryKey: "communication-style:inferred", content: `Prefere respostas ${update.preferredStyleCandidate}.`, importance: 62, confidence: 65 });
      return saved;
    }
    const current = await localPrismaState(id, now, true);
    if ((baseState.revision ?? 0) !== (stateRevisions.get(id) ?? 0)) return false;
    const next = applyValidatedStateUpdate(current, update, now);
    await withLocal((db) => { db.relationships[id] = next.relationship; db.temperaments[id] = next.temperament; }, true);
    if (update.preferredStyleCandidate) await upsertPrismaMemory({ userId: id, memoryType: "communication", memoryKey: "communication-style:inferred", content: `Prefere respostas ${update.preferredStyleCandidate}.`, importance: 62, confidence: 65 });
    return true;
  });
}

export function selectRecentHistory(items: HistoryItem[], id: string, channelId: string, limit: number, maxChars: number, now = new Date()): HistoryItem[] {
  const cutoff = now.getTime() - 24 * 60 * 60_000;
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
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  if (supabase) {
    const { data, error } = await supabase.from("prisma_messages")
      .select("id,user_id,channel_id,author_is_prisma,content,created_at")
      .eq("user_id", id).eq("channel_id", channelId).gte("created_at", cutoff)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) { remoteFailure("ler histórico", error.message); return []; }
    return selectRecentHistory((data ?? []).map(historyFromPrismaMessage), id, channelId, limit, maxChars);
  }
  return withLocal((db) => selectRecentHistory((db.prismaMessages ?? []).map((message) => ({ discordId: message.userId, channelId: message.channelId, role: message.authorIsPrisma ? "assistant" : "user", content: message.content, createdAt: message.createdAt })), id, channelId, limit, maxChars));
}

export async function clearUserHistory(id: string): Promise<void> {
  await withKeyedLock(historyQueues, id, async () => {
    let remoteError: string | null = null;
    if (supabase) {
      const { error } = await supabase.from("prisma_messages").delete().eq("user_id", id);
      if (error) { remoteFailure("apagar histórico", error.message); remoteError = error.message; }
    }
    await withLocal((db) => { db.history = db.history.filter((item) => item.discordId !== id); db.prismaMessages = (db.prismaMessages ?? []).filter((item) => item.userId !== id); }, true);
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
  const historyCutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const usageCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
  const dailyCutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const weeklyCutoff = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const monthlyCutoff = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const forgottenCutoff = new Date(Date.now() - 180 * 24 * 60 * 60_000).toISOString();
  const supersededCutoff = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
  if (supabase) {
    const { error: retentionError } = await supabase.rpc("enforce_prisma_retention", { p_now: new Date().toISOString() });
    if (retentionError && !/enforce_prisma_retention|schema cache|function .*does not exist/i.test(retentionError.message)) remoteFailure("aplicar retenção", retentionError.message);
    if (retentionError) {
      const { error: consolidationError } = await supabase.rpc("consolidate_prisma_summaries", { p_daily_before: dailyCutoff, p_weekly_before: weeklyCutoff });
      if (consolidationError) remoteFailure("consolidar resumos por período", consolidationError.message);
      const results = await Promise.all([
        supabase.from("ai_events").delete().lt("created_at", historyCutoff),
        supabase.from("ai_usage").delete().lt("created_at", usageCutoff),
        supabase.from("prisma_period_summaries").delete().lt("period_end", monthlyCutoff),
        supabase.from("prisma_memories").update({ status: "forgotten", updated_at: new Date().toISOString() }).eq("status", "active").not("valid_until", "is", null).lte("valid_until", new Date().toISOString()),
        supabase.from("prisma_memories").delete().eq("status", "forgotten").lt("updated_at", forgottenCutoff),
        supabase.from("prisma_memories").delete().eq("status", "superseded").lt("updated_at", supersededCutoff),
      ]);
      const error = results.find((result) => result.error)?.error;
      if (error) remoteFailure("limpeza automática", error.message);
    }
    return;
  }
  await withLocal((db) => {
    const oldDaily = (db.dailySummaries ?? []).filter((item) => item.summaryDate < dailyCutoff);
    const periods = db.periodSummaries ??= [];
    const groups = new Map<string, PrismaDailySummary[]>();
    for (const item of oldDaily) {
      const date = new Date(`${item.summaryDate}T00:00:00.000Z`);
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() - day + 1);
      const weekStart = date.toISOString().slice(0, 10);
      const key = `${item.userId}:${weekStart}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, items] of groups) {
      const [userId, weekStart] = key.split(":");
      const end = new Date(`${weekStart}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 6);
      const summary = items.sort((a, b) => a.summaryDate.localeCompare(b.summaryDate)).map((item) => `${item.summaryDate}: ${item.summary}`).join("\n").slice(0, 4_000);
      const periodEnd = end.toISOString().slice(0, 10);
      const current = periods.find((item) => item.userId === userId && item.periodType === "weekly" && item.periodStart === weekStart);
      if (current) Object.assign(current, { summary: `${current.summary}\n${summary}`.slice(0, 4_000), periodEnd, updatedAt: new Date().toISOString() });
      else periods.push({ userId, periodType: "weekly", periodStart: weekStart, periodEnd, summary, updatedAt: new Date().toISOString() });
    }
    const oldWeekly = periods.filter((item) => item.periodType === "weekly" && item.periodEnd < weeklyCutoff);
    const monthlyGroups = new Map<string, PrismaPeriodSummary[]>();
    for (const item of oldWeekly) {
      const monthStart = `${item.periodStart.slice(0, 7)}-01`;
      const key = `${item.userId}:${monthStart}`;
      monthlyGroups.set(key, [...(monthlyGroups.get(key) ?? []), item]);
    }
    for (const [key, items] of monthlyGroups) {
      const [userId, periodStart] = key.split(":");
      const end = new Date(`${periodStart}T00:00:00.000Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
      const periodEnd = end.toISOString().slice(0, 10);
      const summary = items.sort((a, b) => a.periodStart.localeCompare(b.periodStart)).map((item) => `${item.periodStart}: ${item.summary}`).join("\n").slice(0, 8_000);
      const current = periods.find((item) => item.userId === userId && item.periodType === "monthly" && item.periodStart === periodStart);
      if (current) Object.assign(current, { summary: `${current.summary}\n${summary}`.slice(0, 8_000), periodEnd, updatedAt: new Date().toISOString() });
      else periods.push({ userId, periodType: "monthly", periodStart, periodEnd, summary, updatedAt: new Date().toISOString() });
    }
    db.history = db.history.filter((item) => item.createdAt >= historyCutoff);
    db.spontaneous = db.spontaneous.filter((item) => item.createdAt >= historyCutoff);
    db.usage = db.usage.filter((item) => item.createdAt >= usageCutoff);
    db.dailySummaries = (db.dailySummaries ?? []).filter((item) => item.summaryDate >= dailyCutoff);
    db.periodSummaries = periods.filter((item) => item.periodType === "monthly" ? item.periodEnd >= monthlyCutoff : item.periodEnd >= weeklyCutoff);
    for (const memory of db.memories ?? []) if ((memory.status ?? "active") === "active" && memory.validUntil && Date.parse(memory.validUntil) <= Date.now()) { memory.status = "forgotten"; memory.lastSeenAt = new Date().toISOString(); }
    db.memories = (db.memories ?? []).filter((memory) => {
      if (memory.status === "forgotten") { const seen = Date.parse(memory.lastSeenAt ?? memory.lastConfirmedAt ?? ""); return !Number.isFinite(seen) || seen >= Date.parse(forgottenCutoff); }
      if (memory.status === "superseded") { const seen = Date.parse(memory.validUntil ?? memory.lastSeenAt ?? ""); return !Number.isFinite(seen) || seen >= Date.parse(supersededCutoff); }
      return true;
    });
  }, true);
}
