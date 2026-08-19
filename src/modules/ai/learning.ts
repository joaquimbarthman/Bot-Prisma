import { getPrismaProfile, upsertPrismaMemory, upsertPrismaProfile, updateEmotionalState, type PrismaMemory, type PrismaProfile } from "./store.js";

type LearnInput = { userId: string; guildId: string; displayName: string; content: string; reply: string };

function unique(values: string[]): string[] { return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 12); }

function memoryCandidate(userId: string, content: string): PrismaMemory | null {
  const preference = content.match(/\b(?:eu )?(?:gosto|amo|curto|prefiro) (?:muito )?(?:de |do |da )?(.{3,80})/i);
  if (!preference) return null;
  const subject = preference[1].replace(/[.!?].*$/, "").trim();
  if (!subject || /\b(?:água|comer|dormir agora|banho)\b/i.test(subject)) return null;
  return { userId, memoryType: /(?:jogo|música|filme|série|programa|valorant|fortnite)/i.test(subject) ? "interest" : "preference", content: `Gosta de ${subject}.`, importance: 55, confidence: 70 };
}

export async function learnFromInteraction(input: LearnInput): Promise<void> {
  try {
    const memory = memoryCandidate(input.userId, input.content);
    const interests = memory?.memoryType === "interest" ? [memory.content.replace(/^Gosta de /, "").replace(/\.$/, "")] : [];
    const communicationStyle = /\b(?:vc|vdd|pq|tb|n|kkk|mds)\b/i.test(input.content) ? "Informal, usa abreviações e conversa de forma direta." : null;
    const previous = await getPrismaProfile(input.userId);
    const profile: PrismaProfile & { guildId: string } = {
      userId: input.userId, guildId: input.guildId, displayName: input.displayName,
      profileSummary: memory ? `Já comentou que ${memory.content.charAt(0).toLocaleLowerCase("pt-BR") + memory.content.slice(1)}` : previous?.profileSummary ?? null,
      communicationStyle: communicationStyle ?? previous?.communicationStyle ?? null,
      interests: unique([...(previous?.interests ?? []), ...interests]),
      knownPreferences: unique([...(previous?.knownPreferences ?? []), ...(communicationStyle ? ["Prefere conversa informal e direta."] : [])]),
    };
    await upsertPrismaProfile(profile);
    if (memory) await upsertPrismaMemory(memory);
    if (/\b(?:obrigad[oa]|amei|adorei|kkkk|kkk)\b/i.test(input.content)) await updateEmotionalState(input.userId, { happiness: 58, affection: 36 });
    else if (/\b(?:cala a boca|idiota|burra|lixo)\b/i.test(input.content)) await updateEmotionalState(input.userId, { irritation: 20, anger: 12 });
  } catch (error) {
    console.error("[PRISMA-LEARNING] Falha não bloqueante ao aprender interação:", error);
  }
}
