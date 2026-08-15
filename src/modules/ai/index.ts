import { ActivityType, type Client, type Interaction, type Message, type Presence } from "discord.js";
import { config } from "../../config.js";
import { accessLevel } from "./permissions.js";
import { publishPanel, handlePanelInteraction } from "./panel.js";
import { generateReply } from "./provider.js";
import { addHistory, addSpontaneous, checkSupabaseConnection, cleanupExpired, getSettings, lastSpontaneousAt, recentHistory, spontaneousCountToday } from "./store.js";

const cooldowns = new Map<string, number>();
const presenceInFlight = new Set<string>();
const presenceSignatures = new Map<string, string>();
export function startAiCleanup(): void {
  checkSupabaseConnection().catch((error) => console.error("[SUPABASE] Falha no teste de conexão:", error));
  cleanupExpired().catch(console.error);
  setInterval(() => cleanupExpired().catch(console.error), 60 * 60_000).unref();
}

async function isReplyToBot(message: Message, client: Client): Promise<boolean> {
  if (!message.reference?.messageId) return false;
  const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
  return referenced?.author.id === client.user?.id;
}

export async function handleAiMessage(client: Client, message: Message): Promise<boolean> {
  if (!config.prismaAi.enabled || !config.prismaAi.generalChannelId || message.channelId !== config.prismaAi.generalChannelId || !message.inGuild() || !message.member || !message.content) return false;
  const level = accessLevel(message.member);
  const direct = !!client.user && (message.mentions.users.has(client.user.id) || await isReplyToBot(message, client));
  if (level === "none") { if (direct) await message.reply({ content: "A Prisma IA é exclusiva para Boosters e Amigos do Chefe.", allowedMentions: { repliedUser: false } }); return direct; }

  const settings = await getSettings(message.author.id);
  let spontaneous = false;
  if (!direct) {
    if (!settings.spontaneousInteractions || Math.random() * 100 >= config.prismaAi.spontaneousChancePercent) return false;
    if (await spontaneousCountToday(message.author.id, config.prismaAi.timezone) >= config.prismaAi.dailySpontaneousLimit) return false;
    if (Date.now() - await lastSpontaneousAt(message.author.id) < config.prismaAi.spontaneousCooldownMinutes * 60_000) return false;
    spontaneous = true;
  }
  const last = cooldowns.get(message.author.id) ?? 0;
  if (!spontaneous && Date.now() - last < config.prismaAi.userCooldownSeconds * 1000) { await message.reply({ content: "Espere alguns segundos antes de falar comigo novamente.", allowedMentions: { repliedUser: false } }); return true; }
  cooldowns.set(message.author.id, Date.now());

  try {
    await message.channel.sendTyping();
    const history = settings.memoryEnabled ? await recentHistory(message.author.id, message.channelId, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
    const content = message.content.replace(client.user ? new RegExp(`<@!?${client.user.id}>`, "g") : /$^/, "").trim() || "Olá!";
    const answer = await generateReply(message.author.id, settings, history, spontaneous ? `Inicie uma conversa breve relacionada a esta mensagem do usuário: ${content}` : content);
    if (!answer) throw new Error("Resposta vazia.");
    const prefix = settings.allowMentions ? `<@${message.author.id}> ` : "";
    await message.reply({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: settings.allowMentions ? [message.author.id] : [], repliedUser: false } });
    if (settings.memoryEnabled) { const now = new Date().toISOString(); await addHistory({ discordId: message.author.id, channelId: message.channelId, role: "user", content, createdAt: now }); await addHistory({ discordId: message.author.id, channelId: message.channelId, role: "assistant", content: answer, createdAt: now }); }
    if (spontaneous) await addSpontaneous(message.author.id);
  } catch (error) { console.error("[PRISMA-IA] Falha controlada:", error); if (direct) await message.reply({ content: "Não consegui responder agora. Tente novamente mais tarde.", allowedMentions: { repliedUser: false } }); }
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
  try {
    const settings = await getSettings(newPresence.userId);
    if (!settings.spontaneousInteractions) return;
    if (await spontaneousCountToday(newPresence.userId, config.prismaAi.timezone) >= config.prismaAi.dailySpontaneousLimit) return;
    if (Date.now() - await lastSpontaneousAt(newPresence.userId) < config.prismaAi.spontaneousCooldownMinutes * 60_000) return;
    const channel = await client.channels.fetch(config.prismaAi.generalChannelId).catch(() => null);
    if (!channel?.isSendable()) return;
    const history = settings.memoryEnabled ? await recentHistory(newPresence.userId, channel.id, config.prismaAi.historyMaxMessages, config.prismaAi.historyMaxChars) : [];
    const answer = await generateReply(newPresence.userId, settings, history, `A atividade pública do Discord mostra que o usuário está ${activity.description}. Faça um comentário espontâneo, natural e simpático sobre isso, sem dizer que está monitorando a pessoa e sem ultrapassar 50 palavras.`);
    const prefix = settings.allowMentions ? `<@${newPresence.userId}> ` : "";
    await channel.send({ content: `${prefix}${answer}`, allowedMentions: { parse: [], users: settings.allowMentions ? [newPresence.userId] : [] } });
    await addSpontaneous(newPresence.userId);
  } catch (error) { console.error("[PRISMA-IA] Falha na interação por atividade:", error); }
  finally { presenceInFlight.delete(newPresence.userId); }
}

export async function handleAiInteraction(interaction: Interaction): Promise<boolean> {
  if (await handlePanelInteraction(interaction)) return true;
  if (interaction.isChatInputCommand() && interaction.commandName === "configurar-prisma") { await publishPanel(interaction); return true; }
  return false;
}
