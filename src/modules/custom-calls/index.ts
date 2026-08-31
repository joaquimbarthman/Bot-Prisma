import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ComponentType, ModalBuilder, PermissionFlagsBits, SeparatorSpacingSize, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
  type APIComponentInContainer, type APIContainerComponent, type APIMessageTopLevelComponent, type ButtonInteraction, type Client, type Collection, type Guild, type GuildMember, type Interaction, type ModalSubmitInteraction, type Snowflake, type UserSelectMenuInteraction,
} from "discord.js";
import { config } from "../../config.js";
import { verificationCheckEmoji, lfgSoundEmoji, verificationCloseEmoji, customCallAddEmoji, customCallRemoveEmoji, customCallEmojiPickerEmoji, customCallTrashEmoji } from "../../emoji-manager.js";
import { addCustomCallMember, deleteCustomCallRecord, getCustomCall, getCustomCallAccess, getCustomCallMembers, removeCustomCallMember, saveCustomCall, setCustomCallAccess, type CustomCall } from "./store.js";

const PREFIX = "custom-call:";
const locks = new Set<string>();
const privateMessageCleanups = new Map<string, Array<() => Promise<unknown>>>();
const PUBLIC_PANEL_COLOR = 0x008000;
const PRIVATE_PANEL_COLOR = 0x5865f2;

type CustomCallComponentInteraction = ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction;

function privateMessageKey(interaction: CustomCallComponentInteraction): string | null {
  return interaction.guildId ? `${interaction.guildId}:${interaction.user.id}` : null;
}

function trackPrivateMessage(
  interaction: CustomCallComponentInteraction,
  cleanup: () => Promise<unknown>,
): void {
  const key = privateMessageKey(interaction);
  if (!key) return;
  const entries = privateMessageCleanups.get(key) ?? [];
  entries.push(cleanup);
  privateMessageCleanups.set(key, entries);
}

async function clearPrivateMessages(guildId: string, userId: string): Promise<void> {
  const key = `${guildId}:${userId}`;
  const entries = privateMessageCleanups.get(key) ?? [];
  privateMessageCleanups.delete(key);
  await Promise.allSettled(entries.map((cleanup) => cleanup()));
}
const DEFAULT_CALL_EMOJI = "💦";
const graphemeSegmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });

export function parseCustomCallEmoji(value: string): string | null {
  const emoji = value.trim();
  if (!emoji || /^<a?:\w+:\d+>$/.test(emoji)) return null;
  const graphemes = Array.from(graphemeSegmenter.segment(emoji), ({ segment }) => segment);
  return graphemes.length === 1 && /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(emoji) ? emoji : null;
}
export function buildCustomCallName(username: string, emoji = DEFAULT_CALL_EMOJI): string { const prefix = parseCustomCallEmoji(emoji) ?? DEFAULT_CALL_EMOJI; const clean = username.replace(/[\r\n]/g, " ").trim() || "usuario"; return `${prefix}・Call ${clean}`.slice(0, 100); }
function hasAccess(member: GuildMember): boolean { return member.roles.cache.has(config.customCalls.accessRoleId); }
function container(content: string, rows: APIComponentInContainer[] = []): APIContainerComponent[] { return [{ type: ComponentType.Container, accent_color: PRIVATE_PANEL_COLOR, components: [{ type: ComponentType.TextDisplay, content }, ...(rows.length ? [{ type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small } as const, ...rows] : [])] }]; }
function withNotification(panel: APIContainerComponent[], _notification?: string): APIMessageTopLevelComponent[] { return panel; }
async function sendNotification(interaction: CustomCallComponentInteraction, content: string): Promise<void> {
  const message = await interaction.followUp({
    components: container(content),
    flags: ["Ephemeral", "IsComponentsV2"],
    allowedMentions: { parse: [] },
  });
  trackPrivateMessage(interaction, () => interaction.webhook.deleteMessage(message.id));
}
function publicPanel(): APIContainerComponent[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}open`)
      .setLabel("Abrir Painel")
      .setEmoji(lfgSoundEmoji() || "🔊")
      .setStyle(ButtonStyle.Success)
  );

  return [{
    type: ComponentType.Container,
    accent_color: PUBLIC_PANEL_COLOR,
    components: [
      {
        type: ComponentType.TextDisplay,
        content:
          "## PRISMA • Calls Personalizadas\n" +
          "### Seu espaço, suas regras\n" +
          "Crie e gerencie sua própria call personalizada. Você controla quem pode entrar.",
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
      },
      {
        type: ComponentType.MediaGallery,
        items: [
          {
            media: {
              url: "https://imgur.com/VWRDZh0.gif",
            },
          },
        ],
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small,
      },

      row.toJSON(),
    ],
  }];
}
function createPanel(username: string, feedback?: string): APIMessageTopLevelComponent[] {
  const name = buildCustomCallName(username);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}create`).setLabel("Criar Call").setEmoji(verificationCheckEmoji() || "✅").setStyle(ButtonStyle.Primary),
  );
