import type { GuildMember } from "discord.js";
import { config } from "../../config.js";
export type AccessLevel = "none" | "booster" | "friend";
export function accessLevel(member: GuildMember): AccessLevel {
  if (config.prismaAi.friendsRoleId && member.roles.cache.has(config.prismaAi.friendsRoleId)) return "friend";
  if ((config.prismaAi.boosterRoleId && member.roles.cache.has(config.prismaAi.boosterRoleId)) || member.premiumSinceTimestamp) return "booster";
  return "none";
}

export function hasPersonalityAccess(member: GuildMember): boolean {
  return !!config.prismaAi.personalityRoleId && member.roles.cache.has(config.prismaAi.personalityRoleId);
}
