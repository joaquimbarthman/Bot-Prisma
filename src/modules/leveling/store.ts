import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";
import { calculateLevel } from "./progression.js";

export type LevelingSettings = { guildId: string; globalMultiplier: number; chatMultiplier: number; voiceMultiplier: number; prismaReplyBonus: number; boosterRoleId: string | null; boosterMultiplier: number; chatCooldownSeconds: number; voiceCooldownSeconds: number; announcementChannelId: string; maxLevel: number; enabled: boolean };
export type MemberLevel = { guildId: string; userId: string; xpTotal: number; level: number; lastChatXpAt: string | null; lastVoiceXpAt: string | null; currentRewardRoleId: string | null; createdAt: string; updatedAt: string };
export type LevelReward = { guildId: string; level: number; roleId: string; emoji: string; title: string; shortMessage: string };
export type BlacklistEntry = { guildId: string; type: "chat" | "voice"; targetType: "channel" | "role"; targetId: string };
type LocalDatabase = { settings: LevelingSettings[]; members: MemberLevel[]; rewards: LevelReward[]; blacklist: BlacklistEntry[] };

const DEFAULT_CHANNEL = "1541550093679730769";
const DEFAULT_BOOSTER_ROLE = "1538022012591538176";
const file = path.resolve(config.dataDir, "leveling.json");
const supabase = config.supabaseUrl && config.supabaseSecretKey ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
let queue = Promise.resolve();
const empty = (): LocalDatabase => ({ settings: [], members: [], rewards: [], blacklist: [] });
export const defaultSettings = (guildId: string): LevelingSettings => ({ guildId, globalMultiplier: 1, chatMultiplier: 1, voiceMultiplier: 1, prismaReplyBonus: 1, boosterRoleId: DEFAULT_BOOSTER_ROLE, boosterMultiplier: 2, chatCooldownSeconds: 30, voiceCooldownSeconds: 300, announcementChannelId: DEFAULT_CHANNEL, maxLevel: 100, enabled: true });

async function readLocal(): Promise<LocalDatabase> { try { return { ...empty(), ...JSON.parse(await readFile(file, "utf8")) } as LocalDatabase; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty(); throw error; } }
async function writeLocal(db: LocalDatabase): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 }); await rename(temp, file); await chmod(file, 0o600).catch(() => undefined); }
async function localMutation<T>(fn: (db: LocalDatabase) => T | Promise<T>): Promise<T> { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const result = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); queue = queue.catch(() => undefined).then(async () => { try { const db = await readLocal(); const value = await fn(db); await writeLocal(db); resolve(value); } catch (error) { reject(error); } }); await queue; return result; }