const content = [
  "## Criar Call Personalizada",
  "",
  "**Você ainda não possui uma call criada**. Crie seu próprio espaço de forma simples pelo painel.",
].join("\n");
  return withNotification(container(content, [row.toJSON()]), feedback);
}
async function mainPanel(call: CustomCall, panelOwner: GuildMember, feedback?: string): Promise<APIMessageTopLevelComponent[]> {
  const chosenEmoji = parseCustomCallEmoji(call.emoji ?? "") ?? DEFAULT_CALL_EMOJI;
  const members = await getCustomCallMembers(call.id);
  const memberIds = [call.ownerId, ...members.map((item) => item.userId)];
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}add`).setLabel("Adicionar").setEmoji(customCallAddEmoji() ?? "➕").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}remove`).setLabel("Remover").setEmoji(customCallRemoveEmoji() ?? "➖").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}emoji`).setLabel("Escolher emoji").setEmoji(customCallEmojiPickerEmoji() ?? "🙂").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}delete`).setLabel("Excluir Call").setEmoji(customCallTrashEmoji() ?? "🗑️").setStyle(ButtonStyle.Danger),
  );
  const header = [
    "## Sua Call Personalizada",
    `-# Painel de <@${call.ownerId}>\n`,
    "Gerencie sua call em um só lugar, simples e rápida.",
  ].join("\n");
  const content = [
    "### Emoji escolhido　　Canal de voz",
    `${chosenEmoji}　　　　　　　　　<#${call.voiceChannelId}>`,
    "",
    "### Cargo de acesso",
    `<@&${call.roleId}>`,
    "",
    "### Membros",
    Array.from(
      { length: Math.ceil(memberIds.length / 4) },
      (_, index) =>
        memberIds
          .slice(index * 4, index * 4 + 4)
          .map((id) => `<@${id}>`)
          .join(", "),
    ).join("\n"),
  ].join("\n");
  const headerComponent: APIComponentInContainer = { type: ComponentType.Section, components: [{ type: ComponentType.TextDisplay, content: header }], accessory: { type: ComponentType.Thumbnail, media: { url: panelOwner.displayAvatarURL({ extension: "png", size: 256 }) }, description: `Avatar de ${panelOwner.user.username}` } };
  const panel: APIContainerComponent = { type: ComponentType.Container, accent_color: PRIVATE_PANEL_COLOR, components: [headerComponent, { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small }, { type: ComponentType.TextDisplay, content }, { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small }, first.toJSON()] };
  return withNotification([panel], feedback);
}
function emojiModal(currentEmoji: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("emoji")
    .setLabel("Emoji da call e do cargo")
    .setPlaceholder("Exemplo: 🌸")
    .setValue(currentEmoji)
    .setMinLength(1)
    .setMaxLength(16)
    .setRequired(true)
    .setStyle(TextInputStyle.Short);
  return new ModalBuilder().setCustomId(`${PREFIX}emoji-submit`).setTitle("Escolher emoji").addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}
