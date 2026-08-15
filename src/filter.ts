import { readFileSync } from "node:fs";
import { config } from "./config.js";

export type ModerationResult = {
  flagged: boolean;
  confidence: number;
  category?: string;
  reason?: string;
  source: "local" | "ai" | "none";
};

export function normalizeText(input: string): string {
  return input
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[@4]/g, "a").replace(/[3]/g, "e").replace(/[1]/g, "i")
    .replace(/[0]/g, "o").replace(/[5$]/g, "s").replace(/[7]/g, "t")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Mantenha esta lista pequena e inequívoca. Contexto ambíguo deve ser avaliado pela IA/moderação humana.
const severePatterns: Array<{ pattern: RegExp; category: string; reason: string }> = [
  { pattern: /\b(?:heil\s+hitler|morte\s+aos?)\b/i, category: "odio", reason: "Incitação ou exaltação explícita de ódio" },
  { pattern: /\b(?:vamos|temos\s+que|deveria(?:m)?)\s+(?:matar|exterminar|eliminar)\s+(?:todos?\s+)?(?:os|as|esse|essa|esses|essas)\b/i, category: "violencia", reason: "Possível incitação à violência contra um grupo" },
];

type FilterDataset = {
  bloqueio_imediato?: Record<string, { nivel?: number; frases?: string[] }>;
  revisao_contextual?: { termos?: string[] };
};

type DatasetPhrase = { phrase: string; category: string; level: number };
let datasetPhrases: DatasetPhrase[] = [];
let contextualTerms: string[] = [];

if (config.filterJsonPath) {
  try {
    const dataset = JSON.parse(readFileSync(config.filterJsonPath, "utf8")) as FilterDataset;
    datasetPhrases = Object.entries(dataset.bloqueio_imediato ?? {}).flatMap(([category, group]) =>
      (group.frases ?? []).map((phrase) => ({ phrase: normalizeText(phrase), category, level: group.nivel ?? 2 })),
    ).filter((item) => item.phrase.length > 0);
    contextualTerms = (dataset.revisao_contextual?.termos ?? []).map(normalizeText).filter(Boolean);
    console.log(`[FILTRO] JSON carregado: ${datasetPhrases.length} frases de bloqueio e ${contextualTerms.length} termos contextuais.`);
  } catch (error) {
    console.error(`[FILTRO] Não foi possível carregar ${config.filterJsonPath}; usando regras internas:`, error);
  }
}

// Estes termos apenas selecionam mensagens para análise contextual; nunca punem sozinhos.
const suspiciousPatterns = [
  /\b(?:matar|morte|morre|exterminar|eliminar|espancar|agredir|ameacar)\b/i,
  /\b(?:odio|odeio|nojento|inferior|subhumano|aberracao|aberracoes|praga)\b/i,
  /\b(?:racista|racismo|nazista|nazismo|preconceito|xenofob|homofob|transfob|misogin)\w*\b/i,
  /\b(?:vai|deveria|merece|tem\s+que|precisa)\s+(?:morrer|apanhar|sumir)\b/i,
];

export function shouldUseAi(content: string): boolean {
  const normalized = normalizeText(content);
  return normalized.length >= 4 && (
    suspiciousPatterns.some((pattern) => pattern.test(normalized))
    || contextualTerms.some((term) => new RegExp(`(?:^| )${escapeRegex(term)}(?:$| )`).test(normalized))
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function localModeration(content: string): ModerationResult {
  const normalized = normalizeText(content);
  for (const rule of datasetPhrases) {
    if (new RegExp(`(?:^| )${escapeRegex(rule.phrase)}(?:$| )`).test(normalized)) {
      return {
        flagged: true,
        confidence: 1,
        category: rule.category,
        reason: `Frase de bloqueio imediato do filtro JSON (nível ${rule.level})`,
        source: "local",
      };
    }
  }
  for (const rule of severePatterns) {
    if (rule.pattern.test(normalized)) {
      return { flagged: true, confidence: 0.98, category: rule.category, reason: rule.reason, source: "local" };
    }
  }
  return { flagged: false, confidence: 0, source: "none" };
}
