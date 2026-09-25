import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type APIContainerComponent,
  type Client,
  type Guild,
  type GuildMember,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import { config } from "../../config.js";
import { verificationBlockEmoji, verificationCheckEmoji, verificationCloseEmoji, verificationStartEmoji, verificationTakeEmoji } from "../../emoji-manager.js";

const verification = config.verification;
const dangerousExtensions = /\.(?:exe|msi|msp|bat|cmd|com|scr|ps1|vbs|vbe|js|jse|jar|dll|apk|dmg|pkg|sh|reg|iso)$/i;
type Status = "solicitada" | "em_atendimento" | "aguardando_chamada" | "aprovada" | "recusada" | "encerrada";
type CollectionStep = "idle" | "awaiting_name" | "awaiting_birth" | "ready";
type State = { userId: string; status: Status; createdAt: string; username?: string; avatarUrl?: string; staffId?: string; staffUsername?: string; name?: string; birthDate?: string; reason?: string; deleteAt?: string; step?: CollectionStep; promptId?: string };
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
    new ButtonBuilder().setCustomId("verification:start").setLabel("Começar verificação").setEmoji(verificationStartEmoji() ?? "✅").setStyle(ButtonStyle.Primary),
  );
}

function publicPanelComponents(): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: 0x7c5cff,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: "## PRISMA ・ Verificação\n\n### Uma experiência mais segura para todos\n\nConclua uma breve verificação humana para acessar as áreas exclusivas da comunidade.",
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.MediaGallery,
        items: [{ media: { url: "https://imgur.com/SAg0MOT.gif" } }],
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      startButton().toJSON(),
    ],
  }];
}

function staffButtons(reviewReady = false): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("verification:take").setLabel("Assumir atendimento").setEmoji(verificationTakeEmoji() ?? "👤").setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("verification:approve").setLabel("Aprovar").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).setDisabled(!reviewReady),
      new ButtonBuilder().setCustomId("verification:reject").setLabel("Recusar").setEmoji(verificationBlockEmoji() ?? "🚫").setStyle(ButtonStyle.Danger).setDisabled(!reviewReady),
      new ButtonBuilder().setCustomId("verification:close").setLabel("Encerrar atendimento").setEmoji(verificationCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function statusDisplay(state: State): string {
  if (state.status === "em_atendimento") return "⏳ Verificação em andamento";
  if (state.status === "aguardando_chamada") return "Aguardando chamada";
  if (state.status === "aprovada") return "✅ Verificação aprovada";
  if (state.status === "recusada") return "🚫 Verificação recusada";
  if (state.status === "encerrada") return "⚪ Atendimento encerrado";
  return state.step === "ready" ? "Pronto para análise" : "Aguardando staff";
}

function requestedAtDisplay(value: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: config.prismaAi.timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")} ・ ${part("hour")}:${part("minute")}`;
}

function staffPanelComponents(state: State, showButtons = true): APIContainerComponent[] {
  const details = [
    `**Solicitado em**　　　　　 ** Status do atendimento**\n${requestedAtDisplay(state.createdAt)}　    　${statusDisplay(state)}`,
  ];
  if (state.status === "recusada" && state.reason) details.push(`**Motivo**\n${state.reason}`);
  if (state.staffId) details.push(`**Staff responsável**\n<@${state.staffId}> ・ ${safePrivateValue(state.staffUsername ?? "staff")}`);
  if (state.name) details.push(`**Nome informado**\n${state.name}`);
  if (state.birthDate) details.push(`**Data de nascimento**\n${state.birthDate}`);
  const components: APIContainerComponent["components"] = [
    {
      type: ComponentType.Section,
      components: [{
        type: ComponentType.TextDisplay,
        content: `## Atendimento de verificação\n**Solicitante:** <@${state.userId}> \n\nAguarde uma pessoa da equipe assumir o atendimento. Depois, responda às solicitações do bot neste canal privado.\n\n-# <@&${verification.staffRoleId}> novo atendimento aguardando análise.`,
      }],
      accessory: {
        type: ComponentType.Thumbnail,
        media: { url: state.avatarUrl ?? "https://cdn.discordapp.com/embed/avatars/0.png" },
        description: `Avatar de ${safePrivateValue(state.username ?? "usuário")}`,
      },
    },
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    { type: ComponentType.TextDisplay, content: details.join("\n\n") },
  ];
  if (showButtons) components.push(
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    ...staffButtons(state.step === "ready").map((row) => row.toJSON()),
  );
  return [{ type: ComponentType.Container, accent_color: state.status === "aprovada" ? 0x57f287 : state.status === "recusada" ? 0xed4245 : state.status === "encerrada" ? 0x99aab5 : 0x5865f2, components }];
}

function confirmationButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("verification:approve-confirm").setLabel("Confirmar aprovação").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("verification:approve-cancel").setLabel("Cancelar").setEmoji(verificationCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary),
  );
}

