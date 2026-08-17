import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  PermissionFlagsBits,
  OverwriteType,
  SeparatorSpacingSize,
  type APIContainerComponent,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { config } from "../../config.js";
import { reportWarningEmoji, verificationBlockEmoji, verificationCheckEmoji, lfgCloseEmoji  } from "../../emoji-manager.js";

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
  return `atendimento-${nickname}`;
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
    new ButtonBuilder().setCustomId("report:open").setLabel(" Abrir atendimento").setEmoji(reportWarningEmoji() ?? "⚠️").setStyle(ButtonStyle.Danger),
  );
}

function staffButtons(status: ReportStatus): ActionRowBuilder<ButtonBuilder> {
  const finished = status !== "pending";
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("report:resolved").setLabel(" Resolvido").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).setDisabled(finished),
    new ButtonBuilder().setCustomId("report:unresolved").setLabel(" Não resolvido").setEmoji(verificationBlockEmoji() ?? "🚫").setStyle(ButtonStyle.Danger).setDisabled(finished),
    new ButtonBuilder().setCustomId("report:close").setLabel("Encerrar atendimento").setEmoji(lfgCloseEmoji() ?? "❌").setStyle(ButtonStyle.Secondary).setDisabled(finished),
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
    .setTitle("Atendimento privado")
    .setDescription(`Olá, <@${userId}>. Explique como podemos ajudar, descreva o ocorrido com detalhes e envie provas, se houver.`)
    .addFields({ name: "Status", value: statusLabel(status) })
    .setFooter({ text: "Somente você e a equipe responsável podem acessar este canal." });
}

function publicPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Central de atendimentos")
    .setDescription("Use o botão abaixo para abrir um atendimento privado com a equipe. Explique o ocorrido e envie provas no canal criado.");
}

function isReportChannelName(name: string): boolean {
  return name.startsWith("atendimento-") || name.startsWith("denuncia-");
}

function publicPanelComponents(): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: 0xed4245,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: "## PRISMA • Segurança\n ### Central de atendimentos\nUse o botao abaixo para abrir um atendimento privado com a equipe. Explique o ocorrido e envie provas no canal criado.",
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
      },
      {
        type: ComponentType.MediaGallery,
        items: [{
          media: { url: "https://i.imgur.com/4WikC8s.gif" },
        }],
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
      },
      openButton().toJSON(),
    ],
  }];
}

function hasButtonWithCustomId(component: unknown, customId: string): boolean {
  if (!component || typeof component !== "object") return false;
  const candidate = component as { customId?: unknown; components?: unknown };
  if (candidate.customId === customId) return true;
  return Array.isArray(candidate.components) && candidate.components.some((child) => hasButtonWithCustomId(child, customId));
}

async function findOpenReport(guild: Guild, userId: string): Promise<TextChannel | null> {
  await guild.channels.fetch();
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && isReportChannelName(channel.name) && reportUserId(channel) === userId) as TextChannel | undefined ?? null;
}

function isStaff(member: GuildMember): boolean {
  return member.roles.cache.has(config.reports.staffRoleId) || member.permissions.has(PermissionFlagsBits.Administrator);
}

async function ensurePanel(client: Client, guild: Guild): Promise<void> {
  const channel = await guild.channels.fetch(config.reports.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) throw new Error(`Canal do painel de atendimentos ${config.reports.panelChannelId} não encontrado.`);
  const recent = await channel.messages.fetch({ limit: 50 });
  const existing = recent.find((message) => message.author.id === client.user?.id && message.components.some((component) => hasButtonWithCustomId(component, "report:open")));
  const panel = { components: publicPanelComponents(), flags: ["IsComponentsV2"] as const };
  if (existing) { await existing.edit({ ...panel, embeds: [] }); return; }
  await channel.send({
    ...panel,
  });
}

