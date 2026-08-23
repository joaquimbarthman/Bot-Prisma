import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import { config } from "../../config.js";

export function hasCensorshipBypassRole(member: GuildMember | APIInteractionGuildMember | null | undefined): boolean {
  if (!member || !config.censorshipBypassRoleId) return false;
  const roles = member.roles;
  return Array.isArray(roles)
    ? roles.includes(config.censorshipBypassRoleId)
    : roles.cache.has(config.censorshipBypassRoleId);
}
