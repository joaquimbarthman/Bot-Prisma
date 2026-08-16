import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type SendableChannels,
} from "discord.js";
import { config } from "../../config.js";
import { aiPanelEmojis } from "../../emoji-manager.js";
import { accessLevel } from "./permissions.js";
import { sanitizeNickname } from "./personality.js";
import { clearNickname, clearUserHistory, getSettings, resetPrismaState, updateSettings } from "./store.js";

export function panelComponents(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prisma-ai:nickname").setLabel("・ Apelido").setEmoji(aiPanelEmojis.user ?? "👤").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("prisma-ai:memory").setLabel("・ Memória recente").setEmoji(aiPanelEmojis.memory ?? "🧠").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:mentions").setLabel("・ Menções").setEmoji(aiPanelEmojis.mention ?? "📨").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:spontaneous").setLabel("・ Espontâneas").setEmoji(aiPanelEmojis.spontaneous ?? "⚡").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prisma-ai:clear-history").setLabel("Apagar histórico de 48h").setEmoji(aiPanelEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("prisma-ai:reset-relationship").setLabel("Reiniciar relação").setEmoji(aiPanelEmojis.reset ?? "🔄").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("prisma-ai:nickname-remove").setLabel("Remover apelido").setEmoji(aiPanelEmojis.close ?? "✖️").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function resetConfirmationComponents(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("prisma-ai:reset-only").setLabel("Só a relação").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("prisma-ai:reset-with-history").setLabel("Relação + histórico").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("prisma-ai:reset-cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
}

function panelEmbed(client: Client): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle("Prisma • Inteligência Artificial")
    .setThumbnail(client.user?.displayAvatarURL({ size: 256 }) ?? null)
    .setDescription("Uma personalidade-base consistente que desenvolve uma dinâmica própria com você ao longo das conversas.")
    .addFields(
      { name: "💎 Prisma+", value: `Disponível somente para membros com o cargo <@&${config.prismaAi.accessRoleId}>. Boosters recebem esse cargo automaticamente.` },
      { name: "🧠 Memória recente", value: "O texto das conversas expira automaticamente após 48 horas." },
      { name: "🤝 Relação adaptativa", value: "A dinâmica evolui gradualmente e não usa pontos de amizade editáveis." },
      { name: "🔒 Privacidade", value: "Você pode apagar o histórico ou reiniciar a relação separadamente." },
    )
    .setFooter({ text: "Preferências pessoais • respostas privadas" });
}

function hasPrismaControls(message: import("discord.js").Message): boolean {
  return message.components.some((row) => "components" in row && row.components.some((component) => "customId" in component && component.customId?.startsWith("prisma-ai:")));
}

async function updateOrCreatePanel(client: Client, channel: SendableChannels): Promise<void> {
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.filter((message) => message.author.id === client.user?.id && hasPrismaControls(message));
  const current = existing.first();
  if (current) await current.edit({ embeds: [panelEmbed(client)], components: panelComponents() });
  else await channel.send({ embeds: [panelEmbed(client)], components: panelComponents() });
  for (const duplicate of existing.filter((message) => message.id !== current?.id).values()) {
    await duplicate.edit({ components: [] }).catch(() => undefined);
  }
}

export async function refreshAiPanel(client: Client): Promise<void> {
  if (!config.prismaAi.panelChannelId) return;
  const channel = await client.channels.fetch(config.prismaAi.panelChannelId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) { console.error("[PRISMA-IA] Canal do painel não encontrado."); return; }
  await updateOrCreatePanel(client, channel);
}

export async function publishPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== "configurar-prisma") return;
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.editReply("Sem permissão."); return; }
  const channelId = config.prismaAi.panelChannelId || interaction.channelId;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable() || channel.isDMBased()) { await interaction.editReply("Configure AI_PANEL_CHANNEL_ID com um canal válido."); return; }
  await updateOrCreatePanel(interaction.client, channel);
  await interaction.editReply(`Painel atualizado em <#${channelId}>.`);
}

