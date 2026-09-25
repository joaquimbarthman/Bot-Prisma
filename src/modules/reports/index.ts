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
  type Message,
  type TextChannel,
} from "discord.js";
import { config } from "../../config.js";
import { reportWarningEmoji, verificationBlockEmoji, verificationCheckEmoji, lfgCloseEmoji  } from "../../emoji-manager.js";

type ReportStatus = "pending" | "resolved" | "unresolved" | "closed";
type ReportState = { userId: string; status: ReportStatus };
const REPORT_DELETE_DELAY_MS = 60_000;

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

export function reportUserIdFromPanelContent(value: string): string | null {
  return value.match(/(?:Olá,\s*)?<@(\d{17,20})>/)?.[1] ?? null;
}

function reportPanelContent(message: Message): string {
  return JSON.stringify(message.components.map((component) => component.toJSON()));
}

async function resolveReportUserId(channel: TextChannel, currentPanel?: Message): Promise<string | null> {
  const overwriteUserId = reportUserId(channel);
  if (overwriteUserId) return overwriteUserId;

  const currentPanelUserId = currentPanel ? reportUserIdFromPanelContent(reportPanelContent(currentPanel)) : null;
  if (currentPanelUserId) return currentPanelUserId;

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const panel = messages?.find((message) =>
    message.author.id === channel.client.user.id
    && message.components.some((component) => hasButtonWithCustomId(component, "report:close")),
  );
  return panel ? reportUserIdFromPanelContent(reportPanelContent(panel)) : null;
}

function reportStatusFromValue(value: string): ReportStatus {
  if (value.includes("Encerrado sem resolução")) return "closed";
  if (value.includes("Não resolvido")) return "unresolved";
  if (value.includes("Resolvido")) return "resolved";
  return "pending";
}

export function reportStatusFromPanelContent(value: string): ReportStatus {
  const statusText = value.match(/\*\*Status\*\*(?:\\n|\n)([^"\\\n]+)/)?.[1] ?? "";
  return reportStatusFromValue(statusText);
}

function scheduleReportDeletion(channel: TextChannel, delayMs: number, reason: string): void {
  setTimeout(() => channel.delete(reason).catch((error) => console.error("[ATENDIMENTOS] Falha ao excluir canal:", error)), Math.max(0, delayMs)).unref();
}

async function blockReportApplicantMessages(channel: TextChannel, userId: string): Promise<void> {
  await channel.permissionOverwrites.edit(userId, {
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
  }, { reason: "Atendimento finalizado" }).catch((error: unknown) => {
    // O overwrite pode desaparecer quando a pessoa sai do servidor ou outra
    // rotina altera as permissões. Isso não pode cancelar a exclusão do canal.
    console.warn(`[ATENDIMENTOS] Não foi possível bloquear mensagens de ${userId} no canal ${channel.id}:`, error);
  });
}

function openButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("report:open").setLabel(" Abrir atendimento").setEmoji(reportWarningEmoji() ?? "⚠️").setStyle(ButtonStyle.Success),
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

function reportDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp)).replace(",", " às");
}

function reportComponents(userId: string, status: ReportStatus): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: status === "resolved" ? 0x57f287 : status === "unresolved" ? 0xed4245 : status === "closed" ? 0x99aab5 : 0xfee75c,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: `## Atendimento privado\nOlá, <@${userId}>. Explique como podemos ajudar, descreva o ocorrido com detalhes e envie provas, se houver.\n\n**Status**\n${statusLabel(status)}\n\n-# Somente você e a equipe de <@&${config.reports.staffRoleId}> podem acessar este canal.`,
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
      },
      staffButtons(status).toJSON(),
    ],
  }];
}

function transcriptChunks(value: string): string[] {
  const maxLength = 3_500;
  const chunks: string[] = [];
  let remaining = value;
  while (remaining.length > maxLength && chunks.length < 8) {
    const splitAt = remaining.lastIndexOf("\n", maxLength);
    const end = splitAt > 0 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining.slice(0, maxLength));
  return chunks;
}

