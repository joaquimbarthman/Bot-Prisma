import { ComponentType, SeparatorSpacingSize, type APIContainerComponent, type Client, type Collection, type Guild, type GuildMember, type Message, type Snowflake, type VoiceState } from "discord.js";
import { config } from "../../config.js";
import { calculateLevel, calculateXpAward, getTotalXpRequired } from "./progression.js";
import { addBlacklist, awardXp, getBlacklist, getLeaderboard, getMemberLevel, getRankPosition, getRewards, getSettings, removeBlacklist, removeMemberLevel, removeReward, setCurrentRewardRole, setReward, type LevelReward } from "./store.js";

const chatCooldowns = new Map<string, number>();
const voiceEligibleSince = new Map<string, number>();
const voiceGuildsProcessing = new Set<string>();
const cache = new Map<string, { expiresAt: number; settings: Awaited<ReturnType<typeof getSettings>>; chat: Awaited<ReturnType<typeof getBlacklist>>; voice: Awaited<ReturnType<typeof getBlacklist>> }>();
const CACHE_MS = 60_000;

async function guildConfig(guildId: string) { const found = cache.get(guildId); if (found && found.expiresAt > Date.now()) return found; const [settings, chat, voice] = await Promise.all([getSettings(guildId), getBlacklist(guildId, "chat"), getBlacklist(guildId, "voice")]); const value = { expiresAt: Date.now() + CACHE_MS, settings, chat, voice }; cache.set(guildId, value); return value; }
function invalidate(guildId: string): void { cache.delete(guildId); }
function blacklisted(entries: Awaited<ReturnType<typeof getBlacklist>>, channelId: string, member: GuildMember): boolean { return entries.some((entry) => entry.targetType === "channel" ? entry.targetId === channelId : member.roles.cache.has(entry.targetId)); }
function xpAmount(member: GuildMember, sourceXp: number, settings: Awaited<ReturnType<typeof getSettings>>): number {
  const isBooster = !!settings.boosterRoleId && member.roles.cache.has(settings.boosterRoleId);
  return calculateXpAward(settings.globalMultiplier, sourceXp, isBooster ? settings.boosterMultiplier : 0);
}

function panelDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}/${value("month")}/${value("year")} • ${value("hour")}:${value("minute")}`;
}

async function syncReward(member: GuildMember, rewards: LevelReward[], level: number): Promise<LevelReward | null> {
  const deserved = [...rewards].filter((item) => item.level <= level).sort((a, b) => b.level - a.level)[0] ?? null;
  const rewardRoleIds = new Set(rewards.map((item) => item.roleId));
  const obsolete = member.roles.cache.filter((role) => rewardRoleIds.has(role.id) && role.id !== deserved?.roleId);
  if (obsolete.size) await member.roles.remove(obsolete, "Sincronizacao de cargo de evolucao");
  if (deserved && !member.roles.cache.has(deserved.roleId)) await member.roles.add(deserved.roleId, `Marco de evolucao nivel ${deserved.level}`);
  await setCurrentRewardRole(member.guild.id, member.id, deserved?.roleId ?? null);
  return deserved;
}

function levelUpLayout(member: GuildMember, reward: LevelReward): APIContainerComponent {
  const role = member.guild.roles.cache.get(reward.roleId);
  return {
    type: ComponentType.Container,
    accent_color: role?.color || 0x7c5cff,
    components: [
      {
        type: ComponentType.Section,
        components: [{
          type: ComponentType.TextDisplay,
          content: `## Nivel Aumentado\n${reward.emoji}・${reward.title}\n\n> **<@${member.id}>** alcançou o **NÍVEL ${reward.level}** ₊˚⊹ ✦\n> ${reward.shortMessage}・<@&${reward.roleId}>`,
        }],
        accessory: {
          type: ComponentType.Thumbnail,
          media: { url: member.displayAvatarURL({ size: 256, forceStatic: false }) },
          description: "Avatar do membro",
        },
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `-# Prismoria • Sistema de Evolução • ${panelDate()}` },
    ],
  };
}

