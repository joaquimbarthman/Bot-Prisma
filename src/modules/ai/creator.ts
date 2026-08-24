import { PRISMA_CREATOR_ID } from "../../config.js";

export type PrismaPermissionContext = {
  isCreator: boolean;
  canViewDiagnostics: boolean;
  canViewInternalState: boolean;
  canViewOperatorRules: boolean;
  canBypassNormalRestrictions: boolean;
  canViewSecrets: false;
};

export type CreatorDiagnosticRequest = { requested: boolean; operatorRules: boolean; memory: boolean; context: boolean; internalState: boolean; provider: boolean; database: boolean; lyrics: boolean; listRules: boolean };

export type PrismaRuntimeDiagnostics = {
  adminTool?: { tool: string; success: boolean; data: unknown; executedAt: string };
  lastGeneration?: { memoryIds: number[]; memoryCount: number; recentHistoryCount: number; channelContextUsed: boolean; operatorRuleCount: number; model: string };
  operatorRules?: { databaseReachable: boolean; loadedRules: number; cacheEnabled: boolean; cacheAgeMs?: number; lastLoadAt?: string; enteringRuntimePrompt: boolean; error?: string; activeRules?: string[] };
  memory?: { enabled: boolean; relevantCount: number };
  context?: { recentMessages: number; channelContextUsed: boolean };
  internalState?: { relationship: Record<string, unknown>; temperament: Record<string, unknown>; emotionalStateAvailable: boolean };
  provider?: { configured: boolean; model: string };
  lyrics?: { attempted: boolean; status?: string; trackName?: string; artistName?: string };
};

export function isPrismaCreator(userId: string): boolean { return userId === PRISMA_CREATOR_ID; }

export function asksAboutPrismaCreator(content: string): boolean {
  return /\b(?:seu|sua)\s+(?:dono|dona|criador|criadora|owner)\b|\b(?:dono|dona|criador|criadora|owner)\s+da\s+prisma\b|\bquem\s+(?:te|a)\s+criou\b|\bquem\s+(?:e|eh|Ã©)\s+(?:o|a)?\s*(?:dono|dona|criador|criadora|owner)\s+(?:da\s+prisma|seu|sua)\b/i.test(content);
}
export function prismaPermissionContext(userId: string): PrismaPermissionContext {
  const creator = isPrismaCreator(userId);
  return { isCreator: creator, canViewDiagnostics: creator, canViewInternalState: creator, canViewOperatorRules: creator, canBypassNormalRestrictions: creator, canViewSecrets: false };
}
export function detectCreatorDiagnosticRequest(content: string): CreatorDiagnosticRequest {
  const rules = /\b(?:rules?|regras?|prisma_operator_rules)\b/i.test(content);
  const memory = /\b(?:mem[oó]ria|memories|perfil aprendido)\b/i.test(content);
  const context = /\b(?:contexto|hist[oó]rico|mensagens recentes)\b/i.test(content);
  const internalState = /\b(?:temperamento|relacionamento|estado emocional|estado interno|scores?)\b/i.test(content);
  const provider = /\b(?:provider|modelo|openai|gpt)\b/i.test(content);
  const database = /\b(?:banco|supabase|database|tabela)\b/i.test(content);
  const lyrics = /\b(?:pesquisa de letras?|lrclib|letra encontrou|m[uú]sica encontrou)\b/i.test(content);
  return { requested: rules || memory || context || internalState || provider || database || lyrics, operatorRules: rules, memory, context, internalState, provider, database, lyrics, listRules: rules && /\b(?:quais|lista|mostra|conte[uú]do|ativas)\b/i.test(content) };
}
export function redactConfiguredSecrets(content: string, secrets: Array<string | undefined>): string {
  return secrets.filter((value): value is string => !!value && value.length >= 8).reduce((text, secret) => text.split(secret).join("[segredo oculto]"), content);
}
