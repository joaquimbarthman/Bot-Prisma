import type { Guild, GuildMember } from "discord.js";
import { config } from "../../config.js";

export type AccessLevel = "none" | "member";

export function accessLevel(member: GuildMember): AccessLevel {
  return member.roles.cache.has(config.prismaAi.accessRoleId) ? "member" : "none";
}

export function shouldGrantAccessRole(member: GuildMember): boolean {
  return member.premiumSinceTimestamp !== null && !member.roles.cache.has(config.prismaAi.accessRoleId);
}

export async function grantAccessRoleToBooster(member: GuildMember): Promise<boolean> {
  if (!shouldGrantAccessRole(member)) return false;
  const role = member.guild.roles.cache.get(config.prismaAi.accessRoleId)
    ?? await member.guild.roles.fetch(config.prismaAi.accessRoleId).catch(() => null);
  if (!role) {
    console.error(`[PRISMA-IA] Cargo de acesso ${config.prismaAi.accessRoleId} não encontrado.`);
    return false;
  }
  await member.roles.add(role, "Acesso Prisma IA concedido automaticamente por Booster");
  console.log(`[PRISMA-IA] Cargo de acesso concedido ao Booster ${member.user.tag} (${member.id}).`);
  return true;
}

export async function syncBoosterAccessRoles(guild: Guild): Promise<void> {
  const members = await guild.members.fetch();
  const boosters = members.filter(shouldGrantAccessRole);
  const results = await Promise.allSettled(boosters.map((member) => grantAccessRoleToBooster(member)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) console.error(`[PRISMA-IA] Falha ao conceder o cargo de acesso a ${failures.length} Booster(s). Verifique a hierarquia e a permissão Gerenciar cargos.`);
}
