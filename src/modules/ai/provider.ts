import OpenAI from "openai";
import { config } from "../../config.js";
import { buildPersonalityPrompt, limitReplyWords } from "./personality.js";
import { addUsage, monthlyCostBrl, type HistoryItem, type UserSettings } from "./store.js";

const client = config.openAiKey ? new OpenAI({ apiKey: config.openAiKey, baseURL: config.openAiBaseUrl, timeout: 15_000, maxRetries: 1 }) : null;
export async function generateReply(discordId: string, settings: UserSettings, history: HistoryItem[], content: string): Promise<string> {
  if (!client) throw new Error("OPENAI_API_KEY não configurada.");
  if (await monthlyCostBrl() >= config.prismaAi.monthlyBudgetBrl) throw new Error("Orçamento mensal interno atingido.");
  const input = [
    { role: "system" as const, content: buildPersonalityPrompt(settings.personality, settings.nickname, settings.humorLevel) },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: "user" as const, content: content.slice(0, 3000) },
  ];
  const response = await client.responses.create({
    model: config.prismaAi.model,
    input,
    max_output_tokens: config.prismaAi.maxOutputTokens,
    reasoning: { effort: config.prismaAi.reasoningEffort as "minimal" | "low" | "medium" | "high" },
  });
  const usage = response.usage; const inputTokens = usage?.input_tokens ?? 0; const outputTokens = usage?.output_tokens ?? 0;
  const usd = inputTokens / 1_000_000 * config.prismaAi.inputPriceUsdPerMillion + outputTokens / 1_000_000 * config.prismaAi.outputPriceUsdPerMillion;
  await addUsage({ discordId, model: config.prismaAi.model, inputTokens, outputTokens, totalTokens: usage?.total_tokens ?? inputTokens + outputTokens, estimatedCostUsd: usd, estimatedCostBrl: usd * config.prismaAi.usdBrlReference, createdAt: new Date().toISOString() });
  const output = limitReplyWords(response.output_text.replace(/@(everyone|here)|<@&\d+>/gi, "[menção removida]").trim(), 60);
  if (!output) {
    const incompleteReason = response.incomplete_details?.reason ?? "sem motivo informado";
    throw new Error(`Resposta vazia (status=${response.status}, incompleta=${incompleteReason}, output_tokens=${outputTokens}).`);
  }
  return output;
}
