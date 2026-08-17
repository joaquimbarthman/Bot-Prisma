import { Client, Events, GatewayIntentBits, Partials, PermissionFlagsBits, REST, Routes, type GuildBasedChannel } from "discord.js";
import { commands } from "./commands.js";
import { config, validateConfig } from "./config.js";
import { setupCustomEmojis } from "./emoji-manager.js";
import { handleGalleryButton, handleGalleryMessage, refreshGalleryButtons } from "./modules/gallery/index.js";
import { startHealthServer } from "./health-server.js";
import { handleModerationButton, handleModerationCommand, handleModerationMessage } from "./moderation-feature.js";
import { handleAiInteraction, handleAiMessage, handleAiPresenceUpdate, startAiCleanup } from "./modules/ai/index.js";
import { grantAccessRoleToBooster, grantVerifiedRoleToBooster, syncBoosterAccessRoles, syncBoosterVerifiedRoles } from "./modules/ai/permissions.js";
import { handleVerificationInteraction, handleVerificationMessage, startVerificationModule } from "./modules/verification/index.js";
import { handleReportInteraction, startReportModule } from "./modules/reports/index.js";
import { handleLfgInteraction, startLfgCleanup, startLfgModule } from "./modules/lfg/index.js";
import { handleNewPunishmentChannel, syncPunishmentPermissions } from "./punishment-role.js";

validateConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (ready) => {
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
    await syncBoosterAccessRoles(guild).catch((error) => console.error("[PRISMA-IA] Falha ao sincronizar Boosters:", error));
    await syncBoosterVerifiedRoles(guild).catch((error) => console.error("[BOOSTER] Falha ao sincronizar cargos de verificado:", error));
    await syncPunishmentPermissions(guild).catch((error) => console.error("[CASTIGO] Falha ao sincronizar permissões:", error));
  }
  startAiCleanup(ready);
  startLfgCleanup(ready);
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

client.on(Events.ChannelCreate, async (channel) => {
  await handleNewPunishmentChannel(channel).catch((error) => console.error("[CASTIGO] Falha ao proteger novo canal:", error));
});

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  await handleAiPresenceUpdate(client, oldPresence, newPresence);
});

client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
  if (config.guildId && newMember.guild.id !== config.guildId) return;
  await grantAccessRoleToBooster(newMember).catch((error) => console.error(`[PRISMA-IA] Falha ao conceder cargo ao Booster ${newMember.id}:`, error));
  await grantVerifiedRoleToBooster(newMember).catch((error) => console.error(`[BOOSTER] Falha ao conceder cargo de verificado ao Booster ${newMember.id}:`, error));
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (config.guildId && member.guild.id !== config.guildId) return;
  await grantAccessRoleToBooster(member).catch((error) => console.error(`[PRISMA-IA] Falha ao verificar cargo do novo membro ${member.id}:`, error));
  await grantVerifiedRoleToBooster(member).catch((error) => console.error(`[BOOSTER] Falha ao verificar cargo de verificado do novo membro ${member.id}:`, error));
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;
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
    if (await handleLfgInteraction(interaction)) return;
    if (await handleReportInteraction(interaction)) return;
    if (await handleVerificationInteraction(interaction)) return;
    if (await handleAiInteraction(interaction)) return;
    if (interaction.isButton()) {
      if (await handleGalleryButton(interaction)) return;
      if (await handleModerationButton(interaction)) return;
    }
    if (interaction.isChatInputCommand()) await handleModerationCommand(interaction);
  } catch (error) {
    console.error(`[INTERACAO] Falha ao processar ${interaction.id}:`, error);
    if (interaction.isRepliable()) {
      const errorMessage = { content: "Não consegui concluir esta ação. A equipe foi avisada.", ephemeral: true } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(errorMessage).catch(() => undefined);
      else await interaction.reply(errorMessage).catch(() => undefined);
    }
  }
});

client.on(Events.Error, console.error);
const healthServer = startHealthServer(client);
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  console.log(`[SISTEMA] ${signal} recebido; encerrando conexões.`);
  client.destroy();
  healthServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
});
client.login(config.token);
