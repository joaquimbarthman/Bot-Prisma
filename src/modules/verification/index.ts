import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { config } from "../../config.js";
import { verificationBlockEmoji, verificationCheckEmoji } from "../../emoji-manager.js";

const verification = config.verification;
const dangerousExtensions = /\.(?:exe|msi|msp|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|jar|dll|apk|dmg|pkg|sh|reg|iso)$/i;
type Status = "solicitada" | "em_atendimento" | "aguardando_chamada" | "aprovada" | "recusada" | "encerrada";
type CollectionStep = "idle" | "awaiting_name" | "awaiting_birth" | "ready";
type State = { userId: string; status: Status; createdAt: string; staffId?: string; deleteAt?: string; step?: CollectionStep; promptId?: string };
type CollectedData = { name?: string; birthDate?: string };

function enabled(): boolean {
  return !!(verification.verifiedRoleId && verification.logChannelId);
}

function missingConfiguration(): string[] {
  return [
    !verification.verifiedRoleId && "VERIFIED_ROLE_ID",
    !verification.logChannelId && "VERIFICATION_LOG_CHANNEL_ID",
  ].filter(Boolean) as string[];
}

function decodeState(topic: string | null): State | null {
  const values = new URLSearchParams(topic ?? "");
  const userId = values.get("user_id"); const status = values.get("status") as Status | null; const createdAt = values.get("created_at");
  if (values.get("verification") !== "1" || !userId || !status || !createdAt) return null;
  return { userId, status, createdAt, staffId: values.get("staff_id") ?? undefined, deleteAt: values.get("delete_at") ?? undefined, step: (values.get("step") as CollectionStep | null) ?? "idle", promptId: values.get("prompt_id") ?? undefined };
}

function panelEmbed(client: Client): EmbedBuilder {
  return new EmbedBuilder().setColor(0x7c5cff).setAuthor({ name: "Central de Verificação • Prisma", iconURL: client.user?.displayAvatarURL() })
    .setThumbnail(client.user?.displayAvatarURL({ size: 256 }) ?? null)
    .setTitle("Verifique seu acesso")
    .setDescription("### Uma experiência mais segura para todos\nConclua uma breve verificação humana para acessar as áreas exclusivas da comunidade.")
    .addFields(
      { name: "1・Abra o atendimento", value: "Use o botão abaixo para criar seu canal privado.", inline: true },
      { name: "2・Aguarde a staff", value: "Uma pessoa da equipe assumirá sua solicitação.", inline: true },
      { name: "3・Faça a chamada", value: "A conferência será feita em uma chamada privada.", inline: true },
      { name: "🔒 Privacidade em primeiro lugar", value: "Seus dados serão apresentados **somente durante a chamada**. O bot não reconhece rostos, não grava, não tira capturas e não armazena imagens, vídeos ou documentos." },
      { name: "✨ Depois da aprovação", value: "Você receberá o cargo de verificado e terá acesso aos espaços exclusivos da comunidade." },
    )
    .setFooter({ text: "Atendimento humano • Se já houver uma solicitação, mostraremos seu canal aberto" });
}

function startButton(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("verification:start").setLabel("・ Começar verificação").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Primary),
  );
}

function staffButtons(reviewReady = false): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("verification:take").setLabel("Assumir atendimento").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("verification:waiting").setLabel("Aguardando chamada").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("verification:approve").setLabel("・ Aprovar").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).setDisabled(!reviewReady),
      new ButtonBuilder().setCustomId("verification:reject").setLabel("・ Recusar").setEmoji(verificationBlockEmoji() ?? "🚫").setStyle(ButtonStyle.Danger).setDisabled(!reviewReady),
      new ButtonBuilder().setCustomId("verification:close").setLabel("Encerrar atendimento").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function confirmationButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("verification:approve-confirm").setLabel("Confirmar aprovação").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("verification:approve-cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
}

