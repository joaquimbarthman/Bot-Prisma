import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ComponentType, ModalBuilder, SeparatorSpacingSize, TextInputBuilder, TextInputStyle, escapeMarkdown, type APIContainerComponent, type Client, type Interaction, type Message } from "discord.js";
import { config } from "../../config.js";
import { aiPanelEmojis, galleryButtons } from "../../emoji-manager.js";
import { aiModeration } from "../moderation/ai.js";
import { localModeration, normalizeText, shouldUseAi } from "../moderation/filter.js";
import { addGalleryComment, createGalleryPost, deleteGalleryPost, getGalleryPost, listGalleryPosts, toggleGalleryLike, updateGalleryInstagram, type GalleryPost } from "./store.js";
import { addPhotoFrame } from "./image.js";

const GALLERY_COMMENT_MAX_LENGTH = 80;

function normalizeInstagramHandle(value: string): string | null {
  const handle = value.trim().replace(/^@/, "");
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : null;
}

function hasHomophobicTerm(content: string): boolean {
  const normalized = normalizeText(content);
  return /\b(?:viad(?:o|a|ao|ona|inh[ao]?)|bich(?:a|ona|inha)|boiol[ao]|baitol[ao]|maric[ao]|sapat(?:ao|ona)|travec[oa])s?\b/i.test(normalized);
}

async function blockedGalleryComment(content: string): Promise<boolean> {
  if (localModeration(content).flagged || hasHomophobicTerm(content)) return true;
  if (!shouldUseAi(content)) return false;
  const result = await aiModeration(content);
  return result.flagged && /(?:^|,)\s*hate(?:\/|,|$)/i.test(result.category ?? "");
}

function deleteConfirmationComponents(messageId: string, result?: "confirmed" | "cancelled"): APIContainerComponent[] {
  const content = result === "confirmed"
    ? "## Publicação apagada\nA foto foi removida da galeria."
    : result === "cancelled"
      ? "## Exclusão cancelada\nA publicação continua na galeria."
      : "## Apagar publicação\nTem certeza de que deseja apagar esta foto? Essa ação não pode ser desfeita.";
  const components: APIContainerComponent["components"] = [{ type: ComponentType.TextDisplay, content }];
  if (!result) components.push(
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`galeria:excluir-confirm:${messageId}`).setLabel("Apagar").setEmoji(aiPanelEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`galeria:excluir-cancel:${messageId}`).setLabel("Cancelar").setEmoji(aiPanelEmojis.close ?? "✖️").setStyle(ButtonStyle.Secondary),
    ).toJSON(),
  );
  return [{ type: ComponentType.Container, accent_color: result === "confirmed" ? 0x57f287 : result === "cancelled" ? 0x99aab5 : 0xed4245, components }];
}

function galleryPostComponents(userId: string, mediaUrl: string, caption: string, post: GalleryPost): APIContainerComponent[] {
  return [{ type: ComponentType.Container, components: [
    { type: ComponentType.TextDisplay, content: `> -# <@${userId}>` },
    ...(caption ? [{ type: ComponentType.TextDisplay as const, content: caption.slice(0, 150) }] : []),
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    { type: ComponentType.MediaGallery, items: [{ media: { url: mediaUrl } }] },
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    ...galleryButtons(post.likes.length, post.comments.length).map((row) => row.toJSON()),
  ] }];
}