async function migrateTechnicalTopics(guild: Guild): Promise<void> {
  await guild.channels.fetch();
  const channels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText && isReportChannelName(channel.name));
  for (const channel of channels.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    const userId = reportUserId(channel);
    if (!userId) continue;
    if (channel.topic?.startsWith("prisma-report:user=")) {
      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (user) await channel.setTopic(user.username).catch((error) => console.error(`[ATENDIMENTOS] Falha ao atualizar assunto de ${channel.id}:`, error));
    }
    const user = await guild.client.users.fetch(userId).catch(() => null);
    const expectedName = user ? reportChannelName(user.username) : null;
    if (expectedName && channel.name !== expectedName) {
      await channel.setName(expectedName).catch((error) => console.error(`[ATENDIMENTOS] Falha ao atualizar nome de ${channel.id}:`, error));
    }
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const panel = messages?.find((message) => message.author.id === guild.client.user.id && message.components.some((row) => "components" in row && row.components.some((component) => "customId" in component && component.customId === "report:resolved")));
    if (panel) {
      const status = statusFromValue(panel.embeds[0]?.fields.find((field) => field.name === "Status")?.value ?? "");
      await panel.edit({ embeds: [reportEmbed(userId, status)], components: [staffButtons(status)] }).catch((error) => console.error(`[ATENDIMENTOS] Falha ao atualizar painel de ${channel.id}:`, error));
    }
  }
}

export async function startReportModule(client: Client): Promise<void> {
  const guild = config.guildId ? await client.guilds.fetch(config.guildId).catch(() => null) : client.guilds.cache.first() ?? null;
  if (!guild) { console.error("[ATENDIMENTOS] Servidor não encontrado."); return; }
  await migrateTechnicalTopics(guild);
  await ensurePanel(client, guild).catch((error) => console.error("[ATENDIMENTOS] Falha ao publicar painel:", error));
}

async function openReport(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const existing = await findOpenReport(interaction.guild, interaction.user.id);
  if (existing) { await interaction.editReply(`Você já possui um atendimento aberto em <#${existing.id}>.`); return; }
  const botId = interaction.client.user.id;
  const channel = await interaction.guild.channels.create({
    name: reportChannelName(interaction.user.username),
    type: ChannelType.GuildText,
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
  await interaction.editReply(`Seu atendimento foi aberto em <#${channel.id}>.`);
}

async function handleStaffAction(interaction: ButtonInteraction, action: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.channel || interaction.channel.type !== ChannelType.GuildText || !interaction.member || !("roles" in interaction.member)) return;
  if (!isStaff(interaction.member as GuildMember)) { await interaction.reply({ content: "Apenas a equipe responsável pode usar este painel.", ephemeral: true }); return; }
  const channel = interaction.channel as TextChannel;
  const userId = reportUserId(channel);
  if (!userId || !isReportChannelName(channel.name)) { await interaction.reply({ content: "Este canal não possui um atendimento válido.", ephemeral: true }); return; }
  if (!(action === "resolved" || action === "unresolved" || action === "close")) return;
  const state: ReportState = { userId, status: statusFromInteraction(interaction) };
  const finalStatus: ReportStatus = action === "close" ? "closed" : action;
  await interaction.update({ embeds: [reportEmbed(state.userId, finalStatus)], components: [staffButtons(finalStatus)] });
  const log = await interaction.guild!.channels.fetch(config.reports.logChannelId).catch(() => null);
  if (!log?.isSendable()) {
    await interaction.followUp({ content: "Não encontrei o canal de registros de atendimento. Este canal não será apagado.", ephemeral: true });
    await interaction.message.edit({ embeds: [reportEmbed(state.userId, "pending")], components: [staffButtons("pending")] });
    return;
  }
  const createdAt = Math.floor(channel.createdTimestamp / 1000);
  await log.send({
    embeds: [new EmbedBuilder()
      .setColor(finalStatus === "resolved" ? 0x57f287 : finalStatus === "unresolved" ? 0xed4245 : 0x99aab5)
      .setTitle("Atendimento encerrado")
      .addFields(
        { name: "Solicitante", value: `<@${state.userId}>`, inline: true },
        { name: "Status", value: statusLabel(finalStatus), inline: true },
        { name: "Encerrada por", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Aberta em", value: `<t:${createdAt}:F>` },
      )
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });
  await interaction.followUp({ content: "Registro do atendimento enviado. Este canal será excluído em 10 segundos.", ephemeral: true });
  setTimeout(() => channel.delete(`Atendimento ${finalStatus} encerrado por ${interaction.user.tag}`).catch((error) => console.error("[ATENDIMENTOS] Falha ao excluir canal:", error)), 10_000).unref();
}

export async function handleReportInteraction(interaction: import("discord.js").Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith("report:")) return false;
  const action = interaction.customId.split(":")[1];
  if (action === "open") await openReport(interaction);
  else await handleStaffAction(interaction, action);
  return true;
}