async function memberIsStaff(guild: Guild, userId: string): Promise<boolean> {
  const member = await guild.members.fetch(userId).catch(() => null);
  return !!member?.roles.cache.has(verification.staffRoleId);
}

async function findVerificationChannel(guild: Guild, userId: string): Promise<TextChannel | null> {
  await guild.channels.fetch();
  return guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name.startsWith("verificacao-") && channel.permissionOverwrites.cache.has(userId)) as TextChannel | undefined ?? null;
}

async function findStaffPanel(channel: TextChannel): Promise<Message | null> {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  return messages?.find((message) => message.author.id === channel.client.user.id && message.embeds[0]?.title === "Atendimento de verificação") ?? null;
}

function statusFromText(value: string): Status {
  const text = value.toLowerCase();
  if (text.includes("aprovad")) return "aprovada";
  if (text.includes("recusad")) return "recusada";
  if (text.includes("encerrad")) return "encerrada";
  if (text.includes("aguardando chamada")) return "aguardando_chamada";
  if (text.includes("atendimento")) return "em_atendimento";
  return "solicitada";
}

async function readChannelState(channel: TextChannel): Promise<State | null> {
  const legacy = decodeState(channel.topic); if (legacy) return legacy;
  const panel = await findStaffPanel(channel); if (!panel?.embeds[0]) return null;
  const fields = panel.embeds[0].fields; const userField = fields.find((field) => field.name.includes("Usuário"));
  const userId = userField?.value.match(/\d{17,20}/)?.[0]; if (!userId) return null;
  const statusText = fields.find((field) => field.name.includes("Status"))?.value ?? "solicitada";
  const staffId = fields.find((field) => field.name.includes("Staff responsável"))?.value.match(/\d{17,20}/)?.[0];
  const requestedUnix = fields.find((field) => field.name.includes("Solicitado"))?.value.match(/<t:(\d+)/)?.[1];
  const hasName = fields.some((field) => field.name === "Nome informado"); const hasBirth = fields.some((field) => field.name === "Data de nascimento");
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const prompt = recent?.find((message) => message.author.id === channel.client.user.id && message.content.includes("Sua resposta será apagada automaticamente"));
  const step: CollectionStep = hasName && hasBirth ? "ready" : hasName ? "awaiting_birth" : prompt?.content.includes("nome completo") ? "awaiting_name" : "idle";
  const status = statusFromText(statusText); const decisionTime = panel.embeds[0].timestamp ? Date.parse(panel.embeds[0].timestamp) : panel.createdTimestamp;
  return { userId, status, createdAt: requestedUnix ? new Date(Number(requestedUnix) * 1000).toISOString() : panel.createdAt.toISOString(), staffId, step, promptId: prompt?.id, deleteAt: ["aprovada", "recusada", "encerrada"].includes(status) ? new Date(decisionTime + verification.deleteDelaySeconds * 1_000).toISOString() : undefined };
}

function replaceStatus(embed: EmbedBuilder, status: string, staff?: GuildMember): EmbedBuilder {
  let fields = (embed.data.fields ?? []).map((field) => field.name.includes("Status") ? { ...field, value: status } : field);
  if (staff) {
    fields = fields.filter((field) => !field.name.includes("Staff responsável"));
    fields.push({ name: "Staff responsável", value: `<@${staff.id}> • ${safePrivateValue(staff.user.username)}`, inline: true });
  }
  return embed.setFields(fields);
}

function upsertField(embed: EmbedBuilder, name: string, value: string, inline = false): EmbedBuilder {
  const fields = [...(embed.data.fields ?? [])]; const index = fields.findIndex((field) => field.name === name);
  const field = { name, value, inline }; if (index === -1) fields.push(field); else fields[index] = field;
  return embed.setFields(fields);
}

function collectedData(embed: EmbedBuilder): CollectedData {
  const fields = embed.data.fields ?? [];
  return { name: fields.find((field) => field.name === "Nome informado")?.value, birthDate: fields.find((field) => field.name === "Data de nascimento")?.value };
}

