import type { PrismaMemory } from "./store.js";

export type MemoryPersistenceAction = "SAVE" | "UPDATE" | "MERGE" | "DISCARD";
export type MemoryCleanupAction = "KEEP" | "MERGE" | "UPDATE" | "DELETE";
export type MemoryDecision = { action: MemoryPersistenceAction; candidate?: PrismaMemory; targetIds: number[]; reason: string };
export type MemoryCleanupDecision = { action: MemoryCleanupAction; memoryIds: number[]; replacement?: PrismaMemory; reason: string };

const vagueReference = /\b(?:ela|ele|isso|aquilo|esse|essa|aquele|aquela|l[aá]|dele|dela|nisso|disso)\b/iu;
const temporaryState = /\b(?:agora|hoje|ontem|amanh[aã]|neste momento|no momento|est[aá] (?:ouvindo|jogando|assistindo|lendo|com sono|irritad[oa]|trist[ea])|t[oô] (?:ouvindo|jogando|assistindo|lendo|com sono|irritad[oa]|trist[ea])|estava (?:ouvindo|jogando|assistindo|lendo))\b/iu;
const durableCue = /\b(?:gosta|ama|adora|curte|prefere|favorit[oa]|odeia|detesta|n[aã]o gosta|com frequ[eê]ncia|frequentemente|sempre|direto|costuma|tem como objetivo|est[aá] trabalhando|concluiu|prefere ser chamad[oa])\b/iu;
const incompletePreference = /^(?:[\p{L}\p{N}_ -]+\s+)?(?:gosta|ama|adora|curte|prefere|odeia|detesta|n[aã]o gosta)(?:\s+muito)?(?:\s+de)?\s*(?:\.|$)/iu;
const usefulForm = /\b(?:gosta|ama|adora|curte|prefere|favorit[oa]|odeia|detesta|n[aã]o gosta|escuta|joga|costuma|frequentemente|tem como objetivo|est[aá] trabalhando|concluiu|prefere respostas|prefere ser chamad[oa]|considera|confia|sente-se)\b/iu;
const stopWords = new Set("a o as os de da do das dos e em no na nos nas um uma para por com que se ser estar muito mais menos especialmente pessoa usuario usuário gosta gostar ama adora curte prefere nao não".split(/\s+/));

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalized(value).split(/\s+/).filter((token) => token.length > 1 && !stopWords.has(token)));
}

function similarity(left: string, right: string): number {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.min(a.size, b.size);
}

function describesSameFact(left: string, right: string): boolean {
  const a = tokens(left); const b = tokens(right);
  const sizeRatio = Math.min(a.size, b.size) / Math.max(a.size, b.size);
  const oneIsSpecificSong = /\bm[uú]sica\b/iu.test(left) !== /\bm[uú]sica\b/iu.test(right);
  return !oneIsSpecificSong && sizeRatio >= 0.6 && similarity(left, right) >= 0.72;
}

function polarity(content: string): "positive" | "negative" | "neutral" {
  if (/\b(?:n[aã]o gosta|odeia|detesta|n[aã]o acompanha|parou|n[aã]o joga mais)\b/iu.test(content)) return "negative";
  if (/\b(?:gosta|ama|adora|curte|prefere|favorit[oa])\b/iu.test(content)) return "positive";
  return "neutral";
}

function hasUnresolvedReference(content: string): boolean {
  if (!vagueReference.test(content)) return false;
  // Uma entidade nomeada na mesma frase resolve casos como "Prisma ... quando ela aparece".
  const beforeReference = content.split(vagueReference)[0] ?? "";
  return !/\b[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}\p{N}'-]{2,}\b/u.test(beforeReference.replace(/^\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+\s+/, ""));
}

export function validateMemoryCandidate(candidate: PrismaMemory): { valid: boolean; reason: string } {
  const content = candidate.content.trim();
  if (content.length < 8) return { valid: false, reason: "memória curta ou incompleta" };
  if (incompletePreference.test(content)) return { valid: false, reason: "preferência sem objeto" };
  if (hasUnresolvedReference(content)) return { valid: false, reason: "referência vaga não resolvida" };
  if (temporaryState.test(content) && !durableCue.test(content)) return { valid: false, reason: "estado temporário sem evidência recorrente" };
  if (["event", "routine", "interest", "media", "game", "hobby", "preference"].includes(candidate.memoryType) && !usefulForm.test(content)) return { valid: false, reason: "fato sem utilidade futura ou evidência durável" };
  if (candidate.confidence < 65) return { valid: false, reason: "evidência insuficiente" };
  return { valid: true, reason: "memória clara, autossuficiente e útil" };
}

