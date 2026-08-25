import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits, REST, Routes, type GuildBasedChannel } from "discord.js";
import { commands } from "./commands.js";
import { config, validateConfig } from "./config.js";
import { setupCustomEmojis } from "./emoji-manager.js";
import { handleGalleryInteraction, handleGalleryMessage, refreshGalleryButtons } from "./modules/gallery/index.js";
import { startHealthServer } from "./health-server.js";
import { handleModerationButton, handleModerationCommand, handleModerationMessage } from "./modules/moderation/moderation-feature.js";
import { handleAiInteraction, handleAiMessage, handleAiPresenceUpdate, startAiCleanup } from "./modules/ai/index.js";
import { grantAccessRoleToBooster, grantVerifiedRoleToBooster, startedBoosting, syncBoosterAccessRoles } from "./modules/ai/permissions.js";
import { handleVerificationInteraction, handleVerificationMessage, startVerificationModule } from "./modules/verification/index.js";
import { handleReportInteraction, startReportModule } from "./modules/reports/index.js";
import { handleLfgInteraction, startLfgCleanup, startLfgModule } from "./modules/lfg/index.js";
import { handleNewPunishmentChannel, syncPunishmentPermissions } from "./modules/moderation/punishment-role.js";
import { handleBumpMessage, startBumpReminder } from "./modules/bump-reminder/index.js";
import { grantPairedRoleOnce, syncPairedRoleGrants } from "./modules/paired-role-grant/index.js";
import { handleDirectMessage } from "./modules/direct-message/index.js";
import { handleLevelingInteraction, handleLevelingMessage, handleLevelingVoiceState, startLevelingModule, syncLevelingRoles } from "./modules/leveling/index.js";

validateConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel],
});

const discordRecoveryTimeoutMs = 5 * 60_000;
let lastDiscordConnectionAt = Date.now();

function markDiscordConnected(): void {
  lastDiscordConnectionAt = Date.now();
}

client.once(Events.ClientReady, async (ready) => {
  markDiscordConnected();
  console.log(`[DISCORD] Gateway conectado como ${ready.user.tag}; iniciando módulos.`);
  const rest = new REST().setToken(config.token);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body: commands });
  await setupCustomEmojis(ready);
  await refreshGalleryButtons(ready);
  await startVerificationModule(ready);
  await startReportModule(ready);
  await startLfgModule(ready);
  const guild = config.guildId ? await ready.guilds.fetch(config.guildId).catch(() => null) : ready.guilds.cache.first();
  if (guild) {
    // Buscar todos os membros usa o opcode 8, que possui um limite rigoroso no
    // Gateway. As sincronizações abaixo devem compartilhar a mesma resposta.
    const members = await guild.members.fetch().catch((error) => {
      console.error("[MEMBROS] Falha ao carregar membros para as sincronizações iniciais:", error);
      return null;
    });
    if (members) {
      const pairedRoleCount = await syncPairedRoleGrants(guild, members).catch((error) => {
        console.error("[CARGO-DUPLO] Falha ao sincronizar concessões:", error);
        return 0;
      });
      console.log(`[CARGO-DUPLO] ${pairedRoleCount} membro(s) processado(s) nesta inicialização.`);
      await syncBoosterAccessRoles(guild, members).catch((error) => console.error("[PRISMA-IA] Falha ao sincronizar Boosters:", error));
      await syncLevelingRoles(guild, members).catch((error) => console.error("[LEVELING] Falha ao sincronizar cargos:", error));
    } else {
      console.error("[CARGO-DUPLO] Sincronização inicial ignorada porque os membros não foram carregados.");
      console.error("[PRISMA-IA] Sincronização inicial de Boosters ignorada porque os membros não foram carregados.");
    }
    await syncPunishmentPermissions(guild).catch((error) => console.error("[CASTIGO] Falha ao sincronizar permissões:", error));
  }
  startAiCleanup(ready);
  startLfgCleanup(ready);
  startBumpReminder(ready);
  startLevelingModule(ready);
  console.log(`Prisma conectado como ${ready.user.tag}. IA: ${config.openAiKey ? "ativa" : "desativada"}.`);
  console.log(`[MONITOR] Canais: ${config.monitoredChannelIds.size ? [...config.monitoredChannelIds].join(", ") : "todos os canais de texto"}.`);
  for (const channelId of config.monitoredChannelIds) {
    const channel = await ready.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.isDMBased()) { console.error(`[MONITOR] Canal ${channelId} não encontrado ou não pertence a um servidor.`); continue; }
    const permissions = (channel as GuildBasedChannel).permissionsFor(ready.user);
    const missing = [
      [PermissionFlagsBits.ViewChannel, "Ver canal"],
      [PermissionFlagsBits.ReadMessageHistory, "Ver histórico"],
      [PermissionFlagsBits.ManageMessages, "Gerenciar mensagens"],
      [PermissionFlagsBits.SendMessages, "Enviar mensagens"],
    ].filter(([permission]) => !permissions?.has(permission as bigint)).map(([, name]) => name);
    if (missing.length) console.error(`[MONITOR] Canal ${channelId} sem permissões: ${missing.join(", ")}.`);
    else console.log(`[MONITOR] Canal ${channelId} pronto para censura.`);
  }
});