function safePrivateValue(value: string): string {
  return value.replace(/@/g, "@\u200b").replace(/([`*_~|>])/g, "\\$1").slice(0, 100);
}

function channelNickname(member: GuildMember): string {
  const value = member.user.username.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return value || "usuario";
}

function normalizeBirthDate(value: string): string | null {
  const digits = value.replace(/\D/g, ""); if (digits.length !== 8) return null;
  const day = Number(digits.slice(0, 2)); const month = Number(digits.slice(2, 4)); const year = Number(digits.slice(4));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date > new Date() || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

async function setChannelState(channel: TextChannel, patch: Partial<State>): Promise<State | null> {
  const current = await readChannelState(channel); return current ? { ...current, ...patch } : null;
}

async function removeCollectionPrompt(channel: TextChannel, state: State): Promise<void> {
  if (state.promptId) await channel.messages.delete(state.promptId).catch(() => undefined);
}

async function sendCollectionPrompt(channel: TextChannel, userId: string, step: "awaiting_name" | "awaiting_birth", content: string): Promise<void> {
  const prompt = await channel.send({ content: `<@${userId}>, ${content}\n*Sua resposta será apagada automaticamente após ser recebida.*`, allowedMentions: { users: [userId] } });
  await setChannelState(channel, { step, promptId: prompt.id });
}

async function sendLog(client: Client, state: State, staff: GuildMember, channelId: string, result: "Aprovada" | "Recusada" | "Encerrada", reason?: string, data?: CollectedData): Promise<void> {
  const channel = await client.channels.fetch(verification.logChannelId!).catch(() => null);
  if (!channel?.isSendable()) { console.error("[VERIFICACAO] Canal de logs indisponível."); return; }
  const verifiedMember = await staff.guild.members.fetch(state.userId).catch(() => null);
  const verificationChannel = await client.channels.fetch(channelId).catch(() => null);
  const channelName = verificationChannel && "name" in verificationChannel ? verificationChannel.name : "verificacao";
  const embed = new EmbedBuilder().setColor(result === "Aprovada" ? 0x57f287 : result === "Recusada" ? 0xed4245 : 0x99aab5)
    .setTitle(`Verificação ${result.toLowerCase()}`).addFields(
      { name: "👤 Usuário", value: `<@${state.userId}> • ${safePrivateValue(verifiedMember?.user.username ?? "usuário não encontrado")}` },
      { name: "🛡️ Staff", value: `<@${staff.id}> • ${safePrivateValue(staff.user.username)}` },
      { name: "📌 Resultado", value: result, inline: true },
      { name: "💬 Canal", value: `#${channelName}`, inline: true },
    ).setTimestamp();
  if (data?.name) embed.addFields({ name: "Nome informado", value: data.name });
  if (data?.birthDate) embed.addFields({ name: "Data de nascimento", value: data.birthDate });
  if (reason) embed.addFields({ name: "📝 Motivo", value: reason.slice(0, 1000) });
  await channel.send({ embeds: [embed] });
}

async function scheduleDeletion(channel: TextChannel): Promise<void> {
  setTimeout(() => channel.delete("Atendimento de verificação concluído").catch(console.error), verification.deleteDelaySeconds * 1_000);
}

async function configureChannelPermissions(guild: Guild): Promise<void> {
  const botId = guild.members.me?.id; if (!botId) return;
  const panel = await guild.channels.fetch(verification.panelChannelId).catch(() => null);
  const verifiedChat = await guild.channels.fetch(verification.verifiedChatChannelId).catch(() => null);
  const gallery = await guild.channels.fetch(config.galleryChannelId).catch(() => null);
  const onboarding = await guild.fetchOnboarding().catch(() => null);
  const onboardingChannelIds = new Set<string>();
  if (onboarding) {
    for (const channelId of onboarding.defaultChannels.keys()) onboardingChannelIds.add(channelId);
    for (const prompt of onboarding.prompts.values()) {
      for (const option of prompt.options.values()) {
        for (const channelId of option.channels.keys()) onboardingChannelIds.add(channelId);
      }
    }
  }
  if (panel && !panel.isThread()) {
    await panel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true, SendMessages: false });
    await panel.permissionOverwrites.edit(verification.staffRoleId, { ViewChannel: true, SendMessages: false });
    await panel.permissionOverwrites.edit(verification.verifiedRoleId!, { ViewChannel: true, SendMessages: false });
    await panel.permissionOverwrites.edit(botId, { ViewChannel: true, SendMessages: true, EmbedLinks: true, ReadMessageHistory: true });
  }
  for (const channel of [verifiedChat, gallery]) {
    if (!channel || channel.isThread()) continue;
    const isVerifiedChat = channel.id === verification.verifiedChatChannelId;
    const mustBePublicForOnboarding = onboardingChannelIds.has(channel.id);
    const publicReadPermissions = { ViewChannel: true, ReadMessageHistory: true, AddReactions: true, SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AttachFiles: false, EmbedLinks: false, UseApplicationCommands: false };
    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, isVerifiedChat || mustBePublicForOnboarding
        ? publicReadPermissions
        : { ViewChannel: false });
    } catch (error) {
      if ((error as { code?: unknown }).code !== 350003) throw error;
      console.warn(`[VERIFICACAO] Canal ${channel.id} faz parte do Onboarding; mantendo leitura publica para @everyone.`);
      await channel.permissionOverwrites.edit(guild.roles.everyone, publicReadPermissions);
    }
    await channel.permissionOverwrites.edit(verification.verifiedRoleId!, { ViewChannel: true, SendMessages: true, SendMessagesInThreads: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true, AddReactions: true, UseApplicationCommands: true });
    await channel.permissionOverwrites.edit(verification.staffRoleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, ManageMessages: true });
    await channel.permissionOverwrites.edit(botId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, ManageMessages: true });
  }
}

