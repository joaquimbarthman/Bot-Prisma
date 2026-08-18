import { ActivityType, type Client, type Interaction, type Message, type Presence } from "discord.js";
import { config } from "../../config.js";
import { localModeration } from "../../filter.js";
import { accessLevel } from "./permissions.js";
import { publishPanel, handlePanelInteraction, refreshAiPanel } from "./panel.js";
import { generateReply, type ReplyContext } from "./provider.js";
import { SpontaneousReservationLedger } from "./spontaneous-quota.js";
import { addHistoryTurn, addSpontaneous, applyPrismaStateUpdate, captureHistoryRevision, checkSupabaseConnection, cleanupExpired, getPrismaState, getSettings, lastSpontaneousAt, recentHistory, spontaneousCountToday, updateSettings } from "./store.js";

const cooldowns = new Map<string, number>();
const presenceInFlight = new Set<string>();
const presenceSignatures = new Map<string, string>();
const spontaneousReservations = new SpontaneousReservationLedger();

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
  return /\b(?:o que|oq|que)\s+(?:eu\s+)?(?:estou|to)\s+(?:fazendo|jogando|ouvindo|escutando)|\bqual\s+(?:jogo|musica)\b/.test(normalized(content));
}

function isDirectBotInsult(content: string, botId?: string): boolean {
  let value = normalized(content).replace(botId ? new RegExp(`<@!?${botId}>`, "g") : /$^/, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const insult = "(?:burro|burra|idiota|inutil|lerdo|lerda|lixo|otario|otaria|fracassado|fracassada|chato|chata|horrivel|ruim|bosta)";
  return new RegExp(`^(?:seu|sua)?\\s*${insult}$|\\b(?:prisma|voce|vc|tu)\\s+(?:(?:e|eh|ta)\\s+)?(?:um|uma)?\\s*(?:seu|sua)?\\s*${insult}\\b`).test(value);
}

function requestedNickname(content: string): string | null {
  const match = content.match(/(?:quero\s+(?:que\s+)?(?:você|voce|vc)\s+me\s+cham(?:e|ando)\s+de|me\s+cham(?:a|e)\s+de)\s+["']?([^\n.!?]{2,32})["']?/i);
  const nickname = match?.[1]?.trim();
  return nickname && !/@(?:everyone|here)|<@|https?:\/\//i.test(nickname) ? nickname : null;
}

function needsChannelContext(message: Message): boolean {
  return /\b(?:o que .{0,40} (?:falou|disse)|que (?:ele|ela) (?:falou|disse)|mensagem (?:dele|dela)|resum(?:a|e) (?:a|essa) conversa|contexto da conversa)\b/i.test(normalized(message.content));
}

function requestsDirectMention(content: string): boolean {
  return /\b(?:chama|chame|marca|marque|menciona|mencione|convida|convide|manda|mande|envia|envie|escreve|escreva|fala|fale|diz|diga|responde|responda)\b/i.test(normalized(content));
}

export function explicitlyRequestedMentionUserIds(
  content: string,
  mentionedUserIds: Iterable<string>,
  botId?: string,
  authorId?: string,
): string[] {
  if (!requestsDirectMention(content)) return [];
  const rawMentionIds = [...content.matchAll(/<@!?(\d{1,25})>/g)].map((match) => match[1]);
  return [...new Set([...mentionedUserIds, ...rawMentionIds])]
    .filter((userId) => userId !== botId && userId !== authorId)
    .slice(0, 3);
}

async function recentChannelContext(message: Message): Promise<string> {
  const messages = await message.channel.messages.fetch({ limit: 12, before: message.id }).catch(() => null);
  if (!messages) return "";
  const cutoff = Date.now() - 48 * 60 * 60_000;
  const lines = [...messages.values()].reverse()
    .filter((item) => item.createdTimestamp >= cutoff && item.content.trim())
    .map((item) => `${item.member?.displayName ?? item.author.username}: ${item.cleanContent.replace(/\s+/g, " ").slice(0, 280)}`);
  while (lines.join("\n").length > 1_800) lines.shift();
  return lines.join("\n");
}

async function isDirectedAtBot(message: Message, client: Client): Promise<boolean> {
  return !!client.user && (message.mentions.users.has(client.user.id) || /\bprisma\b/i.test(message.content) || await isReplyToBot(message, client));
}

export async function handleAiMessage(client: Client, message: Message): Promise<boolean> {
  if (!config.prismaAi.enabled || !config.prismaAi.generalChannelId || message.channelId !== config.prismaAi.generalChannelId || !message.inGuild() || !message.member || !message.content) return false;
  const level = accessLevel(message.member);
  const direct = asksAboutActivity(message.content) || await isDirectedAtBot(message, client);
  const botInsult = direct && isDirectBotInsult(message.content, client.user?.id);
  if (level === "none") {
    if (direct) {
      const notice = await message.reply({ content: `A Prisma IA é exclusiva para membros com o cargo <@&${config.prismaAi.accessRoleId}>.`, allowedMentions: { parse: [], roles: [] } });
      setTimeout(() => notice.delete().catch(() => undefined), 10_000).unref();
    }
    return direct;
  }

  let settings = await getSettings(message.author.id);
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
    const prismaState = await getPrismaState(message.author.id);
    const history = settings.memoryEnabled ? await recentHistory(message.author.id, message.channelId, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
    const content = message.content.replace(client.user ? new RegExp(`<@!?${client.user.id}>`, "g") : /$^/, "").trim() || "Olá!";
    const currentActivity = message.member.presence ? publicActivity(message.member.presence) : null;
    const replyContext: ReplyContext = {
      mode: botInsult ? "light_roast" : spontaneous ? "spontaneous" : "direct",
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
    if (needsChannelContext(message)) {
      const channelContext = await recentChannelContext(message);
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
    const prefix = settings.allowMentions ? `<@${message.author.id}> ` : "";
    const replyMentionUserIds = [...new Set([
      ...(settings.allowMentions ? [message.author.id] : []),
      ...allowedMentionUserIds,
    ])];
    await message.reply({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: replyMentionUserIds, repliedUser: false } });
    try {
      if (!spontaneous) await applyPrismaStateUpdate(message.author.id, prismaState, unsafeOutput ? {} : generated.stateUpdate);
      if (settings.memoryEnabled && (await getSettings(message.author.id)).memoryEnabled) {
        const now = new Date().toISOString();
        await addHistoryTurn([
          { discordId: message.author.id, channelId: message.channelId, role: "user", content, createdAt: now },
          { discordId: message.author.id, channelId: message.channelId, role: "assistant", content: answer, createdAt: now },
        ], historyRevision);
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
        activityDescription: activity.description,
      },
    );
    const answer = localModeration(generated.reply).flagged
      ? "Não vou seguir por esse caminho. Vamos manter a conversa de boa."
      : generated.reply;
    const prefix = settings.allowMentions ? `<@${newPresence.userId}> ` : "";
    await channel.send({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: settings.allowMentions ? [newPresence.userId] : [] } });
    await addSpontaneous(newPresence.userId);
  } catch (error) { console.error("[PRISMA-IA] Falha na interação por atividade:", error); }
  finally { if (spontaneousReserved) releaseSpontaneousSlot(newPresence.userId); presenceInFlight.delete(newPresence.userId); }
}

export async function handleAiInteraction(interaction: Interaction): Promise<boolean> {
  if (await handlePanelInteraction(interaction)) return true;
  if (interaction.isChatInputCommand() && interaction.commandName === "configurar-prisma") { await publishPanel(interaction); return true; }
  return false;
}
