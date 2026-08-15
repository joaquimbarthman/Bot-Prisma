import type { Client, Interaction, Message } from "discord.js";
import { config } from "../../config.js";
import { accessLevel } from "./permissions.js";
import { publishPanel, handlePanelInteraction } from "./panel.js";
import { generateReply } from "./provider.js";
import { addHistory, addSpontaneous, checkSupabaseConnection, cleanupExpired, getSettings, lastSpontaneousAt, recentHistory, spontaneousCountToday } from "./store.js";

const cooldowns = new Map<string, number>();
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

export async function handleAiInteraction(interaction: Interaction): Promise<boolean> {
  if (await handlePanelInteraction(interaction)) return true;
  if (interaction.isChatInputCommand() && interaction.commandName === "configurar-prisma") { await publishPanel(interaction); return true; }
  return false;
}