async function ensurePublicPanel(client: Client, guild: Guild): Promise<void> {
  const channel = await client.channels.fetch(verification.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("Canal do painel de verificação indisponível.");
  const recent = await channel.messages.fetch({ limit: 50 });
  const existing = recent.find((message) => message.author.id === client.user!.id && message.components.some((row) => "components" in row && row.components.some((component) => "customId" in component && component.customId === "verification:start")));
  const payload = { embeds: [panelEmbed(client)], components: [startButton()] };
  if (existing) await existing.edit(payload); else await channel.send(payload);
}

export async function startVerificationModule(client: Client): Promise<void> {
  if (!enabled()) { console.warn(`[VERIFICACAO] Módulo desativado. Preencha: ${missingConfiguration().join(", ")}.`); return; }
  const guild = config.guildId ? await client.guilds.fetch(config.guildId).catch(() => null) : client.guilds.cache.first();
  if (!guild) { console.error("[VERIFICACAO] Servidor não encontrado."); return; }
  try {
    await guild.channels.fetch(); await configureChannelPermissions(guild); await ensurePublicPanel(client, guild);
    const channels = guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText && channel.name.startsWith("verificacao-"));
    for (const channel of channels.values()) {
      const textChannel = channel as TextChannel; const legacy = decodeState(textChannel.topic);
      if (legacy) await textChannel.setTopic(null).catch(console.error);
      const state = legacy ?? await readChannelState(textChannel);
      if (state) {
        const member = await guild.members.fetch(state.userId).catch(() => null);
        if (member) await textChannel.setName(`verificacao-${channelNickname(member)}`).catch(console.error);
      }
      if (!state?.deleteAt) continue;
      const remaining = Date.parse(state.deleteAt) - Date.now();
      if (remaining <= 0) await channel.delete("Limpeza de verificação concluída").catch(console.error);
      else setTimeout(() => channel.delete("Limpeza de verificação concluída").catch(console.error), remaining);
    }
    console.log("[VERIFICACAO] Painel e permissões configurados.");
  } catch (error) { console.error("[VERIFICACAO] Falha ao iniciar módulo:", error); }
}

