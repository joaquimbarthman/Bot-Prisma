import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { config } from "../../config.js";
import { aiPanelEmojis } from "../../emoji-manager.js";
import { accessLevel, hasPersonalityAccess } from "./permissions.js";
import { personalityOptions, type Personality } from "./personality.js";
import { clearUserHistory, getSettings, updateSettings } from "./store.js";

export function panelComponents() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prisma-ai:nickname").setLabel("・ Apelido").setEmoji(aiPanelEmojis.user ?? "👤").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("prisma-ai:memory").setLabel("・ Memória").setEmoji(aiPanelEmojis.memory ?? "🧠").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:mentions").setLabel("・ Menções").setEmoji(aiPanelEmojis.mention ?? "📨").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:spontaneous").setLabel("・ Espontâneas").setEmoji(aiPanelEmojis.spontaneous ?? "⚡").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:humor").setLabel("・ Humor").setEmoji(aiPanelEmojis.humor ?? "😄").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId("prisma-ai:personality").setPlaceholder("Personalidade • Cargo Prisma AI").addOptions(personalityOptions())),
    new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("prisma-ai:clear-history").setLabel("Apagar meu histórico de 48h").setEmoji(aiPanelEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger)),
  ];
}

export async function publishPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== "configurar-prisma") return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) { await interaction.reply({ content: "Sem permissão.", ephemeral: true }); return; }
  const channelId = config.prismaAi.panelChannelId || interaction.channelId;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) { await interaction.reply({ content: "Configure AI_PANEL_CHANNEL_ID com um canal válido.", ephemeral: true }); return; }
  const embed = new EmbedBuilder()
    .setColor(0x7c5cff)
    .setTitle("Prisma • Inteligência Artificial")
    .setThumbnail(interaction.client.user.displayAvatarURL({ size: 256 }))
    .setDescription("Uma IA que conhece você e interage pelo servidor.")
    .addFields(
      { name: "💎 Prisma+", value: "Converse, crie memórias temporárias e receba interações exclusivas." },
      { name: "🧠 Memória inteligente", value: "Histórico mantido por até 48 horas." },
      { name: "💬 Interações", value: "Prisma pode conversar e mencionar você naturalmente pelo servidor." },
      { name: "🔒 Privacidade", value: "O histórico expira automaticamente." },
    )
    .setFooter({ text: "Use os controles abaixo para personalizar sua experiência" })
    .setTimestamp();
  await channel.send({ embeds: [embed], components: panelComponents() });
  await interaction.reply({ content: `Painel publicado em <#${channelId}>.`, ephemeral: true });
}

export async function handlePanelInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith("prisma-ai:")) return false;
  if (!interaction.inGuild() || !interaction.member || !("roles" in interaction.member)) return true;
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (!member || accessLevel(member) === "none") { await interaction.reply({ content: "A Prisma IA é exclusiva para Boosters e Amigos do Chefe.", ephemeral: true }); return true; }
  const action = interaction.customId.split(":")[1];
  if (action === "nickname" && interaction.isButton()) {
    const modal = new ModalBuilder().setCustomId("prisma-ai:nickname-save").setTitle("Apelido do Prisma");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("nickname").setLabel("Como Prisma deve chamar você?").setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true)));
    await interaction.showModal(modal); return true;
  }
  if (action === "nickname-save" && interaction.isModalSubmit()) {
    const nickname = interaction.fields.getTextInputValue("nickname").trim(); await updateSettings(interaction.user.id, { nickname }); await interaction.reply({ content: `Apelido salvo: **${nickname}**.`, ephemeral: true }); return true;
  }
  const settings = await getSettings(interaction.user.id);
  if (action === "memory") { const value = !settings.memoryEnabled; await updateSettings(interaction.user.id, { memoryEnabled: value }); if (!value) await clearUserHistory(interaction.user.id); await interaction.reply({ content: `Memória temporária: **${value ? "ativada" : "desativada"}**.`, ephemeral: true }); }
  else if (action === "mentions") { const value = !settings.allowMentions; await updateSettings(interaction.user.id, { allowMentions: value }); await interaction.reply({ content: `Menções: **${value ? "ativadas" : "desativadas"}**.`, ephemeral: true }); }
  else if (action === "spontaneous") { const value = !settings.spontaneousInteractions; await updateSettings(interaction.user.id, { spontaneousInteractions: value }); await interaction.reply({ content: `Interações espontâneas: **${value ? "ativadas" : "desativadas"}**.`, ephemeral: true }); }
  else if (action === "humor") { const value = settings.humorLevel >= 5 ? 1 : settings.humorLevel + 1; await updateSettings(interaction.user.id, { humorLevel: value }); await interaction.reply({ content: `Nível de humor: **${value}/5**.`, ephemeral: true }); }
  else if (action === "personality" && interaction.isStringSelectMenu()) { if (!hasPersonalityAccess(member)) await interaction.reply({ content: "Personalidade individual é exclusiva para quem possui o cargo Prisma AI.", ephemeral: true }); else { const value = interaction.values[0] as Personality; await updateSettings(interaction.user.id, { personality: value }); await interaction.reply({ content: `Personalidade definida como **${value}**.`, ephemeral: true }); } }
  else if (action === "clear-history") { await clearUserHistory(interaction.user.id); await interaction.reply({ content: "Seu histórico temporário foi apagado.", ephemeral: true }); }
  return true;
}
