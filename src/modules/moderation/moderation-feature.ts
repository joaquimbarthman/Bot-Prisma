import { ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionFlagsBits, type APIContainerComponent, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Guild, type Message, type TextChannel, type User } from "discord.js";
import { aiModeration } from "./ai.js";
import { config } from "../../config.js";
import { verificationBlockEmoji, verificationCheckEmoji } from "../../emoji-manager.js";
import { localModeration } from "./filter.js";
import { hasCensorshipBypassRole } from "./exemptions.js";
import { getModerationState, isAiMonitoringActive, recordWarning, resetModerationState } from "./state.js";
import { forgiveMember, punishMember } from "./punishment-role.js";

const BAN_DELETE_MESSAGE_SECONDS = 48 * 60 * 60;
const DISCORD_USER_ID = /^\d{17,20}$/;

async function banUser(guild: Guild, userId: string, moderator: User): Promise<User> {
  const user = await guild.client.users.fetch(userId);
  await guild.members.ban(userId, {
    deleteMessageSeconds: BAN_DELETE_MESSAGE_SECONDS,
    reason: `Banido pela moderação: ${moderator.tag} (${moderator.id})`,
  });
  return user;
}

function log(message: Message<true>, status: string): void {
  if (!config.logMonitoredMessages) return;
  const content = config.logMessageContent ? ` | "${message.content.replace(/\s+/g, " ").slice(0, 160)}${message.content.length > 160 ? "…" : ""}"` : "";
  console.log(`[MONITOR] ${new Date().toISOString()} | ${status} | servidor=${message.guild.name} | canal=${message.channelId} | usuario=${message.author.tag} (${message.author.id})${content}`);
}

function reasonInPortuguese(category?: string): string {
  const value = category?.toLowerCase() ?? "";
  if (value.includes("threatening") || value.includes("ameaca")) return "Ameaça";
  if (value.includes("harassment")) return "Xingamento ou assédio";
  if (value.includes("hate")) return "Discurso de ódio ou preconceito";
  if (value.includes("nazismo")) return "Apologia ao nazismo";
  if (value.includes("racismo")) return "Racismo";
  if (value.includes("lgbtfobia")) return "LGBTfobia";
  if (value.includes("antissemitismo")) return "Antissemitismo";
  if (value.includes("xenofobia")) return "Xenofobia";
  if (value.includes("religioso")) return "Intolerância religiosa";
  if (value.includes("capacitismo")) return "Capacitismo";
  return "Conteúdo ofensivo";
}

function reputationBar(value: number): string {
  const filled = Math.max(0, Math.min(4, Math.round(value / 25)));
  return `${"▰".repeat(filled)}${"▱".repeat(4 - filled)}  **${value}%**`;
}

function warningProgress(count: number): string {
  const current = count > 0 ? ((count - 1) % config.warningsBeforeTimeout) + 1 : 0;
  return `${current}/${config.warningsBeforeTimeout}`;
}

export function showModerationActions(count: number, warningLimit = config.warningsBeforeTimeout): boolean {
  return warningLimit > 0 && count > 0 && count % warningLimit === 0;
}

