import { readFileSync } from "node:fs";
import { config } from "../../config.js";

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
    .replace(/(.)\1+/g, "$1")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

/** Forma compacta usada somente contra evasões como "b.u c-e_t_a". */
export function compactNormalizedText(input: string): string {
  return normalizeText(input).replace(/\s+/g, "");
}

type FilterDataset = {
  bloqueio_imediato?: Record<string, { nivel?: number; frases?: string[] }>;
  revisao_contextual?: { termos?: string[] };
  regex_bloqueio_imediato?: Array<{ nome?: string; padrao?: string; categoria?: string; motivo?: string }>;
};

type DatasetPhrase = { phrase: string; evasionPattern: RegExp; category: string; level: number };
type DatasetRegex = { pattern: RegExp; category: string; reason: string };
let datasetPhrases: DatasetPhrase[] = [];
let contextualTerms: string[] = [];
let datasetRegexes: DatasetRegex[] = [];

if (config.filterJsonPath) {
  try {
    const dataset = JSON.parse(readFileSync(config.filterJsonPath, "utf8")) as FilterDataset;
    datasetPhrases = Object.entries(dataset.bloqueio_imediato ?? {}).flatMap(([category, group]) =>
      (group.frases ?? []).map((phrase) => {
        const normalized = normalizeText(phrase);
        const characters = compactNormalizedText(phrase).split("").map(escapeRegex).join("\\s*");
        return { phrase: normalized, evasionPattern: new RegExp(`(?:^| )${characters}(?:$| )`), category, level: group.nivel ?? 2 };
      }),
    ).filter((item) => item.phrase.length > 0);
    contextualTerms = (dataset.revisao_contextual?.termos ?? []).map(normalizeText).filter(Boolean);
    datasetRegexes = (dataset.regex_bloqueio_imediato ?? []).flatMap((rule) => {
      if (!rule.padrao) return [];
      try { return [{ pattern: new RegExp(rule.padrao, "i"), category: rule.categoria ?? "ofensivo", reason: rule.motivo ?? `Regra ${rule.nome ?? "do JSON"}` }]; }
      catch (error) { console.error(`[FILTRO] Regex inválida no JSON (${rule.nome ?? rule.padrao}):`, error); return []; }
    });
    console.log(`[FILTRO] JSON carregado: ${datasetPhrases.length} frases, ${datasetRegexes.length} regex de bloqueio e ${contextualTerms.length} termos contextuais.`);
  } catch (error) {
    console.error(`[FILTRO] Não foi possível carregar ${config.filterJsonPath}; usando regras internas:`, error);
  }
}

export function shouldUseAi(content: string): boolean {
  const normalized = normalizeText(content);
  return normalized.length >= 4 && (
    contextualTerms.some((term) => new RegExp(`(?:^| )${escapeRegex(term)}(?:$| )`).test(normalized))
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function localModeration(content: string): ModerationResult {
  const normalized = normalizeText(content);
  for (const rule of datasetPhrases) {
    if (new RegExp(`(?:^| )${escapeRegex(rule.phrase)}(?:$| )`).test(normalized) || rule.evasionPattern.test(normalized)) {
      return {
        flagged: true,
        confidence: 1,
        category: rule.category,
        reason: `Frase de bloqueio imediato do filtro JSON (nível ${rule.level})`,
        source: "local",
      };
    }
  }
  for (const rule of datasetRegexes) {
    if (rule.pattern.test(normalized)) {
      return { flagged: true, confidence: 0.99, category: rule.category, reason: rule.reason, source: "local" };
    }
  }
  return { flagged: false, confidence: 0, source: "none" };
}
