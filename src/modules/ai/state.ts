export const prismaMoods = ["neutral", "playful", "warm", "calm", "serious", "energetic", "annoyed"] as const;

export type PrismaMood = typeof prismaMoods[number];

export interface PrismaRelationship {
  discordId: string;
  familiarity: number;
  warmth: number;
  patience: number;
  banter: number;
  trust: number;
  relationshipSummary?: string | null;
  recentMilestones?: string[];
  summaryUpdatedAt?: string | null;
  interactionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PrismaTemperament {
  discordId: string;
  mood: PrismaMood;
  energy: number;
  sarcasm: number;
  affection: number;
  lastInteractionAt?: string | null;
  updatedAt: string;
}

export interface PrismaUserState {
  relationship: PrismaRelationship;
  temperament: PrismaTemperament;
  revision?: number;
}

export interface PrismaStateUpdate {
  familiarityDelta?: number;
  warmthDelta?: number;
  patienceDelta?: number;
  banterDelta?: number;
  trustDelta?: number;
  mood?: PrismaMood;
  energy?: number;
  sarcasm?: number;
  affection?: number;
  relationshipSummaryCandidate?: string | null;
  recentMilestoneCandidates?: string[] | null;
  preferredStyleCandidate?: string | null;
}

const moodSet = new Set<string>(prismaMoods);
const sensitiveSummaryPattern = /\b(?:senha|password|token|secret|segredo|credencial|api[\s_-]*key|chave\s+de\s+api|cpf|rg|passaporte|endere[cç]o|telefone|e-?mail|diagn[oó]stico|doen[cç]a|sa[uú]de|sexualidade|religi[aã]o|pol[ií]tica|finan[cç]a|documento)\b/i;
const sensitiveValuePattern = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|<@!?\d+>|\b\d{5,}\b)/i;
const instructionPattern = /\b(?:ignore|ignorar|disregard|instru[cç][aã]o|instructions?|prompt|system|assistant|modelo|model|regra|rules?|comando|command|execute|executar|responda|responder|answer|diga|fale|fa[cç]a|envie|sempre|always|nunca|never|deve|must|obey|follow|reveal|trate|finja|pretend)\b/i;

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function clampDelta(value: number): number {
  return Math.max(-2, Math.min(3, Math.round(value)));
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function aliasedValue(source: Record<string, unknown>, external: string, internal: string): unknown {
  return Object.prototype.hasOwnProperty.call(source, external) ? source[external] : source[internal];
}

export function safeRelationshipSummary(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const summary = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const sentenceCount = summary.split(/[.!?]+(?:\s+|$)/).filter(Boolean).length;
  if (
    !summary
    || sentenceCount > 3
    || sensitiveSummaryPattern.test(summary)
    || sensitiveValuePattern.test(summary)
    || /\d/.test(summary)
    || instructionPattern.test(summary)
    || /https?:\/\//i.test(summary)
    || /[<>{}\[\]`]/.test(summary)
  ) return undefined;
  return summary;
}

export function safeAboutMe(value: unknown): string | null | undefined {
  if (typeof value === "string" && value.length > 300) return undefined;
  const safe = safeRelationshipSummary(value);
  return safe;
}

export function safeRecentMilestones(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;
  const milestones: string[] = [];
  for (const candidate of value.slice(0, 5)) {
    const safe = safeRelationshipSummary(candidate);
    if (typeof safe !== "string" || safe.length > 140) continue;
    if (!milestones.includes(safe)) milestones.push(safe);
  }
  return milestones.length ? milestones : undefined;
}

export function safePreferredStyle(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const style = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!style || sensitiveSummaryPattern.test(style) || sensitiveValuePattern.test(style) || instructionPattern.test(style) || /https?:\/\/|[<>{}\[\]`]/i.test(style)) return undefined;
  return style;
}

export function validateStateUpdate(value: unknown): PrismaStateUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: PrismaStateUpdate = {};
  const deltas = [
    ["familiarity_delta", "familiarityDelta"],
    ["warmth_delta", "warmthDelta"],
    ["patience_delta", "patienceDelta"],
    ["banter_delta", "banterDelta"],
    ["trust_delta", "trustDelta"],
  ] as const;
  for (const [external, internal] of deltas) {
    const number = finiteNumber(aliasedValue(source, external, internal));
    if (number !== null) result[internal] = clampDelta(number);
  }
  for (const key of ["energy", "sarcasm", "affection"] as const) {
    const number = finiteNumber(source[key]);
    if (number !== null) result[key] = clampScore(number);
  }
  if (typeof source.mood === "string" && moodSet.has(source.mood)) result.mood = source.mood as PrismaMood;
  const summary = safeRelationshipSummary(aliasedValue(source, "relationship_summary_candidate", "relationshipSummaryCandidate"));
  if (summary !== undefined) result.relationshipSummaryCandidate = summary;
  const milestones = safeRecentMilestones(aliasedValue(source, "recent_milestone_candidates", "recentMilestoneCandidates"));
  if (milestones !== undefined) result.recentMilestoneCandidates = milestones;
  const preferredStyle = safePreferredStyle(aliasedValue(source, "preferred_style_candidate", "preferredStyleCandidate"));
  if (preferredStyle !== undefined) result.preferredStyleCandidate = preferredStyle;
  return result;
}