function levelUpMessageComponents(member: GuildMember, reward: LevelReward) {
  return [
    levelUpLayout(member, reward),
  ];
}

async function announce(member: GuildMember, reward: LevelReward, channelId: string): Promise<void> {
  const channel = await member.guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || channel.isDMBased()) return;
  await channel.send({ components: levelUpMessageComponents(member, reward), flags: ["IsComponentsV2"], allowedMentions: { parse: [], users: [member.id] } });
}

async function processLevelChange(member: GuildMember, oldLevel: number, newLevel: number, announcementChannelId: string): Promise<void> {
  if (newLevel <= oldLevel) return;
  const rewards = await getRewards(member.guild.id);
  const unlocked = rewards.filter((item) => item.level > oldLevel && item.level <= newLevel).sort((a, b) => b.level - a.level)[0];
  await syncReward(member, rewards, newLevel);
  if (unlocked) await announce(member, unlocked, announcementChannelId);
}

export async function handleLevelingMessage(message: Message): Promise<boolean> {
  if (!message.inGuild() || message.author.bot || !message.member) return false;
  if (await handlePrefixCommand(message)) return true;
  const { settings, chat } = await guildConfig(message.guildId);
  if (!settings.enabled || blacklisted(chat, message.channelId, message.member)) return false;
  const key = `${message.guildId}:${message.author.id}`; const now = Date.now(); const memoryLast = chatCooldowns.get(key) ?? 0;
  if (now - memoryLast < settings.chatCooldownSeconds * 1000) return false;
  const existing = await getMemberLevel(message.guildId, message.author.id); const storedLast = existing?.lastChatXpAt ? Date.parse(existing.lastChatXpAt) : 0;
  if (now - storedLast < settings.chatCooldownSeconds * 1000) { chatCooldowns.set(key, storedLast); return false; }
  const amount = xpAmount(message.member, settings.chatMultiplier, settings); if (!amount) return false;
  chatCooldowns.set(key, now);
  const result = await awardXp(message.guildId, message.author.id, amount, "chat", settings.maxLevel);
  await processLevelChange(message.member, result.before.level, result.after.level, settings.announcementChannelId);
  return false;
}

async function processVoiceGuild(guild: Guild): Promise<void> {
  if (voiceGuildsProcessing.has(guild.id)) return;
  voiceGuildsProcessing.add(guild.id);
  try {
    const { settings, voice } = await guildConfig(guild.id);
    const eligible = new Map<string, GuildMember>();
    if (settings.enabled) {
      for (const channel of guild.channels.cache.filter((item) => item.isVoiceBased()).values()) {
        if (!channel.isVoiceBased() || channel.id === guild.afkChannelId) continue;
        const humans = channel.members.filter((member) => !member.user.bot);
        for (const member of humans.values()) {
          if (!blacklisted(voice, channel.id, member)) eligible.set(`${guild.id}:${member.id}`, member);
        }
      }
    }

    for (const key of voiceEligibleSince.keys()) {
      if (key.startsWith(`${guild.id}:`) && !eligible.has(key)) voiceEligibleSince.delete(key);
    }

    const now = Date.now();
    const requiredMs = settings.voiceCooldownSeconds * 1000;
    for (const [key, member] of eligible) {
      const startedAt = voiceEligibleSince.get(key);
      if (startedAt === undefined) { voiceEligibleSince.set(key, now); continue; }
      if (now - startedAt < requiredMs) continue;
      const amount = xpAmount(member, settings.voiceMultiplier, settings);
      if (!amount) { voiceEligibleSince.set(key, now); continue; }
      const result = await awardXp(guild.id, member.id, amount, "voice", settings.maxLevel);
      voiceEligibleSince.set(key, now);
      await processLevelChange(member, result.before.level, result.after.level, settings.announcementChannelId);
    }
  } finally {
    voiceGuildsProcessing.delete(guild.id);
  }
}