function memberFromRow(row: Record<string, unknown>): MemberLevel { return { guildId: String(row.guild_id), userId: String(row.user_id), xpTotal: Number(row.xp_total), level: Number(row.level), lastChatXpAt: row.last_chat_xp_at ? String(row.last_chat_xp_at) : null, lastVoiceXpAt: row.last_voice_xp_at ? String(row.last_voice_xp_at) : null, currentRewardRoleId: row.current_reward_role_id ? String(row.current_reward_role_id) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
function rewardFromRow(row: Record<string, unknown>): LevelReward { return { guildId: String(row.guild_id), level: Number(row.level), roleId: String(row.role_id), emoji: String(row.emoji ?? ""), title: String(row.title ?? "Novo marco conquistado"), shortMessage: String(row.short_message ?? "Marco conquistado") }; }

export async function getSettings(guildId: string): Promise<LevelingSettings> {
  if (!supabase) { await queue; return { ...defaultSettings(guildId), ...(await readLocal()).settings.find((item) => item.guildId === guildId) }; }
  const { data, error } = await supabase.from("leveling_settings").select("*").eq("guild_id", guildId).maybeSingle();
  if (error) throw new Error(`[LEVELING] Falha ao ler configuracao: ${error.message}`);
  if (!data) { const value = defaultSettings(guildId); const { error: insertError } = await supabase.from("leveling_settings").insert({ guild_id: guildId }); if (insertError) throw new Error(`[LEVELING] Falha ao criar configuracao: ${insertError.message}`); return value; }
  return { guildId, globalMultiplier: Number(data.global_multiplier), chatMultiplier: Number(data.chat_multiplier), voiceMultiplier: Number(data.voice_multiplier), prismaReplyBonus: Number(data.prisma_reply_bonus ?? 1), boosterRoleId: data.booster_role_id ? String(data.booster_role_id) : DEFAULT_BOOSTER_ROLE, boosterMultiplier: Number(data.booster_multiplier), chatCooldownSeconds: Number(data.chat_cooldown_seconds), voiceCooldownSeconds: Number(data.voice_cooldown_seconds), announcementChannelId: String(data.announcement_channel_id), maxLevel: Number(data.max_level), enabled: data.enabled === true };
}

export async function getBlacklist(guildId: string, type: "chat" | "voice"): Promise<BlacklistEntry[]> {
  if (!supabase) { await queue; return (await readLocal()).blacklist.filter((item) => item.guildId === guildId && item.type === type); }
  const { data, error } = await supabase.from("level_blacklist").select("*").eq("guild_id", guildId).eq("type", type); if (error) throw new Error(`[LEVELING] Falha ao ler blacklist: ${error.message}`);
  return (data ?? []).map((row) => ({ guildId, type, targetType: row.target_type as "channel" | "role", targetId: String(row.target_id) }));
}
export async function addBlacklist(entry: BlacklistEntry): Promise<void> { if (supabase) { const { error } = await supabase.from("level_blacklist").upsert({ guild_id: entry.guildId, type: entry.type, target_type: entry.targetType, target_id: entry.targetId }, { onConflict: "guild_id,type,target_type,target_id", ignoreDuplicates: true }); if (error) throw new Error(error.message); return; } await localMutation((db) => { if (!db.blacklist.some((item) => item.guildId === entry.guildId && item.type === entry.type && item.targetType === entry.targetType && item.targetId === entry.targetId)) db.blacklist.push(entry); }); }
export async function removeBlacklist(entry: BlacklistEntry): Promise<void> { if (supabase) { const { error } = await supabase.from("level_blacklist").delete().match({ guild_id: entry.guildId, type: entry.type, target_type: entry.targetType, target_id: entry.targetId }); if (error) throw new Error(error.message); return; } await localMutation((db) => { db.blacklist = db.blacklist.filter((item) => !(item.guildId === entry.guildId && item.type === entry.type && item.targetType === entry.targetType && item.targetId === entry.targetId)); }); }

export async function getRewards(guildId: string): Promise<LevelReward[]> { if (!supabase) { await queue; return (await readLocal()).rewards.filter((item) => item.guildId === guildId).sort((a, b) => a.level - b.level); } const { data, error } = await supabase.from("level_rewards").select("*").eq("guild_id", guildId).order("level"); if (error) throw new Error(error.message); return (data ?? []).map(rewardFromRow); }
export async function setReward(reward: LevelReward): Promise<void> { if (supabase) { const { error } = await supabase.from("level_rewards").upsert({ guild_id: reward.guildId, level: reward.level, role_id: reward.roleId, emoji: reward.emoji, title: reward.title, short_message: reward.shortMessage }, { onConflict: "guild_id,level" }); if (error) throw new Error(error.message); return; } await localMutation((db) => { const index = db.rewards.findIndex((item) => item.guildId === reward.guildId && item.level === reward.level); if (index >= 0) db.rewards[index] = reward; else db.rewards.push(reward); }); }
export async function removeReward(guildId: string, level: number): Promise<void> { if (supabase) { const { error } = await supabase.from("level_rewards").delete().match({ guild_id: guildId, level }); if (error) throw new Error(error.message); return; } await localMutation((db) => { db.rewards = db.rewards.filter((item) => item.guildId !== guildId || item.level !== level); }); }

export async function awardXp(guildId: string, userId: string, amount: number, source: "chat" | "voice", maxLevel: number): Promise<{ before: MemberLevel; after: MemberLevel }> {
  if (supabase) { const { data, error } = await supabase.rpc("award_level_xp", { p_guild_id: guildId, p_user_id: userId, p_amount: amount, p_source: source, p_max_level: maxLevel }); if (error) throw new Error(`[LEVELING] Falha ao entregar XP: ${error.message}`); const row = Array.isArray(data) ? data[0] : data; const after = memberFromRow(row); return { before: { ...after, xpTotal: after.xpTotal - amount, level: Number(row.previous_level) }, after }; }
  return localMutation((db) => { const now = new Date().toISOString(); let member = db.members.find((item) => item.guildId === guildId && item.userId === userId); if (!member) { member = { guildId, userId, xpTotal: 0, level: 0, lastChatXpAt: null, lastVoiceXpAt: null, currentRewardRoleId: null, createdAt: now, updatedAt: now }; db.members.push(member); } const before = { ...member }; member.xpTotal += amount; member.level = calculateLevel(member.xpTotal, maxLevel); member[source === "chat" ? "lastChatXpAt" : "lastVoiceXpAt"] = now; member.updatedAt = now; return { before, after: { ...member } }; });
}
export async function setCurrentRewardRole(guildId: string, userId: string, roleId: string | null): Promise<void> { if (supabase) { const { error } = await supabase.from("member_levels").update({ current_reward_role_id: roleId }).match({ guild_id: guildId, user_id: userId }); if (error) throw new Error(error.message); return; } await localMutation((db) => { const member = db.members.find((item) => item.guildId === guildId && item.userId === userId); if (member) member.currentRewardRoleId = roleId; }); }
export async function removeMemberLevel(guildId: string, userId: string): Promise<void> { if (supabase) { const { error } = await supabase.from("member_levels").delete().match({ guild_id: guildId, user_id: userId }); if (error) throw new Error(`[LEVELING] Falha ao excluir dados do membro: ${error.message}`); return; } await localMutation((db) => { db.members = db.members.filter((item) => item.guildId !== guildId || item.userId !== userId); }); }
export async function getMemberLevel(guildId: string, userId: string): Promise<MemberLevel | null> { if (!supabase) { await queue; return (await readLocal()).members.find((item) => item.guildId === guildId && item.userId === userId) ?? null; } const { data, error } = await supabase.from("member_levels").select("*").match({ guild_id: guildId, user_id: userId }).maybeSingle(); if (error) throw new Error(error.message); return data ? memberFromRow(data) : null; }
export async function getLeaderboard(guildId: string, limit = 10): Promise<MemberLevel[]> { if (!supabase) { await queue; return (await readLocal()).members.filter((item) => item.guildId === guildId).sort((a, b) => b.xpTotal - a.xpTotal).slice(0, limit); } const { data, error } = await supabase.from("member_levels").select("*").eq("guild_id", guildId).order("xp_total", { ascending: false }).limit(limit); if (error) throw new Error(error.message); return (data ?? []).map(memberFromRow); }
export async function getAllMemberLevels(guildId: string): Promise<MemberLevel[]> {
  if (!supabase) { await queue; return (await readLocal()).members.filter((item) => item.guildId === guildId); }
  const members: MemberLevel[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("member_levels").select("*").eq("guild_id", guildId).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []).map(memberFromRow);
    members.push(...page);
    if (page.length < pageSize) return members;
  }
}
export async function getRankPosition(guildId: string, xpTotal: number): Promise<number> { if (!supabase) { await queue; return (await readLocal()).members.filter((item) => item.guildId === guildId && item.xpTotal > xpTotal).length + 1; } const { count, error } = await supabase.from("member_levels").select("user_id", { count: "exact", head: true }).eq("guild_id", guildId).gt("xp_total", xpTotal); if (error) throw new Error(error.message); return (count ?? 0) + 1; }
