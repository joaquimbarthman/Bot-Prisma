import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, PermissionFlagsBits, SeparatorSpacingSize,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client,
  type APIContainerComponent, type Interaction, type Message, type ModalSubmitInteraction, type PartialMessage, type VoiceState,
} from "discord.js";
import { config } from "../../config.js";
import { lfgCheckEmoji, lfgCloseEmoji, lfgGamepadEmoji, lfgTrashEmoji, lfgWarningEmoji } from "../../emoji-manager.js";
import { LFG_GAMES, type LfgGameKey } from "./config.js";
import { mutate, sessions, type LfgSession } from "./store.js";

const PREFIX = "lfg:";
const LFG_LIFETIME_MS = 24 * 60 * 60 * 1000;
const DELETION_WARNING_MS = 10 * 60 * 1000;
const createdCooldowns = new Map<string, number>();
const deletionWarningsShown = new Set<string>();
type Draft = { game: LfgGameKey; maxPlayers: number; note: string; expiresAt: number };
const drafts = new Map<string, Draft>();
export function isLfgGameKey(value: string | undefined): value is LfgGameKey {
  return value !== undefined && Object.prototype.hasOwnProperty.call(LFG_GAMES, value);
}
export function lfgGameRoleMention(game: LfgGameKey): string {
  const roleId = LFG_GAMES[game].roleId;
  return roleId ? `<@&${roleId}>` : "";
}
function draftKey(interaction: Interaction): string { return `${interaction.guildId ?? "dm"}:${interaction.user.id}`; }
function canManage(session: LfgSession, interaction: ButtonInteraction): boolean { return session.creatorId === interaction.user.id; }
function lfgExpiresAt(session: LfgSession): number { return Date.parse(session.createdAt) + LFG_LIFETIME_MS; }
function sessionStatus(session: LfgSession): LfgSession["status"] { return session.status === "open" && session.participants.length >= session.maxPlayers ? "completed" : session.status; }
function label(session: LfgSession, status: LfgSession["status"]): string {
  const remaining = lfgExpiresAt(session) - Date.now();
  if ((status === "open" || status === "completed") && remaining > 0 && remaining <= DELETION_WARNING_MS) return "🗑️ Será apagado em breve";
  return ({ open: "🟢 Aberto", completed: "✅ Completo", closed: "🔒 Fechado", expired: "⌛ Expirado", deleted: "🗑️ Excluído" })[status];
}
function currentCall(client: Client, session: LfgSession): string {
  const channelId = client.guilds.cache.get(session.guildId)?.voiceStates.cache.get(session.creatorId)?.channelId;
  return channelId ? `<#${channelId}>` : "Nenhuma call";
}
function publicationComponents(client: Client, session: LfgSession): APIContainerComponent[] {
  const game = LFG_GAMES[session.game]; const status = sessionStatus(session);
  const roleMention = lfgGameRoleMention(session.game);
  const participants = session.participants.map((id) => `<@${id}>`).join(", ") || "Nenhum";
  const inactive = session.status !== "open" || session.participants.length >= session.maxPlayers;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}join:${session.id}`).setLabel("Participar").setEmoji(lfgCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).setDisabled(inactive),
    new ButtonBuilder().setCustomId(`${PREFIX}leave:${session.id}`).setLabel("Sair").setEmoji(lfgCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary).setDisabled(session.status !== "open"),
  );
  row.addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}delete:${session.id}`).setLabel("Apagar LFG").setEmoji(lfgTrashEmoji() ?? "🗑️").setStyle(ButtonStyle.Danger),
  );
  return [{
    type: ComponentType.Container,
    accent_color: status === "open" ? 0x57f287 : status === "completed" ? 0x5865f2 : 0x99aab5,
    components: [
      {
        type: ComponentType.Section,
        components: [{
          type: ComponentType.TextDisplay,
          content: `### PRISMA • LFG\n## ${game.name}\n-# Criado por <@${session.creatorId}>${roleMention ? `　•　${roleMention}` : ""}\n\n${session.note || "Monte seu grupo e combine a partida com os participantes."}`,
        }],
        accessory: { type: ComponentType.Thumbnail, media: { url: game.img }, description: game.name },
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: `**Jogadores**　　　　　  　　**Status**\n${session.participants.length}/${session.maxPlayers}　　　　　   　 　　　　${label(session, status)}\n\n**Call atual**\n${currentCall(client, session)}\n\n**Participantes**\n${participants}`,
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      row.toJSON(),
    ],
  }];
}
function lfgPanelComponents(): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: 0x5865f2,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: "## PRISMA • LFG\n### Encontrar pessoas para jogar\nCrie um grupo em poucos toques e reúna sua equipe.",
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.MediaGallery, items: [{ media: { url: "https://i.imgur.com/r0pG15G.gif" } }] },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}create`).setLabel(" Criar grupo").setEmoji(lfgGamepadEmoji() ?? "🎮").setStyle(ButtonStyle.Primary),
      ).toJSON(),
    ],
  }];
}

function creationResultComponents(content: string, success = false): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: success ? 0x57f287 : 0xed4245,
    components: [{ type: ComponentType.TextDisplay, content }],
  }];
}

function hasButtonWithCustomId(component: unknown, customId: string): boolean {
  if (!component || typeof component !== "object") return false;
  const candidate = component as { customId?: unknown; components?: unknown };
  if (candidate.customId === customId) return true;
  return Array.isArray(candidate.components) && candidate.components.some((child) => hasButtonWithCustomId(child, customId));
}

function draftView(draft: Draft): { components: APIContainerComponent[] } {
  const slots = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}draft-slots`).setPlaceholder(`Vagas: ${draft.maxPlayers}`).addOptions([2, 3, 4, 5, 6, 8, 10, 12].map((value) => ({ label: `${value} jogadores`, value: String(value), default: value === draft.maxPlayers }))));
  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}draft-note`).setLabel("Adicionar observação").setEmoji(lfgWarningEmoji() ?? "⚠️").setStyle(ButtonStyle.Secondary));
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}draft-create`).setLabel("Publicar LFG").setEmoji(lfgCheckEmoji() ?? "✅").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`${PREFIX}draft-cancel`).setLabel("Cancelar").setEmoji(lfgCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary));
  return {
    components: [{ type: ComponentType.Container, accent_color: 0x5865f2, components: [
      { type: ComponentType.TextDisplay, content: `## Criar grupo • ${LFG_GAMES[draft.game].name}\nConfigure seu grupo em poucos toques. A observação é opcional.` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `**Vagas**\n${draft.maxPlayers} jogadores\n\n**Observação**\n${draft.note || "Nenhuma"}` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      slots.toJSON(), options.toJSON(),
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      actions.toJSON(),
    ] }],
  };
}
async function updateMessage(client: Client, session: LfgSession): Promise<void> { if (!session.messageId) return; const channel = await client.channels.fetch(session.channelId).catch(() => null); if (channel?.isTextBased()) await channel.messages.fetch(session.messageId).then((message) => message.edit({ embeds: [], components: publicationComponents(client, session), flags: ["IsComponentsV2"] })).catch(() => undefined); }
export async function handleLfgVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (oldState.channelId === newState.channelId) return;
  const active = (await sessions()).filter((session) => session.guildId === newState.guild.id && session.creatorId === newState.id && (session.status === "open" || session.status === "completed") && lfgExpiresAt(session) > Date.now());
  await Promise.all(active.map((session) => updateMessage(newState.client, session)));
}
export async function handleLfgMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guildId) return;
  const session = (await sessions()).find((value) => value.guildId === message.guildId && value.messageId === message.id);
  if (!session) return;
  await mutate((db) => {
    const current = db.sessions.find((value) => value.id === session.id);
    if (current) { current.status = "deleted"; current.updatedAt = new Date().toISOString(); }
  });
}
async function showCreate(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: ["Ephemeral"] });
  const last = createdCooldowns.get(interaction.user.id) ?? 0; if (Date.now() - last < config.lfg.createCooldownSeconds * 1000) { await interaction.editReply({ content: "Aguarde um instante antes de criar outro LFG." }); return; }
  const games = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}game`).setPlaceholder("Selecione o jogo").addOptions(Object.entries(LFG_GAMES).map(([value, game]) => ({ label: game.name, value }))));
  await interaction.editReply({ components: [{ type: ComponentType.Container, accent_color: 0x5865f2, components: [{ type: ComponentType.TextDisplay, content: "## Criar grupo\nEscolha o jogo para começar." }, games.toJSON()] }], flags: ["IsComponentsV2"] });
}
async function submitCreate(interaction: ButtonInteraction, draft: Draft): Promise<void> {
  if (!interaction.inGuild()) return; const { game, maxPlayers } = draft;
  if (!interaction.channelId) { await interaction.editReply({ components: creationResultComponents("Não encontrei o canal para publicar este LFG.") }); return; }
  const channel = interaction.channel;
  if (!channel?.isTextBased()) { await interaction.editReply({ components: creationResultComponents("Não encontrei um canal de texto para publicar este LFG.") }); return; }
  const gameRoleId = LFG_GAMES[game].roleId;
  const gameRole = gameRoleId ? await interaction.guild!.roles.fetch(gameRoleId).catch(() => null) : null;
  const botCanMentionAnyRole = channel.permissionsFor(interaction.client.user!)?.has(PermissionFlagsBits.MentionEveryone) ?? false;
  if (gameRoleId && !gameRole) { await interaction.editReply({ components: creationResultComponents(`O cargo configurado para ${LFG_GAMES[game].name} não existe mais. Avise a equipe para atualizar o painel.`) }); return; }
  if (gameRole && !gameRole.mentionable && !botCanMentionAnyRole) { await interaction.editReply({ components: creationResultComponents(`Não consigo mencionar o cargo ${gameRole}. Deixe o cargo mencionável ou conceda ao bot a permissão de mencionar cargos.`) }); return; }
  const now = new Date(); const id = crypto.randomUUID(); const expiresAt = new Date(now.getTime() + LFG_LIFETIME_MS).toISOString();
  const session: LfgSession = { id, guildId: interaction.guildId!, channelId: interaction.channelId, messageId: null, roleMentionMessageId: null, creatorId: interaction.user.id, game, maxPlayers, participants: [interaction.user.id], note: draft.note, status: "open", createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt };
  const openCount = (await sessions()).filter((value) => value.guildId === session.guildId && value.creatorId === session.creatorId && (value.status === "open" || value.status === "completed")).length; if (openCount >= config.lfg.maxOpenPerUser) { await interaction.editReply({ components: creationResultComponents(`Você já atingiu o limite de ${config.lfg.maxOpenPerUser} LFGs ativos.`) }); return; }
  await mutate((db) => { db.sessions.push(session); });
  const message = await channel.send({ components: publicationComponents(interaction.client, session), flags: ["IsComponentsV2"], allowedMentions: { parse: [], roles: gameRoleId ? [gameRoleId] : [] } });
  await mutate((db) => { const current = db.sessions.find((value) => value.id === id)!; current.messageId = message.id; current.updatedAt = new Date().toISOString(); });
  createdCooldowns.set(interaction.user.id, Date.now()); drafts.delete(draftKey(interaction)); await interaction.editReply({ components: creationResultComponents("LFG criado e publicado.", true) });
}
export async function startLfgModule(client: Client): Promise<void> {
  await mutate((db) => {
    for (const session of db.sessions) {
      const expiresAt = new Date(lfgExpiresAt(session)).toISOString();
      if (session.expiresAt !== expiresAt) session.expiresAt = expiresAt;
      if (session.status === "expired" && lfgExpiresAt(session) > Date.now()) {
        session.status = session.participants.length >= session.maxPlayers ? "completed" : "open";
        session.updatedAt = new Date().toISOString();
      }
    }
  });
  await Promise.all((await sessions()).map((session) => updateMessage(client, session)));
  if (!config.lfg.panelChannelId) return;
  const channel = await client.channels.fetch(config.lfg.panelChannelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) { console.error("[LFG] Canal do painel não encontrado."); return; }
  const messages = await channel.messages.fetch({ limit: 50 });
  const existing = messages.find((message) => message.author.id === client.user?.id && message.components.some((component) => hasButtonWithCustomId(component, `${PREFIX}create`)));
  const payload = { components: lfgPanelComponents(), flags: ["IsComponentsV2"] as const };
  if (existing) await existing.edit({ ...payload, embeds: [] });
  else await channel.send(payload);
}
export async function handleLfgInteraction(interaction: Interaction): Promise<boolean> {
  if (!(interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith(PREFIX)) return false;
  const [,, id] = interaction.customId.split(":");
  if (interaction.isButton() && interaction.customId === `${PREFIX}create`) { await showCreate(interaction); return true; }
  if (interaction.isButton() && interaction.customId === `${PREFIX}open`) { const active = (await sessions()).filter((value) => value.guildId === interaction.guildId && value.status === "open" && lfgExpiresAt(value) > Date.now()); await interaction.reply({ content: active.length ? active.map((value) => `• **${LFG_GAMES[value.game].name}** — ${value.participants.length}/${value.maxPlayers} <#${value.channelId}>`).join("\n") : "Não há grupos abertos agora.", flags: ["Ephemeral"], allowedMentions: { parse: [] } }); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}game`) { const game = interaction.values[0]; if (!isLfgGameKey(game)) { await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0xed4245, components: [{ type: ComponentType.TextDisplay, content: "Esse jogo não está mais disponível. Abra a criação novamente para ver a lista atualizada." }] }] }); return true; } const draft: Draft = { game, maxPlayers: 4, note: "", expiresAt: Date.now() + 15 * 60_000 }; drafts.set(draftKey(interaction), draft); await interaction.update(draftView(draft)); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}draft-slots`) { const draft = drafts.get(draftKey(interaction)); if (!draft || draft.expiresAt < Date.now()) { await interaction.reply({ content: "Essa criação expirou. Comece novamente.", flags: ["Ephemeral"] }); return true; } draft.maxPlayers = Number(interaction.values[0]); await interaction.update(draftView(draft)); return true; }
  if (interaction.isModalSubmit() && interaction.customId === `${PREFIX}draft-note-modal`) { const draft = drafts.get(draftKey(interaction)); if (!draft || draft.expiresAt < Date.now()) { await interaction.reply({ content: "Essa criação expirou. Comece novamente.", flags: ["Ephemeral"] }); return true; } draft.note = interaction.fields.getTextInputValue("note").trim().replace(/@(?:everyone|here)|<@&?\d+>/g, "@").slice(0, 500); await interaction.reply({ ...draftView(draft), flags: ["Ephemeral", "IsComponentsV2"] }); return true; }
  if (!interaction.isButton()) return true;
  const action = interaction.customId.split(":")[1];
  if (action.startsWith("draft-")) { const draft = drafts.get(draftKey(interaction)); if (!draft || draft.expiresAt < Date.now()) { await interaction.reply({ content: "Essa criação expirou. Comece novamente.", flags: ["Ephemeral"] }); return true; } if (action === "draft-note") { await interaction.showModal({ customId: `${PREFIX}draft-note-modal`, title: "Observação do grupo", components: [new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("note").setLabel("Modo, rank ou objetivo (opcional)").setStyle(TextInputStyle.Paragraph).setValue(draft.note).setRequired(false).setMaxLength(500))] }); return true; } if (action === "draft-cancel") { drafts.delete(draftKey(interaction)); await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0x99aab5, components: [{ type: ComponentType.TextDisplay, content: "Criação cancelada." }] }] }); return true; } if (action === "draft-create") { await interaction.deferUpdate(); await submitCreate(interaction, draft); return true; } }
  const deferredReply = action === "join" || action === "leave";
  const deferredUpdate = action === "confirm-delete";
  if (deferredReply) await interaction.deferReply({ flags: ["Ephemeral"] });
  else if (deferredUpdate) await interaction.deferUpdate();
  const session = (await sessions()).find((value) => value.id === id); if (!session) { if (deferredReply || deferredUpdate) await interaction.editReply({ content: "Este LFG não existe mais.", components: [] }); else await interaction.reply({ content: "Este LFG não existe mais.", flags: ["Ephemeral"] }); return true; }
  if ((action === "join" || action === "leave") && lfgExpiresAt(session) <= Date.now()) {
    await mutate((db) => { const value = db.sessions.find((item) => item.id === id); if (value && (value.status === "open" || value.status === "completed")) { value.status = "expired"; value.updatedAt = new Date().toISOString(); } });
    await interaction.editReply({ content: "Esta LFG expirou após 24 horas." });
    return true;
  }
  if (action === "delete") { if (!canManage(session, interaction)) { await interaction.reply({ content: "Somente quem criou a LFG pode apagá-la.", flags: ["Ephemeral"] }); return true; } const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}confirm-delete:${id}`).setLabel("Excluir").setEmoji(lfgTrashEmoji() ?? "🗑️").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`${PREFIX}cancel-delete:${id}`).setLabel("Cancelar").setEmoji(lfgCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary)); await interaction.reply({ components: [{ type: ComponentType.Container, accent_color: 0xed4245, components: [{ type: ComponentType.TextDisplay, content: "## Excluir LFG\nIsso encerrará o grupo e removerá a postagem." }, { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small }, buttons.toJSON()] }], flags: ["Ephemeral", "IsComponentsV2"] }); return true; }
  if (action === "cancel-delete") { await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0x99aab5, components: [{ type: ComponentType.TextDisplay, content: "Exclusão cancelada." }] }] }); return true; }
  if (action === "confirm-delete") {
    if (!canManage(session, interaction)) { await interaction.editReply({ content: "Somente quem criou a LFG pode apagá-la.", components: [] }); return true; }
    await mutate((db) => { const value = db.sessions.find((item) => item.id === id); if (value) { value.status = "deleted"; value.updatedAt = new Date().toISOString(); } });
    if (session.messageId || session.roleMentionMessageId) { const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null); if (channel?.isTextBased()) await Promise.all([session.messageId, session.roleMentionMessageId].filter((messageId): messageId is string => !!messageId).map((messageId) => channel.messages.fetch(messageId).then((message) => message.delete()).catch(() => undefined))); }
    await interaction.editReply({ components: creationResultComponents("LFG excluído e anúncio apagado.", true) }); return true;
  }
  const saved = await mutate((db) => { const value = db.sessions.find((item) => item.id === id)!; if (action === "join") { if (value.status !== "open" || value.participants.length >= value.maxPlayers || value.participants.includes(interaction.user.id)) return value; value.participants.push(interaction.user.id); if (value.participants.length >= value.maxPlayers) value.status = "completed"; } else if (action === "leave") { value.participants = value.participants.filter((userId) => userId !== interaction.user.id); if (value.status === "completed") value.status = "open"; } value.updatedAt = new Date().toISOString(); return value; });
  await updateMessage(interaction.client, saved); await interaction.editReply({ content: action === "join" ? "Participação atualizada." : "Você saiu do grupo." }); return true;
}
export function startLfgCleanup(client: Client): void {
  const cleanup = async (): Promise<void> => { for (const session of await sessions()) {
    const remaining = lfgExpiresAt(session) - Date.now();
    if ((session.status === "open" || session.status === "completed") && remaining > 0 && remaining <= DELETION_WARNING_MS && !deletionWarningsShown.has(session.id)) {
      await updateMessage(client, session);
      deletionWarningsShown.add(session.id);
    }
    if (lfgExpiresAt(session) <= Date.now()) {
      deletionWarningsShown.delete(session.id);
      const channel = await client.channels.fetch(session.channelId).catch(() => null);
      const deleted = channel?.isTextBased() && session.messageId
        ? await channel.messages.fetch(session.messageId).then((message) => message.delete()).then(() => true).catch(() => false)
        : !session.messageId;
      const mentionDeleted = channel?.isTextBased() && session.roleMentionMessageId
        ? await channel.messages.fetch(session.roleMentionMessageId).then((message) => message.delete()).then(() => true).catch(() => false)
        : !session.roleMentionMessageId;
      await mutate((db) => {
        const current = db.sessions.find((item) => item.id === session.id);
        if (current) {
          if (current.status === "open" || current.status === "completed") current.status = "expired";
          if (deleted) current.messageId = null;
          if (mentionDeleted) current.roleMentionMessageId = null;
          current.updatedAt = new Date().toISOString();
        }
      });
    }
  } };
  void cleanup().catch((error) => console.error("[LFG] Falha na limpeza inicial:", error));
  setInterval(() => void cleanup().catch((error) => console.error("[LFG] Falha na limpeza periódica:", error)), 60_000).unref();
}