function approvalConfirmationComponents(userId: string, result?: "confirmed" | "cancelled"): APIContainerComponent[] {
  const content = result === "confirmed"
    ? `## Aprovação confirmada\n<@${userId}> foi aprovado e recebeu o cargo de verificado.`
    : result === "cancelled"
      ? "## Aprovação cancelada\nNenhuma alteração foi realizada."
      : `## Confirmar aprovação\nDeseja aprovar <@${userId}>? O cargo de verificado será entregue imediatamente.`;
  const components: APIContainerComponent["components"] = [
    { type: ComponentType.TextDisplay, content },
  ];
  if (!result) components.push(
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    confirmationButtons().toJSON(),
  );
  return [{
    type: ComponentType.Container,
    accent_color: result === "confirmed" ? 0x57f287 : result === "cancelled" ? 0x99aab5 : 0x5865f2,
    components,
  }];
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
  return messages?.find((message) => message.author.id === channel.client.user.id && (message.embeds[0]?.title === "Atendimento de verificação" || componentText(message).includes("Atendimento de verificação"))) ?? null;
}

function componentText(message: Message): string {
  return JSON.stringify(message.components.map((component) => component.toJSON()));
}

function componentThumbnailUrl(message: Message): string | undefined {
  const findThumbnail = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const child of value) {
        const childUrl = findThumbnail(child);
        if (childUrl) return childUrl;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    const component = value as { type?: unknown; media?: { url?: unknown }; components?: unknown[]; accessory?: unknown };
    if (component.type === ComponentType.Thumbnail && typeof component.media?.url === "string") return component.media.url;
    const accessoryUrl = findThumbnail(component.accessory);
    if (accessoryUrl) return accessoryUrl;
    for (const child of component.components ?? []) {
      const childUrl = findThumbnail(child);
      if (childUrl) return childUrl;
    }
    return undefined;
  };
  return findThumbnail(message.components.map((component) => component.toJSON()));
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
  const panel = await findStaffPanel(channel); if (!panel) return null;
  if (!panel.embeds[0]) {
    const text = componentText(panel).replace(/\\n/g, "\n");
    const userId = text.match(/\*\*(?:Usuário|Solicitante):?\*\*[\s\S]*?<@(\d{17,20})>/)?.[1];
    if (!userId) return null;
    const value = (label: string) => text.match(new RegExp(`\\*\\*${label}\\*\\*\\n([^\\n"}]+)`))?.[1];
    const requestedUnix = text.match(/\*\*Solicitado em\*\*[\s\S]*?<t:(\d+)/)?.[1];
    const requestedText = text.match(/(\d{2})\/(\d{2})\/(\d{4}) ・ (\d{2}):(\d{2})/);
    const requestedAt = requestedUnix
      ? new Date(Number(requestedUnix) * 1000).toISOString()
      : requestedText
        ? new Date(`${requestedText[3]}-${requestedText[2]}-${requestedText[1]}T${requestedText[4]}:${requestedText[5]}:00-03:00`).toISOString()
        : panel.createdAt.toISOString();
    const staffId = text.match(/\*\*Staff responsável\*\*[\s\S]*?<@(\d{17,20})>/)?.[1];
    const statusText = text.match(/(?:### Status do atendimento|\*\*Status do atendimento\*\*[^\n]*|\*\*Solicitado em\*\*[^\n]*\*\*Status do atendimento\*\*)\n([^\n"}]+)/)?.[1]?.trim() ?? value("Status") ?? "Aguardando staff";
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const prompt = recent?.find((message) => message.author.id === channel.client.user.id && /nome completo|data.*formato/i.test(message.content));
    const name = value("Nome informado"); const birthDate = value("Data de nascimento");
    const step: CollectionStep = name && birthDate ? "ready" : name ? "awaiting_birth" : prompt?.content.includes("nome completo") ? "awaiting_name" : "idle";
    const status = statusFromText(statusText);
    return { userId, username: text.match(new RegExp(`<@${userId}> — ([^\\n"}]+)`))?.[1], avatarUrl: componentThumbnailUrl(panel), status, createdAt: requestedAt, staffId, staffUsername: staffId ? text.match(new RegExp(`<@${staffId}> — ([^\\n"}]+)`))?.[1] : undefined, name, birthDate, step, promptId: prompt?.id, deleteAt: ["aprovada", "recusada", "encerrada"].includes(status) ? new Date(panel.editedTimestamp! + verification.deleteDelaySeconds * 1_000).toISOString() : undefined };
  }
  const fields = panel.embeds[0].fields; const userField = fields.find((field) => field.name.includes("Usuário"));
  const userId = userField?.value.match(/\d{17,20}/)?.[0]; if (!userId) return null;
  const statusText = fields.find((field) => field.name.includes("Status"))?.value ?? "solicitada";
  const staffId = fields.find((field) => field.name.includes("Staff responsável"))?.value.match(/\d{17,20}/)?.[0];
  const requestedUnix = fields.find((field) => field.name.includes("Solicitado"))?.value.match(/<t:(\d+)/)?.[1];
  const hasName = fields.some((field) => field.name === "Nome informado"); const hasBirth = fields.some((field) => field.name === "Data de nascimento");
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const prompt = recent?.find((message) => message.author.id === channel.client.user.id && /nome completo|data.*formato/i.test(message.content));
  const step: CollectionStep = hasName && hasBirth ? "ready" : hasName ? "awaiting_birth" : prompt?.content.includes("nome completo") ? "awaiting_name" : "idle";
  const status = statusFromText(statusText); const decisionTime = panel.embeds[0].timestamp ? Date.parse(panel.embeds[0].timestamp) : panel.createdTimestamp;
  return {
    userId,
    username: userField?.value.replace(/<@\d{17,20}>\s*[•—-]?\s*/, ""),
    status,
    createdAt: requestedUnix ? new Date(Number(requestedUnix) * 1000).toISOString() : panel.createdAt.toISOString(),
    staffId,
    staffUsername: fields.find((field) => field.name.includes("Staff responsável"))?.value.replace(/<@\d{17,20}>\s*[•—-]?\s*/, ""),
    name: fields.find((field) => field.name === "Nome informado")?.value,
    birthDate: fields.find((field) => field.name === "Data de nascimento")?.value,
    step,
    promptId: prompt?.id,
    deleteAt: ["aprovada", "recusada", "encerrada"].includes(status) ? new Date(decisionTime + verification.deleteDelaySeconds * 1_000).toISOString() : undefined,
  };
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

const nameConnectors = new Set(["da", "das", "de", "do", "dos", "e"]);
const conversationalNameWords = new Set([
  "agora", "aqui", "beleza", "bem", "boa", "bom", "como", "conversa", "dia", "diz", "envia", "estou", "esta", "está",
  "eu", "fala", "falar", "falou", "favor", "gente", "hoje", "mano", "meu", "minha", "nome", "noite", "obrigada",
  "obrigado", "oi", "ola", "olá", "onde", "porque", "preciso", "qual", "quando", "que", "quero", "queria", "sim",
  "sou", "tarde", "tudo", "vc", "vcs", "voce", "você", "vou", "nao", "não",
]);

export function isValidFullName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 80 || normalizeBirthDate(name)) return false;
  if (!/^[\p{L}]+(?:['-][\p{L}]+)*(?: [\p{L}]+(?:['-][\p{L}]+)*)+$/u.test(name)) return false;

  const words = name.toLocaleLowerCase("pt-BR").split(" ");
  if (words.length > 7) return false;
  const significantWords = words.filter((word) => !nameConnectors.has(word));
  if (significantWords.length < 2 || significantWords.some((word) => word.length < 2)) return false;
  return !words.some((word) => conversationalNameWords.has(word));
}

