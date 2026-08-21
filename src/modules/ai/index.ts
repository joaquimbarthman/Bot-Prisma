import { ActivityType, type Client, type Interaction, type Message, type Presence } from "discord.js";
import { config } from "../../config.js";
import { localModeration } from "../moderation/filter.js";
import { accessLevel } from "./permissions.js";
import { publishPanel, handlePanelInteraction, refreshAiPanel } from "./panel.js";
import { generateReply, type ReplyContext } from "./provider.js";
import { SpontaneousReservationLedger } from "./spontaneous-quota.js";
import { addHistoryTurn, addPrismaMessage, addSpontaneous, applyPrismaStateUpdate, captureHistoryRevision, checkSupabaseConnection, cleanupExpired, getPrismaState, getRelevantPrismaMemories, getSettings, lastSpontaneousAt, recentHistory, spontaneousCountToday, updateSettings } from "./store.js";
import { canSendTestNotice, getAiRuntimeState, setAiTestMode } from "./runtime.js";
import { PRISMA_AI_VERSION } from "./version.js";
import { learnFromInteraction } from "./learning.js";
import { buildPrismaPersonalContext } from "./context-builder.js";

const cooldowns = new Map<string, number>();
const presenceInFlight = new Set<string>();
const presenceSignatures = new Map<string, string>();
const spontaneousReservations = new SpontaneousReservationLedger();
const absenceOutreachAt = new Map<string, number>();

async function reserveSpontaneousSlot(discordId: string): Promise<boolean> {
  return spontaneousReservations.reserve(
    discordId,
    config.prismaAi.dailySpontaneousLimit,
    () => spontaneousCountToday(discordId, config.prismaAi.timezone),
  );
}

function releaseSpontaneousSlot(discordId: string): void {
  spontaneousReservations.release(discordId);
}
export function startAiCleanup(client: Client): void {
  checkSupabaseConnection().catch((error) => console.error("[SUPABASE] Falha no teste de conexão:", error));
  refreshAiPanel(client).catch((error) => console.error("[PRISMA-IA] Falha ao atualizar painel:", error));
  cleanupExpired().catch(console.error);
  setInterval(() => cleanupExpired().catch(console.error), 60 * 60_000).unref();
  setTimeout(() => sendOccasionalAbsenceMessage(client).catch(console.error), 5 * 60_000).unref();
  setInterval(() => sendOccasionalAbsenceMessage(client).catch(console.error), 60 * 60_000).unref();
}

async function sendOccasionalAbsenceMessage(client: Client): Promise<void> {
  if (!config.prismaAi.enabled || !config.prismaAi.generalChannelId || Math.random() >= 0.2) return;
  const channel = await client.channels.fetch(config.prismaAi.generalChannelId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) return;
  const members = [...channel.guild.members.cache.values()]
    .filter((member) => !member.user.bot && accessLevel(member) !== "none")
    .sort(() => Math.random() - 0.5);

  for (const member of members) {
    const settings = await getSettings(member.id);
    if (!settings.spontaneousInteractions) continue;
    const state = await getPrismaState(member.id);
    const lastInteraction = state.temperament.lastInteractionAt ? Date.parse(state.temperament.lastInteractionAt) : NaN;
    const absentHours = Number.isFinite(lastInteraction) ? (Date.now() - lastInteraction) / 3_600_000 : 0;
    if (absentHours < 3 || state.relationship.interactionCount < 4) continue;
    if (Date.now() - (absenceOutreachAt.get(member.id) ?? 0) < 24 * 60 * 60_000) continue;
    if (Date.now() - await lastSpontaneousAt(member.id) < config.prismaAi.spontaneousCooldownMinutes * 60_000) continue;
    if (!await reserveSpontaneousSlot(member.id)) continue;
    try {
      const history = settings.memoryEnabled ? await recentHistory(member.id, channel.id, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
      const relevantMemories = settings.memoryEnabled ? await getRelevantPrismaMemories(member.id, 3, "sumiu conversa jogo música") : [];
      const generated = await generateReply(member.id, settings, state, history, "Faz um tempo que não conversamos. Puxe assunto de forma leve.", { mode: "absence", currentAuthorName: member.displayName, currentAuthorId: member.id, relevantMemories });
      const answer = localModeration(generated.reply).flagged ? "Cadê você? Sumiu, hein." : generated.reply;
      const prefix = settings.allowMentions ? `<@${member.id}> ` : "";
      await channel.send({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: settings.allowMentions ? [member.id] : [] } });
      await addSpontaneous(member.id);
      absenceOutreachAt.set(member.id, Date.now());
    } finally {
      releaseSpontaneousSlot(member.id);
    }
    return;
  }
}