async function selectPanel(kind: "add" | "remove"): Promise<APIContainerComponent[]> {
  const select = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${PREFIX}${kind}-select`)
      .setPlaceholder(kind === "add" ? "Pesquise quem será adicionado" : "Pesquise quem será removido")
      .setMinValues(1)
      .setMaxValues(1),
  );
  return container(`## ${kind === "add" ? "Adicionar" : "Remover"} pessoa\nPesquise e selecione uma pessoa do servidor.`, [select.toJSON()]);
}
function deleteConfirmationPanel(): APIContainerComponent[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}cancel-delete`).setLabel("Cancelar").setEmoji(verificationCloseEmoji() ?? "❌").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}confirm-delete`).setLabel("Excluir Call").setEmoji(customCallTrashEmoji() ?? "🗑️").setStyle(ButtonStyle.Danger),
  );

  return container(
    "## Excluir Call Personalizada\n**Essa ação não pode ser desfeita.** Todos os membros perderão acesso e o canal será removido.",
    [row.toJSON()],
  );
}
async function log(client: Client, event: string, call: Partial<CustomCall> & { guildId: string; ownerId: string }, targetUserId?: string): Promise<void> { const line = `[CUSTOM-CALL] ${event} guild=${call.guildId} owner=${call.ownerId} target=${targetUserId ?? "-"} channel=${call.voiceChannelId ?? "-"} role=${call.roleId ?? "-"} timestamp=${new Date().toISOString()}`; console.log(line); if (!config.customCalls.logChannelId) return; const channel = await client.channels.fetch(config.customCalls.logChannelId).catch(() => null); if (channel?.isSendable()) await channel.send({ content: `\`${event}\`・dono <@${call.ownerId}>${targetUserId ? `・alvo <@${targetUserId}>` : ""}\nCanal: ${call.voiceChannelId ? `<#${call.voiceChannelId}>` : "—"}・Cargo: ${call.roleId ? `<@&${call.roleId}>` : "—"}`, allowedMentions: { parse: [] } }).catch(() => undefined); }
async function ensureOwnedCall(member: GuildMember): Promise<CustomCall | null> { let call = await getCustomCall(member.guild.id, member.id); if (!call) return null; call = { ...call, emoji: parseCustomCallEmoji(call.emoji ?? "") ?? DEFAULT_CALL_EMOJI }; const channel = await member.guild.channels.fetch(call.voiceChannelId).catch(() => null); if (!channel?.isVoiceBased()) { const role = await member.guild.roles.fetch(call.roleId).catch(() => null); await role?.delete("Call personalizada sem canal").catch(() => undefined); await deleteCustomCallRecord(call); return null; } let role = await member.guild.roles.fetch(call.roleId).catch(() => null); const expected = buildCustomCallName(member.user.username, call.emoji ?? DEFAULT_CALL_EMOJI); if (!role) { role = await member.guild.roles.create({ name: expected, reason: `Reconstrução da call personalizada de ${member.id}` }); call = { ...call, roleId: role.id, updatedAt: new Date().toISOString() }; await saveCustomCall(call); const savedMembers = await getCustomCallMembers(call.id); await Promise.all([member.id, ...savedMembers.map((item) => item.userId)].map((id) => member.guild.members.fetch(id).then((item) => item.roles.add(role!, "Reconstrução de acesso à call personalizada")).catch(() => undefined))); await channel.permissionOverwrites.edit(role.id, { ViewChannel: true, Connect: true, Speak: true }); }
  if (channel.name !== expected) await channel.setName(expected, "Sincronização do username da call personalizada"); if (role.name !== expected) await role.setName(expected, "Sincronização do username da call personalizada"); return call; }
async function owner(interaction: Interaction): Promise<GuildMember | null> { if (!interaction.inGuild() || !interaction.guild) return null; const member = interaction.guild.members.cache.get(interaction.user.id) ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null); return member && hasAccess(member) ? member : null; }

export async function syncCustomCallAccess(member: GuildMember): Promise<boolean> {
  if (member.user.bot) return false;
  const current = await getCustomCallAccess(member.guild.id, member.id);
  const boosterAccess = member.premiumSinceTimestamp !== null;
  const has = member.roles.cache.has(config.customCalls.accessRoleId);
  const sourceEligible = member.roles.cache.has(config.customCalls.automaticAccessSourceRoleId);
  const firstSourceGrant = sourceEligible && !current?.sourceRoleGrantProcessed;
  const manualAccess = current?.manualAccess ?? (!boosterAccess && has && !firstSourceGrant);

  if (!current && !boosterAccess && !has && !sourceEligible) return false;
  if (firstSourceGrant && !has) {
    await member.roles.add(config.customCalls.accessRoleId, "Concessão única de acesso às Calls Personalizadas");
  }

  const sourceRoleAccess = firstSourceGrant
    ? true
    : current?.sourceRoleAccess && !has
      ? false
      : current?.sourceRoleAccess ?? false;
  const accessChanged = !current
    || current.boosterAccess !== boosterAccess
    || current.manualAccess !== manualAccess
    || current.sourceRoleGrantProcessed !== (current.sourceRoleGrantProcessed || firstSourceGrant)
    || current.sourceRoleAccess !== sourceRoleAccess;
  const access = accessChanged
    ? await setCustomCallAccess(member.guild.id, member.id, {
      boosterAccess,
      manualAccess,
      sourceRoleGrantProcessed: current?.sourceRoleGrantProcessed || firstSourceGrant,
      sourceRoleAccess,
    })
    : current;
  const shouldHave = access.boosterAccess || access.manualAccess || access.sourceRoleAccess;
  const nowHas = member.roles.cache.has(config.customCalls.accessRoleId);
  if (shouldHave === nowHas) return firstSourceGrant;
  if (shouldHave) await member.roles.add(config.customCalls.accessRoleId, "Acesso às Calls Personalizadas");
  else await member.roles.remove(config.customCalls.accessRoleId, "Acesso às Calls Personalizadas encerrado");
  await log(member.client, shouldHave ? "CUSTOM_ACCESS_GRANTED" : "CUSTOM_ACCESS_REVOKED", { guildId: member.guild.id, ownerId: member.id });
  return true;
}
export async function grantManualCustomCallAccess(member: GuildMember): Promise<void> { await setCustomCallAccess(member.guild.id, member.id, { manualAccess: true }); await syncCustomCallAccess(member); }
export async function revokeManualCustomCallAccess(member: GuildMember): Promise<void> { await setCustomCallAccess(member.guild.id, member.id, { manualAccess: false }); await syncCustomCallAccess(member); }
export async function syncCustomCallAccessRoles(guild: Guild, members?: Collection<Snowflake, GuildMember>): Promise<void> { members ??= await guild.members.fetch(); for (const member of members.values()) await syncCustomCallAccess(member); }

async function createCall(interaction: ButtonInteraction, member: GuildMember): Promise<void> { const key = `${member.guild.id}:${member.id}`; if (locks.has(key)) { await interaction.update({ components: container("## Calls Personalizadas\nSua call já está sendo criada.") }); return; } locks.add(key); let roleId: string | null = null; try { const existing = await ensureOwnedCall(member); if (existing) { await interaction.update({ components: await mainPanel(existing, member) }); return; } const category = await member.guild.channels.fetch(config.customCalls.categoryId).catch(() => null); if (!category || category.type !== ChannelType.GuildCategory) throw new Error(`CUSTOM_CALL_CATEGORY_ID ${config.customCalls.categoryId} não aponta para uma categoria válida.`); const me = member.guild.members.me; if (!me?.permissions.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.MoveMembers])) throw new Error("A Prisma precisa das permissões Gerenciar canais, Gerenciar cargos e Mover membros."); const name = buildCustomCallName(member.user.username); const role = await member.guild.roles.create({ name, reason: `Call personalizada de ${member.id}` }); roleId = role.id; const channel = await member.guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: member.guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] }, { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }, { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.MoveMembers] }], reason: `Call personalizada de ${member.id}` }); const now = new Date().toISOString(); const call: CustomCall = { id: crypto.randomUUID(), guildId: member.guild.id, ownerId: member.id, voiceChannelId: channel.id, roleId: role.id, createdAt: now, updatedAt: now }; try { await member.roles.add(role, "Dono da call personalizada"); await saveCustomCall(call); } catch (error) { await channel.delete("Falha ao concluir criação da call personalizada").catch(() => undefined); await role.delete("Falha ao concluir criação da call personalizada").catch(() => undefined); throw error; } await log(interaction.client, "CALL_CREATED", call); await interaction.update({ components: await mainPanel(call, member) }); } finally { locks.delete(key); if (roleId && !(await getCustomCall(member.guild.id, member.id).catch(() => null))) await member.guild.roles.delete(roleId, "Limpeza de criação incompleta").catch(() => undefined); } }
async function selection(interaction: UserSelectMenuInteraction, kind: "add" | "remove", member: GuildMember): Promise<void> {
  const call = await ensureOwnedCall(member);
  if (!call || call.ownerId !== interaction.user.id) { await interaction.update({ components: createPanel(member.user.username) }); await sendNotification(interaction, "**Sua call não foi encontrada!**"); return; }
  const target = await member.guild.members.fetch(interaction.values[0]).catch(() => null);
  const role = await member.guild.roles.fetch(call.roleId).catch(() => null);
  if (!target || !role) throw new Error("Não foi possível encontrar a pessoa ou o cargo da call.");
  if (kind === "add") {
    if (target.user.bot) { await interaction.update({ components: await mainPanel(call, member) }); await sendNotification(interaction, "**Bots não podem ser adicionados!**"); return; }
    if (target.roles.cache.has(role.id)) { await interaction.update({ components: await mainPanel(call, member) }); await sendNotification(interaction, "**Essa pessoa já está autorizada!**"); return; }
    await target.roles.add(role, `Adicionado à call personalizada de ${member.id}`);
    await addCustomCallMember(call.id, target.id);
    await log(interaction.client, "MEMBER_ADDED", call, target.id);
    await interaction.update({ components: await mainPanel(call, member) });
    await sendNotification(interaction, `<@${target.id}> foi adicionado à sua call.`);
    return;
  }
  if (target.id === member.id) { await interaction.update({ components: await mainPanel(call, member) }); await sendNotification(interaction, "**O dono não pode remover a si próprio!**"); return; }
  const saved = (await getCustomCallMembers(call.id)).some((item) => item.userId === target.id);
  if (!saved && !target.roles.cache.has(role.id)) { await interaction.update({ components: await mainPanel(call, member) }); await sendNotification(interaction, "**Essa pessoa não está autorizada!**"); return; }
  await target.roles.remove(role, `Removido da call personalizada de ${member.id}`).catch(() => undefined);
  await removeCustomCallMember(call.id, target.id);
  if (target.voice.channelId === call.voiceChannelId) await target.voice.disconnect("Acesso à call personalizada removido").catch(() => undefined);
  await log(interaction.client, "MEMBER_REMOVED", call, target.id);
  await interaction.update({ components: await mainPanel(call, member) });
  await sendNotification(interaction, `<@${target.id}> foi removido da sua call.`);
}