async function setChannelState(channel: TextChannel, patch: Partial<State>): Promise<State | null> {
  const current = await readChannelState(channel); return current ? { ...current, ...patch } : null;
}

async function removeCollectionPrompt(channel: TextChannel, state: State): Promise<void> {
  if (state.promptId) await channel.messages.delete(state.promptId).catch(() => undefined);
}

async function sendCollectionPrompt(channel: TextChannel, userId: string, step: "awaiting_name" | "awaiting_birth", content: string): Promise<void> {
  // As solicitações de dados devem ficar fora do painel, como mensagens de texto comuns.
  const prompt = await channel.send({
    content: `<@${userId}>, ${content}`,
    embeds: [],
    components: [],
    allowedMentions: { users: [userId] },
  });
  await setChannelState(channel, { step, promptId: prompt.id });
}

function verificationDateTime(timestamp: number): string {
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

async function sendLog(client: Client, state: State, staff: GuildMember, channelId: string, result: "Aprovada" | "Recusada" | "Encerrada", reason?: string, data?: CollectedData): Promise<void> {
  const channel = await client.channels.fetch(verification.logChannelId!).catch(() => null);
  if (!channel?.isSendable()) { console.error("[VERIFICACAO] Canal de logs indisponível."); return; }
  const verifiedMember = await staff.guild.members.fetch(state.userId).catch(() => null);
  const verificationChannel = await client.channels.fetch(channelId).catch(() => null);
  const channelName = verificationChannel && "name" in verificationChannel ? verificationChannel.name : "verificacao";
  const accentColor = result === "Aprovada" ? 0x57f287 : result === "Recusada" ? 0xed4245 : 0x99aab5;
  const resultLabel = result === "Aprovada" ? "✅ Aprovada" : result === "Recusada" ? "🚫 Recusada" : "🔒 Encerrada";
  const privateData = [
    data?.name && `Nome ・ ${data.name}`,
    data?.birthDate && `Nascimento ・ ${data.birthDate}`,
  ].filter(Boolean).join("\n");
  const safeReason = reason?.slice(0, 1000).replace(/```/g, "'''");
  await channel.send({
    components: [{
      type: ComponentType.Container,
      accent_color: accentColor,
      components: [
        { type: ComponentType.TextDisplay, content: `## Verificação ${result.toLowerCase()}\n> ${resultLabel}` },
        { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
        { type: ComponentType.TextDisplay, content: `**Usuário** ・ <@${state.userId}>\n**Responsável** ・ <@${staff.id}>` },
        ...(privateData ? [{ type: ComponentType.Separator as ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small }, { type: ComponentType.TextDisplay as ComponentType.TextDisplay, content: `**Dados informados**\n${privateData}` }] : []),
        ...(safeReason ? [
          { type: ComponentType.Separator as ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
          { type: ComponentType.TextDisplay as ComponentType.TextDisplay, content: "**Motivo**" },
          { type: ComponentType.TextDisplay as ComponentType.TextDisplay, content: `\`\`\`text\n${safeReason}\n\`\`\`` },
        ] : []),
        { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
        { type: ComponentType.TextDisplay, content: `-# Aberto em ${verificationDateTime(Date.parse(state.createdAt))} ・ Fechado em ${verificationDateTime(Date.now())}` },
      ],
    }],
    flags: ["IsComponentsV2"],
    allowedMentions: { parse: [] },
  });
}