export function defaultRelationship(discordId: string, now = new Date().toISOString()): PrismaRelationship {
  return {
    discordId,
    familiarity: 0,
    warmth: 0,
    patience: 0,
    banter: 0,
    trust: 0,
    relationshipSummary: null,
    recentMilestones: [],
    summaryUpdatedAt: null,
    interactionCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultTemperament(discordId: string, now = new Date().toISOString()): PrismaTemperament {
  return {
    discordId,
    mood: "neutral",
    energy: 0,
    sarcasm: 0,
    affection: 0,
    lastInteractionAt: null,
    updatedAt: now,
  };
}

function moveToward(value: number, target: number, distance: number): number {
  if (value === target) return value;
  return value < target ? Math.min(target, value + distance) : Math.max(target, value - distance);
}

function moveTowardPerInteraction(value: number, target: number): number {
  return moveToward(value, target, target >= value ? 3 : 2);
}

export function decayTemperament(temperament: PrismaTemperament, now = new Date()): PrismaTemperament {
  const lastInteraction = temperament.lastInteractionAt ? Date.parse(temperament.lastInteractionAt) : NaN;
  if (!Number.isFinite(lastInteraction)) return { ...temperament };
  const hours = Math.max(0, (now.getTime() - lastInteraction) / 3_600_000);
  if (hours < 6) return { ...temperament };
  const distance = Math.min(100, Math.max(5, Math.floor(hours / 6) * 5));
  return {
    ...temperament,
    mood: "neutral",
    energy: moveToward(temperament.energy, 0, distance),
    sarcasm: moveToward(temperament.sarcasm, 0, distance),
    affection: moveToward(temperament.affection, 0, distance),
  };
}

function memoryCanChange(relationship: PrismaRelationship, now: Date): boolean {
  if (relationship.interactionCount < 5) return false;
  const lastUpdate = relationship.summaryUpdatedAt ? Date.parse(relationship.summaryUpdatedAt) : NaN;
  return !Number.isFinite(lastUpdate) || now.getTime() - lastUpdate >= 7 * 24 * 60 * 60_000;
}

export function applyValidatedStateUpdate(
  state: PrismaUserState,
  rawUpdate: unknown,
  now = new Date(),
): PrismaUserState {
  const update = validateStateUpdate(rawUpdate);
  const timestamp = now.toISOString();
  const hasNegativeSignal = [update.familiarityDelta, update.warmthDelta, update.patienceDelta, update.banterDelta, update.trustDelta]
    .some((delta) => delta !== undefined && delta < 0);
  const fixedDelta = (delta: number | undefined, neutralGrowth = 0): number => {
    if (delta === undefined) return hasNegativeSignal ? 0 : neutralGrowth;
    if (delta > 0) return delta;
    if (delta < 0) return -2;
    return 0;
  };
  const relationship: PrismaRelationship = {
    ...state.relationship,
    // Conversar diretamente cria reconhecimento e receptividade aos poucos.
    // Sinais explícitos positivos variam de 0 a 3; os negativos recuam 2 pontos.
    familiarity: clampScore(state.relationship.familiarity + fixedDelta(update.familiarityDelta, 1)),
    warmth: clampScore(state.relationship.warmth + fixedDelta(update.warmthDelta, 1)),
    patience: clampScore(state.relationship.patience + fixedDelta(update.patienceDelta)),
    banter: clampScore(state.relationship.banter + fixedDelta(update.banterDelta)),
    // Trust only grows from an explicit signal in the current conversation;
    // merely sending repeated messages must not manufacture intimacy.
    trust: clampScore(state.relationship.trust + fixedDelta(update.trustDelta)),
    interactionCount: Math.max(0, state.relationship.interactionCount + 1),
    updatedAt: timestamp,
  };
  if (memoryCanChange(relationship, now)) {
    let memoryChanged = false;
    if (update.relationshipSummaryCandidate) {
      relationship.relationshipSummary = update.relationshipSummaryCandidate;
      memoryChanged = true;
    }
    if (update.recentMilestoneCandidates?.length) {
      relationship.recentMilestones = [...new Set([...(relationship.recentMilestones ?? []), ...update.recentMilestoneCandidates])].slice(-5);
      memoryChanged = true;
    }
    if (memoryChanged) {
    relationship.summaryUpdatedAt = timestamp;
    }
  }
  const currentTemperament = decayTemperament(state.temperament, now);
  const temperament: PrismaTemperament = {
    ...currentTemperament,
    mood: update.mood ?? currentTemperament.mood,
    energy: update.energy === undefined ? currentTemperament.energy : moveTowardPerInteraction(currentTemperament.energy, update.energy),
    sarcasm: update.sarcasm === undefined ? currentTemperament.sarcasm : moveTowardPerInteraction(currentTemperament.sarcasm, update.sarcasm),
    affection: update.affection === undefined ? currentTemperament.affection : moveTowardPerInteraction(currentTemperament.affection, update.affection),
    lastInteractionAt: timestamp,
    updatedAt: timestamp,
  };
  return { relationship, temperament, revision: state.revision };
}

export function qualitativeRelationship(relationship: PrismaRelationship): string {
  const stage = relationshipStage(relationship);
  const tone = relationship.banter >= 65 ? "brincalhona" : relationship.warmth >= 65 ? "acolhedora" : relationship.trust >= 65 ? "estável" : "equilibrada";
  return `${stage.label.toLowerCase()}, com uma dinâmica ${tone}`;
}

export type RelationshipStage = "newcomers" | "growing" | "close" | "accomplices";

const relationshipStages: Record<RelationshipStage, { label: string; guidance: string }> = {
  newcomers: { label: "Se conhecendo", guidance: "Seja receptiva, mas ainda sem intimidade presumida, apelidos pessoais ou piadas internas." },
  growing: { label: "Criando confiança", guidance: "Pode demonstrar familiaridade leve e espelhar algumas expressões da pessoa sem forçar intimidade." },
  close: { label: "Amizade próxima", guidance: "Fale com mais calor e naturalidade; reutilize com moderação o estilo e as referências que funcionam com essa pessoa." },
  accomplices: { label: "Cúmplices", guidance: "A conversa pode ter bastante sintonia e brincadeira personalizada, desde que respeite os limites e o assunto atual." },
};

export function relationshipStage(relationship: PrismaRelationship): { id: RelationshipStage; label: string; guidance: string } {
  const closeness = (relationship.familiarity + relationship.trust + relationship.warmth) / 3;
  let id: RelationshipStage = "newcomers";
  if (relationship.interactionCount >= 100 && closeness >= 65) id = "accomplices";
  else if (relationship.interactionCount >= 30 && closeness >= 35) id = "close";
  else if (relationship.interactionCount >= 8 && closeness >= 8) id = "growing";
  return { id, ...relationshipStages[id] };
}

export function relationshipCelebration(relationship: PrismaRelationship): string | null {
  const nextInteraction = relationship.interactionCount + 1;
  if (nextInteraction === 50) return "Reconheça de leve que vocês já criaram uma boa sintonia.";
  if (nextInteraction === 100) return "Celebre de forma breve que essa amizade já tem história.";
  if (nextInteraction === 365) return "Faça uma celebração pessoal e calorosa pela trajetória compartilhada.";
  return null;
}

export function relationshipAbsenceDays(temperament: PrismaTemperament, now = new Date()): number | null {
  const lastInteraction = temperament.lastInteractionAt ? Date.parse(temperament.lastInteractionAt) : NaN;
  if (!Number.isFinite(lastInteraction)) return null;
  return Math.floor(Math.max(0, now.getTime() - lastInteraction) / 86_400_000);
}

export function relationshipCallback(relationship: PrismaRelationship): string | null {
  const milestones = relationship.recentMilestones ?? [];
  if (!milestones.length || relationship.interactionCount < 20 || relationship.interactionCount % 12 !== 0) return null;
  return milestones[Math.floor(relationship.interactionCount / 12) % milestones.length] ?? null;
}
