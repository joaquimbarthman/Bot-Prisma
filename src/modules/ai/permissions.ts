import { createClient } from "@supabase/supabase-js";
import type { Collection, Guild, GuildMember, Snowflake } from "discord.js";
import { config } from "../../config.js";

export type AccessLevel = "none" | "member";

const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
const boosterGrantsByGuild = new Map<string, Set<string>>();
const boosterGrantLoads = new Map<string, Promise<Set<string>>>();
const boosterGrantsInProgress = new Set<string>();

async function boosterGrants(guildId: string): Promise<Set<string>> {
  const cached = boosterGrantsByGuild.get(guildId);
  if (cached) return cached;
  const pending = boosterGrantLoads.get(guildId);
  if (pending) return pending;
  const loading = (async () => {
    if (!supabase) {
      const grants = new Set<string>(); boosterGrantsByGuild.set(guildId, grants); boosterGrantLoads.delete(guildId); return grants;
    }
    const { data, error } = await supabase.from("booster_access_grants").select("user_id").eq("guild_id", guildId);
    if (error) throw new Error(`[BOOSTER] Falha ao carregar concessões: ${error.message}`);
    const grants = new Set((data ?? []).map((row) => String(row.user_id)));
    boosterGrantsByGuild.set(guildId, grants); boosterGrantLoads.delete(guildId); return grants;
  })();
  boosterGrantLoads.set(guildId, loading);
  return loading;
}

async function rememberBoosterAccess(member: GuildMember): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("booster_access_grants").upsert({ guild_id: member.guild.id, user_id: member.id }, { onConflict: "guild_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`[BOOSTER] Falha ao salvar concessão: ${error.message}`);
  }
  (await boosterGrants(member.guild.id)).add(member.id);
}

export function accessLevel(member: GuildMember): AccessLevel {
  return member.roles.cache.has(config.prismaAi.accessRoleId) ? "member" : "none";
}

export function shouldGrantAccessRole(member: GuildMember): boolean {
  return member.premiumSinceTimestamp !== null && !member.roles.cache.has(config.prismaAi.accessRoleId);
}

export async function grantAccessRoleToBooster(member: GuildMember): Promise<boolean> {
  if (member.premiumSinceTimestamp === null || (await boosterGrants(member.guild.id)).has(member.id)) return false;
  const memberKey = `${member.guild.id}:${member.id}`;
  if (boosterGrantsInProgress.has(memberKey)) return false;
  boosterGrantsInProgress.add(memberKey);

  try {
    // Registra também quem já possui o cargo para respeitar uma remoção
    // manual futura, inclusive após uma reinicialização do bot.
    if (member.roles.cache.has(config.prismaAi.accessRoleId)) {
      await rememberBoosterAccess(member);
      return false;
    }
    const role = member.guild.roles.cache.get(config.prismaAi.accessRoleId)
      ?? await member.guild.roles.fetch(config.prismaAi.accessRoleId).catch(() => null);
    if (!role) {
      console.error(`[PRISMA-IA] Cargo de acesso ${config.prismaAi.accessRoleId} não encontrado.`);
      return false;
    }
    await member.roles.add(role, "Acesso Prisma IA concedido automaticamente por Booster");
    await rememberBoosterAccess(member);
    console.log(`[PRISMA-IA] Cargo de acesso concedido ao Booster ${member.user.tag} (${member.id}).`);
    return true;
  } finally {
    boosterGrantsInProgress.delete(memberKey);
  }
}

export async function syncBoosterAccessRoles(
  guild: Guild,
  members?: Collection<Snowflake, GuildMember>,
): Promise<void> {
  members ??= await guild.members.fetch();
  const boosters = members.filter((member) => member.premiumSinceTimestamp !== null);
  const results = await Promise.allSettled(boosters.map((member) => grantAccessRoleToBooster(member)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) console.error(`[PRISMA-IA] Falha ao conceder o cargo de acesso a ${failures.length} Booster(s). Verifique a hierarquia e a permissão Gerenciar cargos.`);
}