export async function handleModerationMessage(client: Client, message: Message): Promise<boolean> {
  if (!message.inGuild() || !message.content) return false;
  const inMonitoredChannel = config.monitoredChannelIds.has(message.channelId);
  const inMonitoredCategory = !!message.channel.parentId && config.monitoredCategoryIds.has(message.channel.parentId);
  if (!inMonitoredChannel && !inMonitoredCategory) return false;
  if (hasCensorshipBypassRole(message.member)) { log(message, "IGNORADA_CARGO_SEM_CENSURA"); return false; }
  if (config.ignoreAdministrators && message.member?.permissions.has(PermissionFlagsBits.Administrator)) { log(message, "IGNORADA_ADMIN"); return false; }

  const local = localModeration(message.content);
  const state = await getModerationState(message.guildId, message.author.id);
  const monitoredByAi = isAiMonitoringActive(state);
  log(message, local.flagged ? "SINALIZADA_LOCAL" : monitoredByAi ? "ENVIADA_MODERACAO_IA" : "LIBERADA_FILTRO_LOCAL");
  const result = local.flagged ? local : monitoredByAi ? await aiModeration(message.content) : local;
  if (!result.flagged) { log(message, "LIBERADA_APOS_ANALISE"); return false; }

  const reason = reasonInPortuguese(result.category);
  try {
    await message.delete();
  } catch (error) {
    console.error(`[MODERACAO] Conteúdo detectado, mas não foi possível apagar a mensagem ${message.id} no canal ${message.channelId}. Verifique a permissão "Gerenciar mensagens" e a hierarquia do bot.`, error);
    log(message, `FALHA_AO_APAGAR motivo=${reason}`);
    return true;
  }
  const updatedState = await recordWarning(message.guildId, message.author.id, { at: new Date().toISOString(), reason, moderator: "automático" });
  const { warnings: count, trust: reputation } = updatedState;
  log(message, `REMOVIDA motivo=${reason} avisos=${count} reputacao=${reputation}%`);

  let punishment = "";
  if (count === config.warningsBeforeTimeout * 2 && reputation === 0 && message.member) {
    try {
      await punishMember(message.member);
      punishment = ` e ficou com **0% de reputação**, recebendo o cargo **${config.punishmentRoleName}**`;
    } catch (error) { console.error("[CASTIGO] Falha ao aplicar cargo:", error); punishment = ". A moderação foi avisada sobre uma falha no castigo"; }
  } else if (count === config.warningsBeforeTimeout && message.member?.moderatable) {
    try {
      await message.member.timeout(config.timeoutMinutes * 60_000, reason);
      punishment = ` e recebeu um castigo de ${config.timeoutMinutes} minutos`;
    } catch (error) { console.error("[CASTIGO] Falha ao aplicar castigo:", error); punishment = ". A moderação foi avisada sobre uma falha no castigo"; }
  }
  const notice = await message.channel.send(`<@${message.author.id}>, sua mensagem foi removida por **${reason.toLowerCase()}**. Aviso **${warningProgress(count)}**${punishment}.`);
  setTimeout(() => notice.delete().catch(() => undefined), 12_000);

  if (!config.modLogChannelId) return true;
  const channel = await client.channels.fetch(config.modLogChannelId).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased()) return true;
  const content = message.content.replace(/`/g, "ˋ").slice(0, 950);
  const timestamp = Math.floor(Date.now() / 1_000);
  const components: APIContainerComponent[] = [
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.Section,
        components: [{
          type: ComponentType.TextDisplay,
          content: `## Ocorrência de moderação\n-# Mensagem de <@${message.author.id}> removida automaticamente para análise da equipe.\n\n-# Central de Segurança • <t:${timestamp}:t> • <@&1538337494355935302>`,
        }],
        accessory: {
          type: ComponentType.Thumbnail,
          media: { url: message.author.displayAvatarURL({ size: 256, forceStatic: true }) },
          description: `Foto de ${message.author.username}`,
        },
      }],
    },
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.TextDisplay,
        content: `**Avisos**　　　　　　 **Confiança**　　　　　　 **Canal**\n${warningProgress(count)}　　　　　　　${reputationBar(reputation)}　　　　<#${message.channelId}>`,
      }],
    },
    {
      type: ComponentType.Container,
      components: [{ type: ComponentType.TextDisplay, content: `**Motivo**\n${reason}` }],
    },
    {
      type: ComponentType.Container,
      components: [{ type: ComponentType.TextDisplay, content: `**Conteúdo removido**\n\`\`\`\n${content}\n\`\`\`` }],
    },
  ];

  if (showModerationActions(count)) components.push(
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.Section,
        components: [{ type: ComponentType.TextDisplay, content: "**Banir membro**\n-# Remova a pessoa do servidor e apague as mensagens recentes." }],
        accessory: new ButtonBuilder().setCustomId(`moderacao:banir:${message.author.id}`).setLabel("Banir").setEmoji(verificationBlockEmoji() ?? "🚫").setStyle(ButtonStyle.Danger).toJSON(),
      }],
    },
    {
      type: ComponentType.Container,
      components: [{
        type: ComponentType.Section,
        components: [{ type: ComponentType.TextDisplay, content: "**Restaurar confiança**\n-# Zere os avisos, restaure a confiança e remova castigos." }],
        accessory: new ButtonBuilder().setCustomId(`moderacao:confiar:${message.author.id}`).setLabel("Confiar").setEmoji(verificationCheckEmoji() ?? "✅").setStyle(ButtonStyle.Success).toJSON(),
      }],
    },
  );

  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: { parse: [], roles: ["1538337494355935302"] },
  });
  return true;
}

