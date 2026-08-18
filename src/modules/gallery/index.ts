import { AttachmentBuilder, ComponentType, EmbedBuilder, PermissionFlagsBits, SeparatorSpacingSize, type APIContainerComponent, type ButtonInteraction, type Client, type Message, type TextChannel } from "discord.js";
import { config } from "../../config.js";
import { galleryButtons, galleryReportButtons } from "../../emoji-manager.js";
import { beginGalleryReport, cancelGalleryReport, createGalleryPost, deleteGalleryPost, getGalleryPost, listGalleryPosts, toggleGalleryLike, verifyGalleryPost } from "./store.js";
import { addPhotoFrame } from "./image.js";

function galleryTimestamp(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}/${value("month")}/${value("year")} ・ ${value("hour")}:${value("minute")}`;
}

function galleryPostComponents(userId: string, mediaUrl: string, caption: string, timestamp: number, likes: number, reportDisabled = false): APIContainerComponent[] {
  const legend = caption ? `### ${caption.slice(0, 4000)}\n-# Galeria da comunidade - ${galleryTimestamp(timestamp)}` : `-# Galeria da comunidade - ${galleryTimestamp(timestamp)}`;
  return [{
    type: ComponentType.Container,
    components: [
      { type: ComponentType.TextDisplay, content: `### <@${userId}>` },
      { type: ComponentType.MediaGallery, items: [{ media: { url: mediaUrl } }] },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: legend },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      galleryButtons(likes, reportDisabled).toJSON(),
    ],
  }];
}

function componentsWithGalleryButtons(message: Message, likes: number, reportDisabled: boolean) {
  const container = message.components.find((component) => component.type === ComponentType.Container);
  if (!container) return [galleryButtons(likes, reportDisabled)];
  const data = container.toJSON() as APIContainerComponent;
  return [{
    ...data,
    components: data.components.map((component) => {
      if (component.type === ComponentType.ActionRow) return galleryButtons(likes, reportDisabled).toJSON();
      if (component.type === ComponentType.TextDisplay && typeof component.content === "string") {
        return { ...component, content: component.content.replace(/(Galeria da comunidade - ).*$/m, `$1${galleryTimestamp(message.createdTimestamp)}`) };
      }
      return component;
    }),
  }];
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
      await message.edit({
        embeds: [],
        components: galleryPostComponents(post.ownerId, imageUrl, caption, message.createdTimestamp, post.likes.length, post.reportDisabled ?? false),
        flags: ["IsComponentsV2"],
      }).catch((error) => console.error(`[GALERIA] Falha ao migrar a publicação ${messageId}:`, error));
    } else {
      await message.edit({ components: componentsWithGalleryButtons(message, post.likes.length, post.reportDisabled ?? false) }).catch((error) => console.error(`[GALERIA] Falha ao atualizar os botões de ${messageId}:`, error));
    }
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
    const post = await message.channel.send({
      files: [new AttachmentBuilder(framed, { name: filename })],
      components: galleryPostComponents(message.author.id, `attachment://${filename}`, caption, Date.now(), 0),
      flags: ["IsComponentsV2"],
    });
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

