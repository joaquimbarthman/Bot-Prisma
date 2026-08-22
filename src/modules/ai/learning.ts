import { getPrismaProfile, upsertPrismaMemory, upsertPrismaProfile, updateEmotionalState, type PrismaMemory, type PrismaProfile } from "./store.js";
import type { PrismaEmotionalUpdate } from "./emotional-state.js";

type LearnInput = { userId: string; guildId: string; displayName: string; content: string; reply: string; messageId?: string };

function unique(values: string[]): string[] { return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, 12); }

export function emotionalUpdateFromMessage(content: string): PrismaEmotionalUpdate {
  const update: PrismaEmotionalUpdate = {};
  if (/\b(?:obrigad[oa]|amei|adorei|te adoro|você é incr[ií]vel|me ajudou|kkkk|kkk)\b/i.test(content)) Object.assign(update, { happiness: 58, affection: 42, confidence: 54 });
  if (/\b(?:olha isso|tenho uma ideia|bora jogar|finalmente)\b|!{2,}/i.test(content)) Object.assign(update, { curiosity: 60, excitement: 60, energy: 58 });
  if (/\b(?:aff|que saco|n[aã]o aguento|deu errado|t[oô] irritad[oa])\b/i.test(content)) Object.assign(update, { irritation: 35, energy: 42 });
  if (/\b(?:t[oô] trist[ea]|dia ruim|desanimad[oa]|n[aã]o tenho vontade)\b/i.test(content)) Object.assign(update, { sadness: 48, energy: 42, affection: 40 });
  if (/\b(?:tanto faz|sei l[aá]|chato)\b/i.test(content)) Object.assign(update, { boredom: 35, excitement: 22 });
  if (/\b(?:cala a boca|idiota|burr[ao]|lixo)\b/i.test(content)) Object.assign(update, { irritation: 50, anger: 35 });
  return update;
}

function normalizedSubject(value: string): string {
  return value.replace(/[.!?;]|\s+(?:mas|porém|só que)\s+.*/i, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function isExplicitPersonalPreference(clause: string, matchIndex: number): boolean {
  const prefix = clause.slice(0, matchIndex).replace(/^[\s:,-]+|[\s:,-]+$/g, "");
  // A forma verbal já é de primeira pessoa. Texto adicional antes dela pode
  // ser um relato ou uma citação e não deve ser atribuído ao autor.
  return /^(?:(?:eu|também|realmente|eu\s+também)\s*)?$/i.test(prefix);
}

function isUsefulPreferenceSubject(subject: string): boolean {
  if (subject.split(/\s+/).length > 8) return false;
  return !/^(?:isso|disso|n?isso|aquilo|daquilo|aqui|agora|hoje|ontem|amanhã|dormir(?: agora)?|comer(?: agora)?|tomar banho(?: agora)?|quando\b|se\b|que\b|você\b|voce\b|vc\b)|\b(?:minha|meu)\s+(?:mãe|mae|pai|irmã|irma|irmão|irmao|amig[oa]|namorad[oa])(?:\s|$)/i.test(subject);
}

function subjectKey(subject: string): string {
  return subject.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\b(?:o|a|os|as|de|do|da)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Extrai somente preferências explícitas, duráveis e não sensíveis. */
export function memoryCandidates(userId: string, content: string, sourceMessageId?: string): PrismaMemory[] {
  if (content.length > 500 || /[?"“”]|https?:\/\/|<@!?\d+>|\b(?:senha|token|cpf|telefone|e-?mail|endere[cç]o)\b/i.test(content)) return [];
  const clauses = content.split(/[,\n]|\s+e\s+(?=(?:eu\s+)?(?:gosto|amo|curto|prefiro|odeio|detesto|n[aã]o gosto)\b)/i).slice(0, 6);
  const candidates: PrismaMemory[] = [];
  for (const clause of clauses) {
    const match = clause.match(/\b(?:eu\s+)?(n[aã]o gosto|odeio|detesto|gosto|amo|curto|prefiro)\s+(?:muito\s+)?(?:de\s+|do\s+|da\s+)?(.{3,80})/i);
    if (!match) continue;
    if (!isExplicitPersonalPreference(clause, match.index ?? 0)) continue;
    const subject = normalizedSubject(match[2]);
    if (!subject || !isUsefulPreferenceSubject(subject)) continue;
    const key = subjectKey(subject);
    if (key.length < 3) continue;
    const negative = /^(?:n[aã]o gosto|odeio|detesto)$/i.test(match[1]);
    const interest = /(?:jogo|música|filme|série|anime|livro|valorant|fortnite|roblox|minecraft|overwatch)/i.test(subject);
    candidates.push({ userId, memoryType: interest ? "interest" : "preference", memoryKey: `preference:${key}`, content: `${negative ? "Não gosta" : "Gosta"} de ${subject}.`, importance: negative ? 60 : 55, confidence: 72, sourceMessageId });
  }
  return [...new Map(candidates.map((memory) => [memory.memoryKey, memory])).values()].slice(0, 4);
}

export async function learnFromInteraction(input: LearnInput): Promise<void> {
  try {
    const memories = memoryCandidates(input.userId, input.content, input.messageId);
    const interests = memories.filter((memory) => memory.memoryType === "interest" && memory.content.startsWith("Gosta de ")).map((memory) => memory.content.replace(/^Gosta de /, "").replace(/\.$/, ""));
    const previous = await getPrismaProfile(input.userId);
    const profile: PrismaProfile & { guildId: string } = {
      userId: input.userId, guildId: input.guildId, displayName: input.displayName,
      profileSummary: memories[0] ? `Já comentou que ${memories[0].content.charAt(0).toLocaleLowerCase("pt-BR") + memories[0].content.slice(1)}` : previous?.profileSummary ?? null,
      // Uma mensagem isolada não é evidência suficiente para definir o estilo da pessoa.
      communicationStyle: previous?.communicationStyle ?? null,
      interests: unique([...(previous?.interests ?? []), ...interests]),
      knownPreferences: unique(previous?.knownPreferences ?? []),
    };
    if (previous || memories.length) await upsertPrismaProfile(profile);
    for (const memory of memories) await upsertPrismaMemory(memory);
    await updateEmotionalState(input.userId, emotionalUpdateFromMessage(input.content));
  } catch (error) {
    console.error("[PRISMA-LEARNING] Falha não bloqueante ao aprender interação:", error);
  }
}