function galleryDetailsComponents(post: GalleryPost): APIContainerComponent[] {
  const visibleLikes = post.likes.slice(0, 50);
  const hiddenLikes = Math.max(0, post.likes.length - visibleLikes.length);
  const likes = visibleLikes.length
    ? `${visibleLikes.map((id) => `<@${id}>`).join("  ·  ")}${hiddenLikes ? `\n-# e mais ${hiddenLikes} ${hiddenLikes === 1 ? "pessoa" : "pessoas"}` : ""}`
    : "-# Esta foto ainda não recebeu curtidas.";

  const visibleComments = post.comments.slice(-10);
  const comments = visibleComments.length
    ? visibleComments.map((comment) => `> <@${comment.userId}>  **·**  ${escapeMarkdown(comment.content)}`).join("\n")
    : "-# Ainda não há comentários. Seja a primeira pessoa a comentar!";
  const hiddenComments = Math.max(0, post.comments.length - visibleComments.length);

  return [{
    type: ComponentType.Container,
    accent_color: 0xeb459e,
    components: [
      { type: ComponentType.TextDisplay, content: `## Detalhes da foto\n-# Publicada por <@${post.ownerId}>` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `### Curtidas  ·  ${post.likes.length}\n${likes}` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `### Comentários  ·  ${post.comments.length}\n${comments}${hiddenComments ? `\n-# Exibindo os 10 mais recentes de ${post.comments.length} comentários.` : ""}` },
    ],
  }];
}

function componentsWithGalleryButtons(message: Message, post: GalleryPost) {
  const container = message.components.find((component) => component.type === ComponentType.Container);
  if (!container) return galleryButtons(post.likes.length, post.comments.length);
  const data = container.toJSON() as APIContainerComponent;
  return [{ ...data, components: [
    ...data.components.filter((component) => component.type !== ComponentType.ActionRow),
    ...galleryButtons(post.likes.length, post.comments.length).map((row) => row.toJSON()),
  ] }];
}

async function refreshGalleryPost(messageId: string, client: Client, post: GalleryPost): Promise<void> {
  const channel = await client.channels.fetch(config.galleryChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) await message.edit({ components: componentsWithGalleryButtons(message, post) });
}

export async function refreshGalleryButtons(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.galleryChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;
  let refreshed = 0;
  for (const [messageId, post] of await listGalleryPosts()) {
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) continue;
    const isComponentsV2 = message.components.some((component) => component.type === ComponentType.Container);
    const imageUrl = message.embeds[0]?.image?.url ?? message.attachments.first()?.url;
    if (!isComponentsV2 && imageUrl) {
      const caption = message.embeds[0]?.description?.replace(/^###\s*/, "") ?? "";
      await message.edit({ embeds: [], components: galleryPostComponents(post.ownerId, imageUrl, caption, post), flags: ["IsComponentsV2"] }).catch((error) => console.error(`[GALERIA] Falha ao migrar a publicação ${messageId}:`, error));
    } else await message.edit({ components: componentsWithGalleryButtons(message, post) }).catch((error) => console.error(`[GALERIA] Falha ao atualizar os botões de ${messageId}:`, error));
    refreshed += 1;
  }
  console.log(`[GALERIA] Botões sincronizados em ${refreshed} publicações.`);
}

export async function handleGalleryMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.channelId !== config.galleryChannelId) return false;
  const image = message.attachments.find((attachment) => attachment.contentType?.startsWith("image/"));
  if (!image) return false;
  try {
    const response = await fetch(image.url);
    if (!response.ok) throw new Error(`Não foi possível baixar a imagem (${response.status}).`);
    const framed = await addPhotoFrame(Buffer.from(await response.arrayBuffer()));
    const filename = `foto-${message.author.id}.png`;
    const caption = message.content.trim();
    const galleryPost: GalleryPost = { ownerId: message.author.id, likes: [], comments: [] };
    const post = await message.channel.send({ files: [new AttachmentBuilder(framed, { name: filename })], components: galleryPostComponents(message.author.id, `attachment://${filename}`, caption, galleryPost), flags: ["IsComponentsV2"] });
    await createGalleryPost(post.id, message.author.id);
    await message.delete().catch(() => undefined);
    console.log(`[GALERIA] Foto publicada por ${message.author.tag} (${post.id}).`);
  } catch (error) {
    console.error("[GALERIA] Falha ao processar imagem:", error);
    const warning = await message.reply("Não consegui processar essa imagem. Tente enviar um arquivo PNG, JPEG ou WebP menor.").catch(() => null);
    if (warning) setTimeout(() => warning.delete().catch(() => undefined), 10_000);
  }
  return true;
}