async function isReplyToBot(message: Message, client: Client): Promise<boolean> {
  if (!message.reference?.messageId) return false;
  const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
  return referenced?.author.id === client.user?.id;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function asksAboutActivity(content: string): boolean {
  const value = normalized(content);
  return /\b(?:o que|oq|que)\b.{0,32}\b(?:fazendo|jogando|ouvindo|escutando|assistindo|vendo)\b/.test(value)
    || /\b(?:qual|que)\s+(?:jogo|atividade|musica|música)\b/.test(value)
    || /\b(?:estou|to|tô|esta|está|ta|tá)\s+(?:fazendo|jogando|ouvindo|escutando|assistindo|vendo)\b/.test(value)
    || /\b(?:na|em|da)\s+minha\s+atividade\b/.test(value)
    || /\b(?:sabe|consegue|consegue ver|tem como saber|da pra saber|d[aá] para saber|adivinha|me diz|me fala)\b.{0,32}\b(?:o que|qual|minha atividade|estou|to|tô)\b.{0,24}\b(?:faço|fazendo|jogando|ouvindo|assistindo|vendo|atividade|jogo|musica|música)\b/.test(value)
    || /\b(?:qual|que)\s+(?:e|é)\s+(?:a\s+)?minha\s+atividade\b/.test(value)
    || /\b(?:o que|oq|que)\s+(?:eu\s+)?(?:ando|t[oô]|estou)\s+(?:fazendo|jogando|ouvindo|assistindo)\b/.test(value);
}

function isDirectBotInsult(content: string, botId?: string): boolean {
  let value = normalized(content).replace(botId ? new RegExp(`<@!?${botId}>`, "g") : /$^/, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const insult = "(?:burro|burra|idiota|inutil|lerdo|lerda|lixo|otario|otaria|fracassado|fracassada|chato|chata|horrivel|ruim|bosta)";
  return new RegExp(`^(?:seu|sua)?\\s*${insult}$|\\b(?:prisma|voce|vc|tu)\\s+(?:(?:e|eh|ta)\\s+)?(?:um|uma)?\\s*(?:seu|sua)?\\s*${insult}\\b`).test(value);
}

function requestsSpontaneousOptOut(content: string): boolean {
  return /\b(?:desativa|desative|deslig(a|ue)|para|pare|nao quero|não quero|sem)\b.{0,30}\b(?:intera[cç][aã]o espont[aâ]nea|mensagem espont[aâ]nea|me chamar|me chamar do nada|me procurar|notifica[cç][aã]o)/i.test(content)
    || /\b(?:não|nao)\s+(?:me\s+)?(?:chama|procura|manda mensagem)\s+(?:do nada|espontaneamente)/i.test(content);
}

function requestedNickname(content: string): string | null {
  const match = content.match(/(?:quero\s+(?:que\s+)?(?:você|voce|vc)\s+me\s+cham(?:e|ando)\s+de|(?:pode\s+)?me\s+cham(?:a|e)\s+de|pode\s+me\s+chamar\s+de)\s+["']?([^\n.!?]{2,32})["']?/i);
  const nickname = match?.[1]?.replace(/\s+(?:por favor|pfv|please|ok|né|ne)\s*$/i, "").trim();
  return nickname && !/@(?:everyone|here)|<@|https?:\/\//i.test(nickname) ? nickname : null;
}

function needsChannelContext(message: Message): boolean {
  return /\b(?:o que .{0,40} (?:falou|disse)|que (?:ele|ela) (?:falou|disse)|mensagem (?:dele|dela)|resum(?:a|e) (?:a|essa) conversa|contexto da conversa)\b/i.test(normalized(message.content));
}

function requestsDirectMention(content: string): boolean {
  return /\b(?:chama|chame|marca|marque|menciona|mencione|convida|convide|manda|mande|envia|envie|escreve|escreva|fala|fale|diz|diga|responde|responda)\b/i.test(normalized(content));
}

function requestsContextualMention(content: string): boolean {
  return /<@!?\d+>/.test(content) && /\b(?:o que|oq|qual|como)\b.{0,80}\b(?:acha|achou|opin(?:a|i)|pensa|pensou|avalia|avaliou)\b/i.test(normalized(content));
}

export function explicitlyRequestedMentionUserIds(
  content: string,
  mentionedUserIds: Iterable<string>,
  botId?: string,
  authorId?: string,
): string[] {
  if (!requestsDirectMention(content) && !requestsContextualMention(content)) return [];
  const rawMentionIds = [...content.matchAll(/<@!?(\d{1,25})>/g)].map((match) => match[1]);
  return [...new Set([...mentionedUserIds, ...rawMentionIds])]
    .filter((userId) => userId !== botId && userId !== authorId)
    .slice(0, 3);
}

async function recentChannelContext(message: Message): Promise<string> {
  const first = await message.channel.messages.fetch({ limit: 100, before: message.id }).catch(() => null);
  if (!first) return "";
  const oldest = [...first.values()].at(-1);
  const second = config.prismaAi.channelHistoryLimit > 100 && oldest
    ? await message.channel.messages.fetch({ limit: 100, before: oldest.id }).catch(() => null)
    : null;
  const messages = [...(second?.values() ?? []), ...first.values()];
  const lines = messages.reverse()
    .filter((item) => item.content.trim())
    .map((item) => `${item.member?.displayName ?? item.author.username}: ${item.cleanContent.replace(/\s+/g, " ").slice(0, 280)}`);
  while (lines.join("\n").length > 40_000) lines.shift();
  return lines.join("\n");
}

async function expandedChannelContext(message: Message): Promise<string> {
  const first = await message.channel.messages.fetch({ limit: 100, before: message.id }).catch(() => null);
  if (!first) return "";
  const oldest = [...first.values()].at(-1);
  const second = config.prismaAi.channelHistoryExpandedLimit > 100 && oldest
    ? await message.channel.messages.fetch({ limit: 100, before: oldest.id }).catch(() => null)
    : null;
  return [...(second?.values() ?? []), ...first.values()].reverse().filter((m) => m.content.trim()).map((m) => `${m.member?.displayName ?? m.author.username}: ${m.cleanContent.replace(/\s+/g, " ").slice(0, 500)}`).join("\n").slice(-40_000);
}

async function isDirectedAtBot(message: Message, client: Client): Promise<boolean> {
  return !!client.user && (message.mentions.users.has(client.user.id) || /\bprisma\b/i.test(message.content) || await isReplyToBot(message, client));
}

export async function handleAiMessage(client: Client, message: Message): Promise<boolean> {
  if (!config.prismaAi.enabled || !config.prismaAi.generalChannelId || !message.inGuild() || !message.member || !message.content || ![config.prismaAi.generalChannelId, config.prismaAi.testChannelId].includes(message.channelId)) return false;
  const addressedToPrisma = await isDirectedAtBot(message, client);
  const runtime = await getAiRuntimeState();
  if (runtime.testModeEnabled && message.channelId === config.prismaAi.generalChannelId) {
    if (!addressedToPrisma) return false;
    if (canSendTestNotice(message.author.id, config.prismaAi.testNoticeCooldownSeconds * 1000)) await message.reply({ content: "O prisma está atualmente sendo testado, logo ele volta pra conversar com você!", allowedMentions: { repliedUser: false } });
    return true;
  }
  const level = accessLevel(message.member);
  const direct = asksAboutActivity(message.content) || addressedToPrisma;
  const botInsult = direct && isDirectBotInsult(message.content, client.user?.id);
  if (level === "none") {
    if (direct) {
      const notice = await message.reply({ content: `A Prisma IA é exclusiva para membros com o cargo <@&${config.prismaAi.accessRoleId}>.`, allowedMentions: { parse: [], roles: [] } });
      setTimeout(() => notice.delete().catch(() => undefined), 10_000).unref();
    }
    return direct;
  }

  let settings = await getSettings(message.author.id);
  if (requestsSpontaneousOptOut(message.content) && settings.spontaneousInteractions) {
    settings = await updateSettings(message.author.id, { spontaneousInteractions: false });
    await message.reply({ content: "beleza, não vou mais te chamar do nada. se quiser, você pode ativar isso de novo no painel da Prisma.", allowedMentions: { repliedUser: false } });
    return true;
  }
  const historyRevision = captureHistoryRevision(message.author.id);
  let spontaneous = false;
  let spontaneousReserved = false;
  if (!direct) {
    if (!settings.spontaneousInteractions || Math.random() * 100 >= config.prismaAi.spontaneousChancePercent) return false;
    if (Date.now() - await lastSpontaneousAt(message.author.id) < config.prismaAi.spontaneousCooldownMinutes * 60_000) return false;
    if (!await reserveSpontaneousSlot(message.author.id)) return false;
    spontaneousReserved = true;
    spontaneous = true;
  }
  const last = cooldowns.get(message.author.id) ?? 0;
  if (!spontaneous && Date.now() - last < config.prismaAi.userCooldownSeconds * 1000) { await message.reply({ content: "Espere alguns segundos antes de falar comigo novamente.", allowedMentions: { repliedUser: false } }); return true; }
  cooldowns.set(message.author.id, Date.now());

  try {
    await message.channel.sendTyping();
    const preferredNickname = requestedNickname(message.content);
    if (preferredNickname && preferredNickname !== settings.nickname) {
      try { settings = await updateSettings(message.author.id, { nickname: preferredNickname }); }
      catch (error) { console.error("[PRISMA-IA] Não foi possível persistir o apelido; continuando sem bloquear a resposta:", error); }
    }
    const content = message.content.replace(client.user ? new RegExp(`<@!?${client.user.id}>`, "g") : /$^/, "").trim() || "Olá!";
    const prismaState = await getPrismaState(message.author.id);
    const { learnedProfile, relevantMemories, emotionalState } = await buildPrismaPersonalContext(message.author.id, settings, content);
    const history = settings.memoryEnabled ? await recentHistory(message.author.id, message.channelId, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
    const currentPresence = message.guild?.presences.cache.get(message.author.id) ?? message.member.presence;
    const currentActivity = currentPresence ? publicActivity(currentPresence) : null;
    const replyContext: ReplyContext = {
      mode: botInsult ? "light_roast" : spontaneous ? "spontaneous" : "direct",
      currentAuthorName: message.member.displayName,
      currentAuthorId: message.author.id,
      learnedProfile,
      relevantMemories,
      emotionalState,
    };
    const allowedMentionUserIds = explicitlyRequestedMentionUserIds(
      content,
      message.mentions.users.keys(),
      client.user?.id,
      message.author.id,
    );
    if (requestsDirectMention(content)) {
      console.log(`[PRISMA-IA] Menções de usuário autorizadas para ${message.author.id}: ${allowedMentionUserIds.join(", ") || "nenhuma"}.`);
    }
    if (allowedMentionUserIds.length) replyContext.allowedMentionUserIds = allowedMentionUserIds;
    if (asksAboutActivity(content)) {
      replyContext.activityDescription = currentActivity?.description ?? "Nenhuma atividade pública está visível agora.";
    }
    if (direct || needsChannelContext(message)) {
      let channelContext = await recentChannelContext(message);
      if (!channelContext || channelContext.length < 120) channelContext = await expandedChannelContext(message);
      if (channelContext) replyContext.channelExcerpt = channelContext;
    }
    const generated = await generateReply(message.author.id, settings, prismaState, history, content, replyContext);
    let answer = generated.reply;
    if (!answer) throw new Error("Resposta vazia.");
    const unsafeOutput = localModeration(answer).flagged;
    if (unsafeOutput) {
      console.warn("[PRISMA-IA] Saída bloqueada pelo filtro determinístico.");
      answer = "Não vou seguir por esse caminho. Vamos manter a conversa de boa.";
    }
    // A menção automática ao autor é exclusiva das interações espontâneas.
    // Em respostas diretas, o reply do Discord já fornece o contexto sem pingar a pessoa.
    const prefix = spontaneous ? `<@${message.author.id}> ` : "";
    const replyMentionUserIds = [...new Set([
      ...(spontaneous ? [message.author.id] : []),
      ...allowedMentionUserIds,
    ])];
    const sent = await message.reply({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: replyMentionUserIds, repliedUser: false } });
    try {
      if (!spontaneous && !unsafeOutput) await applyPrismaStateUpdate(message.author.id, prismaState, generated.stateUpdate);
      if (settings.memoryEnabled && (await getSettings(message.author.id)).memoryEnabled) {
        const now = new Date().toISOString();
        await addHistoryTurn([
          { discordId: message.author.id, channelId: message.channelId, role: "user", content, createdAt: now },
          { discordId: message.author.id, channelId: message.channelId, role: "assistant", content: answer, createdAt: now },
        ], historyRevision);
        await addPrismaMessage({ messageId: message.id, guildId: message.guildId, channelId: message.channelId, userId: message.author.id, content, authorIsPrisma: false, replyToMessageId: message.reference?.messageId ?? null, createdAt: message.createdAt.toISOString() });
        await addPrismaMessage({ messageId: sent.id, guildId: message.guildId, channelId: message.channelId, userId: message.author.id, content: answer, authorIsPrisma: true, replyToMessageId: message.id, createdAt: sent.createdAt.toISOString() });
        void learnFromInteraction({ userId: message.author.id, guildId: message.guildId, displayName: message.member.displayName, content, reply: answer });
      }
      if (spontaneous) await addSpontaneous(message.author.id);
    } catch (error) {
      console.error("[PRISMA-IA] Resposta enviada, mas a persistência falhou:", error);
    }
  } catch (error) { console.error("[PRISMA-IA] Falha controlada:", error); if (direct) await message.reply({ content: "Não consegui responder agora. Tente novamente mais tarde.", allowedMentions: { repliedUser: false } }); }
  finally { if (spontaneousReserved) releaseSpontaneousSlot(message.author.id); }
  return true;
}

function publicActivity(presence: Presence): { signature: string; description: string } | null {
  const activity = presence.activities.find((item) => item.type !== ActivityType.Custom);
  if (!activity) return null;
  const signature = [activity.type, activity.name, activity.details, activity.state].filter(Boolean).join("|");
  if (activity.type === ActivityType.Playing) return { signature, description: `jogando ${activity.name}` };
  if (activity.type === ActivityType.Listening) {
    const song = activity.details ? ` "${activity.details}"` : " música";
    const artist = activity.state ? ` de ${activity.state}` : "";
    return { signature, description: `ouvindo${song}${artist}` };
  }
  if (activity.type === ActivityType.Streaming) return { signature, description: `fazendo uma transmissão de ${activity.name}` };
  if (activity.type === ActivityType.Watching) return { signature, description: `assistindo ${activity.name}` };
  if (activity.type === ActivityType.Competing) return { signature, description: `competindo em ${activity.name}` };
  return null;
}

export async function handleAiPresenceUpdate(client: Client, oldPresence: Presence | null, newPresence: Presence): Promise<void> {
  if (!config.prismaAi.enabled || !config.prismaAi.generalChannelId || !newPresence.member || newPresence.user?.bot) return;
  const activity = publicActivity(newPresence); if (!activity) return;
  const previous = oldPresence ? publicActivity(oldPresence)?.signature : presenceSignatures.get(newPresence.userId);
  presenceSignatures.set(newPresence.userId, activity.signature);
  if (previous === activity.signature || presenceInFlight.has(newPresence.userId) || accessLevel(newPresence.member) === "none") return;
  presenceInFlight.add(newPresence.userId);
  let spontaneousReserved = false;
  try {
    const settings = await getSettings(newPresence.userId);
    if (!settings.spontaneousInteractions) return;
    if (Date.now() - await lastSpontaneousAt(newPresence.userId) < config.prismaAi.spontaneousCooldownMinutes * 60_000) return;
    if (!await reserveSpontaneousSlot(newPresence.userId)) return;
    spontaneousReserved = true;
    const channel = await client.channels.fetch(config.prismaAi.generalChannelId).catch(() => null);
    if (!channel?.isSendable()) return;
    const prismaState = await getPrismaState(newPresence.userId);
    const history = settings.memoryEnabled ? await recentHistory(newPresence.userId, channel.id, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
    const generated = await generateReply(
      newPresence.userId,
      settings,
      prismaState,
      history,
      "Comente sobre minha atividade atual.",
      {
        mode: "activity",
        currentAuthorName: newPresence.member.displayName,
        currentAuthorId: newPresence.userId,
        activityDescription: activity.description,
      },
    );
    const answer = localModeration(generated.reply).flagged
      ? "Não vou seguir por esse caminho. Vamos manter a conversa de boa."
      : generated.reply;
    // Mudanças de atividade também são interações espontâneas e sempre começam com a menção.
    await channel.send({ content: `<@${newPresence.userId}> ${answer}`, allowedMentions: { parse: [], users: [newPresence.userId] } });
    await addSpontaneous(newPresence.userId);
  } catch (error) { console.error("[PRISMA-IA] Falha na interação por atividade:", error); }
  finally { if (spontaneousReserved) releaseSpontaneousSlot(newPresence.userId); presenceInFlight.delete(newPresence.userId); }
}

export async function handleAiInteraction(interaction: Interaction): Promise<boolean> {
  if (await handlePanelInteraction(interaction)) return true;
  if (interaction.isChatInputCommand() && interaction.commandName === "configurar-prisma") { await publishPanel(interaction); return true; }
  if (interaction.isChatInputCommand() && (interaction.commandName === "teste-ai" || interaction.commandName === "fim-teste-ai")) {
    const enabled = interaction.commandName === "teste-ai";
    await setAiTestMode(enabled, interaction.user.id);
    await interaction.reply({ content: enabled ? `modo de testes ativado, IA ${PRISMA_AI_VERSION}, canal de teste <#${config.prismaAi.testChannelId}>` : "modo de testes desativado, voltei a responder no canal principal", ephemeral: true });
    return true;
  }
  return false;
}