async function scheduleDeletion(channel: TextChannel): Promise<void> {
  setTimeout(() => channel.delete("Atendimento de verificação concluído").catch(console.error), verification.deleteDelaySeconds * 1_000);
}

async function blockApplicantMessages(channel: TextChannel, userId: string): Promise<void> {
  await channel.permissionOverwrites.edit(userId, {
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
  }, { reason: "Atendimento de verificação finalizado" }).catch((error: unknown) => {
    // O overwrite pode desaparecer quando a pessoa sai do servidor ou outra
    // rotina altera as permissões. Bloquear novas mensagens é secundário e
    // nunca deve impedir a limpeza do canal de verificação.
    console.warn(`[VERIFICACAO] Não foi possível bloquear mensagens de ${userId} no canal ${channel.id}:`, error);
  });
}

export function singleParagraphReason(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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
    if (verification.staffRoleId !== "1537991738801659904") await panel.permissionOverwrites.delete("1537991738801659904").catch(() => undefined);
  }
  for (const channel of [verifiedChat, gallery]) {
    if (!channel || channel.isThread()) continue;
    const isVerifiedChat = channel.id === verification.verifiedChatChannelId;
    const mustBePublicForOnboarding = onboardingChannelIds.has(channel.id);
    const publicReadPermissions = { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false, CreatePrivateThreads: false, AttachFiles: false, EmbedLinks: false, UseApplicationCommands: false };
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
    if (verification.staffRoleId !== "1537991738801659904") await channel.permissionOverwrites.delete("1537991738801659904").catch(() => undefined);
  }
}