export async function handleGalleryButton(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.customId.startsWith("galeria-moderacao:")) return handleGalleryModerationButton(interaction);
  if (!interaction.customId.startsWith("galeria:")) return false;
  const action = interaction.customId.split(":")[1];
  const post = await getGalleryPost(interaction.message.id);
  if (!post) {
    await interaction.reply({ content: "Esta publicação não está mais registrada.", ephemeral: true });
    return true;
  }
  if (action === "curtir") {
    const result = await toggleGalleryLike(interaction.message.id, interaction.user.id);
    await interaction.update({ components: componentsWithGalleryButtons(interaction.message, result.post?.likes.length ?? 0, result.post?.reportDisabled ?? false) });
  } else if (action === "detalhes") {
    const likes = post.likes.slice(0, 50).map((id) => `<@${id}>`).join("\n");
    const extra = post.likes.length > 50 ? `\n+${post.likes.length - 50}` : "";
    const embed = new EmbedBuilder().setColor(0xeb459e).setTitle(`Curtidas ・ ${post.likes.length}`)
      .setDescription(post.likes.length ? `${likes}${extra}` : "Nenhuma curtida");
    await interaction.reply({ embeds: [embed], ephemeral: true });
  } else if (action === "excluir") {
    if (interaction.user.id !== post.ownerId) {
      await interaction.reply({ content: "Somente quem publicou a foto pode excluí-la.", ephemeral: true });
      return true;
    }
    await interaction.reply({ content: "Publicação excluída.", ephemeral: true });
    await deleteGalleryPost(interaction.message.id);
    await interaction.message.delete();
  } else if (action === "denunciar") {
    if (interaction.user.id === post.ownerId) { await interaction.reply({ content: "Você não pode denunciar sua própria publicação.", ephemeral: true }); return true; }
    const state = await beginGalleryReport(interaction.message.id);
    if (state === "pending") { await interaction.reply({ content: "Esta publicação já possui uma denúncia aguardando análise.", ephemeral: true }); return true; }
    if (state === "disabled") { await interaction.reply({ content: "Esta publicação já foi verificada pela moderação.", ephemeral: true }); return true; }
    if (state === "missing") { await interaction.reply({ content: "Esta publicação não está mais registrada.", ephemeral: true }); return true; }
    await interaction.deferReply({ ephemeral: true });
    try {
      const configured = config.galleryReportChannelId ? await interaction.client.channels.fetch(config.galleryReportChannelId).catch(() => null) : null;
      const fallback = interaction.guild?.channels.cache.find((channel) => channel.name === "aviso-prisma");
      const reportChannel = (configured ?? fallback) as TextChannel | undefined;
      if (!reportChannel?.isSendable()) throw new Error("Canal aviso-prisma não encontrado ou sem permissão de envio.");
      const original = interaction.message.embeds[0];
      const report = new EmbedBuilder()
        .setColor(0xfee75c).setAuthor({ name: "Central de Segurança • Prisma", iconURL: interaction.client.user.displayAvatarURL() })
        .setTitle("⚠️ Denúncia de publicação")
        .setDescription("Uma imagem da galeria da comunidade aguarda análise da moderação.")
        .addFields(
          { name: "👤 Publicação de", value: `<@${post.ownerId}>`, inline: true },
          { name: "⚠️ Denunciado por", value: `<@${interaction.user.id}>`, inline: true },
          { name: "💭 Publicação", value: `[Abrir imagem](${interaction.message.url})` },
        )
        .setFooter({ text: `Publicação ${interaction.message.id}` }).setTimestamp();
      if (original?.image?.url) report.setImage(original.image.url);
      await reportChannel.send({ embeds: [report], components: [galleryReportButtons(interaction.channelId, interaction.message.id)] });
      await interaction.editReply("Denúncia enviada à moderação. Obrigado por avisar.");
    } catch (error) {
      await cancelGalleryReport(interaction.message.id);
      console.error("[GALERIA] Falha ao enviar denúncia:", error);
      await interaction.editReply("Não consegui enviar a denúncia. Avise um moderador.");
    }
  }
  return true;
}

async function handleGalleryModerationButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: "Somente moderadores podem revisar denúncias.", ephemeral: true }); return true;
  }
  const [, action, channelId, messageId] = interaction.customId.split(":");
  await interaction.deferReply({ ephemeral: true });
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) { await interaction.editReply("O canal da publicação não está disponível."); return true; }
  const publication = await channel.messages.fetch(messageId).catch(() => null);
  const post = await getGalleryPost(messageId);
  if (!post || !publication) { await deleteGalleryPost(messageId); await interaction.message.edit({ components: [] }); await interaction.editReply("A publicação já não existe."); return true; }

  if (action === "verificar") {
    const verified = await verifyGalleryPost(messageId);
    await publication.edit({ components: componentsWithGalleryButtons(publication, verified?.likes.length ?? post.likes.length, true) });
    const reviewed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0x57f287).setFooter({ text: `Verificado por ${interaction.user.tag}` });
    await interaction.message.edit({ embeds: [reviewed], components: [] });
    await interaction.editReply("Publicação verificada. O botão de denúncia foi removido.");
  } else if (action === "apagar") {
    await publication.delete(); await deleteGalleryPost(messageId);
    const removed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(0xed4245).setFooter({ text: `Apagada por ${interaction.user.tag}` });
    await interaction.message.edit({ embeds: [removed], components: [] });
    await interaction.editReply("Publicação apagada da galeria.");
  }
  return true;
}