export async function handleVerificationMessage(message: Message): Promise<boolean> {
  if (!message.inGuild()) return false;
  if (message.channelId === config.galleryChannelId && message.attachments.size) {
    const dangerous = message.attachments.find((attachment) => dangerousExtensions.test(attachment.name ?? "") || /(?:x-msdownload|x-msdos-program|x-executable)/i.test(attachment.contentType ?? ""));
    if (dangerous) {
      await message.delete().catch((error) => console.error("[VERIFICACAO] Falha ao apagar arquivo perigoso:", error));
      const warning = await message.channel.send(`<@${message.author.id}>, arquivos executáveis ou potencialmente perigosos não são permitidos.`).catch(() => null);
      if (warning) setTimeout(() => warning.delete().catch(() => undefined), 10_000);
      return true;
    }
  }

  if (message.channel.type !== ChannelType.GuildText || !message.channel.name.startsWith("verificacao-")) return false;
  const channel = message.channel; const state = await readChannelState(channel);
  if (!state || message.author.id !== state.userId || !["awaiting_name", "awaiting_birth"].includes(state.step ?? "idle")) return false;
  try { await message.delete(); } catch (error) { console.error("[VERIFICACAO] Não foi possível apagar a resposta privada:", error); return true; }
  await removeCollectionPrompt(channel, state);
  const panel = await findStaffPanel(channel); if (!panel) return true;

  if (state.step === "awaiting_name") {
    const name = message.content.trim();
    if (name.length < 3 || normalizeBirthDate(name)) { await sendCollectionPrompt(channel, state.userId, "awaiting_name", "envie seu **nome completo**, não a data de nascimento."); return true; }
    const embed = upsertField(EmbedBuilder.from(panel.embeds[0]), "Nome informado", safePrivateValue(name));
    await panel.edit({ embeds: [embed], components: staffButtons(false) });
    await sendCollectionPrompt(channel, state.userId, "awaiting_birth", "agora envie sua **data de nascimento** no formato `DD/MM/AAAA` ou `DDMMAAAA`.");
    return true;
  }

  const birthDate = normalizeBirthDate(message.content);
  if (!birthDate) { await sendCollectionPrompt(channel, state.userId, "awaiting_birth", "a data não é válida. Envie no formato `DD/MM/AAAA` ou `DDMMAAAA`."); return true; }
  let embed = upsertField(EmbedBuilder.from(panel.embeds[0]), "Data de nascimento", birthDate);
  embed = replaceStatus(embed, "Pronto para análise");
  await panel.edit({ embeds: [embed], components: staffButtons(true) });
  await setChannelState(channel, { step: "ready", promptId: undefined });
  const confirmation = await channel.send(`<@${state.userId}>, dados recebidos. Aguarde a decisão da staff.`);
  setTimeout(() => confirmation.delete().catch(() => undefined), 10_000);
  return true;
}

