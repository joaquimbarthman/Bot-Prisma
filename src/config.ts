import "dotenv/config";

export const PRISMA_CREATOR_ID = process.env.PRISMA_CREATOR_ID?.trim() || "558417730487713794";

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
  dataDir: process.env.DATA_DIR?.trim() || "data",
  token: process.env.DISCORD_TOKEN ?? "",
  clientId: process.env.DISCORD_CLIENT_ID ?? "",
  guildId: process.env.DISCORD_GUILD_ID,
  modLogChannelId: process.env.MOD_LOG_CHANNEL_ID,
  publicErrorChannelId: process.env.PUBLIC_ERROR_CHANNEL_ID?.trim() || "1538276823786455050",
  monitoredChannelIds: new Set(
    (process.env.MONITORED_CHANNEL_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  ),
  monitoredCategoryIds: new Set([
    "1538661540754886716", "1538247652347613376", "1537989282751447166", "1538663337011707944",
    ...(process.env.MONITORED_CATEGORY_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean),
  ]),
  logMonitoredMessages: boolean("LOG_MONITORED_MESSAGES", true),
  logMessageContent: boolean("LOG_MESSAGE_CONTENT", false),
  ignoreAdministrators: boolean("IGNORE_ADMINISTRATORS", false),
  censorshipBypassRoleId: process.env.CENSORSHIP_BYPASS_ROLE_ID?.trim() || "1538337494355935302",
  punishmentRoleName: process.env.PUNISHMENT_ROLE_NAME?.trim() || "Mutado",
  punishmentRoleId: process.env.PUNISHMENT_ROLE_ID?.trim(),
  appealReferenceChannelName: process.env.APPEAL_REFERENCE_CHANNEL_NAME?.trim() || "Falando",
  punishmentCategoryId: process.env.PUNISHMENT_CATEGORY_ID?.trim() || "1538026559913328690",
  filterJsonPath: process.env.FILTER_JSON_PATH?.trim() || "data/filtro_discurso_odio_nazismo_ptBR.json",
  galleryChannelId: process.env.GALLERY_CHANNEL_ID?.trim() || "1538026764260085821",
  verification: {
    panelChannelId: process.env.VERIFICATION_PANEL_CHANNEL_ID?.trim() || "1538200208679239720",
    staffRoleId: process.env.VERIFICATION_STAFF_ROLE_ID?.trim() || "1538337494355935302",
    verifiedChatChannelId: process.env.VERIFIED_CHAT_CHANNEL_ID?.trim() || "138026764260085821",
    verifiedRoleId: process.env.VERIFIED_ROLE_ID?.trim() || "1538272377111318649",
    logChannelId: process.env.VERIFICATION_LOG_CHANNEL_ID?.trim(),
    deleteDelaySeconds: integer("VERIFICATION_DELETE_DELAY_SECONDS", 10),
  },
  reports: {
    panelChannelId: process.env.REPORT_PANEL_CHANNEL_ID?.trim() || "1538296088459608087",
    staffRoleId: process.env.REPORT_STAFF_ROLE_ID?.trim() || "1538337494355935302",
    logChannelId: process.env.REPORT_LOG_CHANNEL_ID?.trim() || "1538276823786455050",
  },
  lfg: {
    panelChannelId: process.env.LFG_PANEL_CHANNEL_ID?.trim() || "1538659348631519303",
    staffRoleId: process.env.LFG_STAFF_ROLE_ID?.trim(),
    maxOpenPerUser: integer("LFG_MAX_OPEN_PER_USER", 2),
    createCooldownSeconds: integer("LFG_CREATE_COOLDOWN_SECONDS", 30),
    nowExpiryMinutes: integer("LFG_NOW_EXPIRY_MINUTES", 120),
  },
  customCalls: {
    panelChannelId: process.env.CUSTOM_CALL_PANEL_CHANNEL_ID?.trim() || "1543322103766327305",
    categoryId: process.env.CUSTOM_CALL_CATEGORY_ID?.trim() || "1538663337011707944",
    accessRoleId: process.env.CUSTOM_CALL_ACCESS_ROLE_ID?.trim() || "1543322771420086362",
    automaticAccessSourceRoleId: process.env.CUSTOM_CALL_AUTOMATIC_ACCESS_SOURCE_ROLE_ID?.trim() || "1538253635392376862",
    logChannelId: process.env.CUSTOM_CALL_LOG_CHANNEL_ID?.trim(),
  },
  bumpReminder: {
    channelId: process.env.BUMP_REMINDER_CHANNEL_ID?.trim() || "1537991941512237067",
    moderationRoleId: process.env.BUMP_REMINDER_ROLE_ID?.trim() || "1538337494355935302",
    sourceBotId: process.env.BUMP_SOURCE_BOT_ID?.trim() || "302050872383242240",
    intervalHours: integer("BUMP_REMINDER_INTERVAL_HOURS", 2),
  },
  pairedRoleGrant: {
    requiredRoleIds: [
      process.env.PAIRED_ROLE_FIRST_ID?.trim() || "1538253635392376862",
      process.env.PAIRED_ROLE_SECOND_ID?.trim() || "1538022012591538176",
    ] as const,
    targetRoleId: process.env.PAIRED_ROLE_TARGET_ID?.trim() || "1538257302606319716",
  },
  leveling: {
    staffRoleId: "1538337494355935302",
    publicCommandChannelId: "1538437757440106506",
  },
  supabaseUrl: process.env.SUPABASE_URL?.trim(),
  supabaseSecretKey: process.env.SUPABASE_SECRET_KEY?.trim(),
  prismaAi: {
    enabled: boolean("PRISMA_AI_ENABLED", false),
    generalChannelId: process.env.AI_GENERAL_CHANNEL_ID?.trim(),
    testChannelId: process.env.AI_TEST_CHANNEL_ID?.trim() || "1539473171441258566",
    testNoticeCooldownSeconds: Math.max(30, integer("AI_TEST_NOTICE_COOLDOWN_SECONDS", 45)),
    panelChannelId: process.env.AI_PANEL_CHANNEL_ID?.trim(),
    accessRoleId: process.env.AI_ACCESS_ROLE_ID?.trim() || "1538257302606319716",
    boosterRoleId: process.env.AI_BOOSTER_ROLE_ID?.trim() || "1538022012591538176",
    model: process.env.PRISMA_AI_MODEL?.trim() || "gpt-5-mini",
    webSearchEnabled: boolean("AI_WEB_SEARCH_ENABLED", true),
    personalityConfigPath: process.env.PRISMA_PERSONALITY_CONFIG?.trim() || "data/personality/prisma.json",
    soulPath: process.env.PRISMA_SOUL_PATH?.trim() || "data/personality/prisma.json",
    reasoningEffort: process.env.AI_REASONING_EFFORT?.trim() || "minimal",
    maxOutputTokens: integer("AI_MAX_OUTPUT_TOKENS", 450),
    historyMaxMessages: integer("AI_HISTORY_MAX_MESSAGES", 10),
    historyMaxChars: integer("AI_HISTORY_MAX_CHARS", 12000),
    channelHistoryLimit: integer("AI_CHANNEL_HISTORY_LIMIT", 200),
    channelHistoryExpandedLimit: integer("AI_CHANNEL_HISTORY_EXPANDED_LIMIT", 200),
    userCooldownSeconds: Math.max(3, integer("AI_USER_COOLDOWN_SECONDS", 3)),
    operatorUserId: PRISMA_CREATOR_ID,
    creatorUserId: PRISMA_CREATOR_ID,
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
  moderationModel: process.env.MODERATION_MODEL?.trim() || "omni-moderation-latest",
  port: integer("PORT", 10_000),
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