function processVoiceCycle(client: Client): void {
  for (const guild of client.guilds.cache.values()) {
    void processVoiceGuild(guild).catch((error) => console.error(`[LEVELING] Falha no lote de voz de ${guild.id}:`, error));
  }
}

export function startLevelingModule(client: Client): void {
  processVoiceCycle(client);
  setInterval(() => processVoiceCycle(client), 30_000).unref();
}

export async function handleLevelingVoiceState(oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (oldState.channelId === newState.channelId) return;
  await processVoiceGuild(newState.guild);
}

function parseTarget(message: Message): { targetType: "channel" | "role"; targetId: string } | null { const channel = message.mentions.channels.first(); if (channel) return { targetType: "channel", targetId: channel.id }; const role = message.mentions.roles.first(); return role ? { targetType: "role", targetId: role.id } : null; }
function staff(message: Message): boolean { return !!message.member?.roles.cache.has(config.leveling.staffRoleId); }
const rewardCopy: Record<number, [string, string, string]> = { 1: ["🪨", "Toda jornada comeca com um pequeno fragmento", "Jornada iniciada"], 10: ["🧊", "Aos poucos, o brilho comeca a surgir", "Estagio alcancado"], 20: ["🌙", "Uma nova energia comeca a despertar", "Evolucao conquistada"], 35: ["💧", "Sua presenca ja comeca a deixar marcas", "Marco conquistado"], 50: ["🍀", "Metade da jornada, o brilho so aumenta", "Grande conquista"], 60: ["❄️", "Quanto mais alto, mais raro se torna", "Nova ascensao"], 75: ["🪻", "Poucos chegam tao longe em sua jornada", "Raro marco"], 90: ["💎", "O topo ja pode ser visto daqui", "Quase lendario"], 100: ["🫧", "O brilho finalmente alcancou sua forma maxima", "Evolucao maxima"] };

