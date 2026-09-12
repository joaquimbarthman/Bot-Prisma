import { PermissionFlagsBits, PermissionsBitField, type Guild, type GuildBasedChannel } from "discord.js";
import { getRewards, type LevelReward } from "./store.js";

const channelBenefits = [
  [1, "SendMessages", PermissionFlagsBits.SendMessages],
  [10, "AttachFiles", PermissionFlagsBits.AttachFiles],
  [10, "EmbedLinks", PermissionFlagsBits.EmbedLinks],
  [20, "Stream", PermissionFlagsBits.Stream],
  [35, "AddReactions", PermissionFlagsBits.AddReactions],
  [60, "UseExternalStickers", PermissionFlagsBits.UseExternalStickers],
  [60, "UseExternalEmojis", PermissionFlagsBits.UseExternalEmojis],
  [75, "UseSoundboard", PermissionFlagsBits.UseSoundboard],
  [75, "UseExternalSounds", PermissionFlagsBits.UseExternalSounds],
  [75, "PrioritySpeaker", PermissionFlagsBits.PrioritySpeaker],
  [90, "MoveMembers", PermissionFlagsBits.MoveMembers],
  [100, "MuteMembers", PermissionFlagsBits.MuteMembers],
] as const;

const roleBenefits = [[1, PermissionFlagsBits.ChangeNickname]] as const;
const managedRolePermissions = roleBenefits.map(([, permission]) => permission);

export function levelChannelBenefits(level: number): bigint[] {
  return channelBenefits.filter(([requiredLevel]) => level >= requiredLevel).map(([, , permission]) => permission);
}

export function levelRoleBenefits(level: number): bigint[] {
  return roleBenefits.filter(([requiredLevel]) => level >= requiredLevel).map(([, permission]) => permission);
}

export function levelChannelPermissionUpdate(level: number, voiceChannel: boolean): Record<string, boolean | null> {
  const unlocked = new Set(levelChannelBenefits(level));
  return Object.fromEntries(channelBenefits.map(([, name, permission]) => [
    name,
    name === "SendMessages" && !voiceChannel ? null : unlocked.has(permission),
  ]));
}

async function updateChannelBenefits(channel: GuildBasedChannel, reward: LevelReward | null, roleId: string): Promise<boolean> {
  if (!("permissionOverwrites" in channel) || !channel.permissionOverwrites.cache.has(roleId)) return false;
  const update = reward
    ? levelChannelPermissionUpdate(reward.level, channel.isVoiceBased())
    : Object.fromEntries(channelBenefits.map(([, name]) => [name, null]));
  await channel.permissionOverwrites.edit(roleId, update, { reason: "Beneficios do sistema de evolucao" });
  return true;
}

async function updateRoleBenefits(guild: Guild, reward: LevelReward | null, roleId: string): Promise<void> {
  const role = await guild.roles.fetch(roleId).catch(() => null);
  if (!role || role.managed) return;
  const permissions = new PermissionsBitField(role.permissions);
  permissions.remove(managedRolePermissions);
  if (reward) permissions.add(levelRoleBenefits(reward.level));
  if (!permissions.equals(role.permissions)) await role.setPermissions(permissions, "Beneficios do sistema de evolucao");
}

export async function syncLevelBenefitPermissions(guild: Guild, rewards: LevelReward[]): Promise<number> {
  await guild.channels.fetch();
  let updatedChannels = 0;
  for (const reward of rewards) {
    await updateRoleBenefits(guild, reward, reward.roleId);
    for (const channel of guild.channels.cache.values()) {
      if (await updateChannelBenefits(channel, reward, reward.roleId)) updatedChannels += 1;
    }
  }
  return updatedChannels;
}

export async function clearLevelBenefitPermissions(guild: Guild, roleId: string): Promise<void> {
  await updateRoleBenefits(guild, null, roleId);
  await guild.channels.fetch();
  for (const channel of guild.channels.cache.values()) await updateChannelBenefits(channel, null, roleId);
}

export async function syncLevelBenefitsForChannel(channel: GuildBasedChannel): Promise<void> {
  if (!("permissionOverwrites" in channel)) return;
  const rewards = await getRewards(channel.guild.id);
  for (const reward of rewards) await updateChannelBenefits(channel, reward, reward.roleId);
}
