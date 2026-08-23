import { createClient } from "@supabase/supabase-js";
import { config } from "../../config.js";

const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
const memory = new Map<string, string[]>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;

export async function preserveMemberRoles(guildId: string, userId: string, roleIds: string[]): Promise<string[]> {
  const existing = await getPreservedRoles(guildId, userId);
  if (existing.length) return existing;
  const preserved = [...new Set(roleIds)];
  if (!supabase) { memory.set(key(guildId, userId), preserved); return preserved; }
  const { error } = await supabase.from("punishment_role_snapshots").upsert({ guild_id: guildId, user_id: userId, role_ids: preserved }, { onConflict: "guild_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(`[CASTIGO] Falha ao preservar cargos: ${error.message}`);
  return preserved;
}

export async function getPreservedRoles(guildId: string, userId: string): Promise<string[]> {
  if (!supabase) return memory.get(key(guildId, userId)) ?? [];
  const { data, error } = await supabase.from("punishment_role_snapshots").select("role_ids").eq("guild_id", guildId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`[CASTIGO] Falha ao ler cargos preservados: ${error.message}`);
  return Array.isArray(data?.role_ids) ? data.role_ids.filter((id): id is string => typeof id === "string") : [];
}

export async function clearPreservedRoles(guildId: string, userId: string): Promise<void> {
  if (!supabase) { memory.delete(key(guildId, userId)); return; }
  const { error } = await supabase.from("punishment_role_snapshots").delete().eq("guild_id", guildId).eq("user_id", userId);
  if (error) throw new Error(`[CASTIGO] Falha ao limpar cargos preservados: ${error.message}`);
}
