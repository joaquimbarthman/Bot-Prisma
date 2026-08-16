import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  OverwriteType,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { config } from "../../config.js";
import { reportWarningEmoji, verificationBlockEmoji, verificationCheckEmoji } from "../../emoji-manager.js";

type ReportStatus = "pending" | "resolved" | "unresolved" | "closed";
type ReportState = { userId: string; status: ReportStatus };

export function reportChannelName(displayName: string): string {
  const nickname = displayName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "usuario";
  return `denuncia-${nickname}`;
}

function reportUserId(channel: TextChannel): string | null {
  return channel.permissionOverwrites.cache.find((overwrite) =>
    overwrite.type === OverwriteType.Member && overwrite.id !== channel.client.user.id,
  )?.id ?? null;
}

function statusFromValue(value: string): ReportStatus {
  if (value.includes("Encerrado sem resolução")) return "closed";
  if (value.includes("Não resolvido")) return "unresolved";
  if (value.includes("Resolvido")) return "resolved";
  return "pending";
}

function statusFromInteraction(interaction: ButtonInteraction): ReportStatus {
  return statusFromValue(interaction.message.embeds[0]?.fields.find((field) => field.name === "Status")?.value ?? "");
}

function openButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("report:open").setLabel("・ Abrir denúncia").setEmoji(reportWarningEmoji() ?? "⚠️").setStyle(ButtonStyle.Danger),
  );
}

function staffButtons(status: ReportStatus): ActionRowBuilder<ButtonBuilder> {
  const finished = status !== "pending";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("report:resolved").setLabel("・ Resolvido").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).setDisabled(finished),
    new ButtonBuilder().setCustomId("report:unresolved").setLabel("・ Não resolvido").setEmoji(verificationBlockEmoji() ?? "🚫").setStyle(ButtonStyle.Danger).setDisabled(finished),
    new ButtonBuilder().setCustomId("report:close").setLabel("Encerrar denúncia").setStyle(ButtonStyle.Secondary).setDisabled(finished),
  );
}

function statusLabel(status: ReportStatus): string {
  if (status === "resolved") return "✅ Resolvido";
  if (status === "unresolved") return "🚫 Não resolvido";
  if (status === "closed") return "🔒 Encerrado sem resolução";
  return "⏳ Aguardando análise";
}

function reportEmbed(userId: string, status: ReportStatus): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(status === "resolved" ? 0x57f287 : status === "unresolved" ? 0xed4245 : status === "closed" ? 0x99aab5 : 0xfee75c)
    .setTitle("Atendimento de denúncia")
    .setDescription(`Olá, <@${userId}>. Descreva a denúncia com o máximo de detalhes possível e envie provas, se houver.`)
    .addFields({ name: "Status", value: statusLabel(status) })
    .setFooter({ text: "Somente o denunciante e a equipe responsável podem acessar este canal." });
}

async function findOpenReport(guild: Guild, userId: string): Promise<TextChannel | null> {
  await guild.channels.fetch();
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name.startsWith("denuncia-") && reportUserId(channel) === userId) as TextChannel | undefined ?? null;
}

function isStaff(member: GuildMember): boolean {
  return member.roles.cache.has(config.reports.staffRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);
}

async function ensurePanel(client: Client, guild: Guild): Promise<void> {
  const channel = await guild.channels.fetch(config.reports.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) throw new Error(`Canal do painel de denúncias ${config.reports.panelChannelId} não encontrado.`);
  const recent = await channel.messages.fetch({ limit: 50 });
  const existing = recent.find((message) => message.author.id === client.user?.id && message.components.some((row) => "components" in row && row.components.some((component) => "customId" in component && component.customId === "report:open")));
  if (existing) { await existing.edit({ components: [openButton()] }); return; }
  await channel.send({
    embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("Central de denúncias").setDescription("Use o botão abaixo para abrir uma denúncia privada com a equipe. Explique o ocorrido e envie provas no canal criado.")],
    components: [openButton()],
  });
}

async function migrateTechnicalTopics(guild: Guild): Promise<void> {
  await guild.channels.fetch();
  const channels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText && channel.name.startsWith("denuncia-"));
  for (const channel of channels.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    const userId = reportUserId(channel);
    if (!userId) continue;
    if (channel.topic?.startsWith("prisma-report:user=")) {
      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (user) await channel.setTopic(user.username).catch((error) => console.error(`[DENUNCIAS] Falha ao atualizar assunto de ${channel.id}:`, error));
    }
    const user = await guild.client.users.fetch(userId).catch(() => null);
    const expectedName = user ? reportChannelName(user.username) : null;
    if (expectedName && channel.name !== expectedName) {
      await channel.setName(expectedName).catch((error) => console.error(`[DENUNCIAS] Falha ao atualizar nome de ${channel.id}:`, error));
    }
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const panel = messages?.find((message) => message.author.id === guild.client.user.id && message.components.some((row) => "components" in row && row.components.some((component) => "customId" in component && component.customId === "report:resolved")));
    if (panel) {
      const status = statusFromValue(panel.embeds[0]?.fields.find((field) => field.name === "Status")?.value ?? "");
      await panel.edit({ components: [staffButtons(status)] }).catch((error) => console.error(`[DENUNCIAS] Falha ao atualizar painel de ${channel.id}:`, error));
    }
  }
}