async function changeEmoji(interaction: ModalSubmitInteraction, member: GuildMember): Promise<void> {
  if (!interaction.isFromMessage()) {
    await interaction.reply({ content: "Não consegui identificar o painel desta call. Abra o painel novamente e tente de novo.", flags: ["Ephemeral"] });
    return;
  }
  await interaction.deferUpdate();
  const call = await getCustomCall(member.guild.id, member.id);
  if (!call || call.ownerId !== interaction.user.id) { await interaction.editReply({ components: createPanel(member.user.username) }); return; }
  const emoji = parseCustomCallEmoji(interaction.fields.getTextInputValue("emoji"));
  if (!emoji) {
    await interaction.editReply({ components: await mainPanel(call, member) });
    await sendNotification(interaction, "Use apenas **um emoji comum (Unicode)**, como 🌸. Emojis personalizados do servidor não podem ser usados em nomes de canal ou cargo.");
    return;
  }
  const channel = await member.guild.channels.fetch(call.voiceChannelId).catch(() => null);
  const role = await member.guild.roles.fetch(call.roleId).catch(() => null);
  if (!channel?.isVoiceBased() || !role) throw new Error("Não foi possível encontrar o canal ou o cargo da call.");
  const name = buildCustomCallName(member.user.username, emoji);
  await channel.setName(name, `Emoji da call personalizada alterado por ${member.id}`);
  await role.setName(name, `Emoji da call personalizada alterado por ${member.id}`);
  const updated = { ...call, emoji, updatedAt: new Date().toISOString() };
  await saveCustomCall(updated);
  await log(interaction.client, "CALL_EMOJI_CHANGED", updated);
  await interaction.editReply({ components: await mainPanel(updated, member) });
  await sendNotification(interaction, `Emoji alterado para ${emoji} no canal e no cargo da sua call.`);
}