async function reportTranscript(channel: TextChannel): Promise<string | null> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < 1_000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100 || !before) break;
  }
  const entries = messages.reverse()
    .filter((message) => !message.author.bot && message.content.trim())
    .map((message) => ({
      name: message.author.username,
      content: message.content.trim().replace(/```/g, "'''"),
    }));
  return entries.length ? entries.map((entry) => `${entry.name}: ${entry.content}`).join("\n\n") : null;
}

function reportLogComponents(userId: string, staffId: string, status: ReportStatus, createdAt: number, transcript: string | null): APIContainerComponent[] {
  const accentColor = status === "resolved" ? 0x57f287 : status === "unresolved" ? 0xed4245 : 0x99aab5;
  return [{
    type: ComponentType.Container,
    accent_color: accentColor,
    components: [
      { type: ComponentType.TextDisplay, content: `## Atendimento encerrado\n> ${statusLabel(status)}` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: `**Solicitante** ・ <@${userId}>\n**Encerrado por** ・ <@${staffId}>`,
      },
      ...(transcript ? [
        { type: ComponentType.Separator as ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
        { type: ComponentType.TextDisplay as ComponentType.TextDisplay, content: "### Registro do chat" },
        ...transcriptChunks(transcript).map((chunk) => ({
          type: ComponentType.TextDisplay as ComponentType.TextDisplay,
          content: `\`\`\`text\n${chunk}\n\`\`\``,
        })),
      ] : []),
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `-# Aberto em ${reportDateTime(createdAt * 1000)} ・ Fechado em ${reportDateTime(Date.now())}` },
    ],
  }];
}

function isReportChannelName(name: string): boolean {
  return name.startsWith("atendimento-") || name.startsWith("denuncia-");
}

function publicPanelComponents(): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: 0x57f287,
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
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const panel = messages?.find((message) => message.author.id === guild.client.user.id && message.components.some((component) => hasButtonWithCustomId(component, "report:resolved")));
    const panelContent = panel ? reportPanelContent(panel) : "";
    const userId = reportUserId(channel) ?? reportUserIdFromPanelContent(panelContent);
    if (!userId) continue;
    const componentStatus = reportStatusFromPanelContent(panelContent);
    const legacyStatus = reportStatusFromValue(panel?.embeds[0]?.fields.find((field) => field.name === "Status")?.value ?? "");
    const status = panelContent.includes("**Status**") ? componentStatus : legacyStatus;
    if (panel && status !== "pending") {
      const deleteAt = (panel.editedTimestamp ?? panel.createdTimestamp) + REPORT_DELETE_DELAY_MS;
      scheduleReportDeletion(channel, deleteAt - Date.now(), `Limpeza de atendimento ${status}`);
      continue;
    }
    await channel.permissionOverwrites.edit(config.reports.staffRoleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageMessages: true,
    }).catch((error) => console.error(`[ATENDIMENTOS] Falha ao liberar equipe em ${channel.id}:`, error));
    const previousStaffRoleId = "1537991738801659904";
    if (previousStaffRoleId !== config.reports.staffRoleId) {
      await channel.permissionOverwrites.delete(previousStaffRoleId).catch(() => undefined);
    }
    if (channel.topic?.startsWith("prisma-report:user=")) {
      const user = await guild.client.users.fetch(userId).catch(() => null);
      if (user) await channel.setTopic(user.username).catch((error) => console.error(`[ATENDIMENTOS] Falha ao atualizar assunto de ${channel.id}:`, error));
    }
    const user = await guild.client.users.fetch(userId).catch(() => null);
    const expectedName = user ? reportChannelName(user.username) : null;
    if (expectedName && channel.name !== expectedName) {
      await channel.setName(expectedName).catch((error) => console.error(`[ATENDIMENTOS] Falha ao atualizar nome de ${channel.id}:`, error));
    }
    if (panel) {
      await panel.edit({ embeds: [], components: reportComponents(userId, status), flags: ["IsComponentsV2"] }).catch((error) => console.error(`[ATENDIMENTOS] Falha ao atualizar painel de ${channel.id}:`, error));
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
  await interaction.deferReply({ flags: ["Ephemeral"] });
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
    components: reportComponents(interaction.user.id, "pending"),
    flags: ["IsComponentsV2"],
    allowedMentions: { users: [interaction.user.id], roles: [config.reports.staffRoleId] },
  });
  await interaction.editReply(`Seu atendimento foi aberto em <#${channel.id}>.`);
}