async function ensurePublicPanel(client: Client, guild: Guild): Promise<void> {
  const channel = await client.channels.fetch(verification.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) throw new Error("Canal do painel de verificação indisponível.");
  const recent = await channel.messages.fetch({ limit: 50 });
  const containsStartButton = (component: unknown): boolean => {
    if (!component || typeof component !== "object") return false;
    const value = component as { customId?: unknown; components?: unknown[] };
    return value.customId === "verification:start" || value.components?.some(containsStartButton) === true;
  };
  const existing = recent.find((message) => message.author.id === client.user!.id && message.components.some(containsStartButton));
  const payload = { components: publicPanelComponents(), flags: ["IsComponentsV2"] as const };
  if (existing) await existing.edit({ ...payload, embeds: [] }); else await channel.send(payload);
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
      await textChannel.permissionOverwrites.edit(verification.staffRoleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, ManageMessages: true }).catch(console.error);
      if (verification.staffRoleId !== "1537991738801659904") await textChannel.permissionOverwrites.delete("1537991738801659904").catch(() => undefined);
      if (legacy) await textChannel.setTopic(null).catch(console.error);
      const state = legacy ?? await readChannelState(textChannel);
      if (state) {
        const member = await guild.members.fetch(state.userId).catch(() => null);
        if (member) await textChannel.setName(`verificacao-${channelNickname(member)}`).catch(console.error);
        const staffPanel = await findStaffPanel(textChannel);
        if (staffPanel?.embeds.length) {
          await staffPanel.edit({ embeds: [], components: staffPanelComponents({ ...state, username: state.username ?? member?.user.username, avatarUrl: state.avatarUrl ?? member?.displayAvatarURL({ size: 256, forceStatic: true }) }), flags: ["IsComponentsV2"] }).catch(console.error);
        }
      }
      if (!state?.deleteAt) continue;
      await blockApplicantMessages(textChannel, state.userId).catch(console.error);
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
    if (!isValidFullName(name)) { await sendCollectionPrompt(channel, state.userId, "awaiting_name", "envie somente seu **nome completo** (nome e sobrenome), sem frases ou mensagens de conversa."); return true; }
    await panel.edit({ components: staffPanelComponents({ ...state, name: safePrivateValue(name), step: "awaiting_birth" }) });
    await sendCollectionPrompt(channel, state.userId, "awaiting_birth", "agora envie sua **data de nascimento** no formato `DD/MM/AAAA` ou `DDMMAAAA`.");
    return true;
  }

  const birthDate = normalizeBirthDate(message.content);
  if (!birthDate) { await sendCollectionPrompt(channel, state.userId, "awaiting_birth", "a data não é válida. Envie no formato `DD/MM/AAAA` ou `DDMMAAAA`."); return true; }
  await panel.edit({ components: staffPanelComponents({ ...state, birthDate, step: "ready" }) });
  await setChannelState(channel, { step: "ready", promptId: undefined });
  const confirmation = await channel.send(`<@${state.userId}>, dados recebidos. Aguarde a decisão da staff.`);
  setTimeout(() => confirmation.delete().catch(() => undefined), 10_000);
  return true;
}

