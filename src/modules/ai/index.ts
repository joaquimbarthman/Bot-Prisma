import { ActivityType, type Client, type Interaction, type Message, type Presence } from "discord.js";
import { config } from "../../config.js";
import { localModeration } from "../moderation/filter.js";
import { accessLevel } from "./permissions.js";
import { publishPanel, handlePanelInteraction, refreshAiPanel } from "./panel.js";
import { generateReply, suppressUnrequestedSelfActivity, type ReplyContext } from "./provider.js";
import { SpontaneousReservationLedger } from "./spontaneous-quota.js";
import { addAbsenceOutreach, addPrismaMessage, addSpontaneous, applyPrismaStateUpdate, checkSupabaseConnection, cleanupExpired, clearPrismaThought, getPrismaState, getPrismaThought, getSettings, lastAbsenceOutreachAt, lastSpontaneousAt, listPrismaOperatorRules, recentHistory, savePrismaOperatorRule, setPrismaThought, spontaneousCountToday, updateSettings } from "./store.js";
import { canSendTestNotice, getAiRuntimeState, setAiTestMode } from "./runtime.js";
import { PRISMA_AI_VERSION } from "./version.js";
import { learnFromInteraction } from "./learning.js";
import { buildPrismaPersonalContext, determineContextNeeds } from "./context-builder.js";
import { selectTopicContext, type ChannelContextMessage } from "./topic-context.js";
import { loadPrismaBehavior } from "./behavior.js";
import { asksAboutPrismaCreator } from "./creator.js";
import { shouldRunDailySummary, summarizeCompletedConversationDays } from "./daily-summary.js";
import { asksFavoriteSongPart, researchLyrics } from "./lyrics.js";
import { analyzeSocialTreatment } from "./social-reciprocity.js";

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
  // No início, fecha somente dias anteriores: isso recupera períodos pendentes sem
  // consolidar o dia atual enquanto ele ainda recebe mensagens.
  summarizeCompletedConversationDays().catch((error) => console.error("[PRISMA-MEMÓRIA] Falha no catch-up de resumos:", error));
  const runScheduledDailySummary = () => {
    if (!shouldRunDailySummary(new Date(), "America/Sao_Paulo")) return;
    summarizeCompletedConversationDays().catch((error) => console.error("[PRISMA-MEMÓRIA] Falha ao resumir conversas:", error));
  };
  runScheduledDailySummary();
  setInterval(runScheduledDailySummary, 20_000).unref();
  setTimeout(() => sendOccasionalAbsenceMessage(client).catch(console.error), 5 * 60_000).unref();
  setInterval(() => sendOccasionalAbsenceMessage(client).catch(console.error), 60 * 60_000).unref();
  getPrismaThought(config.prismaAi.operatorUserId)
    .then((thought) => applyPrismaThought(client, thought))
    .catch((error) => console.error("[PRISMA-IA] Falha ao restaurar pensamento:", error));
}