function richer(left: PrismaMemory, right: PrismaMemory): PrismaMemory {
  const preferred = left.content.length >= right.content.length ? left : right;
  return { ...preferred, importance: Math.max(left.importance, right.importance), confidence: Math.max(left.confidence, right.confidence), occurrenceCount: Math.max(left.occurrenceCount ?? 1, right.occurrenceCount ?? 1) };
}

export function decideMemoryPersistence(candidate: PrismaMemory, existing: PrismaMemory[]): MemoryDecision {
  const validation = validateMemoryCandidate(candidate);
  if (!validation.valid) return { action: "DISCARD", targetIds: [], reason: validation.reason };
  const active = existing.filter((item) => (item.status ?? "active") === "active");
  const exactKey = candidate.memoryKey ? active.find((item) => item.memoryKey === candidate.memoryKey) : undefined;
  if (exactKey) {
    const action = polarity(exactKey.content) !== polarity(candidate.content) || normalized(exactKey.content) !== normalized(candidate.content) ? "UPDATE" : "MERGE";
    return { action, candidate: { ...candidate, importance: Math.max(candidate.importance, exactKey.importance), confidence: Math.max(candidate.confidence, exactKey.confidence), memoryKey: exactKey.memoryKey }, targetIds: exactKey.id ? [exactKey.id] : [], reason: action === "UPDATE" ? "nova evidência substitui a memória da mesma entidade" : "evidência equivalente reforça a memória existente" };
  }
  const semantic = active.filter((item) => item.memoryType === candidate.memoryType && describesSameFact(item.content, candidate.content));
  if (semantic.length) {
    const target = semantic.sort((a, b) => similarity(b.content, candidate.content) - similarity(a.content, candidate.content))[0];
    return { action: "MERGE", candidate: { ...candidate, importance: Math.max(candidate.importance, target.importance), confidence: Math.max(candidate.confidence, target.confidence), memoryKey: target.memoryKey ?? candidate.memoryKey }, targetIds: semantic.flatMap((item) => item.id ? [item.id] : []), reason: "memória semanticamente redundante" };
  }
  return { action: "SAVE", candidate, targetIds: [], reason: validation.reason };
}

export function planMemoryCleanup(memories: PrismaMemory[]): MemoryCleanupDecision[] {
  const decisions: MemoryCleanupDecision[] = [];
  const handled = new Set<number>();
  for (const memory of memories) {
    if (!memory.id || handled.has(memory.id)) continue;
    const validation = validateMemoryCandidate(memory);
    if (!validation.valid) { handled.add(memory.id); decisions.push({ action: "DELETE", memoryIds: [memory.id], reason: validation.reason }); continue; }
    const related = memories.filter((other) => other.id && other.id !== memory.id && !handled.has(other.id) && other.memoryType === memory.memoryType && ((memory.memoryKey && other.memoryKey === memory.memoryKey) || describesSameFact(memory.content, other.content)));
    if (!related.length) { handled.add(memory.id); decisions.push({ action: "KEEP", memoryIds: [memory.id], reason: "memória útil e sem redundância" }); continue; }
    const group = [memory, ...related]; group.forEach((item) => item.id && handled.add(item.id));
    const newest = [...group].sort((a, b) => Date.parse(b.lastConfirmedAt ?? b.lastSeenAt ?? "") - Date.parse(a.lastConfirmedAt ?? a.lastSeenAt ?? ""))[0];
    const replacement = group.reduce(richer, newest);
    decisions.push({ action: polarity(memory.content) !== polarity(newest.content) ? "UPDATE" : "MERGE", memoryIds: group.flatMap((item) => item.id ? [item.id] : []), replacement: { ...replacement, content: newest.content, memoryKey: newest.memoryKey ?? memory.memoryKey }, reason: "memórias redundantes ou contraditórias consolidadas pela evidência mais recente" });
  }
  return decisions;
}
