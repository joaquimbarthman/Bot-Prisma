import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel, type GuildMember, type Role, type TextChannel } from "discord.js";
import { config } from "../../config.js";
import { clearPreservedRoles, getPreservedRoles, preserveMemberRoles } from "./punishment-role-snapshots.js";

const punishmentPermissions = {
  ViewChannel: false,
  SendMessages: false,
  SendMessagesInThreads: false,
  AddReactions: false,
  AttachFiles: false,
  EmbedLinks: false,
  CreatePublicThreads: false,
  CreatePrivateThreads: false,
  UseApplicationCommands: false,
  Connect: false,
  Speak: false,
  Stream: false,
  UseVAD: false,
  RequestToSpeak: false,
  UseSoundboard: false,
  UseExternalSounds: false,
  SendVoiceMessages: false,
};

async function applyPunishmentPermissions(channel: GuildBasedChannel, role: Role): Promise<boolean> {
  if (!("permissionOverwrites" in channel)) return false;
  await channel.permissionOverwrites.edit(role, punishmentPermissions, { reason: "Bloqueio automático do cargo Mutado" });
  return true;
}

export async function getPunishmentRole(guild: Guild): Promise<Role> {
  let role = config.punishmentRoleId
    ? await guild.roles.fetch(config.punishmentRoleId).catch(() => null) ?? undefined
    : guild.roles.cache.find((item) => item.name === config.punishmentRoleName);
  if (config.punishmentRoleId && !role) {
    throw new Error(`O cargo de castigo ${config.punishmentRoleId} não foi encontrado.`);
  }
  role ??= await guild.roles.create({ name: config.punishmentRoleName, color: 0x555555, reason: "Cargo automático de castigo" });
  await guild.channels.fetch();
  for (const channel of guild.channels.cache.values()) await applyPunishmentPermissions(channel, role);
  return role;
}

export async function syncPunishmentPermissions(guild: Guild): Promise<void> {
  const role = await getPunishmentRole(guild);
  console.log(`[CASTIGO] Cargo ${role.name} sincronizado em ${guild.channels.cache.size} canais e categorias.`);
}

export async function handleNewPunishmentChannel(channel: GuildBasedChannel): Promise<void> {
  const role = config.punishmentRoleId
    ? await channel.guild.roles.fetch(config.punishmentRoleId).catch(() => null)
    : channel.guild.roles.cache.find((item) => item.name === config.punishmentRoleName) ?? null;
  if (!role) return;
  await applyPunishmentPermissions(channel, role);
  console.log(`[CASTIGO] Novo canal protegido: ${channel.name}.`);
}
export async function punishMember(member: GuildMember): Promise<Role> {
  const role = await getPunishmentRole(member.guild);
  const originalRoles = member.roles.cache.filter((item) => item.id !== member.guild.id && item.id !== role.id && !item.managed).map((item) => item.id);
  await preserveMemberRoles(member.guild.id, member.id, originalRoles);
  await member.roles.add(role, "Reputação chegou a 0%");
  const removableRoles = member.roles.cache.filter((item) => item.id !== member.guild.id && item.id !== role.id && !item.managed && item.editable).map((item) => item.id);
  if (removableRoles.length) await member.roles.remove(removableRoles, "Cargos guardados durante o castigo").catch((error) => console.error(`[CASTIGO] Falha ao remover alguns cargos de ${member.user.tag}:`, error));
  const unremovable = originalRoles.filter((roleId) => member.roles.cache.has(roleId) && !removableRoles.includes(roleId));
  if (unremovable.length) console.warn(`[CASTIGO] ${member.user.tag}: ${unremovable.length} cargo(s) não puderam ser removidos por hierarquia ou integração.`);

  const topicMarker = `castigo-user:${member.id}`;
  let appealChannel = member.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.topic === topicMarker,
  ) as TextChannel | undefined;
  if (!appealChannel) {
    const reference = member.guild.channels.cache.find(
      (channel) => channel.type === ChannelType.GuildText
        && channel.parentId === config.punishmentCategoryId
        && channel.name.toLowerCase() === config.appealReferenceChannelName.toLowerCase(),
    ) as TextChannel | undefined;
    const punishmentCategory = member.guild.channels.cache.get(config.punishmentCategoryId);
    if (!punishmentCategory || punishmentCategory.type !== ChannelType.GuildCategory) {
      throw new Error(`A categoria de castigo ${config.punishmentCategoryId} não foi encontrada.`);
    }
    const moderatorRoles = member.guild.roles.cache.filter(
      (item) => item.permissions.has(PermissionFlagsBits.ModerateMembers) && !item.managed,
    );
    const permissionOverwrites = [
      { id: member.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: role.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...moderatorRoles.map((item) => ({ id: item.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] })),
    ];
    appealChannel = await member.guild.channels.create({
      name: `castigo-${member.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
      type: ChannelType.GuildText,
      topic: topicMarker,
      parent: punishmentCategory.id,
      permissionOverwrites,
      reason: `Canal privado de revisão para ${member.user.tag}`,
    });
    if (reference) await appealChannel.setPosition(reference.rawPosition + 1).catch(console.error);
  }
  await appealChannel.send(`<@${member.id}>, você está de castigo. Converse com algum moderador para revisar suas permissões.`);
  return role;
}
export async function forgiveMember(member: GuildMember): Promise<void> {
  await member.guild.roles.fetch();
  const role = config.punishmentRoleId
    ? member.guild.roles.cache.get(config.punishmentRoleId)
    : member.guild.roles.cache.find((item) => item.name === config.punishmentRoleName);
  const preserved = await getPreservedRoles(member.guild.id, member.id);
  const blocked = preserved.filter((roleId) => {
    const savedRole = member.guild.roles.cache.get(roleId);
    return savedRole && !member.roles.cache.has(roleId) && !savedRole.editable;
  });
  if (blocked.length) throw new Error(`Não foi possível restaurar ${blocked.length} cargo(s). Coloque o cargo do bot acima deles e tente novamente.`);
  const restorable = preserved.filter((roleId) => {
    const savedRole = member.guild.roles.cache.get(roleId);
    return savedRole && !savedRole.managed && savedRole.editable && !member.roles.cache.has(roleId);
  });
  if (restorable.length) await member.roles.add(restorable, "Cargos restaurados pela confiança da moderação");
  if (role && member.roles.cache.has(role.id)) await member.roles.remove(role, "Perdão da moderação");
  await clearPreservedRoles(member.guild.id, member.id);
  const appealChannel = member.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.topic === `castigo-user:${member.id}`,
  );
  if (appealChannel) await appealChannel.delete("Castigo encerrado pela moderação");
}