export async function handleGalleryInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isModalSubmit()) || !interaction.customId.startsWith("galeria:")) return false;
  if (interaction.isModalSubmit()) {
    const [, action, messageId] = interaction.customId.split(":");
    if (!messageId) return false;
    if (action === "instagram-modal") {
      const post = await getGalleryPost(messageId);
      if (!post) { await interaction.reply({ content: "Esta publicação não está mais registrada.", flags: ["Ephemeral"] }); return true; }
      if (interaction.user.id !== post.ownerId) { await interaction.reply({ content: "Somente quem publicou a foto pode definir o Instagram.", flags: ["Ephemeral"] }); return true; }
      const instagramHandle = normalizeInstagramHandle(interaction.fields.getTextInputValue("instagram"));
      if (!instagramHandle) { await interaction.reply({ content: "Digite apenas um usuário válido do Instagram, como @prisma.ia.", flags: ["Ephemeral"] }); return true; }
      const updated = await updateGalleryInstagram(messageId, instagramHandle);
      if (!updated) { await interaction.reply({ content: "Esta publicação não está mais registrada.", flags: ["Ephemeral"] }); return true; }
      await refreshGalleryPost(messageId, interaction.client, updated).catch((error) => console.error("[GALERIA] Falha ao atualizar Instagram:", error));
      await interaction.reply({ content: "Instagram atualizado.", flags: ["Ephemeral"] });
      return true;
    }
    if (action !== "comentar-modal") return false;
    const content = interaction.fields.getTextInputValue("comentario").trim().replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").slice(0, GALLERY_COMMENT_MAX_LENGTH);
    if (!content) { await interaction.reply({ content: "Escreva um comentário antes de enviar.", flags: ["Ephemeral"] }); return true; }
    if (await blockedGalleryComment(content)) {
      await interaction.reply({ content: "Esse comentário não pode ser publicado. Mantenha a conversa respeitosa.", flags: ["Ephemeral"] });
      return true;
    }
    const post = await addGalleryComment(messageId, interaction.user.id, content);
    if (!post) { await interaction.reply({ content: "Esta publicação não está mais registrada.", flags: ["Ephemeral"] }); return true; }
    await refreshGalleryPost(messageId, interaction.client, post).catch((error) => console.error("[GALERIA] Falha ao atualizar comentários:", error));
    await interaction.reply({ content: "Comentário adicionado.", flags: ["Ephemeral"] });
    return true;
  }
  const [, action, targetMessageId] = interaction.customId.split(":");
  if (action === "excluir-cancel" && targetMessageId) {
    await interaction.update({ components: deleteConfirmationComponents(targetMessageId, "cancelled") });
    return true;
  }
  if (action === "excluir-confirm" && targetMessageId) {
    const targetPost = await getGalleryPost(targetMessageId);
    if (!targetPost || interaction.user.id !== targetPost.ownerId) {
      await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0xed4245, components: [{ type: ComponentType.TextDisplay, content: "## Não foi possível apagar\nEssa publicação não existe mais ou não pertence a você." }] }] });
      return true;
    }
    const channel = await interaction.client.channels.fetch(config.galleryChannelId).catch(() => null);
    const publication = channel?.isTextBased() ? await channel.messages.fetch(targetMessageId).catch(() => null) : null;
    await deleteGalleryPost(targetMessageId);
    await publication?.delete().catch((error) => console.error("[GALERIA] Falha ao apagar publicação:", error));
    await interaction.update({ components: deleteConfirmationComponents(targetMessageId, "confirmed") });
    return true;
  }
  const post = await getGalleryPost(interaction.message.id);
  if (!post) { await interaction.reply({ content: "Esta publicação não está mais registrada.", flags: ["Ephemeral"] }); return true; }
  if (action === "curtir") {
    const result = await toggleGalleryLike(interaction.message.id, interaction.user.id);
    if (result.post) await interaction.update({ components: componentsWithGalleryButtons(interaction.message, result.post) });
    else await interaction.reply({ content: "Esta publicação não está mais registrada.", flags: ["Ephemeral"] });
  } else if (action === "comentar") {
    const modal = new ModalBuilder().setCustomId(`galeria:comentar-modal:${interaction.message.id}`).setTitle("Comentar na foto").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("comentario").setLabel(`Comentário (até ${GALLERY_COMMENT_MAX_LENGTH} caracteres)`).setStyle(TextInputStyle.Paragraph).setMaxLength(GALLERY_COMMENT_MAX_LENGTH).setRequired(true)));
    await interaction.showModal(modal);
  } else if (action === "instagram") {
    if (interaction.user.id === post.ownerId) {
      const modal = new ModalBuilder().setCustomId(`galeria:instagram-modal:${interaction.message.id}`).setTitle("Instagram da foto")
        .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("instagram").setLabel("Seu @ do Instagram").setStyle(TextInputStyle.Short).setPlaceholder("@seuusuario").setValue(post.instagramHandle ? `@${post.instagramHandle}` : "").setMaxLength(31).setRequired(true)));
      await interaction.showModal(modal);
    } else if (post.instagramHandle) {
      await interaction.reply({ content: "Instagram da pessoa que publicou a foto:", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel(`@${post.instagramHandle}`).setURL(`https://www.instagram.com/${post.instagramHandle}`).setStyle(ButtonStyle.Link))], flags: ["Ephemeral"] });
    } else await interaction.reply({ content: "A pessoa que publicou esta foto ainda não informou o Instagram.", flags: ["Ephemeral"] });
  } else if (action === "detalhes") {
    await interaction.reply({ components: galleryDetailsComponents(post), flags: ["Ephemeral", "IsComponentsV2"], allowedMentions: { parse: [] } });
  } else if (action === "excluir") {
    if (interaction.user.id !== post.ownerId) { await interaction.reply({ content: "Somente quem publicou a foto pode excluir a publicação.", flags: ["Ephemeral"] }); return true; }
    await interaction.reply({ components: deleteConfirmationComponents(interaction.message.id), flags: ["Ephemeral", "IsComponentsV2"] });
  }
  return true;
}
