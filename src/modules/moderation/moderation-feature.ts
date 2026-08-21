import { ComponentType, MessageFlags, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Message, type TextChannel } from "discord.js";
import { aiModeration } from "./ai.js";
import { config } from "../../config.js";
import { moderationButtons } from "../../emoji-manager.js";
import { localModeration } from "./filter.js";
import { forgiveMember, punishMember } from "./punishment-role.js";
import { decreaseReputation, getReputation, resetReputation } from "./reputation.js";
import { addWarning, clearWarnings, getWarnings } from "./warnings.js";

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

export async function handleModerationMessage(client: Client, message: Message): Promise<boolean> {
  if (!message.inGuild() || !message.content) return false;
  if (config.monitoredChannelIds.size && !config.monitoredChannelIds.has(message.channelId)) return false;
  if (config.ignoreAdministrators && message.member?.permissions.has(PermissionFlagsBits.Administrator)) { log(message, "IGNORADA_ADMIN"); return false; }

  const local = localModeration(message.content);
  log(message, local.flagged ? "SINALIZADA_LOCAL" : "ENVIADA_MODERACAO");
  const result = local.flagged ? local : await aiModeration(message.content);
  if (!result.flagged) { log(message, "LIBERADA_APOS_ANALISE"); return false; }

  const reason = reasonInPortuguese(result.category);
  try {
    await message.delete();
  } catch (error) {
    console.error(`[MODERACAO] Conteúdo detectado, mas não foi possível apagar a mensagem ${message.id} no canal ${message.channelId}. Verifique a permissão "Gerenciar mensagens" e a hierarquia do bot.`, error);
    log(message, `FALHA_AO_APAGAR motivo=${reason}`);
    return true;
  }
  const count = await addWarning(message.guildId, message.author.id, { at: new Date().toISOString(), reason, moderator: "automático" });
  let reputation = await getReputation(message.guildId, message.author.id);
  if (count >= config.warningsBeforeTimeout) reputation = await decreaseReputation(message.guildId, message.author.id);
  log(message, `REMOVIDA motivo=${reason} aviso=${count}/${config.warningsBeforeTimeout} reputacao=${reputation}%`);

  let punishment = "";
  if (count >= config.warningsBeforeTimeout && reputation === 0 && message.member) {
    try {
      await punishMember(message.member); await clearWarnings(message.guildId, message.author.id);
      punishment = ` e ficou com **0% de reputação**, recebendo o cargo **${config.punishmentRoleName}**`;
    } catch (error) { console.error("[CASTIGO] Falha ao aplicar cargo:", error); punishment = ". A moderação foi avisada sobre uma falha no castigo"; }
  } else if (count >= config.warningsBeforeTimeout && message.member?.moderatable) {
    try {
      await message.member.timeout(config.timeoutMinutes * 60_000, reason); await clearWarnings(message.guildId, message.author.id);
      punishment = ` e recebeu um castigo de ${config.timeoutMinutes} minutos. Os avisos foram zerados`;
    } catch (error) { console.error("[CASTIGO] Falha ao aplicar castigo:", error); punishment = ". A moderação foi avisada sobre uma falha no castigo"; }
  }
  const notice = await message.channel.send(`<@${message.author.id}>, sua mensagem foi removida por **${reason.toLowerCase()}**. Aviso **${count}/${config.warningsBeforeTimeout}**${punishment}.`);
  setTimeout(() => notice.delete().catch(() => undefined), 12_000);

  if (!config.modLogChannelId) return true;
  const channel = await client.channels.fetch(config.modLogChannelId).catch(() => null) as TextChannel | null;
  if (!channel?.isTextBased()) return true;
  const content = message.content.replace(/`/g, "ˋ").slice(0, 950);
  const accentColor = reputation <= 25 ? 0xed4245 : reputation <= 50 ? 0xfee75c : 0xf0b232;
  const timestamp = Math.floor(Date.now() / 1_000);
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [{
      type: ComponentType.Container,
      accent_color: accentColor,
      components: [
        {
          type: ComponentType.Section,
          components: [{
            type: ComponentType.TextDisplay,
            content: `## Ocorrência de moderação\n**Membro** ・ <@${message.author.id}>\n\n-# Mensagem removida automaticamente. Revise os dados abaixo se for necessário tomar uma ação adicional.`,
          }],
          accessory: {
            type: ComponentType.Thumbnail,
            media: { url: message.author.displayAvatarURL({ size: 256 }) },
            description: `Foto de ${message.author.username}`,
          },
        },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        {
          type: ComponentType.TextDisplay,
          content: `**Canal**　　　　　　　 **Motivo**\n<#${message.channelId}>　  　      ${reason}\n\n**Avisos**　　　　　　  **  Confiança**\n${count}/${config.warningsBeforeTimeout}　　　 　　　　　 ${reputationBar(reputation)}`,
        },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        { type: ComponentType.TextDisplay, content: `**Conteúdo removido**\n\`\`\`\n${content}\n\`\`\`` },
        { type: ComponentType.Separator, divider: true, spacing: 1 },
        moderationButtons(message.author.id).toJSON(),
        { type: ComponentType.TextDisplay, content: `-# Central de Segurança • <t:${timestamp}:t>` },
      ],
    }],
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
      await member.ban({ reason: `Banido pela moderação: ${interaction.user.tag}` });
      await interaction.editReply(`${member.user.tag} foi banido do servidor.`);
    } else if (action === "confiar") {
      await clearWarnings(interaction.guild.id, userId); await resetReputation(interaction.guild.id, userId);
      if (member) { if (member.isCommunicationDisabled()) await member.timeout(null, `Confiança restaurada por ${interaction.user.tag}`); await forgiveMember(member); }
      await interaction.editReply("Confiança restaurada para **100%**, avisos zerados e castigos removidos.");
    }
  } catch (error) { console.error(`[MODERADOR] Falha em ${action}:`, error); await interaction.editReply("Não consegui executar a ação. Verifique permissões e hierarquia de cargos."); }
  return true;
}

export async function handleModerationCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) return;
  const user = interaction.options.getUser("membro", true);
  if (interaction.commandName === "avisos") {
    const warnings = await getWarnings(interaction.guildId, user.id); const reputation = await getReputation(interaction.guildId, user.id);
    const text = warnings.length ? warnings.slice(-10).map((warning, index) => `${index + 1}. <t:${Math.floor(new Date(warning.at).getTime() / 1000)}:d> — ${warning.reason}`).join("\n") : "Nenhum aviso.";
    await interaction.reply({ content: `**Avisos de ${user.tag}: ${warnings.length}** · **Reputação: ${reputation}%**\n${text}`, flags: ["Ephemeral"] });
  } else if (interaction.commandName === "limpar-avisos") {
    await clearWarnings(interaction.guildId, user.id); await resetReputation(interaction.guildId, user.id);
    const member = await interaction.guild?.members.fetch(user.id).catch(() => null); if (member) await forgiveMember(member).catch(console.error);
    await interaction.reply({ content: `Os avisos de ${user.tag} foram removidos, a reputação voltou para 100% e o castigo foi retirado.`, flags: ["Ephemeral"] });
  }
}