export async function handleVerificationInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith("verification:")) return false;
  if (!interaction.inGuild() || !interaction.guild) return true;
  if (!enabled()) { await interaction.reply({ content: `Verificação indisponível. Configuração pendente: ${missingConfiguration().join(", ")}.`, flags: ["Ephemeral"] }); return true; }
  const action = interaction.customId.split(":")[1];
  if (action === "start" && interaction.isButton()) return handleStart(interaction);
  const deferredUpdate = interaction.isButton() && ["take", "waiting", "approve-confirm", "approve-cancel", "close"].includes(action);
  if (deferredUpdate) await interaction.deferUpdate();
  if (!(await memberIsStaff(interaction.guild, interaction.user.id))) {
    if (deferredUpdate) await interaction.followUp({ content: "Somente a staff pode usar este controle.", flags: ["Ephemeral"] });
    else await interaction.reply({ content: "Somente a staff pode usar este controle.", flags: ["Ephemeral"] });
    return true;
  }
  const staff = await interaction.guild.members.fetch(interaction.user.id);
  const channel = interaction.channel as TextChannel | null;
  const state = channel ? await readChannelState(channel) : null;
  if (!channel || !state) {
    if (channel?.type === ChannelType.GuildText && channel.name.startsWith("verificacao-") && action === "close" && interaction.isButton()) {
      await interaction.message.edit({ components: [] }).catch(() => undefined);
      await scheduleDeletion(channel);
      await channel.send(`Este atendimento de verificação foi encerrado. O canal será apagado em ${verification.deleteDelaySeconds} segundos.`).catch(() => undefined);
      await interaction.followUp({ content: "Verificação órfã encerrada; a exclusão do canal foi agendada.", flags: ["Ephemeral"] });
      return true;
    }
    if (deferredUpdate) await interaction.followUp({ content: "Este não é um canal de verificação válido.", flags: ["Ephemeral"] });
    else await interaction.reply({ content: "Este não é um canal de verificação válido.", flags: ["Ephemeral"] });
    return true;
  }
  if (action === "take" && interaction.isButton()) {
    await setChannelState(channel, { status: "em_atendimento", staffId: staff.id });
    await interaction.message.edit({ components: staffPanelComponents({ ...state, status: "em_atendimento", staffId: staff.id, staffUsername: staff.user.username }) });
    if (!state.step || state.step === "idle") await sendCollectionPrompt(channel, state.userId, "awaiting_name", "envie seu **nome completo**.");
    return true;
  }
  if (action === "waiting" && interaction.isButton()) {
    await setChannelState(channel, { status: "aguardando_chamada", staffId: staff.id });
    await interaction.message.edit({ components: staffPanelComponents({ ...state, status: "aguardando_chamada", staffId: staff.id, staffUsername: staff.user.username }) }); return true;
  }
  if (action === "approve" && interaction.isButton()) { if (state.step !== "ready") { await interaction.reply({ content: "Aguarde o usuário enviar nome e data de nascimento.", flags: ["Ephemeral"] }); return true; } await interaction.reply({ components: approvalConfirmationComponents(state.userId), flags: ["Ephemeral", "IsComponentsV2"] }); return true; }
  if (action === "approve-cancel" && interaction.isButton()) { await interaction.editReply({ components: approvalConfirmationComponents(state.userId, "cancelled") }); return true; }
  if (action === "approve-confirm" && interaction.isButton()) return approve(interaction, channel, state, staff);
  if (action === "reject" && interaction.isButton()) {
    if (state.step !== "ready") { await interaction.reply({ content: "Aguarde o usuário enviar nome e data de nascimento.", flags: ["Ephemeral"] }); return true; }
    const modal = new ModalBuilder().setCustomId("verification:reject-submit").setTitle("Recusar verificação");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Motivo da recusa").setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(1000).setRequired(true)));
    await interaction.showModal(modal); return true;
  }
  if (action === "reject-submit" && interaction.isModalSubmit()) return reject(interaction, channel, state, staff);
  if (action === "close" && interaction.isButton()) {
    const next = await setChannelState(channel, { status: "encerrada", staffId: staff.id });
    const panel = interaction.message; await panel.edit({ components: staffPanelComponents({ ...state, status: "encerrada", staffId: staff.id, staffUsername: staff.user.username }, false) });
    await scheduleDeletion(channel);
    await blockApplicantMessages(channel, state.userId);
    if (next) await sendLog(interaction.client, next, staff, channel.id, "Encerrada", undefined, { name: state.name, birthDate: state.birthDate });
    await channel.send(`<@${state.userId}>, este atendimento foi encerrado. O canal será apagado em ${verification.deleteDelaySeconds} segundos.`);
    await interaction.followUp({ content: "Atendimento encerrado.", flags: ["Ephemeral"] }); return true;
  }
  return true;
}

