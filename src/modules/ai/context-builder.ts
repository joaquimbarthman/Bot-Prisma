import { getEmotionalState, getPrismaProfile, getRelevantPrismaMemories, listActiveSelfLearnings, recentDailySummaries, type UserSettings } from "./store.js";

export type PrismaPersonalContext = {
  learnedProfile: Awaited<ReturnType<typeof getPrismaProfile>>;
  relevantMemories: Awaited<ReturnType<typeof getRelevantPrismaMemories>>;
  emotionalState: Awaited<ReturnType<typeof getEmotionalState>> | undefined;
  dailySummaries: Awaited<ReturnType<typeof recentDailySummaries>>;
  selfLearnings: Awaited<ReturnType<typeof listActiveSelfLearnings>>;
};

/** Carrega somente o contexto privado necessário para a mensagem atual. */
export async function buildPrismaPersonalContext(userId: string, settings: UserSettings, currentMessage: string): Promise<PrismaPersonalContext> {
  if (!settings.memoryEnabled) return { learnedProfile: null, relevantMemories: [], emotionalState: undefined, dailySummaries: [], selfLearnings: await listActiveSelfLearnings(12) };
  const [learnedProfile, relevantMemories, emotionalState, dailySummaries, selfLearnings] = await Promise.all([
    getPrismaProfile(userId),
    getRelevantPrismaMemories(userId, 8, currentMessage),
    getEmotionalState(userId),
    recentDailySummaries(userId, 7),
    listActiveSelfLearnings(12),
  ]);
  return { learnedProfile, relevantMemories, emotionalState, dailySummaries, selfLearnings };
}
