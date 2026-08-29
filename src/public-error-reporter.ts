import { EmbedBuilder, type Client, type Interaction, type Message } from "discord.js";
import { config } from "./config.js";

export type PublicFeature = "lfg" | "reports" | "verification" | "gallery" | "moderation" | "leveling" | "ai" | "system";

const featureNames: Record<PublicFeature, string> = {
  lfg: "LFG",
  reports: "Atendimentos",
  verification: "Verificação",
  gallery: "Galeria",
  moderation: "Moderação",
  leveling: "Leveling",
  ai: "Prisma IA",
  system: "Sistema público",
};

const actionNames: Record<string, string> = {
  "lfg:create": "abrir a criação do LFG",
  "lfg:game": "selecionar o jogo do LFG",
  "lfg:draft-create": "criar e publicar o LFG",
  "lfg:join": "entrar no LFG",
  "lfg:leave": "sair do LFG",
  "lfg:voice": "criar o lobby de voz",
  "lfg:delete": "apagar o LFG",
  "lfg:confirm-delete": "confirmar a exclusão do LFG",
  "verification:start": "iniciar a verificação",
  "verification:approve-confirm": "aprovar a verificação",
  "verification:reject-submit": "recusar a verificação",
  "verification:close": "encerrar a verificação",
  "report:open": "criar o atendimento",
  "report:resolved": "concluir o atendimento como resolvido",
  "report:unresolved": "concluir o atendimento como não resolvido",
  "report:close": "encerrar o atendimento",
  "galeria:comentar-modal": "comentar na galeria",
  "galeria:excluir-confirm": "apagar a publicação da galeria",
  "galeria:curtir": "curtir a publicação da galeria",
};

export function publicInteractionAction(interaction: Interaction): string {
  if (interaction.isChatInputCommand()) return `executar o comando /${interaction.commandName}`;
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit())) return "concluir esta ação";
  const parts = interaction.customId.split(":");
  const key = `${parts[0]}:${parts[1] ?? ""}`;
  return actionNames[key] ?? `concluir a ação ${key}`;
}

export function sanitizePublicError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(\/interactions\/\d+\/)[^/\s]+(\/callback)/gi, "$1[TOKEN_REMOVIDO]$2")
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, "$1[REMOVIDO]")
    .replace(/```/g, "'''")
    .slice(0, 3_500);
}

type PublicErrorContext = {
  feature: PublicFeature;
  action: string;
  guildId?: string | null;
  channelId?: string | null;
  userId?: string | null;
  eventId?: string | null;
};

export async function reportPublicError(client: Client, context: PublicErrorContext, error: unknown): Promise<boolean> {
  const channel = await client.channels.fetch(config.publicErrorChannelId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) {
    console.error(`[ERRO-PUBLICO] Canal ${config.publicErrorChannelId} indisponível.`);
    return false;
  }
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`Erro público • ${featureNames[context.feature]}`)
    .addFields(
      { name: "Ação", value: context.action || "Ação desconhecida" },
      { name: "Canal", value: `\u2002${context.channelId ? `<#${context.channelId}>` : "Indisponível"}\u2002`, inline: true },
      { name: "Usuário", value: `\u2002${context.userId ? `<@${context.userId}>` : "Indisponível"}\u2002`, inline: true },
      { name: "Evento", value: `\u2002${context.eventId ? `\`${context.eventId}\`` : "Indisponível"}\u2002`, inline: true },
      { name: "Erro", value: `\`\`\`\n${sanitizePublicError(error) || "Erro sem detalhes"}\n\`\`\`` },
    )
    .setTimestamp();
  return channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).then(() => true).catch((sendError) => {
    console.error("[ERRO-PUBLICO] Falha ao enviar relatório:", sendError);
    return false;
  });
}

export function interactionErrorContext(interaction: Interaction, feature: PublicFeature): PublicErrorContext {
  return { feature, action: publicInteractionAction(interaction), guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user.id, eventId: interaction.id };
}

export function messageErrorContext(message: Message, feature: PublicFeature): PublicErrorContext {
  return { feature, action: `processar uma mensagem em ${featureNames[feature]}`, guildId: message.guildId, channelId: message.channelId, userId: message.author.id, eventId: message.id };
}