function applyPrismaThought(client: Client, thought: string | null): void {
  client.user?.setPresence({
    activities: thought ? [{ name: thought, state: thought, type: ActivityType.Custom }] : [],
    status: "online",
  });
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
    if (Date.now() - await lastAbsenceOutreachAt(member.id) < 24 * 60 * 60_000) continue;
    if (Date.now() - await lastSpontaneousAt(member.id) < config.prismaAi.spontaneousCooldownMinutes * 60_000) continue;
    if (!await reserveSpontaneousSlot(member.id)) continue;
    try {
      const history = settings.memoryEnabled ? await recentHistory(member.id, channel.id, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
      const personalContext = await buildPrismaPersonalContext(member.id, settings, "sumiu conversa jogo música", { recentHistory: true, memories: true, channelContext: false, expandedChannelContext: false, dailySummaries: true, userProfile: true });
      const [currentThought, operatorRules] = await Promise.all([
        getPrismaThought(config.prismaAi.operatorUserId),
        listPrismaOperatorRules(config.prismaAi.operatorUserId),
      ]);
      const behavior = await loadPrismaBehavior(member.roles.cache.keys());
      const generated = await generateReply(member.id, settings, state, history, "Faz um tempo que não conversamos. Puxe assunto de forma leve.", { mode: "absence", currentAuthorName: member.displayName, currentAuthorId: member.id, learnedProfile: personalContext.learnedProfile, relevantMemories: personalContext.relevantMemories, dailySummaries: personalContext.dailySummaries, selfLearnings: personalContext.selfLearnings, emotionalState: personalContext.emotionalState, currentThought, operatorRules: operatorRules.map((item) => item.rule), behavior });
      const answer = localModeration(generated.reply).flagged ? "Cadê você? Sumiu, hein." : generated.reply;
      await channel.send({ content: `<@${member.id}> ${answer}`, allowedMentions: { parse: [], users: [member.id] } });
      await addSpontaneous(member.id);
      await addAbsenceOutreach(member.id);
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

function asksWhatPrismaIsDoing(content: string): boolean {
  const value = normalized(content);
  return /\b(?:o que|oq|que)\s+(?:(?:voce|vc)\s+)?(?:esta|ta|anda)\s+fazendo\b/.test(value)
    || /\bfazendo\s+(?:o que|oq)\b/.test(value)
    || /\b(?:voce|vc)\s+(?:esta|ta|anda)\s+(?:fazendo|jogando|ouvindo|assistindo)\b/.test(value);
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

export function operatorRuleFromMessage(content: string): string | null {
  const text = content.replace(/\s+/g, " ").trim();
  const startsWithTrigger = text.match(/^(?:prisma\s*[,!:.-]?\s*)?lembre\s+disso\b\s*[:,-]?\s*(.+)$/i);
  const endsWithTrigger = text.match(/^(.+?)\s*(?:[,;:—-]\s*|\s+)(?:prisma\s*[,!:.-]?\s*)?lembre\s+disso[.!?]*$/i);
  const instruction = (startsWithTrigger?.[1] ?? endsWithTrigger?.[1] ?? "").replace(/\s+/g, " ").trim();
  if (instruction.length < 5 || instruction.length > 350) return null;
  return instruction;
}

function needsChannelContext(message: Message): boolean {
  return /\b(?:o que .{0,40} (?:falou|disse)|que (?:ele|ela) (?:falou|disse)|mensagem (?:dele|dela)|resum(?:a|e) (?:a|essa) conversa|contexto da conversa)\b/i.test(normalized(message.content));
}

function requestsDirectMention(content: string): boolean {
  const text = normalized(content);
  return /\b(?:chama|chame|marca|marque|menciona|mencione|convida|convide|manda|mande|envia|envie|escreve|escreva|fala|fale|diz|diga|pergunta|pergunte|responde|responda|cumprimenta|cumprimente|sauda|saude|interage|interaja)\b/i.test(text)
    || /\b(?:de|da)\s+(?:um\s+)?(?:oi|ola|bom dia|boa tarde|boa noite|boas?\s+vindas?)\b/i.test(text)
    || /\b(?:puxa|puxe|inicia|inicie|comeca|comece)\b.{0,45}\b(?:assunto|conversa|papo)\b.{0,45}\b(?:com|pro|pra|para)\b/i.test(text)
    || /\b(?:conversa|fale|fala|interage|interaja)\s+(?:ai\s+)?(?:com|pro|pra)\b/i.test(text);
}

function requestsContextualMention(content: string): boolean {
  if (!/<@!?\d+>/.test(content)) return false;
  const text = normalized(content);
  return /\b(?:o que|oq|qual|como)\b.{0,100}\b(?:acha|achou|opin(?:a|i)|pensa|pensou|avalia|avaliou)\b/i.test(text)
    || /\b(?:acha|achou|opin(?:a|i)|pensa|pensou|avalia|avaliou|concorda|discorda)\b.{0,120}\b(?:disse|falou|comentou|mandou|assunto|ideia|opiniao)\b/i.test(text)
    || /\b(?:sobre|do|da)\b.{0,80}<@!?\d+>.{0,80}\b(?:disse|falou|comentou|mandou)\b/i.test(content);
}

function requestedPlainUsernames(content: string): string[] {
  if (!requestsDirectMention(content)) return [];
  return [...content.matchAll(/(?:^|[^<\w])@([a-z0-9_.]{2,32})/gi)]
    .map((match) => match[1])
    .filter((name) => !/^(?:everyone|here)$/i.test(name))
    .filter((name, index, values) => values.indexOf(name) === index)
    .slice(0, 3);
}

function requestedRecipientUsernames(content: string): string[] {
  if (!requestsDirectMention(content)) return [];
  return [...content.matchAll(/\b(?:para|pra)\s+\*{0,2}@?([a-z0-9_.]{2,32})/gi)]
    .map((match) => match[1])
    .filter((name, index, values) => values.indexOf(name) === index)
    .slice(0, 3);
}

export function includeRequestedRecipient(answer: string, recipient: string | undefined, recipientName?: string): string {
  if (!recipient) return answer;
  const hasRecipient = answer.includes(recipient) || (!!recipientName && answer.toLocaleLowerCase("pt-BR").includes(recipientName.toLocaleLowerCase("pt-BR")));
  if (hasRecipient) return answer;
  const greeting = /^(oi+|eai|ol[aá])\b[,!]?\s*/i;
  return greeting.test(answer)
    ? answer.replace(greeting, (value) => `${value}${recipient}, `)
    : `${recipient}, ${answer}`;
}

export type CurrentTurnContext = {
  speakerId: string;
  speakerName: string;
  explicitlyMentionedUserIds: string[];
  allowedMentionIds: string[];
  replyToUserId?: string;
  replyToMessageId?: string;
};

export function createCurrentTurnContext(speakerId: string, speakerName: string, mentionedIds: Iterable<string>, botId?: string, replyToMessageId?: string): CurrentTurnContext {
  const allowedMentionIds = allowedMentionIdsForMessage(mentionedIds, botId);
  const safeSpeakerName = speakerName.replace(/[@<>`#\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "usuário atual";
  return { speakerId, speakerName: safeSpeakerName, explicitlyMentionedUserIds: [...allowedMentionIds], allowedMentionIds: [...allowedMentionIds], replyToMessageId };
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
    .filter((userId) => userId !== botId && userId !== authorId);
}

export function contextUserIdsForNames(channelExcerpt?: string): string[] {
  if (!channelExcerpt) return [];
  return [...new Set([...channelExcerpt.matchAll(/\[autor_id=(\d{1,25})\]/g)].map((match) => match[1]))].slice(0, 25);
}

export function allowedMentionIdsForMessage(mentionedIds: Iterable<string>, botId?: string): string[] {
  return [...new Set(mentionedIds)]
    .filter((id) => /^\d{1,25}$/.test(id) && id !== botId)
    .slice(0, 25);
}

async function resolveRequestedMentions(message: Message, requestedIds: string[]): Promise<{ allowedMentionUserIds: string[]; unmentionableUsers: Array<{ id: string; username: string }> }> {
  const allowedMentionUserIds: string[] = [];
  const unmentionableUsers: Array<{ id: string; username: string }> = [];
  for (const userId of requestedIds) {
    const member = message.guild?.members.cache.get(userId) ?? await message.guild?.members.fetch(userId).catch(() => null);
    const username = member?.user.username ?? message.mentions.users.get(userId)?.username ?? "essa pessoa";
    if (member && !member.user.bot) allowedMentionUserIds.push(userId);
    else unmentionableUsers.push({ id: userId, username });
  }
  return { allowedMentionUserIds, unmentionableUsers };
}

async function resolveContextUserNames(message: Message, userIds: string[]): Promise<Array<{ id: string; username: string }>> {
  const users: Array<{ id: string; username: string }> = [];
  for (const userId of userIds.slice(0, 25)) {
    const member = message.guild?.members.cache.get(userId) ?? await message.guild?.members.fetch(userId).catch(() => null);
    if (member) users.push({ id: userId, username: member.displayName || member.user.username });
  }
  return users;
}

async function topicAwareChannelContext(message: Message, limit: number): Promise<string> {
  const collected: Message[] = [];
  let before = message.id;
  for (const pageLimit of channelFetchPageSizes(limit)) {
    const page = await message.channel.messages.fetch({ limit: pageLimit, before }).catch(() => null);
    if (!page?.size) break;
    const values = [...page.values()];
    collected.push(...values);
    before = values.at(-1)?.id ?? before;
    if (values.length < pageLimit) break;
  }
  if (message.reference?.messageId && !collected.some((item) => item.id === message.reference?.messageId)) {
    const referenced = await message.fetchReference().catch(() => null);
    if (referenced) collected.push(referenced);
  }
  const records: ChannelContextMessage[] = collected.map((item) => ({
    id: item.id,
    authorId: item.author.id,
    authorName: item.member?.displayName ?? item.author.username,
    content: item.cleanContent,
    createdAt: item.createdTimestamp,
    replyToId: item.reference?.messageId,
  }));
  return selectTopicContext(records, message.cleanContent, message.reference?.messageId);
}

export function channelFetchPageSizes(limit: number): number[] {
  const pages: number[] = [];
  let remaining = Math.max(0, Math.floor(limit));
  while (remaining > 0) { const size = Math.min(remaining, 100); pages.push(size); remaining -= size; }
  return pages;
}

async function temporaryConversationHistory(message: Message, botId?: string): Promise<import("./store.js").HistoryItem[]> {
  if (!botId) return [];
  const fetched = await message.channel.messages.fetch({ limit: Math.min(config.prismaAi.historyMaxMessages, 12), before: message.id }).catch(() => null);
  if (!fetched) return [];
  return temporaryHistoryFromMessages([...fetched.values()].map((item) => ({ authorId: item.author.id, content: item.cleanContent, createdAt: item.createdAt })), message.author.id, botId, message.channelId);
}

export function temporaryHistoryFromMessages(messages: Array<{ authorId: string; content: string; createdAt: Date }>, userId: string, botId: string, channelId: string): import("./store.js").HistoryItem[] {
  return messages.filter((item) => item.authorId === userId || item.authorId === botId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-12)
    .map((item) => ({ discordId: userId, channelId, role: item.authorId === botId ? "assistant" as const : "user" as const, content: item.content, createdAt: item.createdAt.toISOString() }));
}

async function recentChannelContext(message: Message): Promise<string> { return topicAwareChannelContext(message, config.prismaAi.channelHistoryLimit); }
async function expandedChannelContext(message: Message): Promise<string> { return topicAwareChannelContext(message, config.prismaAi.channelHistoryExpandedLimit); }

async function isDirectedAtBot(message: Message, client: Client): Promise<boolean> {
  return !!client.user && (message.mentions.users.has(client.user.id) || /\bprisma\b/i.test(message.content) || await isReplyToBot(message, client));
}

export async function handleAiMessage(client: Client, message: Message): Promise<boolean> {
  if (!config.prismaAi.enabled || !config.prismaAi.generalChannelId || !message.inGuild() || !message.member || !message.content || ![config.prismaAi.generalChannelId, config.prismaAi.testChannelId].includes(message.channelId)) return false;
  const addressedToPrisma = await isDirectedAtBot(message, client);
  const operatorRuleCommand = message.author.id === config.prismaAi.operatorUserId ? operatorRuleFromMessage(message.content) : null;
  const runtime = await getAiRuntimeState();
  if (runtime.testModeEnabled && message.channelId === config.prismaAi.generalChannelId && !operatorRuleCommand) {
    if (!addressedToPrisma) return false;
    if (canSendTestNotice(message.author.id, config.prismaAi.testNoticeCooldownSeconds * 1000)) await message.reply({ content: "O prisma está atualmente sendo testado, logo ele volta pra conversar com você!", allowedMentions: { repliedUser: false } });
    return true;
  }
  const level = accessLevel(message.member);
  const direct = asksAboutActivity(message.content) || addressedToPrisma || !!operatorRuleCommand;
  const botInsult = direct && isDirectBotInsult(message.content, client.user?.id);
  if (level === "none" && !operatorRuleCommand) {
    if (direct) {
      const notice = await message.reply({ content: `Para conversar com a Prisma, você deve ser <@&${config.prismaAi.boosterRoleId}>.`, allowedMentions: { parse: [], roles: [] } });
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
    if (operatorRuleCommand) {
      const saved = await savePrismaOperatorRule(message.author.id, operatorRuleCommand);
      const confirmation = await message.reply({
        content: saved ? `Regra salva exatamente como definida: ${operatorRuleCommand}` : "Essa regra já está salva.",
        allowedMentions: { repliedUser: false },
      });
      setTimeout(() => confirmation.delete().catch(() => undefined), 10_000).unref();
      if (saved) setTimeout(() => message.delete().catch(() => undefined), 10_000).unref();
      return true;
    }
    const preferredNickname = requestedNickname(message.content);
    if (preferredNickname && preferredNickname !== settings.nickname) {
      try { settings = await updateSettings(message.author.id, { nickname: preferredNickname }); }
      catch (error) { console.error("[PRISMA-IA] Não foi possível persistir o apelido; continuando sem bloquear a resposta:", error); }
    }
    const content = message.content.replace(client.user ? new RegExp(`<@!?${client.user.id}>`, "g") : /$^/, "").trim() || "Olá!";
    const currentTurn = createCurrentTurnContext(message.author.id, message.member.displayName, message.mentions.users.keys(), client.user?.id, message.reference?.messageId);
    const prismaState = await getPrismaState(message.author.id);
    const socialTreatment = analyzeSocialTreatment(content, prismaState.relationship.attitudeScore);
    const contextNeeds = determineContextNeeds(content, { hasReply: !!message.reference?.messageId, mentionsOtherUser: message.mentions.users.some((user) => user.id !== client.user?.id && user.id !== message.author.id) });
    const { learnedProfile, relevantMemories, emotionalState, dailySummaries, selfLearnings } = await buildPrismaPersonalContext(message.author.id, settings, content, contextNeeds);
    const history = settings.memoryEnabled
      ? await recentHistory(message.author.id, message.channelId, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars)
      : await temporaryConversationHistory(message, client.user?.id);
    const currentPresence = message.guild?.presences.cache.get(message.author.id) ?? message.member.presence;
    const currentActivity = currentPresence ? publicActivity(currentPresence) : null;
    const [currentThought, operatorRules] = await Promise.all([
      getPrismaThought(config.prismaAi.operatorUserId),
      listPrismaOperatorRules(config.prismaAi.operatorUserId),
    ]);
    const replyContext: ReplyContext = {
      mode: socialTreatment.hostilityLevel > 0 || botInsult ? "light_roast" : spontaneous ? "spontaneous" : "direct",
      currentAuthorName: currentTurn.speakerName,
      currentAuthorId: currentTurn.speakerId,
      currentTurn,
      learnedProfile,
      relevantMemories,
      dailySummaries,
      selfLearnings,
      emotionalState,
      operatorRules: operatorRules.map((item) => item.rule),
      currentThought,
      socialTreatment,
      behavior: await loadPrismaBehavior(message.member.roles.cache.keys()),
    };
    if (asksAboutPrismaCreator(content)) {
      const creatorId = config.prismaAi.creatorUserId;
      const creatorUser = client.users.cache.get(creatorId) ?? await client.users.fetch(creatorId).catch(() => null);
      const creatorName = creatorUser?.username.replace(/[^\p{L}\p{N}_. -]/gu, "").trim().slice(0, 40) || null;
      replyContext.creatorIdentity = { id: creatorId, username: creatorName };
    }
    const referencedMessage = message.reference?.messageId ? await message.fetchReference().catch(() => null) : null;
    if (asksFavoriteSongPart(content, history)) {
      replyContext.lyricsResearchAttempted = true;
      replyContext.lyricsResearch = await researchLyrics(
        content,
        history,
        fetch,
        [referencedMessage?.cleanContent, currentActivity?.description].filter((value): value is string => !!value),
      );
    }
    const mentionNeedsChannel = requestsDirectMention(content) && /\b(?:ele|ela|esse|essa|dele|dela)\b/iu.test(content);
    if (contextNeeds.channelContext || needsChannelContext(message) || mentionNeedsChannel) {
      let channelContext = await recentChannelContext(message);
      if (contextNeeds.expandedChannelContext) channelContext = await expandedChannelContext(message) || channelContext;
      if (channelContext) replyContext.channelExcerpt = channelContext;
    }
    const referencedAuthorId = referencedMessage?.author.id;
    currentTurn.replyToUserId = referencedAuthorId;
    // Criada do zero para a mensagem atual e descartada ao fim desta resposta.
    const currentMessageMentionIds = currentTurn.allowedMentionIds;
    const requestedMentionUserIds = explicitlyRequestedMentionUserIds(content, message.mentions.users.keys(), client.user?.id, message.author.id);
    const { allowedMentionUserIds, unmentionableUsers: unavailableCurrentMentions } = await resolveRequestedMentions(message, currentMessageMentionIds);
    const requestedResolution = await resolveRequestedMentions(message, requestedMentionUserIds);
    const contextUserIds = [...new Set([...contextUserIdsForNames(replyContext.channelExcerpt), ...(referencedAuthorId ? [referencedAuthorId] : [])])]
      .filter((id) => id !== client.user?.id && !allowedMentionUserIds.includes(id));
    const contextUsersForNames = await resolveContextUserNames(message, contextUserIds);
    const unmentionableUsers = [...new Map([...unavailableCurrentMentions, ...requestedResolution.unmentionableUsers, ...contextUsersForNames].map((user) => [user.id, user])).values()];
    const recipientUsernames = requestedRecipientUsernames(message.cleanContent);
    const fallbackUsernames = [...new Set([
      ...requestedPlainUsernames(content),
      ...(unmentionableUsers.length || requestedMentionUserIds.length === 0 ? recipientUsernames : []),
    ])];
    if (requestsDirectMention(content)) {
      console.log(`[PRISMA-IA] Menções de usuário autorizadas para ${message.author.id}: ${allowedMentionUserIds.join(", ") || "nenhuma"}.`);
    }
    if (allowedMentionUserIds.length) replyContext.allowedMentionUserIds = allowedMentionUserIds;
    if (unmentionableUsers.length) replyContext.unmentionableUsers = unmentionableUsers;
    if (fallbackUsernames.length) replyContext.fallbackUsernames = fallbackUsernames;
    if (asksAboutActivity(content)) {
      replyContext.activityDescription = currentActivity?.description ?? "Nenhuma atividade pública está visível agora.";
    }
    const generated = await generateReply(message.author.id, settings, prismaState, history, content, replyContext);
    let answer = suppressUnrequestedSelfActivity(generated.reply, asksWhatPrismaIsDoing(content)) || "entendi.";
    if (!answer) throw new Error("Resposta vazia.");
    if (requestsDirectMention(content)) {
      const unavailableRecipient = requestedResolution.unmentionableUsers[0]?.username;
      const mentionableRecipientId = requestedMentionUserIds.find((id) => allowedMentionUserIds.includes(id));
      const recipient = unavailableRecipient ?? (mentionableRecipientId ? `<@${mentionableRecipientId}>` : recipientUsernames[0]);
      answer = includeRequestedRecipient(answer, recipient, recipientUsernames[0]);
    }
    const unsafeOutput = localModeration(answer).flagged;
    if (unsafeOutput) {
      console.warn("[PRISMA-IA] Saída bloqueada pelo filtro determinístico.");
      answer = "Não vou seguir por esse caminho. Vamos manter a conversa de boa.";
    }
    // Interações espontâneas precisam identificar e notificar o destinatário.
    // Em respostas diretas, o reply do Discord já fornece o contexto sem pingar a pessoa.
    const prefix = spontaneous ? `<@${message.author.id}> ` : "";
    const replyMentionUserIds = [...new Set([
      ...(spontaneous ? [message.author.id] : []),
      ...allowedMentionUserIds,
    ])];
    const sent = await message.reply({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: replyMentionUserIds, roles: [], repliedUser: false } });
    // A autorização pertence a uma única resposta; descarte explícito após o envio.
    allowedMentionUserIds.length = 0;
    replyContext.allowedMentionUserIds = [];
    try {
      if (!spontaneous && !unsafeOutput) await applyPrismaStateUpdate(message.author.id, prismaState, { ...generated.stateUpdate, attitudeDelta: socialTreatment.relationshipDelta });
      if (settings.memoryEnabled && (await getSettings(message.author.id)).memoryEnabled) {
        await addPrismaMessage({ messageId: message.id, guildId: message.guildId, channelId: message.channelId, userId: message.author.id, content, authorIsPrisma: false, replyToMessageId: message.reference?.messageId ?? null, createdAt: message.createdAt.toISOString() });
        await addPrismaMessage({ messageId: sent.id, guildId: message.guildId, channelId: message.channelId, userId: message.author.id, content: answer, authorIsPrisma: true, replyToMessageId: message.id, createdAt: sent.createdAt.toISOString() });
        void learnFromInteraction({ userId: message.author.id, guildId: message.guildId, displayName: message.member.displayName, content, reply: answer, messageId: message.id, previousAssistantMessage: [...history].reverse().find((item) => item.role === "assistant")?.content, aiMemoryCandidates: generated.memoryCandidates, aiEmotionalUpdate: generated.emotionalUpdate });
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
    const personalContext = await buildPrismaPersonalContext(newPresence.userId, settings, activity.description, { recentHistory: true, memories: true, channelContext: false, expandedChannelContext: false, dailySummaries: true, userProfile: true });
    const [currentThought, operatorRules] = await Promise.all([
      getPrismaThought(config.prismaAi.operatorUserId),
      listPrismaOperatorRules(config.prismaAi.operatorUserId),
    ]);
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
        learnedProfile: personalContext.learnedProfile,
        relevantMemories: personalContext.relevantMemories,
        dailySummaries: personalContext.dailySummaries,
        selfLearnings: personalContext.selfLearnings,
        emotionalState: personalContext.emotionalState,
        currentThought,
        operatorRules: operatorRules.map((item) => item.rule),
        behavior: await loadPrismaBehavior(newPresence.member.roles.cache.keys()),
      },
    );
    const answer = localModeration(generated.reply).flagged
      ? "Não vou seguir por esse caminho. Vamos manter a conversa de boa."
      : generated.reply;
    await channel.send({ content: `<@${newPresence.userId}> ${answer}`, allowedMentions: { parse: [], users: [newPresence.userId] } });
    await addSpontaneous(newPresence.userId);
  } catch (error) { console.error("[PRISMA-IA] Falha na interação por atividade:", error); }
  finally { if (spontaneousReserved) releaseSpontaneousSlot(newPresence.userId); presenceInFlight.delete(newPresence.userId); }
}

export async function handleAiInteraction(interaction: Interaction): Promise<boolean> {
  if (await handlePanelInteraction(interaction)) return true;
  if (interaction.isChatInputCommand() && (interaction.commandName === "set-pensamento" || interaction.commandName === "clear-pensamento")) {
    if (interaction.user.id !== config.prismaAi.operatorUserId) {
      await interaction.reply({ content: "Somente o operador da Prisma pode usar este comando.", flags: ["Ephemeral"] });
      return true;
    }
    if (interaction.commandName === "set-pensamento") {
      const thought = await setPrismaThought(interaction.user.id, interaction.options.getString("texto", true));
      applyPrismaThought(interaction.client, thought);
      await interaction.reply({ content: `Pensamento definido: “${thought}”`, flags: ["Ephemeral"] });
    } else {
      await clearPrismaThought(interaction.user.id);
      applyPrismaThought(interaction.client, null);
      await interaction.reply({ content: "Pensamento apagado.", flags: ["Ephemeral"] });
    }
    return true;
  }
  if (interaction.isChatInputCommand() && interaction.commandName === "configurar-prisma") { await publishPanel(interaction); return true; }
  if (interaction.isChatInputCommand() && (interaction.commandName === "teste-ai" || interaction.commandName === "fim-teste-ai")) {
    const enabled = interaction.commandName === "teste-ai";
    await setAiTestMode(enabled, interaction.user.id);
    await interaction.reply({ content: enabled ? `modo de testes ativado, IA ${PRISMA_AI_VERSION}, canal de teste <#${config.prismaAi.testChannelId}>` : "modo de testes desativado, voltei a responder no canal principal", flags: ["Ephemeral"] });
    return true;
  }
  return false;
}
