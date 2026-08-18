import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  GuildMember,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type SendableChannels,
  type APIContainerComponent,
} from "discord.js";
import { config } from "../../config.js";
import { aiPanelEmojis } from "../../emoji-manager.js";
import { accessLevel } from "./permissions.js";
import { sanitizeNickname } from "./personality.js";
import { qualitativeRelationship, safeAboutMe, type PrismaRelationship } from "./state.js";
import { clearNickname, clearUserHistory, getPrismaState, getSettings, resetPrismaState, updateSettings, type UserSettings } from "./store.js";

export function publicPanelComponents(): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: 0x7c5cff,
    components: [
      { type: ComponentType.TextDisplay, content: "## PRISMA • AI\n\n### Uma nova forma de interagir com a Prisma\n\nUma personalidade-base consistente que desenvolve uma dinâmica própria com você ao longo das conversas." },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.MediaGallery, items: [{ media: { url: "https://i.imgur.com/tpY1lXI.gif" } }] },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("prisma-ai:open").setLabel("Abrir painel").setEmoji(aiPanelEmojis.user ?? "👤").setStyle(ButtonStyle.Primary),
      ).toJSON(),
    ],
  }];
}

function userPanelButtons(settings: UserSettings): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prisma-ai:nickname").setLabel("Apelido").setEmoji(aiPanelEmojis.user ?? "👤").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("prisma-ai:memory").setLabel("Memória recente").setEmoji(aiPanelEmojis.memory ?? "🧠").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:mentions").setLabel("Menções").setEmoji(aiPanelEmojis.mention ?? "📨").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:spontaneous").setLabel("Espontâneas").setEmoji(aiPanelEmojis.spontaneous ?? "⚡").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("prisma-ai:about-me").setLabel("Sobre mim").setEmoji(aiPanelEmojis.humor ?? "🙂").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prisma-ai:clear-history").setLabel("Apagar histórico de 48h").setEmoji(aiPanelEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("prisma-ai:reset-relationship").setLabel("Reiniciar relação").setEmoji(aiPanelEmojis.reset ?? "🔄").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("prisma-ai:nickname-remove").setLabel("Remover apelido").setEmoji(aiPanelEmojis.close ?? "✖️").setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function resetConfirmationComponents(result?: "cancelled" | "relationship" | "all"): APIContainerComponent[] {
  const message = result === "cancelled"
    ? "## Reinício cancelado\nNenhuma informação foi alterada."
    : result === "relationship"
      ? "## Relação reiniciada\nA dinâmica construída com a Prisma foi apagada."
      : result === "all"
        ? "## Relação e histórico reiniciados\nA dinâmica e o histórico recente foram apagados."
        : "## Reiniciar vínculo com a Prisma\nEscolha quais informações deseja apagar permanentemente. Essa ação não pode ser desfeita.";
  const components: APIContainerComponent["components"] = [
    { type: ComponentType.TextDisplay, content: message },
  ];
  if (!result) components.push(
    { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("prisma-ai:reset-only").setLabel("Só a relação").setEmoji(aiPanelEmojis.reset ?? "🔄").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("prisma-ai:reset-with-history").setLabel("Relação + histórico").setEmoji(aiPanelEmojis.trash ?? "🗑️").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("prisma-ai:reset-cancel").setLabel("Cancelar").setEmoji(aiPanelEmojis.close ?? "✖️").setStyle(ButtonStyle.Secondary),
    ).toJSON(),
  );
  return [{
    type: ComponentType.Container,
    accent_color: result === "cancelled" ? 0x99aab5 : result ? 0x57f287 : 0xed4245,
    components,
  }];
}

export function relationshipPercentage(relationship: PrismaRelationship): number {
  return Math.round((
    normalizedRelationshipScore(relationship.familiarity, 10)
    + normalizedRelationshipScore(relationship.warmth, 50)
    + normalizedRelationshipScore(relationship.trust, 30)
    + normalizedRelationshipScore(relationship.banter, 30)
  ) / 4);
}

function normalizedRelationshipScore(value: number, initialValue: number): number {
  if (value <= initialValue) return 0;
  return Math.round(((value - initialValue) / (100 - initialValue)) * 100);
}

function progressBar(value: number): string {
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}`;
}

export function shortAboutMe(value: string, maximum = 40): string {
  const text = value.trim();
  if (text.length <= maximum) return text;
  const preview = text.slice(0, maximum + 1);
  const wordBoundary = preview.lastIndexOf(" ");
  const shortened = (wordBoundary > 0 ? preview.slice(0, wordBoundary) : text.slice(0, maximum)).trimEnd();
  return `${shortened}...`;
}

export function userPanelComponents(user: Interaction["user"], settings: UserSettings, relationship: PrismaRelationship): APIContainerComponent[] {
  const status = (enabled: boolean) => enabled ? "🟢 Ativadas" : "⚪ Desativadas";
  const progress = relationshipPercentage(relationship);
  const affinity = Math.round((normalizedRelationshipScore(relationship.familiarity, 10) + normalizedRelationshipScore(relationship.warmth, 50)) / 2);
  const trust = normalizedRelationshipScore(relationship.trust, 30);
  const harmony = Math.round((normalizedRelationshipScore(relationship.warmth, 50) + normalizedRelationshipScore(relationship.banter, 30)) / 2);
  return [{
    type: ComponentType.Container,
    accent_color: 0x7c5cff,
    components: [
      {
        type: ComponentType.Section,
        components: [{
          type: ComponentType.TextDisplay,
          content: `## Seu painel • Prisma AI\n<@${user.id}>\n\nSuas preferências e a dinâmica construída com a Prisma.`,
        }],
        accessory: {
          type: ComponentType.Thumbnail,
          media: { url: user.displayAvatarURL({ size: 256 }) },
          description: `Avatar de ${user.displayName}`,
        },
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: `### Vínculo com a Prisma\n**${qualitativeRelationship(relationship)}**\n${progressBar(progress)}　**${progress}%**\n\n**Afinidade**　${affinity}%\n**Confiança**　${trust}%\n**Sintonia**　${harmony}%\n\n**Como a Prisma vê vocês**\n${relationship.relationshipSummary || "A relação ainda está começando a ganhar forma."}`,
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: `### Suas preferências\n**Apelido**　${settings.nickname || "Não definido"}\n**Sobre mim**　${settings.aboutMe ? shortAboutMe(settings.aboutMe) : "Não informado"}\n**Memória recente**　${settings.memoryEnabled ? "🟢 Ativada • até 48 horas" : "⚪ Desativada"}\n**Menções**　${status(settings.allowMentions)}\n**Interações espontâneas**　${status(settings.spontaneousInteractions)}`,
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      ...userPanelButtons(settings).map((row) => row.toJSON()),
    ],
  }];
}

