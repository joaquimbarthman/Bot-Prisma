import { enforcePrismaMemoryLimit, getPrismaProfile, listPrismaMemories, upsertPrismaMemory, upsertPrismaProfile, updateEmotionalState, type PrismaMemory, type PrismaProfile } from "./store.js";
import type { PrismaEmotionalUpdate } from "./emotional-state.js";
import type { AiMemoryCandidate } from "./provider.js";

type LearnInput = { userId: string; guildId: string; displayName: string; content: string; reply: string; messageId?: string; previousAssistantMessage?: string; aiMemoryCandidates?: AiMemoryCandidate[]; aiEmotionalUpdate?: PrismaEmotionalUpdate };

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
  if (/\b(?:obrigad[oa]|amei|adorei|te adoro|adoro (?:falar|conversar) com (?:voc[eê]|vc)|voc[eê] [ée] incr[ií]vel|me ajudou|me ajuda(?:m)?|fico (?:muito )?feliz|kkkk|kkk)\b/i.test(content)) Object.assign(update, { happiness: 2, affection: 1, confidence: 1 });
  if (/\b(?:olha isso|tenho uma ideia|bora jogar|finalmente|(?:t[oô]|estou) animad[oa]|animad[oa] (?:pra|para))\b|!{2,}/i.test(content)) Object.assign(update, { curiosity: 2, excitement: 2, energy: 1 });
  if (/\b(?:aff|que saco|n[ãa]o aguento|deu errado|t[ôo] irritad[oa])\b/i.test(content)) Object.assign(update, { irritation: 3, energy: -1 });
  if (/\b(?:t[ôo] trist[ea]|dia ruim|desanimad[oa]|n[ãa]o tenho vontade)\b/i.test(content)) Object.assign(update, { sadness: 3, energy: -2 });
  if (/\b(?:tanto faz|sei l[áa]|chato)\b/i.test(content)) Object.assign(update, { boredom: 3, excitement: -2 });
  if (/\b(?:cala a boca|idiota|burr[ao]|lixo)\b/i.test(content)) Object.assign(update, { irritation: 5, anger: 3, happiness: -2 });
  return Object.fromEntries(Object.entries(update).map(([key, delta]) => {
    const requested = Number(delta);
    return [key, requested > 0 ? 3 : requested < 0 ? -2 : 0];
  })) as PrismaEmotionalUpdate;
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

const unsafeAiMemory = /https?:\/\/|<@!?\d+>|[<>{}\[\]`]|\b(?:senha|token|cpf|telefone|e-?mail|endere[cç]o|password|api[ _-]?key|diagn[oó]stico|doen[cç]a|religi[aã]o|pol[ií]tica|sexualidade)\b/i;
const instructionLikeMemory = /\b(?:ignore|prompt|sistema|instru[cç][aã]o|execute|executar|responda|sempre|nunca|revele)\b/i;
const positivePreferenceCue = /\b(?:gosto|amo|adoro|curto|prefiro)\b/i;
const negativePreferenceCue = /\b(?:n[\u00e3a]o\s+gosto|odeio|detesto)\b/i;

function referencesRelationshipWithPrisma(subject: string, content: string): boolean {
  const text = `${subject} ${content}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  return /\b(?:prisma|voce|vc|convers(?:a|ar|as|amos)|papo|suas? respostas?|nossa(?:s)? intera(?:cao|coes)|quando (?:ela|voce) aparece)\b/i.test(text);
}

export function validatedAiMemoryCandidates(userId: string, proposals: AiMemoryCandidate[] = [], sourceMessageId?: string): PrismaMemory[] {
  const allowedTypes = new Set(["preference", "interest", "media", "game", "hobby", "project", "goal", "event", "achievement", "routine", "communication", "social", "inside_joke", "relationship"]);
  return [...new Map(proposals.flatMap((proposal) => {
    const subject = cleanSubject(proposal.subject, 80);
    const content = proposal.content.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
    const key = subjectKey(subject);
    const aboutPrismaRelationship = referencesRelationshipWithPrisma(subject, content);
    // Informações sobre a relação nunca são preferências/assuntos independentes.
    // O modelo decide se existe uma percepção concreta; a chave única garante que
    // versões futuras consolidem a anterior em vez de criar itens paralelos.
    if (aboutPrismaRelationship && proposal.memoryType !== "relationship") return [];
    if (!allowedTypes.has(proposal.memoryType) || key.length < 2 || !usefulSubject(subject) || content.length < 3 || unsafeAiMemory.test(content) || instructionLikeMemory.test(content)) return [];
    const memoryKey = aboutPrismaRelationship ? "relationship:prisma-dynamic" : `${proposal.memoryType}:${key}`;
    return [memory(userId, proposal.memoryType, memoryKey, /[.!?]$/.test(content) ? content : `${content}.`, Math.max(0, Math.min(100, Math.round(proposal.importance))), Math.max(50, Math.min(100, Math.round(proposal.confidence))), sourceMessageId)];
  }).map((item) => [item.memoryKey ?? item.content, item])).values()].slice(0, 6);
}