export async function handleModerationButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("moderacao:")) return false;
  if (!interaction.inGuild() || !interaction.guild) return true;
  const [, action, userId] = interaction.customId.split(":");
  const permission = action === "banir" ? PermissionFlagsBits.BanMembers : PermissionFlagsBits.ModerateMembers;
  if (!interaction.memberPermissions?.has(permission)) { await interaction.reply({ content: "Somente moderadores podem usar estes botões.", flags: ["Ephemeral"] }); return true; }
  await interaction.deferReply({ flags: ["Ephemeral"] });
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  try {
    if (action === "banir") {
      if (!member?.bannable) throw new Error("Membro não encontrado ou não pode ser banido.");
      const user = await banUser(interaction.guild, userId, interaction.user);
      await interaction.editReply(`${user.tag} foi banido do servidor e as mensagens das últimas 48 horas foram apagadas.`);
    } else if (action === "confiar") {
      await resetModerationState(interaction.guild.id, userId);
      if (member) { if (member.isCommunicationDisabled()) await member.timeout(null, `Confiança restaurada por ${interaction.user.tag}`); await forgiveMember(member); }
      await interaction.editReply("Confiança restaurada para **100%**, avisos zerados e castigos removidos.");
    }
  } catch (error) { console.error(`[MODERADOR] Falha em ${action}:`, error); await interaction.editReply("Não consegui executar a ação. Verifique permissões e hierarquia de cargos."); }
  return true;
}

export async function handleModerationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.guild) return;
  if (interaction.commandName === "ban") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      await interaction.reply({ content: "Você precisa da permissão **Banir membros** para usar este comando.", flags: ["Ephemeral"] });
      return;
    }

    const userId = interaction.options.getString("id", true).trim();
    if (!DISCORD_USER_ID.test(userId)) {
      await interaction.reply({ content: "Informe um ID de usuário válido do Discord.", flags: ["Ephemeral"] });
      return;
    }
    if (userId === interaction.user.id) {
      await interaction.reply({ content: "Você não pode banir a si mesmo.", flags: ["Ephemeral"] });
      return;
    }
    if (userId === interaction.client.user.id) {
      await interaction.reply({ content: "Eu não posso banir a mim mesma.", flags: ["Ephemeral"] });
      return;
    }

    await interaction.deferReply({ flags: ["Ephemeral"] });
    try {
      const user = await banUser(interaction.guild, userId, interaction.user);
      await interaction.editReply(`${user.tag} (${user.id}) foi banido do servidor e as mensagens das últimas 48 horas foram apagadas.`);
    } catch (error) {
      console.error(`[MODERADOR] Falha ao banir ${userId}:`, error);
      await interaction.editReply("Não consegui banir esse usuário. Verifique o ID, minhas permissões e a hierarquia de cargos.");
    }
    return;
  }

  const user = interaction.options.getUser("membro", true);
  if (interaction.commandName === "avisos") {
    const state = await getModerationState(interaction.guildId, user.id); const warnings = state.warningHistory; const reputation = state.trust;
    const text = warnings.length ? warnings.slice(-10).map((warning, index) => `${index + 1}. <t:${Math.floor(new Date(warning.at).getTime() / 1000)}:d> — ${warning.reason}`).join("\n") : "Nenhum aviso.";
    await interaction.reply({ content: `**Avisos de ${user.tag}: ${warnings.length}** · **Reputação: ${reputation}%**\n${text}`, flags: ["Ephemeral"] });
  } else if (interaction.commandName === "limpar-avisos") {
    await resetModerationState(interaction.guildId, user.id);
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null); if (member) await forgiveMember(member).catch(console.error);
    await interaction.reply({ content: `Os avisos de ${user.tag} foram removidos, a reputação voltou para 100% e o castigo foi retirado.`, flags: ["Ephemeral"] });
  }
}
