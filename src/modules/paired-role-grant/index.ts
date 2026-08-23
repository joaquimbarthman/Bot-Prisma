import { createClient } from "@supabase/supabase-js";
import type { Collection, Guild, GuildMember, Snowflake } from "discord.js";
import { config } from "../../config.js";

const supabase = config.supabaseUrl && config.supabaseSecretKey
  ? createClient(config.supabaseUrl, config.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
const processedByGuild = new Map<string, Set<string>>();
const loadingByGuild = new Map<string, Promise<Set<string>>>();
const processing = new Set<string>();

async function processedMembers(guildId: string): Promise<Set<string>> {
  const cached = processedByGuild.get(guildId);
  if (cached) return cached;
  const pending = loadingByGuild.get(guildId);
  if (pending) return pending;
  const loading = (async () => {
    if (!supabase) {
      const members = new Set<string>(); processedByGuild.set(guildId, members); loadingByGuild.delete(guildId); return members;
    }
    const { data, error } = await supabase.from("paired_role_grants").select("user_id").eq("guild_id", guildId);
    if (error) throw new Error(`[CARGO-DUPLO] Falha ao carregar concessões: ${error.message}`);
    const members = new Set((data ?? []).map((row) => String(row.user_id)));
    processedByGuild.set(guildId, members); loadingByGuild.delete(guildId); return members;
  })();
  loadingByGuild.set(guildId, loading);
  return loading;
}

function isEligible(member: GuildMember): boolean {
  return !member.user.bot
    && config.pairedRoleGrant.requiredRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function remember(member: GuildMember): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from("paired_role_grants").upsert({ guild_id: member.guild.id, user_id: member.id }, { onConflict: "guild_id,user_id", ignoreDuplicates: true });
    if (error) throw new Error(`[CARGO-DUPLO] Falha ao salvar concessão: ${error.message}`);
  }
  (await processedMembers(member.guild.id)).add(member.id);
}

export async function grantPairedRoleOnce(member: GuildMember): Promise<boolean> {
  const memberKey = `${member.guild.id}:${member.id}`;
  if (!isEligible(member) || (await processedMembers(member.guild.id)).has(member.id) || processing.has(memberKey)) return false;
  processing.add(memberKey);

  try {
    const targetRole = member.guild.roles.cache.get(config.pairedRoleGrant.targetRoleId)
      ?? await member.guild.roles.fetch(config.pairedRoleGrant.targetRoleId).catch(() => null);
    if (!targetRole) throw new Error(`Cargo de destino ${config.pairedRoleGrant.targetRoleId} não encontrado.`);

    // Registre também quem já possui o cargo, respeitando uma remoção manual futura.
    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole, "Concessão única por possuir um dos cargos necessários");
    }
    await remember(member);
    return true;
  } finally {
    processing.delete(memberKey);
  }
}

export async function syncPairedRoleGrants(
  guild: Guild,
  members?: Collection<Snowflake, GuildMember>,
): Promise<number> {
  await guild.roles.fetch();
  members ??= await guild.members.fetch();
  let processed = 0;
  for (const member of members.values()) {
    if (await grantPairedRoleOnce(member)) processed += 1;
  }
  return processed;
}
