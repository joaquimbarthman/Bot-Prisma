import { getPrismaProfile, upsertPrismaMemory, upsertPrismaProfile, updateEmotionalState, type PrismaMemory, type PrismaProfile } from "./store.js";
import type { PrismaEmotionalUpdate } from "./emotional-state.js";

type LearnInput = { userId: string; guildId: string; displayName: string; content: string; reply: string };

function unique(values: string[]): string[] { return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 12); }

/** Ajusta o tom da Prisma a partir do que a pessoa expressou, sem fazer diagnóstico. */
export function emotionalUpdateFromMessage(content: string): PrismaEmotionalUpdate {
  const update: PrismaEmotionalUpdate = {};
  if (/\b(?:obrigad[oa]|amei|adorei|te adoro|você é incr[ií]vel|me ajudou|kkkk|kkk)\b/i.test(content)) {
    Object.assign(update, { happiness: 58, affection: 42, confidence: 54 });
  }
  if (/\b(?:olha isso|tenho uma ideia|bora jogar|finalmente)\b|!{2,}/i.test(content)) {
    Object.assign(update, { curiosity: 60, excitement: 60, energy: 58 });
  }
  if (/\b(?:aff|que saco|n[aã]o aguento|deu errado|t[oô] irritad[oa])\b/i.test(content)) {
    Object.assign(update, { irritation: 35, energy: 42 });
  }
  if (/\b(?:t[oô] trist[ea]|dia ruim|desanimad[oa]|n[aã]o tenho vontade)\b/i.test(content)) {
    Object.assign(update, { sadness: 48, energy: 42, affection: 40 });
  }
  if (/\b(?:tanto faz|sei l[aá]|chato)\b/i.test(content)) {
    Object.assign(update, { boredom: 35, excitement: 22 });
  }
  if (/\b(?:cala a boca|idiota|burr[ao]|lixo)\b/i.test(content)) {
    Object.assign(update, { irritation: 50, anger: 35 });
  }
  return update;
}

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
    // Mesmo sem gatilhos, o update vazio cria o estado padrão na primeira conversa.
    await updateEmotionalState(input.userId, emotionalUpdateFromMessage(input.content));
  } catch (error) {
    console.error("[PRISMA-LEARNING] Falha não bloqueante ao aprender interação:", error);
  }
}