async function authorizedMember(interaction: Interaction): Promise<GuildMember | null> {
  if (!interaction.inGuild() || !interaction.guild) return null;
  if (interaction.member instanceof GuildMember) return interaction.member;
  return interaction.guild.members.fetch({ user: interaction.user.id, force: true }).catch(() => null);
}

export async function handlePanelInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith("prisma-ai:")) return false;
  if (!interaction.inGuild()) return true;
  const action = interaction.customId.split(":")[1];
  const selfServiceDeletion = ["clear-history", "reset-relationship", "reset-only", "reset-with-history", "reset-cancel", "nickname-remove"].includes(action);
  const resetConfirmation = interaction.isButton() && ["reset-only", "reset-with-history", "reset-cancel"].includes(action);
  const opensModal = interaction.isButton() && action === "nickname";
  if (resetConfirmation) await interaction.deferUpdate();
  else if (!opensModal) await interaction.deferReply({ ephemeral: true });

  const member = await authorizedMember(interaction);
  if (!selfServiceDeletion && (!member || accessLevel(member) === "none")) {
    const content = `A Prisma IA é exclusiva para membros com o cargo <@&${config.prismaAi.accessRoleId}>.`;
    if (interaction.deferred) await interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } });
    else await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
    return true;
  }

  if (action === "nickname" && interaction.isButton()) {
    const modal = new ModalBuilder().setCustomId("prisma-ai:nickname-save").setTitle("Apelido do Prisma");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("nickname").setLabel("Como Prisma deve chamar você?").setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true)));
    await interaction.showModal(modal); return true;
  }
  if (action === "nickname-save" && interaction.isModalSubmit()) {
    const nickname = sanitizeNickname(interaction.fields.getTextInputValue("nickname"));
    if (!nickname) { await interaction.editReply("Digite um apelido válido."); return true; }
    await updateSettings(interaction.user.id, { nickname });
    await interaction.editReply({ content: `Apelido salvo: **${nickname}**.`, allowedMentions: { parse: [] } });
    return true;
  }
  if (action === "nickname-remove") {
    await clearNickname(interaction.user.id);
    await interaction.editReply("Seu apelido cadastrado foi removido.");
    return true;
  }
  if (action === "reset-relationship") {
    await interaction.editReply({ content: "Isso apaga permanentemente a dinâmica construída com a Prisma. O que deseja reiniciar?", components: [resetConfirmationComponents()] });
    return true;
  }
  if (action === "reset-cancel") {
    await interaction.editReply({ content: "Reinício cancelado.", components: [] }); return true;
  }
  if (action === "reset-only" || action === "reset-with-history") {
    const clearHistory = action === "reset-with-history";
    await resetPrismaState(interaction.user.id, clearHistory);
    await interaction.editReply({ content: clearHistory ? "Relação e histórico recente reiniciados." : "Sua relação com a Prisma foi reiniciada.", components: [] });
    return true;
  }
  if (action === "humor" || action === "personality") {
    await interaction.editReply("Esse controle foi removido. A personalidade da Prisma agora evolui naturalmente com cada relação.");
    return true;
  }

  if (action === "clear-history") {
    await clearUserHistory(interaction.user.id);
    await interaction.editReply("Seu histórico recente de 48 horas foi apagado. A relação persistente foi mantida.");
    return true;
  }

  const settings = await getSettings(interaction.user.id);
  if (action === "memory") {
    const value = !settings.memoryEnabled; await updateSettings(interaction.user.id, { memoryEnabled: value });
    if (!value) await clearUserHistory(interaction.user.id);
    await interaction.editReply(`Memória recente: **${value ? "ativada" : "desativada"}**.`);
  } else if (action === "mentions") {
    const value = !settings.allowMentions; await updateSettings(interaction.user.id, { allowMentions: value });
    await interaction.editReply(`Menções: **${value ? "ativadas" : "desativadas"}**.`);
  } else if (action === "spontaneous") {
    const value = !settings.spontaneousInteractions; await updateSettings(interaction.user.id, { spontaneousInteractions: value });
    await interaction.editReply(`Interações espontâneas: **${value ? "ativadas" : "desativadas"}**.`);
  }
  return true;
}