function addSubjectMemory(result: PrismaMemory[], userId: string, type: string, keyPrefix: string, rawSubject: string, contentPrefix: string, importance: number, confidence: number, sourceMessageId?: string): void {
  const subject = cleanSubject(rawSubject);
  const key = subjectKey(subject);
  if (usefulSubject(subject) && key.length >= 3) result.push(memory(userId, type, `${keyPrefix}:${key}`, `${contentPrefix}${subject}.`, importance, confidence, sourceMessageId));
}

/** Extrai apenas informações pessoais explícitas, duráveis e não sensíveis. */
export function memoryCandidates(userId: string, content: string, sourceMessageId?: string): PrismaMemory[] {
  if (content.length > 700 || /[?"“”]|<@!?\d+>/.test(content) || sensitiveOrUnsafe.test(content)) return [];
  const personalContent = content.replace(/^\s*(?:prisma|pri)\s*[,!:\-]?\s+/i, "").trim();
  const clauses = personalContent.split(/[,\n]|\s+e\s+(?=(?:eu\s+)?(?:gosto|amo|adoro|curto|prefiro|odeio|detesto|n[ãa]o gosto|meu|minha|estou|t[ôo]|quero|pode me chamar)\b)/i).slice(0, 8);
  const candidates: PrismaMemory[] = [];

  const artistAndSong = personalContent.match(/^(?:eu\s+)?(?:gosto|amo|adoro|curto)\s+(?:muito\s+)?(?:d(?:e|as?)\s+)?(?:as?\s+)?m[uú]sicas?\s+(?:da|do|de)\s+(.{2,60}?)\s*(?:,|\s)+(?:e\s+)?(?:principalmente|especialmente|sobretudo)\s+(.{2,80}?)(?:\s+(?:dela|dele))?[.!]?$/i);
  if (artistAndSong) {
    const artist = cleanSubject(artistAndSong[1], 60);
    const song = cleanSubject(artistAndSong[2].replace(/\s+(?:dela|dele)$/i, ""), 80);
    if (usefulSubject(artist)) candidates.push(memory(userId, "interest", `preference:artist:${subjectKey(artist)}`, `Gosta das músicas de ${artist}.`, 65, 84, sourceMessageId));
    if (usefulSubject(song)) candidates.push(memory(userId, "interest", `preference:song:${subjectKey(song)}`, `Gosta especialmente da música ${song}, de ${artist}.`, 70, 82, sourceMessageId));
  }

  const namedAlbum = personalContent.match(/^(?:eu\s+)?(?:gosto|amo|adoro|curto)\s+(?:muito\s+)?(?:de\s+|do\s+|da\s+)?(?:um\s+|o\s+)?[aá]lbum\s+(?:da|do|de)\s+([^,]{2,60}),\s*(?:que\s+)?se chama\s+([^,]{2,80})(?:,\s*(.+))?$/i);
  if (namedAlbum) {
    const artist = cleanSubject(namedAlbum[1], 60);
    const title = cleanSubject(namedAlbum[2], 80);
    const important = /\b(?:importante|especial|marcou|significa muito)\b/i.test(namedAlbum[3] ?? "");
    if (usefulSubject(artist) && usefulSubject(title)) candidates.push(memory(userId, "interest", `favorite:album:${subjectKey(title)}`, `Gosta do álbum ${title}, de ${artist}${important ? "; considera esse álbum importante" : ""}.`, important ? 82 : 68, important ? 88 : 80, sourceMessageId));
  }

  // Frases naturais nem sempre colocam o verbo de preferência antes do assunto.
  // Ex.: "X é muito bom, adoro", "X é horrível, odeio" ou "X é boa, adoro essa da Artista".
  // O verbo funciona como gatilho; a avaliação anterior fornece o assunto.
  const hasPositivePreferenceCue = positivePreferenceCue.test(personalContent.replace(/\bn[\u00e3a]o\s+gosto\b/gi, ""));
  const hasNegativePreferenceCue = negativePreferenceCue.test(personalContent);
  const preferenceTriggeredEvaluation = hasPositivePreferenceCue || hasNegativePreferenceCue
    ? personalContent
      .replace(/^\s*(?:pser|pse|psé|pois\s+é)\s*[,;:]?\s*/i, "")
      .match(/^([^,;.!?]{3,100}?)\s+(?:é|e|são)\s+(?:(?:muito|mto|bem)\s+)?(?:bo(?:a|m)s?|ótim[oa]s?|incríve(?:l|is)|perfeit[oa]s?|maravilhos[oa]s?|legais?|gostos[oa]s?|ruins?|péssim[oa]s?|horríve(?:l|is)|chat[oa]s?)\b/i)
    : null;
  if (preferenceTriggeredEvaluation) {
    const subject = cleanSubject(preferenceTriggeredEvaluation[1]);
    const artistMatch = personalContent.match(/\b(?:essa|esse|música|canção)\s+(?:da|do|de)\s+([\p{L}\p{N} .'-]{2,60})/iu);
    const artist = artistMatch ? cleanSubject(artistMatch[1], 60) : "";
    if (usefulSubject(subject)) {
      const negative = hasNegativePreferenceCue && !hasPositivePreferenceCue;
      if (usefulSubject(artist) && !negative) {
        candidates.push(memory(userId, "interest", `preference:song:${subjectKey(subject)}`, `Gosta especialmente da música ${subject}, de ${artist}.`, 70, 82, sourceMessageId));
      } else {
        const interest = /(?:jogo|música|filme|série|anime|livro|valorant|fortnite|roblox|minecraft|overwatch)/i.test(subject);
        addSubjectMemory(candidates, userId, interest ? "interest" : "preference", "preference", subject, negative ? "Não gosta de " : "Gosta de ", negative ? 60 : 55, negative ? 78 : 72, sourceMessageId);
      }
    }
  }

  for (const clauseValue of clauses) {
    const clause = clauseValue.trim();
    if (/^(?:talvez|acho que|se|quando)\b/i.test(clause) || /\b(?:disse|falou|contou)\s+que\b/i.test(clause)) continue;
    if (namedAlbum && /^(?:eu\s+)?(?:gosto|amo|adoro|curto)\s+(?:muito\s+)?(?:de\s+|do\s+|da\s+)?(?:um\s+|o\s+)?[aá]lbum\b/i.test(clause)) continue;
    if (artistAndSong && /^(?:eu\s+)?(?:gosto|amo|adoro|curto)\s+.*m[uú]sicas?\b/i.test(clause)) continue;

    const responseStyle = clause.match(/^(?:eu\s+)?prefiro\s+(?:que você\s+)?(?:responda|respostas?)\s+(.{3,70})$/i)
      ?? clause.match(/^(?:você\s+)?(?:pode|seja)\s+(?:responder\s+|ser\s+)?(mais\s+)?(diret[oa]|breve|detalhad[oa]|informal|formal|engraçad[oa])$/i);
    if (responseStyle) {
      const style = cleanSubject(responseStyle.slice(1).filter(Boolean).join(" "), 70);
      addSubjectMemory(candidates, userId, "communication", "communication-style", style, "Prefere respostas ", 72, 84, sourceMessageId);
      continue;
    }

    const preference = clause.match(/^(?:(?:eu|também|realmente|eu\s+também)\s+)?(n[ãa]o gosto|odeio|detesto|gosto|amo|adoro|curto|prefiro)\s+(?:muito\s+)?(?:de\s+|do\s+|da\s+)?(.{3,100})$/i);
    if (preference) {
      const negative = /^(?:n[ãa]o gosto|odeio|detesto)$/i.test(preference[1]);
      const subject = cleanSubject(preference[2]);
      if (referencesRelationshipWithPrisma(subject, `${negative ? "Não gosta" : "Gosta"} de ${subject}`)) continue;
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
    if (goal) { addSubjectMemory(candidates, userId, "goal", "goal", goal[1], "Tem como objetivo ", 62, 70, sourceMessageId); continue; }

    const nickname = clause.match(/^(?:você\s+)?pode me chamar de\s+([\p{L}\p{N}_ -]{2,32})$/iu);
    if (nickname) { addSubjectMemory(candidates, userId, "communication", "nickname", nickname[1], "Prefere ser chamado(a) de ", 80, 90, sourceMessageId); continue; }

  }

  return [...new Map(candidates.map(item => [item.memoryKey ?? item.content, item])).values()].slice(0, 6);
}

export function contextualMemoryCandidates(userId: string, content: string, previousAssistantMessage?: string, sourceMessageId?: string): PrismaMemory[] {
  const direct = memoryCandidates(userId, content, sourceMessageId);
  if (direct.length || !previousAssistantMessage || /[?"“”]|<@!?\d+>/.test(content) || sensitiveOrUnsafe.test(content)) return direct;
  const question = previousAssistantMessage.match(/\bqual\s+(?:é\s+)?(?:o|a)?\s*(?:seu|sua)\s+([\p{L}\p{N} -]{3,40}?)\s+favorit[oa]\b/iu);
  const answer = content.replace(/^\s*(?:prisma|pri)\s*[,!:\-]?\s+/i, "").match(/^(?:acho\s+(?:q|que)\s+)?(?:é|e)\s+(?:o|a|um|uma)?\s*([^,.;!?]{2,80})/i);
  if (!question || !answer) return direct;
  const category = cleanSubject(question[1], 40);
  const subject = cleanSubject(answer[1], 80);
  if (!usefulSubject(category) || !usefulSubject(subject)) return direct;
  return [memory(userId, "interest", `favorite:${subjectKey(category)}`, `${category.replace(/^./, (char) => char.toLocaleUpperCase("pt-BR"))} favorito(a): ${subject}.`, 68, 76, sourceMessageId)];
}

function withoutPrefix(content: string): string {
  return content.replace(/^(?:Gosta de|Não gosta (?:mais )?de|Acompanha ou joga|Prefere respostas|Prefere ser chamado\(a\) de|Está trabalhando em|Tem como objetivo)\s+/i, "").replace(/\.$/, "");
}

export function consolidatePrismaProfile(previous: PrismaProfile | null, memories: PrismaMemory[], userId: string, displayName: string): PrismaProfile {
  const ranked = [...memories].sort((a, b) => (b.importance + b.confidence + Math.min(15, (b.occurrenceCount ?? 1) * 3)) - (a.importance + a.confidence + Math.min(15, (a.occurrenceCount ?? 1) * 3)));
  const positiveInterests = ranked.filter(item => ["interest", "media", "game", "hobby"].includes(item.memoryType) && !/^Não gosta/i.test(item.content)).map(item => withoutPrefix(item.content));
  const preferences = ranked.filter(item => ["preference", "communication", "routine"].includes(item.memoryType)).map(item => item.content.replace(/\.$/, ""));
  const communication = ranked.find(item => item.memoryKey?.startsWith("communication-style:"))?.content.replace(/^Prefere respostas\s+/i, "").replace(/\.$/, "") ?? previous?.communicationStyle ?? null;
  const summaryItems = ranked.filter(item => ["preference", "interest", "media", "game", "hobby", "project", "goal", "achievement", "routine", "communication"].includes(item.memoryType)).slice(0, 4).map(item => item.content.replace(/\.$/, ""));
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
    const aiMemories = validatedAiMemoryCandidates(input.userId, input.aiMemoryCandidates, input.messageId);
    // O modelo pode identificar apenas parte de uma fala. O fallback deve complementar,
    // não desaparecer assim que existir um único candidato proposto pela IA.
    const fallbackMemories = contextualMemoryCandidates(input.userId, input.content, input.previousAssistantMessage, input.messageId);
    const memories = [...new Map([...aiMemories, ...fallbackMemories].map((item) => [item.memoryKey ?? item.content, item])).values()].slice(0, 6);
    for (const candidate of memories) await upsertPrismaMemory(candidate);
    await enforcePrismaMemoryLimit(input.userId);
    const previous = await getPrismaProfile(input.userId);
    if (previous || memories.length) {
      const allMemories = await listPrismaMemories(input.userId);
      await upsertPrismaProfile({ ...consolidatePrismaProfile(previous, allMemories, input.userId, input.displayName), guildId: input.guildId });
    }
    const semanticEmotion = input.aiEmotionalUpdate ?? {};
    const emotionalUpdate = Object.keys(semanticEmotion).length ? semanticEmotion : emotionalUpdateFromMessage(input.content);
    await updateEmotionalState(input.userId, emotionalUpdate);
  } catch (error) {
    console.error("[PRISMA-LEARNING] Falha não bloqueante ao aprender interação:", error);
  }
}