export async function startReportModule(client: Client): Promise<void> {
  const guild = config.guildId ? await client.guilds.fetch(config.guildId).catch(() => null) : client.guilds.cache.first() ?? null;
  if (!guild) { console.error("[DENUNCIAS] Servidor não encontrado."); return; }
  await migrateTechnicalTopics(guild);
  await ensurePanel(client, guild).catch((error) => console.error("[DENUNCIAS] Falha ao publicar painel:", error));
}

async function openReport(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const existing = await findOpenReport(interaction.guild, interaction.user.id);
  if (existing) { await interaction.editReply(`Você já possui uma denúncia aberta em <#${existing.id}>.`); return; }
  const panel = await interaction.guild.channels.fetch(config.reports.panelChannelId).catch(() => null);
  const botId = interaction.client.user.id;
  const channel = await interaction.guild.channels.create({
    name: reportChannelName(interaction.user.username),
    type: ChannelType.GuildText,
    parent: panel && "parentId" in panel ? panel.parentId ?? undefined : undefined,
    topic: interaction.user.username.slice(0, 1024),
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: config.reports.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] },
    ],
  });
  await channel.send({
    content: `<@${interaction.user.id}> <@&${config.reports.staffRoleId}>`,
    embeds: [reportEmbed(interaction.user.id, "pending")],
    components: [staffButtons("pending")],
    allowedMentions: { users: [interaction.user.id], roles: [config.reports.staffRoleId] },
  });
  await interaction.editReply(`Sua denúncia foi aberta em <#${channel.id}>.`);
}

async function handleStaffAction(interaction: ButtonInteraction, action: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.channel || interaction.channel.type !== ChannelType.GuildText || !interaction.member || !("roles" in interaction.member)) return;
  if (!isStaff(interaction.member as GuildMember)) { await interaction.reply({ content: "Apenas a equipe responsável pode usar este painel.", ephemeral: true }); return; }
  const channel = interaction.channel as TextChannel;
  const userId = reportUserId(channel);
  if (!userId || !channel.name.startsWith("denuncia-")) { await interaction.reply({ content: "Este canal não possui uma denúncia válida.", ephemeral: true }); return; }
  if (!(action === "resolved" || action === "unresolved" || action === "close")) return;
  const state: ReportState = { userId, status: statusFromInteraction(interaction) };
  const finalStatus: ReportStatus = action === "close" ? "closed" : action;
  await interaction.update({ embeds: [reportEmbed(state.userId, finalStatus)], components: [staffButtons(finalStatus)] });
  const log = await interaction.guild!.channels.fetch(config.reports.logChannelId).catch(() => null);
  if (!log?.isSendable()) {
    await interaction.followUp({ content: "Não encontrei o canal de relatórios. O canal não será apagado.", ephemeral: true });
    await interaction.message.edit({ embeds: [reportEmbed(state.userId, "pending")], components: [staffButtons("pending")] });
    return;
  }
  const createdAt = Math.floor(channel.createdTimestamp / 1000);
  await log.send({
    embeds: [new EmbedBuilder()
      .setColor(finalStatus === "resolved" ? 0x57f287 : finalStatus === "unresolved" ? 0xed4245 : 0x99aab5)
      .setTitle("Denúncia encerrada")
      .addFields(
        { name: "Denunciante", value: `<@${state.userId}>`, inline: true },
        { name: "Status", value: statusLabel(finalStatus), inline: true },
        { name: "Encerrada por", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Aberta em", value: `<t:${createdAt}:F>` },
      )
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });
  await interaction.followUp({ content: "Relatório enviado. Este canal será excluído em 10 segundos.", ephemeral: true });
  setTimeout(() => channel.delete(`Denúncia ${finalStatus} encerrada por ${interaction.user.tag}`).catch((error) => console.error("[DENUNCIAS] Falha ao excluir canal:", error)), 10_000).unref();
}

export async function handleReportInteraction(interaction: import("discord.js").Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith("report:")) return false;
  const action = interaction.customId.split(":")[1];
  if (action === "open") await openReport(interaction);
  else await handleStaffAction(interaction, action);
  return true;
}
