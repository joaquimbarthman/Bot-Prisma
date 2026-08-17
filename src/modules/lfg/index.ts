import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, EmbedBuilder, PermissionFlagsBits, SeparatorSpacingSize,
  StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type Client,
  type APIContainerComponent, type GuildMember, type Interaction, type ModalSubmitInteraction,
} from "discord.js";
import { config } from "../../config.js";
import { lfgCheckEmoji, lfgCloseEmoji, lfgGamepadEmoji, lfgSoundEmoji, lfgTrashEmoji, lfgWarningEmoji } from "../../emoji-manager.js";
import { LFG_GAMES, LFG_VOICE_CATEGORY_ID, type LfgGameKey } from "./config.js";
import { mutate, sessions, type LfgSession } from "./store.js";

const PREFIX = "lfg:";
const PUBLICATION_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const createdCooldowns = new Map<string, number>();
let botAvatarUrl: string | undefined;
type Draft = { game: LfgGameKey; maxPlayers: number; scheduledMinutes: number; autoVoiceEnabled: boolean; note: string; expiresAt: number };
const drafts = new Map<string, Draft>();
function draftKey(interaction: Interaction): string { return `${interaction.guildId ?? "dm"}:${interaction.user.id}`; }
function isStaff(member: GuildMember): boolean { return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator) || (!!config.lfg.staffRoleId && member.roles.cache.has(config.lfg.staffRoleId)); }
function canManage(session: LfgSession, interaction: ButtonInteraction): boolean { return session.creatorId === interaction.user.id || (!!interaction.member && "permissions" in interaction.member && isStaff(interaction.member as GuildMember)); }
function safeName(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 75) || "usuario"; }
export function lfgVoiceChannelName(username: string): string { return `🕹️・lobby-${safeName(username)}`; }
function sessionStatus(session: LfgSession): LfgSession["status"] { return session.status === "open" && session.participants.length >= session.maxPlayers ? "completed" : session.status; }
function label(status: LfgSession["status"]): string { return ({ open: "🟢 Aberto", completed: "✅ Completo", closed: "🔒 Fechado", expired: "⌛ Expirado", deleted: "🗑️ Excluído" })[status]; }
function publicationComponents(session: LfgSession): APIContainerComponent[] {
  const game = LFG_GAMES[session.game]; const status = sessionStatus(session);
  const scheduled = session.scheduledFor ? `<t:${Math.floor(Date.parse(session.scheduledFor) / 1000)}:t>` : "Agora";
  const participants = session.participants.map((id) => `<@${id}>`).join(", ") || "Nenhum";
  const inactive = session.status !== "open" || session.participants.length >= session.maxPlayers;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}join:${session.id}`).setLabel("Participar").setEmoji(lfgCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).setDisabled(inactive),
    new ButtonBuilder().setCustomId(`${PREFIX}leave:${session.id}`).setLabel("Sair").setEmoji(lfgCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary).setDisabled(session.status !== "open"),
  );
  if (session.voiceChannelId) row.addComponents(new ButtonBuilder().setLabel("Entrar no lobby").setEmoji(lfgSoundEmoji() ?? "🎵").setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${session.guildId}/${session.voiceChannelId}`));
  else row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}voice:${session.id}`).setLabel("Criar lobby").setEmoji(lfgSoundEmoji() ?? "🎵").setStyle(ButtonStyle.Primary).setDisabled(session.status === "deleted"));
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
          content: `### PRISMA • LFG\n## ${game.name}\n${session.note || "Monte seu grupo e entre no lobby quando estiver pronto."}`,
        }],
        accessory: { type: ComponentType.Thumbnail, media: { url: game.img }, description: game.name },
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: `**Criador**　　　　　　　　　**Jogadores**\n<@${session.creatorId}>　　　　${session.participants.length}/${session.maxPlayers}\n\n**Horário**　　　　　　　　　**Status**\n${scheduled}　　　　　　　　　　${label(status)}\n\n**Participantes**\n${participants}`,
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      row.toJSON(),
    ],
  }];
}
function panel(): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } { const card = new EmbedBuilder().setColor(0x5865f2).setAuthor({ name: "PRISMA • LFG" }).setTitle("Encontrar pessoas para jogar").setDescription("Crie um grupo em poucos toques, reúna sua equipe e entre no lobby.").addFields({ name: "Como funciona", value: "Escolha o jogo, defina vagas e publique. Quando o grupo estiver completo, ele é marcado automaticamente.", inline: false }); if (botAvatarUrl) card.setThumbnail(botAvatarUrl); return { embeds: [card], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}create`).setLabel("・ Criar grupo").setEmoji(lfgGamepadEmoji() ?? "🎮").setStyle(ButtonStyle.Primary))] }; }
function lfgPanelComponents(): APIContainerComponent[] {
  return [{
    type: ComponentType.Container,
    accent_color: 0x5865f2,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: "## PRISMA • LFG\n### Encontrar pessoas para jogar\nCrie um grupo em poucos toques, reuna sua equipe e entre no lobby.",
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

function hasButtonWithCustomId(component: unknown, customId: string): boolean {
  if (!component || typeof component !== "object") return false;
  const candidate = component as { customId?: unknown; components?: unknown };
  if (candidate.customId === customId) return true;
  return Array.isArray(candidate.components) && candidate.components.some((child) => hasButtonWithCustomId(child, customId));
}

function draftView(draft: Draft): { components: APIContainerComponent[] } {
  const schedule = draft.scheduledMinutes ? `Daqui a ${draft.scheduledMinutes} min` : "Agora";
  const slots = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}draft-slots`).setPlaceholder(`Vagas: ${draft.maxPlayers}`).addOptions([2, 3, 4, 5, 6, 8, 10, 12].map((value) => ({ label: `${value} jogadores`, value: String(value), default: value === draft.maxPlayers }))));
  const time = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}draft-time`).setPlaceholder(`Horário: ${schedule}`).addOptions([{ label: "Agora", value: "0", default: draft.scheduledMinutes === 0 }, { label: "Daqui a 30 minutos", value: "30", default: draft.scheduledMinutes === 30 }, { label: "Daqui a 1 hora", value: "60", default: draft.scheduledMinutes === 60 }, { label: "Daqui a 2 horas", value: "120", default: draft.scheduledMinutes === 120 }]));
  const options = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}draft-voice`).setLabel(draft.autoVoiceEnabled ? "Call automática: ligada" : "Call automática: desligada").setEmoji(lfgSoundEmoji() ?? "🎵").setStyle(draft.autoVoiceEnabled ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`${PREFIX}draft-note`).setLabel("Adicionar observação").setEmoji(lfgWarningEmoji() ?? "⚠️").setStyle(ButtonStyle.Secondary));
  const actions = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}draft-create`).setLabel("Publicar LFG").setEmoji(lfgCheckEmoji() ?? "✅").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`${PREFIX}draft-cancel`).setLabel("Cancelar").setEmoji(lfgCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary));
  return {
    components: [{ type: ComponentType.Container, accent_color: 0x5865f2, components: [
      { type: ComponentType.TextDisplay, content: `## Criar grupo • ${LFG_GAMES[draft.game].name}\nConfigure seu grupo em poucos toques. A observação é opcional.` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `**Vagas**　　　　　 **Horário**　　　　　 **Call automática**\n${draft.maxPlayers} jogadores　　　　 ${schedule}　　　　　 ${draft.autoVoiceEnabled ? "🟢 Ativada" : "⚪ Desativada"}\n\n**Observação**\n${draft.note || "Nenhuma"}` },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      slots.toJSON(), time.toJSON(), options.toJSON(),
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      actions.toJSON(),
    ] }],
  };
}
async function updateMessage(client: Client, session: LfgSession): Promise<void> { if (!session.messageId) return; const channel = await client.channels.fetch(session.channelId).catch(() => null); if (channel?.isTextBased()) await channel.messages.fetch(session.messageId).then((message) => message.edit({ content: null, embeds: [], components: publicationComponents(session), flags: ["IsComponentsV2"] })).catch(() => undefined); }
async function createVoice(client: Client, sessionId: string): Promise<LfgSession | null> {
  const session = (await sessions()).find((value) => value.id === sessionId); if (!session || session.voiceChannelId || session.status === "deleted") return session ?? null;
  const guild = await client.guilds.fetch(session.guildId).catch(() => null); if (!guild) return null;
  const creator = await guild.members.fetch(session.creatorId).catch(() => null);
  const lobbyName = lfgVoiceChannelName(creator?.user.username ?? session.creatorId);
  const role = await guild.roles.create({ name: lobbyName, reason: `Acesso temporário ao LFG ${session.id}` });
  const channel = await guild.channels.create({ name: lobbyName, type: ChannelType.GuildVoice, parent: LFG_VOICE_CATEGORY_ID, userLimit: session.maxPlayers, permissionOverwrites: [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
    { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.UseVAD] },
  ], reason: `Lobby temporário do LFG ${session.id}` });
  const saved = await mutate((db) => { const current = db.sessions.find((value) => value.id === sessionId); if (!current) return null; if (current.voiceChannelId) return current; current.voiceChannelId = channel.id; current.temporaryRoleId = role.id; current.updatedAt = new Date().toISOString(); return current; });
  if (saved?.voiceChannelId !== channel.id) { await channel.delete("Lobby duplicado de LFG evitado").catch(() => undefined); await role.delete("Cargo duplicado de LFG evitado").catch(() => undefined); }
  else await Promise.all(saved!.participants.map((userId) => guild.members.fetch(userId).then((member) => member.roles.add(role, `Participante do LFG ${session.id}`)).catch(() => undefined)));
  return saved;
}
async function showCreate(interaction: ButtonInteraction): Promise<void> {
  const last = createdCooldowns.get(interaction.user.id) ?? 0; if (Date.now() - last < config.lfg.createCooldownSeconds * 1000) { await interaction.reply({ content: "Aguarde um instante antes de criar outro LFG.", ephemeral: true }); return; }
  const games = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}game`).setPlaceholder("Selecione o jogo").addOptions(Object.entries(LFG_GAMES).map(([value, game]) => ({ label: game.name, value }))));
  await interaction.reply({ components: [{ type: ComponentType.Container, accent_color: 0x5865f2, components: [{ type: ComponentType.TextDisplay, content: "## Criar grupo\nEscolha o jogo para começar." }, games.toJSON()] }], flags: ["Ephemeral", "IsComponentsV2"] });
}
async function submitCreate(interaction: ButtonInteraction, draft: Draft): Promise<void> {
  if (!interaction.inGuild()) return; const { game, maxPlayers, autoVoiceEnabled: auto } = draft;
  if (!interaction.channelId) { await interaction.reply({ content: "Não encontrei o canal para publicar este LFG.", ephemeral: true }); return; }
  const now = new Date(); const scheduledFor = draft.scheduledMinutes ? new Date(now.getTime() + draft.scheduledMinutes * 60_000) : null; const id = crypto.randomUUID(); const expiresAt = new Date((scheduledFor?.getTime() ?? now.getTime()) + (scheduledFor ? config.lfg.scheduledGraceMinutes : config.lfg.nowExpiryMinutes) * 60_000).toISOString();
  const session: LfgSession = { id, guildId: interaction.guildId!, channelId: interaction.channelId, messageId: null, roleMentionMessageId: null, creatorId: interaction.user.id, game, maxPlayers, participants: [interaction.user.id], scheduledFor: scheduledFor?.toISOString() ?? null, note: draft.note, autoVoiceEnabled: auto, voiceChannelId: null, temporaryRoleId: null, status: "open", createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt, deleteVoiceWhenEmpty: false };
  const openCount = (await sessions()).filter((value) => value.guildId === session.guildId && value.creatorId === session.creatorId && (value.status === "open" || value.status === "completed")).length; if (openCount >= config.lfg.maxOpenPerUser) { await interaction.reply({ content: `Você já atingiu o limite de ${config.lfg.maxOpenPerUser} LFGs ativos.`, ephemeral: true }); return; }
  await mutate((db) => { db.sessions.push(session); });
  const publishedSession = session.autoVoiceEnabled ? await createVoice(interaction.client, id) ?? session : session;
  const channel = interaction.channel; if (!channel?.isTextBased()) return;
  const gameRoleId = LFG_GAMES[game].roleId;
  const roleMention = await channel.send({ content: `<@&${gameRoleId}>`, allowedMentions: { parse: [], roles: [gameRoleId] } });
  const message = await channel.send({ components: publicationComponents(publishedSession), flags: ["IsComponentsV2"] }).catch(async (error) => { await roleMention.delete().catch(() => undefined); throw error; });
  await mutate((db) => { const current = db.sessions.find((value) => value.id === id)!; current.messageId = message.id; current.roleMentionMessageId = roleMention.id; current.updatedAt = new Date().toISOString(); });
  createdCooldowns.set(interaction.user.id, Date.now()); drafts.delete(draftKey(interaction)); await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0x57f287, components: [{ type: ComponentType.TextDisplay, content: "LFG criado e publicado." }] }] });
}
export async function startLfgModule(client: Client): Promise<void> {
  botAvatarUrl = client.user?.displayAvatarURL({ size: 256 });
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
  if (interaction.isButton() && interaction.customId === `${PREFIX}open`) { const active = (await sessions()).filter((value) => value.guildId === interaction.guildId && value.status === "open"); await interaction.reply({ content: active.length ? active.map((value) => `• **${LFG_GAMES[value.game].name}** — ${value.participants.length}/${value.maxPlayers} <#${value.channelId}>`).join("\n") : "Não há grupos abertos agora.", ephemeral: true, allowedMentions: { parse: [] } }); return true; }
  if (interaction.isStringSelectMenu() && interaction.customId === `${PREFIX}game`) { const draft: Draft = { game: interaction.values[0] as LfgGameKey, maxPlayers: 4, scheduledMinutes: 0, autoVoiceEnabled: false, note: "", expiresAt: Date.now() + 15 * 60_000 }; drafts.set(draftKey(interaction), draft); await interaction.update(draftView(draft)); return true; }
  if (interaction.isStringSelectMenu() && (interaction.customId === `${PREFIX}draft-slots` || interaction.customId === `${PREFIX}draft-time`)) { const draft = drafts.get(draftKey(interaction)); if (!draft || draft.expiresAt < Date.now()) { await interaction.reply({ content: "Essa criação expirou. Comece novamente.", ephemeral: true }); return true; } if (interaction.customId.endsWith("slots")) draft.maxPlayers = Number(interaction.values[0]); else draft.scheduledMinutes = Number(interaction.values[0]); await interaction.update(draftView(draft)); return true; }
  if (interaction.isModalSubmit() && interaction.customId === `${PREFIX}draft-note-modal`) { const draft = drafts.get(draftKey(interaction)); if (!draft || draft.expiresAt < Date.now()) { await interaction.reply({ content: "Essa criação expirou. Comece novamente.", ephemeral: true }); return true; } draft.note = interaction.fields.getTextInputValue("note").trim().replace(/@(?:everyone|here)|<@&?\d+>/g, "@").slice(0, 500); await interaction.reply({ ...draftView(draft), flags: ["Ephemeral", "IsComponentsV2"] }); return true; }
  if (!interaction.isButton()) return true;
  const action = interaction.customId.split(":")[1];
  if (action.startsWith("draft-")) { const draft = drafts.get(draftKey(interaction)); if (!draft || draft.expiresAt < Date.now()) { await interaction.reply({ content: "Essa criação expirou. Comece novamente.", ephemeral: true }); return true; } if (action === "draft-voice") { draft.autoVoiceEnabled = !draft.autoVoiceEnabled; await interaction.update(draftView(draft)); return true; } if (action === "draft-note") { await interaction.showModal({ customId: `${PREFIX}draft-note-modal`, title: "Observação do grupo", components: [new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId("note").setLabel("Modo, rank ou objetivo (opcional)").setStyle(TextInputStyle.Paragraph).setValue(draft.note).setRequired(false).setMaxLength(500))] }); return true; } if (action === "draft-cancel") { drafts.delete(draftKey(interaction)); await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0x99aab5, components: [{ type: ComponentType.TextDisplay, content: "Criação cancelada." }] }] }); return true; } if (action === "draft-create") { await submitCreate(interaction, draft); return true; } }
  const session = (await sessions()).find((value) => value.id === id); if (!session) { await interaction.reply({ content: "Este LFG não existe mais.", ephemeral: true }); return true; }
  if (action === "delete") { if (!canManage(session, interaction)) { await interaction.reply({ content: "Somente o criador ou a equipe pode apagar este LFG.", ephemeral: true }); return true; } const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}confirm-delete:${id}`).setLabel("Excluir").setEmoji(lfgTrashEmoji() ?? "🗑️").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`${PREFIX}cancel-delete:${id}`).setLabel("Cancelar").setEmoji(lfgCloseEmoji() ?? "✖️").setStyle(ButtonStyle.Secondary)); await interaction.reply({ components: [{ type: ComponentType.Container, accent_color: 0xed4245, components: [{ type: ComponentType.TextDisplay, content: "## Excluir LFG\nIsso encerrará o grupo e removerá a postagem." }, { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small }, buttons.toJSON()] }], flags: ["Ephemeral", "IsComponentsV2"] }); return true; }
  if (action === "cancel-delete") { await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0x99aab5, components: [{ type: ComponentType.TextDisplay, content: "Exclusão cancelada." }] }] }); return true; }
  if (action === "confirm-delete") { if (!canManage(session, interaction)) { await interaction.reply({ content: "Sem permissão.", ephemeral: true }); return true; } const saved = await mutate((db) => { const value = db.sessions.find((item) => item.id === id)!; value.status = "deleted"; value.deleteVoiceWhenEmpty = true; value.updatedAt = new Date().toISOString(); return value; }); const voice = saved.voiceChannelId ? await interaction.guild?.channels.fetch(saved.voiceChannelId).catch(() => null) : null; if (voice?.isVoiceBased() && voice.members.size === 0) await voice.delete("LFG apagado").catch(() => undefined); if (saved.temporaryRoleId) await interaction.guild?.roles.fetch(saved.temporaryRoleId).then((role) => role?.delete("LFG apagado")).catch(() => undefined); if (session.messageId || session.roleMentionMessageId) { const channel = await interaction.client.channels.fetch(session.channelId).catch(() => null); if (channel?.isTextBased()) await Promise.all([session.messageId, session.roleMentionMessageId].filter((messageId): messageId is string => !!messageId).map((messageId) => channel.messages.fetch(messageId).then((message) => message.delete()).catch(() => undefined))); } await interaction.update({ components: [{ type: ComponentType.Container, accent_color: 0x57f287, components: [{ type: ComponentType.TextDisplay, content: "LFG excluído e anúncio apagado." }] }] }); return true; }
  if (action === "voice") { if (!canManage(session, interaction)) { await interaction.reply({ content: "Somente o criador ou a equipe pode usar esta ação.", ephemeral: true }); return true; } const saved = await createVoice(interaction.client, id); if (saved) await updateMessage(interaction.client, saved); await interaction.reply({ content: saved?.voiceChannelId ? `Lobby pronto: <#${saved.voiceChannelId}>` : "Não foi possível criar o lobby.", ephemeral: true }); return true; }
  const saved = await mutate((db) => { const value = db.sessions.find((item) => item.id === id)!; if (action === "join") { if (value.status !== "open" || value.participants.length >= value.maxPlayers || value.participants.includes(interaction.user.id)) return value; value.participants.push(interaction.user.id); if (value.participants.length >= value.maxPlayers) value.status = "completed"; } else if (action === "leave") { value.participants = value.participants.filter((userId) => userId !== interaction.user.id); if (value.status === "completed") value.status = "open"; } value.updatedAt = new Date().toISOString(); return value; });
  if (saved.temporaryRoleId && interaction.guild) { const role = await interaction.guild.roles.fetch(saved.temporaryRoleId).catch(() => null); const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null); if (role && member) { if (action === "join" && saved.participants.includes(interaction.user.id)) await member.roles.add(role, `Participante do LFG ${id}`).catch(() => undefined); if (action === "leave") await member.roles.remove(role, `Saiu do LFG ${id}`).catch(() => undefined); } }
  await updateMessage(interaction.client, saved); if (action === "join" && saved.status === "completed" && saved.autoVoiceEnabled) { const voice = await createVoice(interaction.client, id); if (voice) await updateMessage(interaction.client, voice); } await interaction.reply({ content: action === "join" ? "Participação atualizada." : "Você saiu do grupo.", ephemeral: true }); return true;
}
export function startLfgCleanup(client: Client): void {
  const emptySince = new Map<string, number>();
  setInterval(async () => { for (const session of await sessions()) {
    if (session.messageId && Date.now() - Date.parse(session.createdAt) >= PUBLICATION_RETENTION_MS) {
      const channel = await client.channels.fetch(session.channelId).catch(() => null);
      const deleted = channel?.isTextBased()
        ? await channel.messages.fetch(session.messageId).then((message) => message.delete()).then(() => true).catch(() => false)
        : false;
      const mentionDeleted = channel?.isTextBased() && session.roleMentionMessageId
        ? await channel.messages.fetch(session.roleMentionMessageId).then((message) => message.delete()).then(() => true).catch(() => false)
        : !session.roleMentionMessageId;
      if (deleted) await mutate((db) => {
        const current = db.sessions.find((item) => item.id === session.id);
        if (current) { current.messageId = null; if (mentionDeleted) current.roleMentionMessageId = null; current.updatedAt = new Date().toISOString(); }
      });
    }
    if ((session.status === "open" || session.status === "completed") && Date.parse(session.expiresAt) <= Date.now()) { const saved = await mutate((db) => { const value = db.sessions.find((item) => item.id === session.id)!; value.status = "expired"; value.updatedAt = new Date().toISOString(); return value; }); await updateMessage(client, saved); }
    if (!session.voiceChannelId) continue;
    const voice = await client.channels.fetch(session.voiceChannelId).catch(() => null);
    if (!voice?.isVoiceBased()) { emptySince.delete(session.voiceChannelId); continue; }
    if (voice.members.size) { emptySince.delete(voice.id); continue; }
    const since = emptySince.get(voice.id) ?? Date.now(); emptySince.set(voice.id, since);
    if (session.deleteVoiceWhenEmpty || session.status === "deleted" || Date.now() - since >= config.lfg.voiceEmptyGraceMinutes * 60_000) {
      const deleted = await voice.delete("Limpeza de lobby temporário LFG").then(() => true).catch(() => false); emptySince.delete(voice.id);
      if (deleted && session.status !== "deleted") { const saved = await mutate((db) => { const current = db.sessions.find((item) => item.id === session.id)!; current.voiceChannelId = null; current.updatedAt = new Date().toISOString(); return current; }); await updateMessage(client, saved); }
    }
  } }, 60_000).unref();
}
