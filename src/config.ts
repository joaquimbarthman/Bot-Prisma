import "dotenv/config";

function integer(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} deve ser um inteiro positivo.`);
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "sim", "on"].includes(value.toLowerCase());
}

function decimal(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} deve ser um número não negativo.`);
  return value;
}

export const config = {
  token: process.env.DISCORD_TOKEN ?? "",
  clientId: process.env.DISCORD_CLIENT_ID ?? "",
  guildId: process.env.DISCORD_GUILD_ID,
  modLogChannelId: process.env.MOD_LOG_CHANNEL_ID,
  galleryReportChannelId: process.env.GALLERY_REPORT_CHANNEL_ID?.trim() || process.env.MOD_LOG_CHANNEL_ID?.trim(),
  monitoredChannelIds: new Set(
    (process.env.MONITORED_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  ),
  logMonitoredMessages: boolean("LOG_MONITORED_MESSAGES", true),
  logMessageContent: boolean("LOG_MESSAGE_CONTENT", false),
  ignoreAdministrators: boolean("IGNORE_ADMINISTRATORS", false),
  punishmentRoleName: process.env.PUNISHMENT_ROLE_NAME?.trim() || "Mutado",
  punishmentRoleId: process.env.PUNISHMENT_ROLE_ID?.trim(),
  appealReferenceChannelName: process.env.APPEAL_REFERENCE_CHANNEL_NAME?.trim() || "Falando",
  punishmentCategoryId: process.env.PUNISHMENT_CATEGORY_ID?.trim() || "1538026559913328690",
  filterJsonPath: process.env.FILTER_JSON_PATH?.trim(),
  galleryChannelId: process.env.GALLERY_CHANNEL_ID?.trim() || "1538026764260085821",
  verification: {
    panelChannelId: process.env.VERIFICATION_PANEL_CHANNEL_ID?.trim() || "1538200208679239720",
    staffRoleId: process.env.VERIFICATION_STAFF_ROLE_ID?.trim() || "1537991738801659904",
    verifiedChatChannelId: process.env.VERIFIED_CHAT_CHANNEL_ID?.trim() || "138026764260085821",
    verifiedRoleId: process.env.VERIFIED_ROLE_ID?.trim() || "1538272377111318649",
    logChannelId: process.env.VERIFICATION_LOG_CHANNEL_ID?.trim(),
    deleteDelaySeconds: integer("VERIFICATION_DELETE_DELAY_SECONDS", 10),
  },
  reports: {
    panelChannelId: process.env.REPORT_PANEL_CHANNEL_ID?.trim() || "1538296088459608087",
    staffRoleId: process.env.REPORT_STAFF_ROLE_ID?.trim() || "1537991738801659904",
    logChannelId: process.env.REPORT_LOG_CHANNEL_ID?.trim() || "1538276823786455050",
  },
  lfg: {
    panelChannelId: process.env.LFG_PANEL_CHANNEL_ID?.trim() || "1538659348631519303",
    staffRoleId: process.env.LFG_STAFF_ROLE_ID?.trim(),
    maxOpenPerUser: integer("LFG_MAX_OPEN_PER_USER", 2),
    createCooldownSeconds: integer("LFG_CREATE_COOLDOWN_SECONDS", 30),
    nowExpiryMinutes: integer("LFG_NOW_EXPIRY_MINUTES", 120),
    voiceEmptyGraceMinutes: integer("LFG_VOICE_EMPTY_GRACE_MINUTES", 60),
  },
  bumpReminder: {
    channelId: process.env.BUMP_REMINDER_CHANNEL_ID?.trim() || "1537991941512237067",
    moderationRoleId: process.env.BUMP_REMINDER_ROLE_ID?.trim() || "1538337494355935302",
    intervalHours: integer("BUMP_REMINDER_INTERVAL_HOURS", 2),
  },
  supabaseUrl: process.env.SUPABASE_URL?.trim(),
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY?.trim(),
  prismaAi: {
    enabled: boolean("PRISMA_AI_ENABLED", false),
    generalChannelId: process.env.AI_GENERAL_CHANNEL_ID?.trim(),
    panelChannelId: process.env.AI_PANEL_CHANNEL_ID?.trim(),
    accessRoleId: process.env.AI_ACCESS_ROLE_ID?.trim() || "1538257302606319716",
    model: process.env.PRISMA_AI_MODEL?.trim() || "gpt-5-mini",
    personalityConfigPath: process.env.PRISMA_PERSONALITY_CONFIG?.trim() || "data/prisma-personality.json",
    soulPath: process.env.PRISMA_SOUL_PATH?.trim() || "personality/prisma.json",
    reasoningEffort: process.env.AI_REASONING_EFFORT?.trim() || "minimal",
    maxOutputTokens: integer("AI_MAX_OUTPUT_TOKENS", 300),
    historyMaxMessages: integer("AI_HISTORY_MAX_MESSAGES", 10),
    historyMaxChars: integer("AI_HISTORY_MAX_CHARS", 12000),
    userCooldownSeconds: Math.max(3, integer("AI_USER_COOLDOWN_SECONDS", 3)),
    spontaneousCooldownMinutes: integer("AI_SPONTANEOUS_COOLDOWN_MINUTES", 180),
    dailySpontaneousLimit: integer("AI_DAILY_SPONTANEOUS_LIMIT", 10),
    spontaneousChancePercent: decimal("AI_SPONTANEOUS_CHANCE_PERCENT", 2),
    monthlyBudgetBrl: decimal("AI_MONTHLY_BUDGET_BRL", 10),
    inputPriceUsdPerMillion: decimal("AI_INPUT_PRICE_PER_MILLION_USD", 0.25),
    outputPriceUsdPerMillion: decimal("AI_OUTPUT_PRICE_PER_MILLION_USD", 2),
    usdBrlReference: decimal("USD_BRL_REFERENCE", 5.5),
    timezone: process.env.AI_TIMEZONE?.trim() || "America/Sao_Paulo",
  },
  openAiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  openAiBaseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  aiMaxDailyRequests: integer("AI_MAX_DAILY_REQUESTS", 1000),
  warningsBeforeTimeout: integer("WARNINGS_BEFORE_TIMEOUT", 3),
  timeoutMinutes: integer("TIMEOUT_MINUTES", 10),
};

export function validateConfig(): void {
  const missing = [!config.token && "DISCORD_TOKEN", !config.clientId && "DISCORD_CLIENT_ID"].filter(Boolean);
  if (missing.length) throw new Error(`Preencha no .env: ${missing.join(", ")}`);
  if (!!config.supabaseUrl !== !!config.supabaseSecretKey) throw new Error("Configure SUPABASE_URL e SUPABASE_SECRET_KEY juntas, ou remova ambas para usar o modo local.");
  if (config.prismaAi.enabled && !config.openAiKey) throw new Error("PRISMA_AI_ENABLED exige OPENAI_API_KEY.");
}
