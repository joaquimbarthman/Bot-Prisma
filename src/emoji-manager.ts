import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type Client } from "discord.js";
import path from "node:path";
import { config } from "./config.js";

const galleryEmojis: { empty?: string; full?: string; details?: string; trash?: string; warning?: string; instagram?: string; comment?: string } = {};
const moderationEmojis: { block?: string; check?: string } = {};
const verificationEmojis: { start?: string } = {};
const lfgEmojis: { check?: string; close?: string; sound?: string; trash?: string; warning?: string; gamepad?: string } = {};
const customCallEmojis: { add?: string; remove?: string; members?: string; trash?: string } = {};
export const aiPanelEmojis: { user?: string; memory?: string; mention?: string; spontaneous?: string; humor?: string; trash?: string; reset?: string; close?: string } = {};

export function verificationCheckEmoji(): string | undefined {
  return moderationEmojis.check;
}

export function verificationStartEmoji(): string | undefined {
  return verificationEmojis.start;
}

export function verificationBlockEmoji(): string | undefined {
  return moderationEmojis.block;
}

export function verificationTakeEmoji(): string | undefined {
  return aiPanelEmojis.user;
}

export function verificationWaitingEmoji(): string | undefined {
  return lfgEmojis.sound;
}

export function verificationCloseEmoji(): string | undefined {
  return aiPanelEmojis.close;
}

export function reportWarningEmoji(): string | undefined {
  return galleryEmojis.warning;
}

export function galleryTrashEmoji(): string | undefined {
  return galleryEmojis.trash;
}

export function galleryCloseEmoji(): string | undefined {
  return aiPanelEmojis.close;
}

export function lfgCloseEmoji(): string | undefined {
  return lfgEmojis.close;
}

export function lfgCheckEmoji(): string | undefined {
  return lfgEmojis.check;
}

export function lfgSoundEmoji(): string | undefined {
  return lfgEmojis.sound;
}

export function lfgTrashEmoji(): string | undefined {
  return lfgEmojis.trash;
}

export function lfgWarningEmoji(): string | undefined {
  return lfgEmojis.warning;
}

export function lfgGamepadEmoji(): string | undefined {
  return lfgEmojis.gamepad;
}

export function customCallAddEmoji(): string | undefined { return customCallEmojis.add; }
export function customCallRemoveEmoji(): string | undefined { return customCallEmojis.remove; }
export function customCallMembersEmoji(): string | undefined { return customCallEmojis.members; }
export function customCallTrashEmoji(): string | undefined { return customCallEmojis.trash; }

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

    const [empty, full, details, trash, warning, instagram, comment, block, check, verificationStart, aiUser, aiMemory, aiMention, aiSpontaneous, aiHumor, aiReset, aiClose, lfgSound, lfgGamepad, customCallAdd, customCallRemove] = await Promise.all([
      ensure("coracao_vazio_branco", "heart.png", "Ícone branco da galeria"),
      ensure("coracao_cheio_branco", "heart-fill.png", "Ícone branco da galeria"),
      ensure("icone_detalhes_branco", "line.png", "Ícone branco da galeria"),
      ensure("icone_lixo_branco", "trash.png", "Ícone branco da galeria"),
      ensure("icone_denuncia_branco", "sinal-de-aviso.png", "Ícone de denúncia da galeria"),
      ensure("icone_instagram", "instagram.png", "Ícone do botão de Instagram da galeria"),
      ensure("icone_comentar", "comente.png", "Ícone do botão de comentar da galeria"),
      ensure("icone_banir_branco", "block.png", "Ícone do painel de moderação"),
      ensure("icone_confiar_branco", "check.png", "Ícone do painel de moderação"),
      ensure("verificacao_iniciar", "verificar.png", "Ícone do painel de verificação"),
      ensure("prisma_ai_usuario", "do-utilizador.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_memoria", "lasca.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_mencao", "em.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_espontanea", "simbolo-flash.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_humor", "humor.png", "Ícone do painel Prisma IA"),
      ensure("prisma_ai_recarregar", "recarregar.png", "Ícone de reiniciar relação da Prisma IA"),
      ensure("prisma_ai_fechar", "close.png", "Ícone de remover apelido da Prisma IA"),
      ensure("lfg_som_musical", "som-musical.png", "Ícone do botão de lobby LFG"),
      ensure("lfg_controle", "controle-de-video-game.png", "Ícone do botão de criar grupo LFG"),
      ensure("call_personalizada_adicionar", "mais.png", "Ícone de adicionar membro à call personalizada"),
      ensure("call_personalizada_remover", "minimize-o-sinal.png", "Ícone de remover membro da call personalizada"),
    ]);
    Object.assign(galleryEmojis, { empty: empty.id, full: full.id, details: details.id, trash: trash.id, warning: warning.id, instagram: instagram.id, comment: comment.id });
    Object.assign(moderationEmojis, { block: block.id, check: check.id });
    Object.assign(verificationEmojis, { start: verificationStart.id });
    Object.assign(lfgEmojis, { check: check.id, close: aiClose.id, sound: lfgSound.id, trash: trash.id, warning: warning.id, gamepad: lfgGamepad.id });
    Object.assign(customCallEmojis, { add: customCallAdd.id, remove: customCallRemove.id, members: aiUser.id, trash: trash.id });
    Object.assign(aiPanelEmojis, { user: aiUser.id, memory: aiMemory.id, mention: aiMention.id, spontaneous: aiSpontaneous.id, humor: aiHumor.id, trash: trash.id, reset: aiReset.id, close: aiClose.id });
    console.log("[EMOJIS] Ícones personalizados carregados.");
  } catch (error) {
    console.error("[EMOJIS] Falha ao carregar ícones; usando símbolos padrão:", error);
  }
}

export function galleryButtons(likes: number, comments: number): ActionRowBuilder<ButtonBuilder>[] {
  const mainRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("galeria:curtir").setLabel(` ${likes}`).setEmoji(likes > 0 ? galleryEmojis.full ?? "♥" : galleryEmojis.empty ?? "♡").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("galeria:comentar").setLabel(` ${comments}`).setEmoji(galleryEmojis.comment ?? "💬").setStyle(ButtonStyle.Secondary),
  );
  mainRow.addComponents(new ButtonBuilder().setCustomId("galeria:instagram").setEmoji(galleryEmojis.instagram ?? "📷").setStyle(ButtonStyle.Secondary));
  mainRow.addComponents(new ButtonBuilder().setCustomId("galeria:detalhes").setEmoji(galleryEmojis.details ?? "⋯").setStyle(ButtonStyle.Secondary));
  mainRow.addComponents(new ButtonBuilder().setCustomId("galeria:excluir").setEmoji(galleryEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger));
  return [mainRow];
}

export function moderationButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`moderacao:banir:${userId}`).setLabel("Banir").setEmoji(moderationEmojis.block ?? "🚫").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`moderacao:confiar:${userId}`).setLabel("Restaurar confiança").setEmoji(moderationEmojis.check ?? "✅").setStyle(ButtonStyle.Success),
  );
}