export async function handleVerificationInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith("verification:")) return false;
  if (!interaction.inGuild() || !interaction.guild) return true;
  if (!enabled()) { await interaction.reply({ content: `Verificação indisponível. Configuração pendente: ${missingConfiguration().join(", ")}.`, ephemeral: true }); return true; }
  const action = interaction.customId.split(":")[1];
  if (action === "start" && interaction.isButton()) return handleStart(interaction);
  const deferredUpdate = interaction.isButton() && ["take", "waiting", "approve-confirm", "approve-cancel", "close"].includes(action);
  if (deferredUpdate) await interaction.deferUpdate();
  if (!(await memberIsStaff(interaction.guild, interaction.user.id))) {
    if (deferredUpdate) await interaction.followUp({ content: "Somente a staff pode usar este controle.", ephemeral: true });
    else await interaction.reply({ content: "Somente a staff pode usar este controle.", ephemeral: true });
    return true;
  }
  const staff = await interaction.guild.members.fetch(interaction.user.id);
  const channel = interaction.channel as TextChannel | null;
  const state = channel ? await readChannelState(channel) : null;
  if (!channel || !state) {
    if (deferredUpdate) await interaction.followUp({ content: "Este não é um canal de verificação válido.", ephemeral: true });
    else await interaction.reply({ content: "Este não é um canal de verificação válido.", ephemeral: true });
    return true;
  }
  if (action === "take" && interaction.isButton()) {
    await setChannelState(channel, { status: "em_atendimento", staffId: staff.id });
    await interaction.message.edit({ embeds: [replaceStatus(EmbedBuilder.from(interaction.message.embeds[0]), "Em atendimento", staff)], components: staffButtons(state.step === "ready") });
    if (!state.step || state.step === "idle") await sendCollectionPrompt(channel, state.userId, "awaiting_name", "envie seu **nome completo**.");
    return true;
  }
  if (action === "waiting" && interaction.isButton()) {
    await setChannelState(channel, { status: "aguardando_chamada", staffId: staff.id });
    await interaction.message.edit({ embeds: [replaceStatus(EmbedBuilder.from(interaction.message.embeds[0]), "Aguardando chamada", staff)], components: staffButtons(state.step === "ready") }); return true;
  }
  if (action === "approve" && interaction.isButton()) { if (state.step !== "ready") { await interaction.reply({ content: "Aguarde o usuário enviar nome e data de nascimento.", ephemeral: true }); return true; } await interaction.reply({ content: `Confirma a aprovação de <@${state.userId}>? O cargo de verificado será entregue.`, components: [confirmationButtons()], ephemeral: true }); return true; }
  if (action === "approve-cancel" && interaction.isButton()) { await interaction.editReply({ content: "Aprovação cancelada.", components: [] }); return true; }
  if (action === "approve-confirm" && interaction.isButton()) return approve(interaction, channel, state, staff);
  if (action === "reject" && interaction.isButton()) {
    if (state.step !== "ready") { await interaction.reply({ content: "Aguarde o usuário enviar nome e data de nascimento.", ephemeral: true }); return true; }
    const modal = new ModalBuilder().setCustomId("verification:reject-submit").setTitle("Recusar verificação");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo da recusa").setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(1000).setRequired(true)));
    await interaction.showModal(modal); return true;
  }
  if (action === "reject-submit" && interaction.isModalSubmit()) return reject(interaction, channel, state, staff);
  if (action === "close" && interaction.isButton()) {
    const next = await setChannelState(channel, { status: "encerrada", staffId: staff.id });
    const panel = interaction.message; await panel.edit({ embeds: [replaceStatus(EmbedBuilder.from(panel.embeds[0]).setColor(0x99aab5).setTimestamp(), "⚪ Atendimento encerrado", staff)], components: [] });
    if (next) await sendLog(interaction.client, next, staff, channel.id, "Encerrada", undefined, collectedData(EmbedBuilder.from(panel.embeds[0]))); await channel.send(`<@${state.userId}>, este atendimento foi encerrado. O canal será apagado em ${verification.deleteDelaySeconds} segundos.`); await scheduleDeletion(channel); await interaction.followUp({ content: "Atendimento encerrado.", ephemeral: true }); return true;
  }
  return true;
}