async function handlePrefixCommand(message: Message): Promise<boolean> {
  const input = message.content.trim(); const command = input.split(/\s+/, 1)[0]?.toLowerCase();
  if (!["!addb", "!remb", "!add-chat", "!remove-chat", "!add-voice", "!remove-voice", "!listab", "!addl", "!removel", "!levels", "!testep", "!testp", "!rank", "!top"].includes(command)) return false;
  if (!message.guild || !message.member) return true;
  const publicCommand = command === "!rank" || command === "!top";
  if (publicCommand && message.channelId !== config.leveling.publicCommandChannelId) {
    const notice = await message.reply(`Use este comando de evolucao somente em <#${config.leveling.publicCommandChannelId}>.`);
    setTimeout(() => void notice.delete().catch(() => undefined), 5_000).unref();
    return true;
  }
  if (command === "!rank") { await sendRank(message, message.mentions.members?.first() ?? message.member); return true; }
  if (command === "!top") {
    const rows = await getLeaderboard(message.guild.id, 1_000);
    const fetchedMembers = await message.guild.members.fetch().catch(() => null);
    const members = fetchedMembers ?? message.guild.members.cache;
    const staleRows = fetchedMembers ? rows.filter((row) => !fetchedMembers.has(row.userId)) : [];
    await Promise.all(staleRows.map((row) => removeMemberLevel(row.guildId, row.userId)));
    const activeRows = rows.filter((row) => members.has(row.userId)).slice(0, 10);
    const ranking = activeRows.map((row, index) =>
      `**${index + 1} <@${row.userId}> - Nível ${row.level}** • ${row.xpTotal.toLocaleString("pt-BR")} XP`,
    ).join("\n");
    const components: APIContainerComponent[] = [{
      type: ComponentType.Container,
      accent_color: 0x7c5cff,
      components: [
        { type: ComponentType.TextDisplay, content: "## Ranking de Evolução\n-# Os membros com maior experiência acumulada no servidor." },
        { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
        { type: ComponentType.TextDisplay, content: ranking ? `**Lista de Membros**\n\n>>> ${ranking}` : "**Membros**\n\nAinda não há participantes no ranking." },
        { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
        { type: ComponentType.TextDisplay, content: `-# Prismoria • Sistema de Evolução • ${panelDate()}` },
      ],
    }];
    await message.reply({ components, flags: ["IsComponentsV2"], allowedMentions: { parse: [] } });
    return true;
  }
  if (!staff(message)) { await message.reply(`Somente <@&${config.leveling.staffRoleId}> pode usar este comando.`); return true; }
  if (command === "!testep" || command === "!testp") {
    const level = Number(input.match(/^!teste?p\s+(\d{1,3})(?:\s|$)/i)?.[1]);
    if (!Number.isInteger(level) || level < 1 || level > 100) { await message.reply("Use `!testep <nivel> [@membro]`."); return true; }
    const reward = (await getRewards(message.guild.id)).find((item) => item.level === level);
    if (!reward) { await message.reply(`O nivel ${level} ainda nao possui cargo configurado.`); return true; }
    const member = message.mentions.members?.first() ?? message.member;
    await message.reply({ components: levelUpMessageComponents(member, reward), flags: ["IsComponentsV2"], allowedMentions: { parse: [], users: [member.id] } });
    return true;
  }
  if (command === "!listab") {
    const entries = (await Promise.all([getBlacklist(message.guild.id, "chat"), getBlacklist(message.guild.id, "voice")])).flat();
    const unique = [...new Map(entries.map((entry) => [`${entry.targetType}:${entry.targetId}`, entry])).values()];
    await message.reply(unique.length ? unique.map((entry) => `<${entry.targetType === "channel" ? "#" : "@&"}${entry.targetId}>`).join("\n") : "A lista negra esta vazia.");
    return true;
  }
  const shortBlacklistMatch = input.match(/^!(addb|remb)(?:\s|$)/i);
  if (shortBlacklistMatch) {
    const target = parseTarget(message);
    if (!target) { await message.reply(`Use \`!${shortBlacklistMatch[1].toLowerCase()} #canal\` ou \`!${shortBlacklistMatch[1].toLowerCase()} @cargo\`.`); return true; }
    const types: ("chat" | "voice")[] = ["chat", "voice"];
    for (const type of types) {
      const entry = { guildId: message.guild.id, type, ...target };
      if (shortBlacklistMatch[1].toLowerCase() === "addb") await addBlacklist(entry); else await removeBlacklist(entry);
    }
    invalidate(message.guild.id);
    await message.reply("Lista negra atualizada.");
    return true;
  }
  const blacklistMatch = command.match(/^!(add|remove)-(chat|voice)$/); if (blacklistMatch) { const target = parseTarget(message); if (!target) { await message.reply("Mencione um canal ou cargo."); return true; } const entry = { guildId: message.guild.id, type: blacklistMatch[2] as "chat" | "voice", ...target }; if (blacklistMatch[1] === "add") await addBlacklist(entry); else await removeBlacklist(entry); invalidate(message.guild.id); await message.reply("Blacklist atualizada."); return true; }
  if (command === "!levels") { const rewards = await getRewards(message.guild.id); await message.reply(rewards.length ? rewards.map((item) => `Nivel ${item.level}: <@&${item.roleId}>`).join("\n") : "Nenhum cargo de evolucao configurado."); return true; }
  const shortLevel = input.match(/^!(?:addl|removel)\s+(\d{1,3})(?:\s|$)/i)?.[1];
  const legacyLevel = input.match(/nivel\((\d{1,3})\)/i)?.[1];
  const level = Number(shortLevel ?? legacyLevel);
  if (!Number.isInteger(level) || level < 1 || level > 100) { await message.reply(command === "!addl" ? "Use `!addl <nivel> @cargo`." : "Use `!removel <nivel>`."); return true; }
  if (command === "!removel") { await removeReward(message.guild.id, level); await message.reply(`Recompensa do nivel ${level} removida.`); return true; }
  const role = message.mentions.roles.first(); if (!role) { await message.reply("Use `!addl <nivel> @cargo`."); return true; } const copy = rewardCopy[level] ?? ["✦", `Novo marco no nivel ${level}`, "Marco conquistado"]; await setReward({ guildId: message.guild.id, level, roleId: role.id, emoji: copy[0], title: copy[1], shortMessage: copy[2] }); await message.reply(`Nivel ${level} vinculado a ${role}.`); return true;
}

async function sendRank(target: Message, member: GuildMember): Promise<void> {
  const record = await getMemberLevel(member.guild.id, member.id);
  const settings = await getSettings(member.guild.id);
  const xp = record?.xpTotal ?? 0;
  const level = calculateLevel(xp, settings.maxLevel);
  const levelStartXp = getTotalXpRequired(level);
  const nextLevelXp = level >= settings.maxLevel ? levelStartXp : getTotalXpRequired(level + 1);
  const levelProgressXp = Math.max(0, xp - levelStartXp);
  const levelRequiredXp = Math.max(0, nextLevelXp - levelStartXp);
  const percent = level >= settings.maxLevel ? 100 : Math.floor((levelProgressXp / levelRequiredXp) * 100);
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)));
  const progressBar = `${"▰".repeat(filled)}${"▱".repeat(10 - filled)}`;
  const rewards = await getRewards(member.guild.id);
  const current = [...rewards].reverse().find((item) => item.level <= level);
  const next = rewards.find((item) => item.level > level);
  const position = await getRankPosition(member.guild.id, xp);
  const roleColor = current ? member.guild.roles.cache.get(current.roleId)?.color : undefined;

  const components: APIContainerComponent[] = [{
    type: ComponentType.Container,
    accent_color: roleColor || member.displayColor || 0x7c5cff,
    components: [
      {
        type: ComponentType.Section,
        components: [{
          type: ComponentType.TextDisplay,
          content: [
            "## Progresso de Evolução",
            `### Nível ${level}`,
            level >= settings.maxLevel
              ? "**Evolução máxima alcançada**"
              : `**${levelProgressXp.toLocaleString("pt-BR")} / ${levelRequiredXp.toLocaleString("pt-BR")} XP**`,
            `${progressBar} **${percent}%\n**`,
            "-# Cada conversa fortalece sua presença. Continue participando e avance na jornada.",
          ].join("\n"),
        }],
        accessory: {
          type: ComponentType.Thumbnail,
          media: { url: member.displayAvatarURL({ size: 256, forceStatic: false }) },
          description: "Avatar do membro",
        },
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: `**Cargo atual**\n${current ? `<@&${current.roleId}>` : "Nenhum marco desbloqueado"}\n\n**Posição no servidor**\n#${position}`,
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      {
        type: ComponentType.TextDisplay,
        content: next
          ? `**Próximo marco**\n<@&${next.roleId}>\n\n-# Disponível no nível ${next.level}`
          : "**Jornada concluída**\nTodos os marcos foram conquistados.",
      },
      { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
      { type: ComponentType.TextDisplay, content: `-# Prismoria • Sistema de Evolução • ${panelDate()}` },
    ],
  }];

  await target.reply({ components, flags: ["IsComponentsV2"], allowedMentions: { parse: [] } });
}

export async function syncLevelingRoles(
  guild: Guild,
  members?: Collection<Snowflake, GuildMember>,
): Promise<void> {
  const rewards = await getRewards(guild.id);
  if (!rewards.length) return;
  members ??= await guild.members.fetch();
  for (const member of members.values()) {
    if (member.user.bot) continue;
    const level = await getMemberLevel(guild.id, member.id);
    if (level) await syncReward(member, rewards, level.level);
  }
}

export async function handleLevelingMemberRemove(member: Pick<GuildMember, "guild" | "id">): Promise<void> {
  const key = `${member.guild.id}:${member.id}`;
  chatCooldowns.delete(key);
  voiceEligibleSince.delete(key);
  await removeMemberLevel(member.guild.id, member.id);
}
