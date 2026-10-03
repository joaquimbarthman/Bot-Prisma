import { ComponentType, type APIContainerComponent, type Client, type Interaction, type Message } from "discord.js";
import { config } from "./config.js";

export type PublicFeature = "lfg" | "custom-calls" | "reports" | "verification" | "gallery" | "moderation" | "leveling" | "ai" | "system";

const featureNames: Record<PublicFeature, string> = {
  lfg: "LFG",
  "custom-calls": "Calls Personalizadas",
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
  "lfg:delete": "apagar o LFG",
  "lfg:confirm-delete": "confirmar a exclusão do LFG",
  "custom-call:open": "abrir o painel de calls personalizadas",
  "custom-call:create": "criar a call personalizada",
  "custom-call:add": "adicionar uma pessoa à call personalizada",
  "custom-call:remove": "remover uma pessoa da call personalizada",
  "custom-call:members": "ver integrantes da call personalizada",
  "custom-call:delete": "excluir a call personalizada",
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

function errorDateTime(timestamp = Date.now()): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp)).replace(",", " ・");
}

function safePublicUsername(value: string): string {
  return value.replace(/@/g, "@\u200b").replace(/([`*_~|>])/g, "\\$1").slice(0, 32);
}

function publicErrorComponents(context: PublicErrorContext, error: unknown, userName?: string): APIContainerComponent[] {
  const feature = featureNames[context.feature];
  const action = context.action || "concluir uma ação desconhecida";
  const channel = context.channelId ? `<#${context.channelId}>` : "Indisponível";
  const user = context.userId ? `<@${context.userId}>` : "Indisponível";
  const details = sanitizePublicError(error) || "Erro sem detalhes";

  return [
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.TextDisplay,
        content: `## Erro • ${feature}\n-# Registrado em ${errorDateTime()}`,
      }],
    },
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.TextDisplay,
        content: `**Motivo**\nNão foi possível ${action}.\n\n**Canal**\n**${channel}**\n\n**Usuário**\n${user} ・ ${userName ? safePublicUsername(userName) : "Indisponível"}`,
      }],
    },
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.TextDisplay,
        content: `**Detalhes do erro**\n\`\`\`text\n${details}\n\`\`\``,
      }],
    },
  ];
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
  const reportedUser = context.userId ? await client.users.fetch(context.userId).catch(() => null) : null;
  return channel.send({ components: publicErrorComponents(context, error, reportedUser?.username), flags: ["IsComponentsV2"], allowedMentions: { parse: [] } }).then(() => true).catch((sendError) => {
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
