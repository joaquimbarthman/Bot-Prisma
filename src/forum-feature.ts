import { AttachmentBuilder, type Message } from "discord.js";
import path from "node:path";
import { config } from "./config.js";

const defaultImageName = "prisma-forum-default.png";
const defaultImagePath = path.resolve("assets", "forum-default.png");
const initializedThreads = new Set<string>();

/** Adds the configured fallback image only to a forum post's starter message. */
export async function handleForumDefaultImage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.channelId === config.galleryChannelId) return;
  if (!message.channel.isThread() || message.channel.parentId !== config.forumDefaultImageChannelId) return;
  const thread = message.channel;
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (!starter || starter.id !== message.id) return;
  if (message.attachments.some((attachment) => attachment.contentType?.startsWith("image/"))) return;
  if (initializedThreads.has(thread.id)) return;
  initializedThreads.add(thread.id);

  const recent = await thread.messages.fetch({ limit: 10 }).catch(() => null);
  const alreadyAdded = recent?.some((item) =>
    item.author.id === message.client.user?.id && item.attachments.some((attachment) => attachment.name === defaultImageName),
  );
  if (alreadyAdded) return;

  await thread.send({
    files: [new AttachmentBuilder(defaultImagePath, { name: defaultImageName })],
  }).catch((error) => {
    initializedThreads.delete(thread.id);
    console.error(`[FORUM] Falha ao publicar imagem padrão no tópico ${thread.id}:`, error);
  });
}
