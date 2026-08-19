export type PrismaEmotionalState = {
  userId: string;
  happiness: number;
  sadness: number;
  anger: number;
  irritation: number;
  affection: number;
  curiosity: number;
  excitement: number;
  boredom: number;
  confidence: number;
  energy: number;
  updatedAt: string;
};

export type PrismaEmotionalUpdate = Partial<Omit<PrismaEmotionalState, "userId" | "updatedAt">>;

const emotionalKeys = ["happiness", "sadness", "anger", "irritation", "affection", "curiosity", "excitement", "boredom", "confidence", "energy"] as const;

export function clampEmotion(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

export function defaultEmotionalState(userId: string, now = new Date().toISOString()): PrismaEmotionalState {
  return { userId, happiness: 50, sadness: 0, anger: 0, irritation: 0, affection: 30, curiosity: 50, excitement: 30, boredom: 0, confidence: 50, energy: 50, updatedAt: now };
}

function toward(value: number, neutral: number, amount: number): number {
  return value < neutral ? Math.min(neutral, value + amount) : Math.max(neutral, value - amount);
}

export function decayEmotionalState(state: PrismaEmotionalState, now = new Date()): PrismaEmotionalState {
  const elapsedHours = Math.max(0, (now.getTime() - Date.parse(state.updatedAt)) / 3_600_000);
  if (!Number.isFinite(elapsedHours) || elapsedHours < 1) return { ...state };
  const amount = Math.min(100, Math.floor(elapsedHours) * 4);
  return {
    ...state,
    happiness: toward(state.happiness, 50, amount), sadness: toward(state.sadness, 0, amount),
    anger: toward(state.anger, 0, amount), irritation: toward(state.irritation, 0, amount),
    affection: toward(state.affection, 30, amount), curiosity: toward(state.curiosity, 50, amount),
    excitement: toward(state.excitement, 30, amount), boredom: toward(state.boredom, 0, amount),
    confidence: toward(state.confidence, 50, amount), energy: toward(state.energy, 50, amount),
  };
}

export function applyEmotionalUpdate(state: PrismaEmotionalState, update: PrismaEmotionalUpdate, now = new Date()): PrismaEmotionalState {
  const next = { ...state, updatedAt: now.toISOString() };
  for (const key of emotionalKeys) if (update[key] !== undefined) next[key] = clampEmotion(update[key], state[key]);
  return next;
}

export function describeEmotionalState(state: PrismaEmotionalState): string {
  const descriptions: string[] = [];
  if (state.anger >= 60 || state.irritation >= 60) descriptions.push("está irritada e com pouca paciência");
  else if (state.sadness >= 60) descriptions.push("está mais sensível e triste");
  else if (state.happiness >= 65) descriptions.push("está bem-humorada");
  else descriptions.push("está em um humor neutro");
  if (state.curiosity >= 65) descriptions.push("curiosa");
  if (state.excitement >= 65) descriptions.push("animada");
  if (state.energy <= 30) descriptions.push("com pouca energia");
  return `Com esta pessoa, a Prisma ${descriptions.join(", ")}. Demonstre isso naturalmente, sem expor números.`;
}