async function handleStart(interaction: ButtonInteraction): Promise<true> {
  await interaction.deferReply({ ephemeral: true });
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  if (member.roles.cache.has(verification.verifiedRoleId!)) { await interaction.editReply("Você já possui o cargo de verificado."); return true; }
  const existing = await findVerificationChannel(interaction.guild!, interaction.user.id);
  if (existing) { await interaction.editReply(`Você já possui uma verificação aberta: <#${existing.id}>.`); return true; }
  const createdAt = new Date().toISOString(); const botId = interaction.client.user.id;
  const channel = await interaction.guild!.channels.create({
    name: `verificacao-${channelNickname(member)}`, type: ChannelType.GuildText,
    permissionOverwrites: [
      { id: interaction.guild!.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: verification.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MentionEveryone] },
    ],
  });
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("Atendimento de verificação")
    .setDescription("Aguarde uma staff assumir o atendimento. Depois, responda às solicitações do bot neste canal privado.")
    .addFields(
      { name: "Usuário", value: `<@${interaction.user.id}> • ${safePrivateValue(member.user.username)}` },
      { name: "Status", value: "Aguardando staff", inline: true },
      { name: "Solicitado em", value: `<t:${Math.floor(new Date(createdAt).getTime() / 1000)}:F>`, inline: true },
    ).setTimestamp(new Date(createdAt));
  await channel.send({ content: `<@${interaction.user.id}> <@&${verification.staffRoleId}>`, embeds: [embed], components: staffButtons(false), allowedMentions: { users: [interaction.user.id], roles: [verification.staffRoleId] } });
  await interaction.editReply(`Seu canal privado foi criado: <#${channel.id}>.`); return true;
}

async function approve(interaction: ButtonInteraction, channel: TextChannel, state: State, staff: GuildMember): Promise<true> {
  const member = await interaction.guild!.members.fetch(state.userId).catch(() => null);
  if (!member) { await interaction.followUp({ content: "O usuário não está mais no servidor.", ephemeral: true }); return true; }
  await member.roles.add(verification.verifiedRoleId!, `Verificação aprovada por ${staff.user.tag}`);
  const next = await setChannelState(channel, { status: "aprovada", staffId: staff.id }); const panel = await findStaffPanel(channel);
  if (panel) await panel.edit({ embeds: [replaceStatus(EmbedBuilder.from(panel.embeds[0]).setColor(0x57f287).setTimestamp(), "✅ Verificação aprovada", staff)], components: [] });
  await channel.send(`<@${state.userId}>, sua verificação foi **aprovada** e o cargo foi entregue. Este canal será apagado em ${verification.deleteDelaySeconds} segundos.`);
  await member.send("Sua verificação no servidor foi aprovada. Você já recebeu o cargo de verificado.").catch(() => undefined);
  if (next) await sendLog(interaction.client, next, staff, channel.id, "Aprovada", undefined, panel ? collectedData(EmbedBuilder.from(panel.embeds[0])) : undefined); await scheduleDeletion(channel);
  await interaction.followUp({ content: "Verificação aprovada e cargo entregue.", ephemeral: true }); return true;
}

async function reject(interaction: ModalSubmitInteraction, channel: TextChannel, state: State, staff: GuildMember): Promise<true> {
  await interaction.deferReply({ ephemeral: true }); const reason = interaction.fields.getTextInputValue("reason").trim();
  const next = await setChannelState(channel, { status: "recusada", staffId: staff.id }); const panel = await findStaffPanel(channel);
  if (panel) await panel.edit({ embeds: [replaceStatus(EmbedBuilder.from(panel.embeds[0]).setColor(0xed4245).setTimestamp(), `🚫 Verificação recusada\nMotivo: ${reason}`, staff)], components: [] });
  await channel.send(`<@${state.userId}>, sua verificação foi **recusada**. Motivo: ${reason}\nEste canal será apagado em ${verification.deleteDelaySeconds} segundos.`);
  const member = await interaction.guild!.members.fetch(state.userId).catch(() => null);
  await member?.send(`Sua verificação foi recusada. Motivo: ${reason}`).catch(() => undefined);
  if (next) await sendLog(interaction.client, next, staff, channel.id, "Recusada", reason, panel ? collectedData(EmbedBuilder.from(panel.embeds[0])) : undefined); await scheduleDeletion(channel);
  await interaction.editReply("Verificação recusada e registrada."); return true;
}
