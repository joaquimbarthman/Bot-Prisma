import type { Client } from "discord.js";
import { config } from "../../config.js";

export function bumpReminderContent(roleId = config.bumpReminder.moderationRoleId): string {
  return `<@&${roleId}> Já está na hora de usar o /bump neste canal.`;
}

async function sendBumpReminder(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.bumpReminder.channelId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) {
    console.error(`[BUMP] Canal ${config.bumpReminder.channelId} não encontrado ou não permite mensagens.`);
    return;
  }
  await channel.send({
    content: bumpReminderContent(),
    allowedMentions: { parse: [], roles: [config.bumpReminder.moderationRoleId] },
  });
}

export function startBumpReminder(client: Client): void {
  const intervalMs = config.bumpReminder.intervalHours * 60 * 60_000;
  setInterval(
    () => sendBumpReminder(client).catch((error) => console.error("[BUMP] Falha ao enviar lembrete:", error)),
    intervalMs,
  ).unref();
  console.log(`[BUMP] Lembrete configurado a cada ${config.bumpReminder.intervalHours}h no canal ${config.bumpReminder.channelId}.`);
}