function hasPrismaControls(message: import("discord.js").Message): boolean {
  const containsControl = (component: unknown): boolean => {
    if (!component || typeof component !== "object") return false;
    const value = component as { customId?: unknown; components?: unknown[] };
    return (typeof value.customId === "string" && value.customId.startsWith("prisma-ai:"))
      || (Array.isArray(value.components) && value.components.some(containsControl));
  };
  return message.components.some(containsControl);
}

async function updateOrCreatePanel(client: Client, channel: SendableChannels): Promise<void> {
  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.filter((message) => message.author.id === client.user?.id && hasPrismaControls(message));
  const current = existing.first();
  if (current) await current.edit({ content: null, embeds: [], components: publicPanelComponents(), flags: ["IsComponentsV2"] });
  else await channel.send({ components: publicPanelComponents(), flags: ["IsComponentsV2"] });
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
  await interaction.deferReply({ flags: ["Ephemeral"] });
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

async function refreshUserPanel(interaction: Interaction): Promise<void> {
  const [settings, state] = await Promise.all([getSettings(interaction.user.id), getPrismaState(interaction.user.id)]);
  await interaction.editReply({ components: userPanelComponents(interaction.user, settings, state.relationship), allowedMentions: { parse: [] } });
}

export async function handlePanelInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith("prisma-ai:")) return false;
  if (!interaction.inGuild()) return true;
  const action = interaction.customId.split(":")[1];
  const selfServiceDeletion = ["clear-history", "reset-relationship", "reset-only", "reset-with-history", "reset-cancel", "nickname-remove"].includes(action);
  const resetConfirmation = interaction.isButton() && ["reset-only", "reset-with-history", "reset-cancel"].includes(action);
  const opensModal = interaction.isButton() && (action === "nickname" || action === "about-me");
  const updatesPanel = (interaction.isButton() && ["clear-history", "nickname-remove", "memory", "mentions", "spontaneous"].includes(action))
    || (interaction.isModalSubmit() && ["nickname-save", "about-me-save"].includes(action));
  if (resetConfirmation) await interaction.deferUpdate();
  else if (updatesPanel) await interaction.deferUpdate();
  else if (!opensModal && action !== "open" && action !== "reset-relationship") await interaction.deferReply({ flags: ["Ephemeral"] });

  const member = await authorizedMember(interaction);
  if (!selfServiceDeletion && (!member || accessLevel(member) === "none")) {
    const content = `A Prisma IA é exclusiva para membros com o cargo <@&${config.prismaAi.accessRoleId}>.`;
    if (interaction.deferred) await interaction.followUp({ content, flags: ["Ephemeral"], allowedMentions: { parse: [] } });
    else await interaction.reply({ content, flags: ["Ephemeral"], allowedMentions: { parse: [] } });
    return true;
  }

  if (action === "nickname" && interaction.isButton()) {
    const modal = new ModalBuilder().setCustomId("prisma-ai:nickname-save").setTitle("Apelido do Prisma");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("nickname").setLabel("Como Prisma deve chamar você?").setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true)));
    await interaction.showModal(modal); return true;
  }
  if (action === "about-me" && interaction.isButton()) {
    const settings = await getSettings(interaction.user.id);
    const modal = new ModalBuilder().setCustomId("prisma-ai:about-me-save").setTitle("Sobre mim");
    const input = new TextInputBuilder()
      .setCustomId("about-me")
      .setLabel("Conte algo curto sobre você")
      .setPlaceholder("Ex.: curto RPG e sou do interior")
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(160)
      .setRequired(true);
    if (settings.aboutMe) input.setValue(settings.aboutMe);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }
  if (action === "about-me-save" && interaction.isModalSubmit()) {
    const aboutMe = safeAboutMe(interaction.fields.getTextInputValue("about-me"));
    if (typeof aboutMe !== "string") {
      await interaction.editReply("Escreva uma frase curta, sem dados sensíveis, links ou instruções para a IA.");
      return true;
    }
    try {
      await updateSettings(interaction.user.id, { aboutMe });
    } catch (error) {
      if (error instanceof Error && error.message.includes("about_me")) {
        await interaction.editReply("O recurso “Sobre mim” ainda precisa da migração do banco de dados. Aplique `20260817_prisma_about_me.sql` no Supabase e tente novamente.");
        return true;
      }
      throw error;
    }
    await refreshUserPanel(interaction);
    return true;
  }
  if (action === "open" && interaction.isButton()) {
    const [settings, state] = await Promise.all([getSettings(interaction.user.id), getPrismaState(interaction.user.id)]);
    await interaction.reply({
      components: userPanelComponents(interaction.user, settings, state.relationship),
      flags: ["Ephemeral", "IsComponentsV2"],
      allowedMentions: { parse: [] },
    });
    return true;
  }
  if (action === "nickname-save" && interaction.isModalSubmit()) {
    const nickname = sanitizeNickname(interaction.fields.getTextInputValue("nickname"));
    if (!nickname) { await interaction.editReply("Digite um apelido válido."); return true; }
    await updateSettings(interaction.user.id, { nickname });
    await refreshUserPanel(interaction);
    return true;
  }
  if (action === "nickname-remove") {
    await clearNickname(interaction.user.id);
    await refreshUserPanel(interaction);
    return true;
  }
  if (action === "reset-relationship") {
    await interaction.reply({ components: resetConfirmationComponents(), flags: ["Ephemeral", "IsComponentsV2"] });
    return true;
  }
  if (action === "reset-cancel") {
    await interaction.deleteReply().catch(() => undefined);
    await interaction.followUp({ content: "Reinício cancelado. Nenhuma informação foi alterada.", flags: ["Ephemeral"] });
    return true;
  }
  if (action === "reset-only" || action === "reset-with-history") {
    const clearHistory = action === "reset-with-history";
    await resetPrismaState(interaction.user.id, clearHistory);
    await interaction.deleteReply().catch(() => undefined);
    await interaction.followUp({
      content: clearHistory
        ? "Relação e histórico reiniciados. A dinâmica e o histórico recente foram apagados."
        : "Relação reiniciada. A dinâmica construída com a Prisma foi apagada.",
      flags: ["Ephemeral"],
    });
    return true;
  }
  if (action === "humor" || action === "personality") {
    await interaction.editReply("Esse controle foi removido. A personalidade da Prisma agora evolui naturalmente com cada relação.");
    return true;
  }

  if (action === "clear-history") {
    await clearUserHistory(interaction.user.id);
    await refreshUserPanel(interaction);
    await interaction.followUp({ content: "Histórico recente de 48 horas apagado. A relação com a Prisma foi mantida.", flags: ["Ephemeral"] });
    return true;
  }

  const settings = await getSettings(interaction.user.id);
  if (action === "memory") {
    const value = !settings.memoryEnabled; await updateSettings(interaction.user.id, { memoryEnabled: value });
    if (!value) await clearUserHistory(interaction.user.id);
    await refreshUserPanel(interaction);
  } else if (action === "mentions") {
    const value = !settings.allowMentions; await updateSettings(interaction.user.id, { allowMentions: value });
    await refreshUserPanel(interaction);
  } else if (action === "spontaneous") {
    const value = !settings.spontaneousInteractions; await updateSettings(interaction.user.id, { spontaneousInteractions: value });
    await refreshUserPanel(interaction);
  }
  return true;
}
