import { getEmotionalState, getPrismaProfile, getRelevantPrismaMemories, type UserSettings } from "./store.js";

export type PrismaPersonalContext = {
  learnedProfile: Awaited<ReturnType<typeof getPrismaProfile>>;
  relevantMemories: Awaited<ReturnType<typeof getRelevantPrismaMemories>>;
  emotionalState: Awaited<ReturnType<typeof getEmotionalState>> | undefined;
};

/** Carrega somente o contexto privado necessário para a mensagem atual. */
export async function buildPrismaPersonalContext(userId: string, settings: UserSettings, currentMessage: string): Promise<PrismaPersonalContext> {
  if (!settings.memoryEnabled) return { learnedProfile: null, relevantMemories: [], emotionalState: undefined };
  const [learnedProfile, relevantMemories, emotionalState] = await Promise.all([
    getPrismaProfile(userId),
    getRelevantPrismaMemories(userId, 8, currentMessage),
    getEmotionalState(userId),
  ]);
  return { learnedProfile, relevantMemories, emotionalState };
}