export async function startCustomCallsModule(client: Client): Promise<void> {
  const channel = await client.channels.fetch(config.customCalls.panelChannelId).catch((error) => {
    console.error(`[CUSTOM-CALL] Falha ao buscar o canal do painel ${config.customCalls.panelChannelId}:`, error);
    return null;
  });
  if (!channel?.isTextBased() || channel.isDMBased()) {
    console.error(`[CUSTOM-CALL] O ID ${config.customCalls.panelChannelId} não aponta para um canal de texto do servidor.`);
    return;
  }
  const permissions = channel.permissionsFor(client.user!);
  const missing = [
    [PermissionFlagsBits.ViewChannel, "Ver canal"],
    [PermissionFlagsBits.SendMessages, "Enviar mensagens"],
  ].filter(([permission]) => !permissions?.has(permission as bigint)).map(([, label]) => label);
  if (missing.length) throw new Error(`Canal do painel sem permissões para a Prisma: ${missing.join(", ")}.`);

  const messages = permissions?.has(PermissionFlagsBits.ReadMessageHistory)
    ? await channel.messages.fetch({ limit: 50 }).catch((error) => {
      console.error("[CUSTOM-CALL] Não foi possível consultar a mensagem existente; um novo painel será enviado:", error);
      return null;
    })
    : null;
  const existing = messages?.find((message) => message.author.id === client.user?.id && message.components.length > 0 && JSON.stringify(message.components).includes(`${PREFIX}open`));
  const payload = { components: publicPanel(), flags: ["IsComponentsV2"] as const };
  if (existing) await existing.edit({ ...payload, embeds: [] });
  else await channel.send(payload);
  console.log(`[CUSTOM-CALL] Painel publicado no canal ${channel.id}.`);
}
export async function handleCustomCallInteraction(interaction: Interaction): Promise<boolean> { if (!(interaction.isButton() || interaction.isUserSelectMenu() || interaction.isModalSubmit()) || !interaction.customId.startsWith(PREFIX)) return false; const action = interaction.customId.slice(PREFIX.length); const member = await owner(interaction); if (!member) { const components = container("## 🫧 Calls Personalizadas\nVocê não possui acesso a este recurso."); if (interaction.replied || interaction.deferred) await interaction.editReply({ components, flags: ["IsComponentsV2"] }); else await interaction.reply({ components, flags: ["Ephemeral", "IsComponentsV2"] }); return true; }
  if (action === "open") { await interaction.deferReply({ flags: ["Ephemeral"] }); const call = await ensureOwnedCall(member); await interaction.editReply({ components: call ? await mainPanel(call, member) : createPanel(member.user.username), flags: ["IsComponentsV2"] }); trackPrivateMessage(interaction, () => interaction.deleteReply()); return true; }
  if (interaction.isUserSelectMenu() && (action === "add-select" || action === "remove-select")) { await selection(interaction, action === "add-select" ? "add" : "remove", member); return true; }
  if (interaction.isModalSubmit() && action === "emoji-submit") { await changeEmoji(interaction, member); return true; }
  if (interaction.isButton() && action === "emoji") { await interaction.showModal(emojiModal(DEFAULT_CALL_EMOJI)); return true; }
  if (!interaction.isButton()) return true; if (action === "create") { await createCall(interaction, member); return true; } const call = await ensureOwnedCall(member); if (!call || call.ownerId !== interaction.user.id) { await interaction.update({ components: createPanel(member.user.username) }); await sendNotification(interaction, "**Sua call não foi encontrada!**"); return true; }
  if (action === "add" || action === "remove") {
    const selectionPanel = await selectPanel(action);
    await interaction.update({ components: selectionPanel });
    return true;
  }
  if (action === "cancel-delete") {
    await interaction.deferUpdate();
    await interaction.deleteReply().catch(() => undefined);
    return true;
  }
  if (action === "delete") {
    await interaction.reply({
      components: deleteConfirmationPanel(),
      flags: ["Ephemeral", "IsComponentsV2"],
    });
    trackPrivateMessage(interaction, () => interaction.deleteReply());
    return true;
  }
  if (action === "confirm-delete") { const key = `${call.guildId}:${call.ownerId}`; if (locks.has(key)) return true; locks.add(key); try { const authorized = await getCustomCallMembers(call.id); const role = await member.guild.roles.fetch(call.roleId).catch(() => null); if (role) await Promise.all([member.id, ...authorized.map((item) => item.userId)].map((id) => member.guild.members.fetch(id).then((target) => target.roles.remove(role, "Call personalizada excluída")).catch(() => undefined))); const channel = await member.guild.channels.fetch(call.voiceChannelId).catch(() => null); await channel?.delete("Call personalizada excluída pelo dono").catch(() => undefined); await role?.delete("Call personalizada excluída pelo dono").catch(() => undefined); await deleteCustomCallRecord(call); await log(interaction.client, "CALL_DELETED", call); await interaction.update({ components: container("Sua call personalizada foi excluída com sucesso.") }); await new Promise((resolve) => setTimeout(resolve, 3000)); await clearPrivateMessages(call.guildId, call.ownerId); } finally { locks.delete(key); } return true; }
  return true;
}