async function handleStaffAction(interaction: ButtonInteraction, action: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.channel || interaction.channel.type !== ChannelType.GuildText || !interaction.member || !("roles" in interaction.member)) return;
  if (!isStaff(interaction.member as GuildMember)) { await interaction.reply({ content: "Apenas a equipe responsável pode usar este painel.", flags: ["Ephemeral"] }); return; }
  const channel = interaction.channel as TextChannel;
  if (!isReportChannelName(channel.name) || !(action === "resolved" || action === "unresolved" || action === "close")) return;
  const userId = await resolveReportUserId(channel, interaction.message);
  if (!userId) {
    if (action !== "close") { await interaction.reply({ content: "Não foi possível identificar o solicitante. Use Encerrar atendimento para excluir este canal órfão.", flags: ["Ephemeral"] }); return; }
    await interaction.update({ components: [] });
    scheduleReportDeletion(channel, REPORT_DELETE_DELAY_MS, `Atendimento órfão encerrado por ${interaction.user.tag}`);
    await channel.send("Este atendimento foi encerrado. O canal será excluído em 1 minuto.").catch(() => undefined);
    await interaction.followUp({ content: "Atendimento órfão encerrado. Este canal será excluído em 1 minuto.", flags: ["Ephemeral"] });
    return;
  }
  const state: ReportState = { userId, status: "pending" };
  const finalStatus: ReportStatus = action === "close" ? "closed" : action;
  await interaction.update({ components: reportComponents(state.userId, finalStatus) });
  const log = await interaction.guild!.channels.fetch(config.reports.logChannelId).catch(() => null);
  const createdAt = Math.floor(channel.createdTimestamp / 1000);
  const transcript = await reportTranscript(channel);
  if (log?.isSendable()) {
    await log.send({ components: reportLogComponents(state.userId, interaction.user.id, finalStatus, createdAt, transcript), flags: ["IsComponentsV2"], allowedMentions: { parse: [] } })
      .catch((error) => console.error("[ATENDIMENTOS] Falha ao enviar registro; o canal ainda será excluído:", error));
  } else {
    console.error("[ATENDIMENTOS] Canal de registros indisponível; o atendimento ainda será excluído.");
  }
  scheduleReportDeletion(channel, REPORT_DELETE_DELAY_MS, `Atendimento ${finalStatus} encerrado por ${interaction.user.tag}`);
  await blockReportApplicantMessages(channel, userId);
  await channel.send({ content: `<@${userId}>, este atendimento foi encerrado. O canal será excluído em 1 minuto.`, allowedMentions: { users: [userId] } }).catch(() => undefined);
  await interaction.followUp({
    content: log?.isSendable()
      ? "Atendimento encerrado. Este canal será excluído em 1 minuto."
      : "Atendimento encerrado. O registro não pôde ser enviado, mas este canal será excluído em 1 minuto.",
    flags: ["Ephemeral"],
  });
}

export async function handleReportInteraction(interaction: import("discord.js").Interaction): Promise<boolean> {
  if (!interaction.isButton() || !interaction.customId.startsWith("report:")) return false;
  const action = interaction.customId.split(":")[1];
  if (action === "open") await openReport(interaction);
  else await handleStaffAction(interaction, action);
  return true;
}