client.on(Events.ShardReady, (shardId) => {
  markDiscordConnected();
  console.log(`[DISCORD] Shard ${shardId} pronta.`);
});
client.on(Events.ShardResume, (shardId, replayedEvents) => {
  markDiscordConnected();
  console.log(`[DISCORD] Shard ${shardId} reconectada; ${replayedEvents} evento(s) recuperado(s).`);
});
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.error(`[DISCORD] Shard ${shardId} desconectada (código ${event.code}). Tentando reconectar.`);
});
client.on(Events.ShardError, (error, shardId) => {
  console.error(`[DISCORD] Erro na shard ${shardId}:`, error);
});

client.on(Events.ChannelCreate, async (channel) => {
  await handleNewPunishmentChannel(channel).catch((error) => console.error("[CASTIGO] Falha ao proteger novo canal:", error));
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  await handleAiPresenceUpdate(client, oldPresence, newPresence);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  await handleLevelingVoiceState(oldState, newState).catch((error) => console.error(`[LEVELING] Falha ao atualizar tempo de voz de ${newState.id}:`, error));
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (config.guildId && newMember.guild.id !== config.guildId) return;
  await grantPairedRoleOnce(newMember).catch((error) => console.error(`[CARGO-DUPLO] Falha ao processar ${newMember.id}:`, error));
  await grantAccessRoleToBooster(newMember).catch((error) => console.error(`[PRISMA-IA] Falha ao conceder cargo ao Booster ${newMember.id}:`, error));
  if (startedBoosting(oldMember, newMember)) {
    await grantVerifiedRoleToBooster(newMember).catch((error) => console.error(`[BOOSTER] Falha ao conceder cargo de verificado ao Booster ${newMember.id}:`, error));
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (config.guildId && member.guild.id !== config.guildId) return;
  await grantPairedRoleOnce(member).catch((error) => console.error(`[CARGO-DUPLO] Falha ao processar novo membro ${member.id}:`, error));
  await grantAccessRoleToBooster(member).catch((error) => console.error(`[PRISMA-IA] Falha ao verificar cargo do novo membro ${member.id}:`, error));
});

client.on(Events.MessageCreate, async (message) => {
  try {
    void handleBumpMessage(client, message);
    if (message.author.bot) return;
    if (await handleLevelingMessage(message)) return;
    if (await handleDirectMessage(message)) return;
    if (await handleVerificationMessage(message)) return;
    if (await handleGalleryMessage(message)) return;
    if (await handleModerationMessage(client, message)) return;
    await handleAiMessage(client, message);
  } catch (error) {
    console.error(`[MENSAGEM] Falha ao processar mensagem ${message.id} no canal ${message.channelId}:`, error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && await handleLevelingInteraction(interaction)) return;
    if (await handleLfgInteraction(interaction)) return;
    if (await handleReportInteraction(interaction)) return;
    if (await handleVerificationInteraction(interaction)) return;
    if (await handleAiInteraction(interaction)) return;
    if (await handleGalleryInteraction(interaction)) return;
    if (interaction.isButton()) {
      if (await handleModerationButton(interaction)) return;
    }
    if (interaction.isChatInputCommand()) await handleModerationCommand(interaction);
  } catch (error) {
    console.error(`[INTERACAO] Falha ao processar ${interaction.id}:`, error);
    if (interaction.isRepliable()) {
      const errorMessage = { content: "Não consegui concluir esta ação. A equipe foi avisada.", flags: ["Ephemeral"] } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(errorMessage).catch(() => undefined);
      else await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
});

client.on(Events.Error, console.error);
const healthServer = startHealthServer(client);
setInterval(() => {
  if (client.isReady()) {
    markDiscordConnected();
    return;
  }
  const disconnectedForMs = Date.now() - lastDiscordConnectionAt;
  if (disconnectedForMs < discordRecoveryTimeoutMs) return;
  console.error(`[DISCORD] Conexão indisponível há ${Math.floor(disconnectedForMs / 1000)}s; reiniciando o processo.`);
  process.exit(1);
}, 30_000).unref();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  console.log(`[SISTEMA] ${signal} recebido; encerrando conexões.`);
  client.destroy();
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
});
client.login(config.token).catch((error) => {
  console.error("[DISCORD] Falha ao autenticar ou conectar:", error);
  process.exit(1);
});
