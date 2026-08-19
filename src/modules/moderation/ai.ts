import OpenAI from "openai";
import { config } from "../../config.js";
import type { ModerationResult } from "./filter.js";

const cache = new Map<string, { expires: number; result: ModerationResult }>();
let usage = { day: new Date().toISOString().slice(0, 10), requests: 0 };
const watchedCategories = ["harassment", "harassment/threatening", "hate", "hate/threatening"];
const openai = config.openAiKey
  ? new OpenAI({ apiKey: config.openAiKey, baseURL: config.openAiBaseUrl, timeout: 8_000, maxRetries: 1 })
  : null;

function resetDailyCounter(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) usage = { day: today, requests: 0 };
}

export async function aiModeration(content: string): Promise<ModerationResult> {
  if (!openai) return { flagged: false, confidence: 0, source: "none" };
  const cacheKey = content.toLowerCase().trim().slice(0, 3000);
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.result;
  resetDailyCounter();
  if (usage.requests >= config.aiMaxDailyRequests) {
    console.warn(`[MODERACAO] Limite diário atingido (${config.aiMaxDailyRequests}); análise ignorada.`);
    return { flagged: false, confidence: 0, source: "none" };
  }
  usage.requests += 1;

  try {
    const analysis = await openai.moderations.create({
      model: config.moderationModel,
      input: content.slice(0, 3000),
    });
    const moderation = analysis.results[0];
    if (!moderation) throw new Error("API não retornou resultado de moderação");

    const categories = moderation.categories as unknown as Record<string, boolean>;
    const scores = moderation.category_scores as unknown as Record<string, number>;
    const matched = watchedCategories.filter((category) => categories[category] === true);
    const confidence = Math.max(0, ...watchedCategories.map((category) => scores[category] ?? 0));
    const result: ModerationResult = {
      flagged: matched.length > 0,
      confidence,
      category: matched.join(", ") || "seguro",
      reason: matched.length ? `Categoria detectada: ${matched.join(", ")}` : "Nenhuma ofensa detectada",
      source: "ai",
    };
    cache.set(cacheKey, { expires: Date.now() + 6 * 60 * 60_000, result });
    if (cache.size > 1_000) cache.delete(cache.keys().next().value!);
    return result;
  } catch (error) {
    console.error("[MODERACAO] Falha na API; mensagem não foi punida:", error);
    return { flagged: false, confidence: 0, source: "none" };
  }
}