async function handleStart(interaction: ButtonInteraction): Promise<true> {
  await interaction.deferReply({ flags: ["Ephemeral"] });
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
  const state: State = { userId: interaction.user.id, username: member.user.username, avatarUrl: member.displayAvatarURL({ size: 256, forceStatic: true }), status: "solicitada", createdAt, step: "idle" };
  await channel.send({ components: staffPanelComponents(state), flags: ["IsComponentsV2"], allowedMentions: { users: [interaction.user.id], roles: [verification.staffRoleId] } });
  await interaction.editReply(`Seu canal privado foi criado: <#${channel.id}>.`); return true;
}

async function approve(interaction: ButtonInteraction, channel: TextChannel, state: State, staff: GuildMember): Promise<true> {
  const member = await interaction.guild!.members.fetch(state.userId).catch(() => null);
  if (!member) { await interaction.followUp({ content: "O usuário não está mais no servidor.", flags: ["Ephemeral"] }); return true; }
  await member.roles.add(verification.verifiedRoleId!, `Verificação aprovada por ${staff.user.tag}`);
  const next = await setChannelState(channel, { status: "aprovada", staffId: staff.id }); const panel = await findStaffPanel(channel);
  if (panel) await panel.edit({ components: staffPanelComponents({ ...state, status: "aprovada", staffId: staff.id, staffUsername: staff.user.username }, false) });
  await scheduleDeletion(channel);
  await blockApplicantMessages(channel, state.userId);
  await channel.send(`<@${state.userId}>, sua verificação foi **aprovada** e o cargo foi entregue. Este canal será apagado em ${verification.deleteDelaySeconds} segundos.`);
  await member.send("Sua verificação no servidor foi aprovada. Você já recebeu o cargo de verificado.").catch(() => undefined);
  if (next) await sendLog(interaction.client, next, staff, channel.id, "Aprovada", undefined, { name: state.name, birthDate: state.birthDate });
  await interaction.editReply({ components: approvalConfirmationComponents(state.userId, "confirmed") }); return true;
}

async function reject(interaction: ModalSubmitInteraction, channel: TextChannel, state: State, staff: GuildMember): Promise<true> {
  await interaction.deferReply({ flags: ["Ephemeral"] }); const reason = singleParagraphReason(interaction.fields.getTextInputValue("reason"));
  const next = await setChannelState(channel, { status: "recusada", staffId: staff.id }); const panel = await findStaffPanel(channel);
  if (panel) await panel.edit({ components: staffPanelComponents({ ...state, status: "recusada", reason, staffId: staff.id, staffUsername: staff.user.username }, false) });
  await scheduleDeletion(channel);
  await blockApplicantMessages(channel, state.userId);
  await channel.send(`<@${state.userId}>, sua verificação foi **recusada**. Motivo: ${reason} Este canal será apagado em ${verification.deleteDelaySeconds} segundos.`);
  const member = await interaction.guild!.members.fetch(state.userId).catch(() => null);
  await member?.send(`Sua verificação foi recusada. Motivo: ${reason}`).catch(() => undefined);
  if (next) await sendLog(interaction.client, next, staff, channel.id, "Recusada", reason, { name: state.name, birthDate: state.birthDate });
  await interaction.editReply("Verificação recusada e registrada."); return true;
}
