import { getEmotionalState, getPrismaProfile, getRelevantPrismaMemories, listActiveSelfLearnings, recentDailySummaries, type UserSettings } from "./store.js";

export type PrismaPersonalContext = {
  learnedProfile: Awaited<ReturnType<typeof getPrismaProfile>>;
  relevantMemories: Awaited<ReturnType<typeof getRelevantPrismaMemories>>;
  emotionalState: Awaited<ReturnType<typeof getEmotionalState>> | undefined;
  dailySummaries: Awaited<ReturnType<typeof recentDailySummaries>>;
  selfLearnings: Awaited<ReturnType<typeof listActiveSelfLearnings>>;
};

export type ContextNeeds = {
  recentHistory: true;
  memories: boolean;
  channelContext: boolean;
  expandedChannelContext: boolean;
  dailySummaries: boolean;
  userProfile: boolean;
};

const oldContextPattern = /\b(?:lembra|lembrar|ontem|outro dia|antes|última vez|ultima vez|semana passada|eu te falei|eu tinha (?:dito|falado)|aquele projeto|aquela pessoa|meu favorito|oq eu tinha falado)\b/iu;
const memoryPattern = /\b(?:lembra|meu|minha|favorit[oa]|eu gosto|eu curto|eu prefiro|eu te falei|eu tinha (?:dito|falado)|aquele projeto|aquela pessoa)\b/iu;
const channelPattern = /\b(?:oq|o que|que)\s+(?:ele|ela|eles|elas|vcs|vocês?)\s+(?:falou|disse|falaram|disseram|acham)|\b(?:essa|aquela)\s+(?:conversa|discussão)|\boq aconteceu aqui\b|\bisso q(?:ue)? (?:ele|ela) (?:disse|falou)\b|\bvc viu(?: oq)?\b/iu;

export function determineContextNeeds(content: string, options: { hasReply?: boolean; mentionsOtherUser?: boolean } = {}): ContextNeeds {
  const oldContext = oldContextPattern.test(content);
  return {
    recentHistory: true,
    memories: memoryPattern.test(content) || oldContext,
    channelContext: !!options.hasReply || !!options.mentionsOtherUser || channelPattern.test(content),
    expandedChannelContext: oldContext && (!!options.hasReply || channelPattern.test(content)),
    dailySummaries: oldContext,
    userProfile: memoryPattern.test(content) || oldContext,
  };
}

function uniqueSelfLearnings<T extends { insight: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.insight.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 6);
}

/** Carrega somente o contexto privado necessário para a mensagem atual. */
export async function buildPrismaPersonalContext(userId: string, settings: UserSettings, currentMessage: string, needs = determineContextNeeds(currentMessage)): Promise<PrismaPersonalContext> {
  const [learnedProfile, relevantMemories, emotionalState, dailySummaries, selfLearnings] = await Promise.all([
    settings.memoryEnabled && needs.userProfile ? getPrismaProfile(userId) : null,
    settings.memoryEnabled && needs.memories ? getRelevantPrismaMemories(userId, 5, currentMessage) : [],
    getEmotionalState(userId),
    settings.memoryEnabled && needs.dailySummaries ? recentDailySummaries(userId, 5) : [],
    listActiveSelfLearnings(8),
  ]);
  return { learnedProfile, relevantMemories, emotionalState, dailySummaries, selfLearnings: uniqueSelfLearnings(selfLearnings) };
}
