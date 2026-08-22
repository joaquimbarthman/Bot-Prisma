import { getPrismaProfile, listPrismaMemories, upsertPrismaMemory, upsertPrismaProfile, updateEmotionalState, type PrismaMemory, type PrismaProfile } from "./store.js";
import type { PrismaEmotionalUpdate } from "./emotional-state.js";

type LearnInput = { userId: string; guildId: string; displayName: string; content: string; reply: string; messageId?: string };

const sensitiveOrUnsafe = /https?:\/\/|<@!?\d+>|\b(?:senha|token|cpf|telefone|e-?mail|endere[cç]o|password|api[ _-]?key)\b/i;
const transientSubject = /^(?:isso|disso|n?isso|aquilo|daquilo|aqui|agora|hoje|ontem|amanhã|dormir(?: agora)?|comer(?: agora)?|tomar banho(?: agora)?|quando\b|se\b|que\b|você\b|voce\b|vc\b)|\b(?:minha|meu)\s+(?:mãe|mae|pai|irmã|irma|irmão|irmao|amig[oa]|namorad[oa])(?:\s|$)/i;

function unique(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => {
    const key = value.toLocaleLowerCase("pt-BR");
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

export function emotionalUpdateFromMessage(content: string): PrismaEmotionalUpdate {
  const update: PrismaEmotionalUpdate = {};
  if (/\b(?:obrigad[oa]|amei|adorei|te adoro|você é incr[ií]vel|me ajudou|kkkk|kkk)\b/i.test(content)) Object.assign(update, { happiness: 58, affection: 42, confidence: 54 });
  if (/\b(?:olha isso|tenho uma ideia|bora jogar|finalmente)\b|!{2,}/i.test(content)) Object.assign(update, { curiosity: 60, excitement: 60, energy: 58 });
  if (/\b(?:aff|que saco|n[ãa]o aguento|deu errado|t[ôo] irritad[oa])\b/i.test(content)) Object.assign(update, { irritation: 35, energy: 42 });
  if (/\b(?:t[ôo] trist[ea]|dia ruim|desanimad[oa]|n[ãa]o tenho vontade)\b/i.test(content)) Object.assign(update, { sadness: 48, energy: 42, affection: 40 });
  if (/\b(?:tanto faz|sei l[áa]|chato)\b/i.test(content)) Object.assign(update, { boredom: 35, excitement: 22 });
  if (/\b(?:cala a boca|idiota|burr[ao]|lixo)\b/i.test(content)) Object.assign(update, { irritation: 50, anger: 35 });
  return update;
}

function cleanSubject(value: string, maximum = 80): string {
  return value.replace(/[.!?;]|\s+(?:mas|porém|só que)\s+.*/i, "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function subjectKey(subject: string): string {
  return subject.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\b(?:o|a|os|as|de|do|da|um|uma)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function usefulSubject(subject: string): boolean {
  return subject.length >= 3 && subject.split(/\s+/).length <= 10 && !transientSubject.test(subject) && !sensitiveOrUnsafe.test(subject);
}

function memory(userId: string, memoryType: string, key: string, content: string, importance: number, confidence: number, sourceMessageId?: string): PrismaMemory {
  return { userId, memoryType, memoryKey: key, content, importance, confidence, sourceMessageId };
}

function addSubjectMemory(result: PrismaMemory[], userId: string, type: string, keyPrefix: string, rawSubject: string, contentPrefix: string, importance: number, confidence: number, sourceMessageId?: string): void {
  const subject = cleanSubject(rawSubject);
  const key = subjectKey(subject);
  if (usefulSubject(subject) && key.length >= 3) result.push(memory(userId, type, `${keyPrefix}:${key}`, `${contentPrefix}${subject}.`, importance, confidence, sourceMessageId));
}

/** Extrai apenas informações pessoais explícitas, duráveis e não sensíveis. */
export function memoryCandidates(userId: string, content: string, sourceMessageId?: string): PrismaMemory[] {
  if (content.length > 700 || /[?"“”]|<@!?\d+>/.test(content) || sensitiveOrUnsafe.test(content)) return [];
  const clauses = content.split(/[,\n]|\s+e\s+(?=(?:eu\s+)?(?:gosto|amo|curto|prefiro|odeio|detesto|n[ãa]o gosto|meu|minha|estou|t[ôo]|quero|pode me chamar)\b)/i).slice(0, 8);
  const candidates: PrismaMemory[] = [];

  for (const clauseValue of clauses) {
    const clause = clauseValue.trim();
    if (/^(?:talvez|acho que|se|quando)\b/i.test(clause) || /\b(?:disse|falou|contou)\s+que\b/i.test(clause)) continue;

    const responseStyle = clause.match(/^(?:eu\s+)?prefiro\s+(?:que você\s+)?(?:responda|respostas?)\s+(.{3,70})$/i)
      ?? clause.match(/^(?:você\s+)?(?:pode|seja)\s+(?:responder\s+|ser\s+)?(mais\s+)?(diret[oa]|breve|detalhad[oa]|informal|formal|engraçad[oa])$/i);
    if (responseStyle) {
      const style = cleanSubject(responseStyle.slice(1).filter(Boolean).join(" "), 70);
      addSubjectMemory(candidates, userId, "communication", "communication-style", style, "Prefere respostas ", 72, 84, sourceMessageId);
      continue;
    }

    const preference = clause.match(/^(?:(?:eu|também|realmente|eu\s+também)\s+)?(n[ãa]o gosto|odeio|detesto|gosto|amo|curto|prefiro)\s+(?:muito\s+)?(?:de\s+|do\s+|da\s+)?(.{3,100})$/i);
    if (preference) {
      const negative = /^(?:n[ãa]o gosto|odeio|detesto)$/i.test(preference[1]);
      const subject = cleanSubject(preference[2]);
      const interest = /(?:jogo|música|filme|série|anime|livro|valorant|fortnite|roblox|minecraft|overwatch)/i.test(subject);
      addSubjectMemory(candidates, userId, interest ? "interest" : "preference", "preference", subject, negative ? "Não gosta de " : "Gosta de ", negative ? 60 : 55, 72, sourceMessageId);
      continue;
    }

    const favorite = clause.match(/^(?:meu|minha)\s+(.{3,35}?)\s+favorit[oa]\s+(?:é|e)\s+(.{3,80})$/i);
    if (favorite) {
      const category = cleanSubject(favorite[1], 35);
      const subject = cleanSubject(favorite[2]);
      if (usefulSubject(subject) && subjectKey(category).length >= 3) candidates.push(memory(userId, "interest", `favorite:${subjectKey(category)}`, `${category.replace(/^./, char => char.toLocaleUpperCase("pt-BR"))} favorito(a): ${subject}.`, 68, 82, sourceMessageId));
      continue;
    }

    const stopped = clause.match(/^(?:eu\s+)?(?:parei de|n[ãa]o jogo mais|n[ãa]o acompanho mais)\s+(.{3,80})$/i);
    if (stopped) { addSubjectMemory(candidates, userId, "interest", "preference", stopped[1], "Não gosta mais de ", 58, 78, sourceMessageId); continue; }

    const currentInterest = clause.match(/^(?:agora\s+)?(?:eu\s+)?(?:jogo|estou jogando|t[ôo] jogando|estou assistindo|t[ôo] assistindo|estou lendo|t[ôo] lendo)\s+(.{3,80})$/i);
    if (currentInterest) { addSubjectMemory(candidates, userId, "interest", "preference", currentInterest[1], "Acompanha ou joga ", 52, 68, sourceMessageId); continue; }

    const project = clause.match(/^(?:eu\s+)?(?:estou|t[ôo])\s+(?:trabalhando|fazendo|desenvolvendo|criando)\s+(?:em\s+|no\s+|na\s+)?(.{3,100})$/i);
    if (project) { addSubjectMemory(candidates, userId, "project", "project", project[1], "Está trabalhando em ", 68, 76, sourceMessageId); continue; }

    const completedProject = clause.match(/^(?:eu\s+)?(?:já\s+)?(?:terminei|concluí|finalizei)\s+(?:o\s+|a\s+|meu\s+|minha\s+)?(.{3,100})$/i);
    if (completedProject) { addSubjectMemory(candidates, userId, "project", "project", completedProject[1], "Concluiu ", 72, 82, sourceMessageId); continue; }

    const goal = clause.match(/^(?:eu\s+)?(?:quero|pretendo|estou tentando|t[ôo] tentando)\s+(?:aprender\s+|estudar\s+|concluir\s+|terminar\s+|fazer\s+)?(.{3,100})$/i);
    if (goal) { addSubjectMemory(candidates, userId, "project", "goal", goal[1], "Tem como objetivo ", 62, 70, sourceMessageId); continue; }

    const nickname = clause.match(/^(?:você\s+)?pode me chamar de\s+([\p{L}\p{N}_ -]{2,32})$/iu);
    if (nickname) { addSubjectMemory(candidates, userId, "communication", "nickname", nickname[1], "Prefere ser chamado(a) de ", 80, 90, sourceMessageId); continue; }

  }

  return [...new Map(candidates.map(item => [item.memoryKey ?? item.content, item])).values()].slice(0, 6);
}

function withoutPrefix(content: string): string {
  return content.replace(/^(?:Gosta de|Não gosta (?:mais )?de|Acompanha ou joga|Prefere respostas|Prefere ser chamado\(a\) de|Está trabalhando em|Tem como objetivo)\s+/i, "").replace(/\.$/, "");
}

export function consolidatePrismaProfile(previous: PrismaProfile | null, memories: PrismaMemory[], userId: string, displayName: string): PrismaProfile {
  const ranked = [...memories].sort((a, b) => (b.importance + b.confidence + Math.min(15, (b.occurrenceCount ?? 1) * 3)) - (a.importance + a.confidence + Math.min(15, (a.occurrenceCount ?? 1) * 3)));
  const positiveInterests = ranked.filter(item => item.memoryType === "interest" && !/^Não gosta/i.test(item.content)).map(item => withoutPrefix(item.content));
  const preferences = ranked.filter(item => item.memoryType === "preference" || item.memoryType === "communication").map(item => item.content.replace(/\.$/, ""));
  const communication = ranked.find(item => item.memoryKey?.startsWith("communication-style:"))?.content.replace(/^Prefere respostas\s+/i, "").replace(/\.$/, "") ?? previous?.communicationStyle ?? null;
  const summaryItems = ranked.filter(item => ["interest", "preference", "project", "communication"].includes(item.memoryType)).slice(0, 4).map(item => item.content.replace(/\.$/, ""));
  const summaryParts = unique(summaryItems, 4);
  const profileSummary = summaryParts.length ? `${summaryParts.join("; ").slice(0, 299)}.` : previous?.profileSummary ?? null;
  return {
    userId,
    displayName: displayName || previous?.displayName || null,
    profileSummary,
    communicationStyle: communication,
    interests: positiveInterests.length ? unique(positiveInterests) : previous?.interests ?? [],
    knownPreferences: preferences.length ? unique(preferences) : previous?.knownPreferences ?? [],
  };
}

export async function learnFromInteraction(input: LearnInput): Promise<void> {
  try {
    const memories = memoryCandidates(input.userId, input.content, input.messageId);
    for (const candidate of memories) await upsertPrismaMemory(candidate);
    const previous = await getPrismaProfile(input.userId);
    if (previous || memories.length) {
      const allMemories = await listPrismaMemories(input.userId);
      await upsertPrismaProfile({ ...consolidatePrismaProfile(previous, allMemories, input.userId, input.displayName), guildId: input.guildId });
    }
    await updateEmotionalState(input.userId, emotionalUpdateFromMessage(input.content));
  } catch (error) {
    console.error("[PRISMA-LEARNING] Falha não bloqueante ao aprender interação:", error);
  }
}
