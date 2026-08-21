import type { Client, Message, TextBasedChannel } from "discord.js";
import { config } from "../../config.js";

type BumpEvidence = {
  content: string;
  createdTimestamp: number;
  author: { id: string; bot: boolean };
  embeds: ReadonlyArray<{ title?: string | null; description?: string | null }>;
  interactionMetadata?: unknown;
  interaction?: { commandName?: string } | null;
};

let reminderTimer: NodeJS.Timeout | null = null;
let scheduledBumpAt = 0;
let notifiedBumpAt = 0;

export function bumpReminderContent(roleId = config.bumpReminder.moderationRoleId): string {
  return `<@&${roleId}> Já está na hora de usar o /bump neste canal.`;
}

export function isBumpMessage(message: BumpEvidence): boolean {
  const metadata = message.interactionMetadata as { name?: unknown; commandName?: unknown } | null | undefined;
  const metadataCommand = typeof metadata?.name === "string" ? metadata.name : typeof metadata?.commandName === "string" ? metadata.commandName : undefined;
  const commandName = metadataCommand ?? message.interaction?.commandName;
  if (commandName?.toLowerCase() === "bump") return true;
  if (!message.author.bot) return /(^|\s)\/bump(?:\s|$)/i.test(message.content);
  if (message.author.id !== config.bumpReminder.sourceBotId) return false;
  const botText = [message.content, ...message.embeds.flatMap((embed) => [embed.title ?? "", embed.description ?? ""])].join(" ");
  return /\bbump(?:ed)?\s+done\b/i.test(botText);
}

async function sendBumpReminder(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.bumpReminder.channelId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) {
    console.error(`[BUMP] Canal ${config.bumpReminder.channelId} não encontrado ou não permite mensagens.`);
    return;
  }
  await channel.send({ content: bumpReminderContent(), allowedMentions: { parse: [], roles: [config.bumpReminder.moderationRoleId] } });
}

function scheduleBumpReminder(client: Client, bumpAt: number): void {
  if (bumpAt <= scheduledBumpAt || bumpAt <= notifiedBumpAt) return;
  scheduledBumpAt = bumpAt;
  if (reminderTimer) clearTimeout(reminderTimer);
  const dueAt = bumpAt + config.bumpReminder.intervalHours * 60 * 60_000;
  reminderTimer = setTimeout(() => {
    reminderTimer = null;
    if (scheduledBumpAt !== bumpAt || notifiedBumpAt >= bumpAt) return;
    sendBumpReminder(client).then(() => { notifiedBumpAt = bumpAt; }).catch((error) => console.error("[BUMP] Falha ao enviar lembrete:", error));
  }, Math.max(0, dueAt - Date.now()));
  reminderTimer.unref();
  console.log(`[BUMP] Último bump em ${new Date(bumpAt).toISOString()}; lembrete agendado para ${new Date(dueAt).toISOString()}.`);
}

async function findLatestBump(channel: TextBasedChannel): Promise<number | null> {
  let before: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const messages = await channel.messages.fetch({ limit: 100, before });
    const bumps = [...messages.values()].filter((message) => isBumpMessage(message));
    if (bumps.length) return Math.max(...bumps.map((message) => message.createdTimestamp));
    const oldest = [...messages.values()].at(-1);
    if (!oldest || messages.size < 100) break;
    before = oldest.id;
  }
  return null;
}

export async function handleBumpMessage(client: Client, message: Message): Promise<void> {
  if (message.channelId !== config.bumpReminder.channelId || message.author.id === client.user?.id || !isBumpMessage(message)) return;
  scheduleBumpReminder(client, message.createdTimestamp);
}

export function startBumpReminder(client: Client): void {
  void (async () => {
    const channel = await client.channels.fetch(config.bumpReminder.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      console.error(`[BUMP] Canal ${config.bumpReminder.channelId} não encontrado ou não é texto.`);
      return;
    }
    const latestBump = await findLatestBump(channel);
    if (!latestBump) {
      console.log(`[BUMP] Nenhum /bump recente encontrado no canal ${config.bumpReminder.channelId}; aguardando o próximo bump.`);
      return;
    }
    scheduleBumpReminder(client, latestBump);
  })().catch((error) => console.error("[BUMP] Falha ao localizar o último bump:", error));
}
