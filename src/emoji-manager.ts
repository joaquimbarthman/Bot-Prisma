import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from "discord.js";
import path from "node:path";
import { config } from "./config.js";

const galleryEmojis: { empty?: string; full?: string; details?: string; trash?: string; warning?: string } = {};
const moderationEmojis: { block?: string; check?: string } = {};
export const aiPanelEmojis: { user?: string; memory?: string; mention?: string; spontaneous?: string; humor?: string; trash?: string } = {};

export function verificationCheckEmoji(): string | undefined {
  return moderationEmojis.check;
}

export function verificationBlockEmoji(): string | undefined {
  return moderationEmojis.block;
}

export async function setupCustomEmojis(client: Client): Promise<void> {
  if (!config.guildId) {
    console.warn("[EMOJIS] DISCORD_GUILD_ID não definido; usando símbolos padrão.");
    return;
  }
  try {
    const guild = await client.guilds.fetch(config.guildId);
    const emojis = await guild.emojis.fetch();
    const ensure = async (name: string, file: string, reason: string) =>
      emojis.find((emoji) => emoji.name === name)
      ?? guild.emojis.create({ attachment: path.resolve("assets", file), name, reason });

    const [empty, full, details, trash, warning, block, check, aiUser, aiMemory, aiMention, aiSpontaneous, aiHumor] = await Promise.all([
      ensure("coracao_vazio_branco", "heart.png", "Ícone branco da galeria"),
      ensure("coracao_cheio_branco", "heart-fill.png", "Ícone branco da galeria"),
      ensure("icone_detalhes_branco", "line.png", "Ícone branco da galeria"),
      ensure("icone_lixo_branco", "trash.png", "Ícone branco da galeria"),
      ensure("icone_denuncia_branco", "sinal-de-aviso.png", "Ícone de denúncia da galeria"),
      ensure("icone_banir_branco", "block.png", "Ícone do painel de moderação"),
      ensure("icone_confiar_branco", "check.png", "Ícone do painel de moderação"),
      ensure("prisma_ai_usuario", "do-utilizador.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_memoria", "lasca.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_mencao", "em.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_espontanea", "simbolo-flash.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_humor", "humor.png", "Ícone do painel Prisma IA"),
    ]);
    Object.assign(galleryEmojis, { empty: empty.id, full: full.id, details: details.id, trash: trash.id, warning: warning.id });
    Object.assign(moderationEmojis, { block: block.id, check: check.id });
    Object.assign(aiPanelEmojis, { user: aiUser.id, memory: aiMemory.id, mention: aiMention.id, spontaneous: aiSpontaneous.id, humor: aiHumor.id, trash: trash.id });
    console.log("[EMOJIS] Ícones personalizados carregados.");
  } catch (error) {
    console.error("[EMOJIS] Falha ao carregar ícones; usando símbolos padrão:", error);
  }
}

export function galleryButtons(likes: number, reportDisabled = false): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("galeria:curtir").setLabel(`・ ${likes}`).setEmoji(likes > 0 ? galleryEmojis.full ?? "♥" : galleryEmojis.empty ?? "♡").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("galeria:detalhes").setLabel(" ").setEmoji(galleryEmojis.details ?? "⋯").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("galeria:excluir").setLabel(" ").setEmoji(galleryEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Secondary),
  );
  if (!reportDisabled) row.addComponents(new ButtonBuilder().setCustomId("galeria:denunciar").setLabel(" ").setEmoji(galleryEmojis.warning ?? "⚠️").setStyle(ButtonStyle.Secondary));
  return row;
}

export function galleryReportButtons(channelId: string, messageId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`galeria-moderacao:verificar:${channelId}:${messageId}`).setLabel("・ Verificado").setEmoji(moderationEmojis.check ?? "✅").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`galeria-moderacao:apagar:${channelId}:${messageId}`).setLabel("・ Apagar").setEmoji(galleryEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger),
  );
}

export function moderationButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`moderacao:banir:${userId}`).setLabel("・ Banir").setEmoji(moderationEmojis.block ?? "🚫").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`moderacao:confiar:${userId}`).setLabel("・ Confiar").setEmoji(moderationEmojis.check ?? "✅").setStyle(ButtonStyle.Success),
  );
}
