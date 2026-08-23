import { config } from "../../config.js";
import { memoryCandidates } from "./learning.js";
import { completedDailyMessageBatches, reinforceSelfLearning, saveDailySummaryAndDeleteMessages, type PrismaDailyBatch } from "./store.js";
import { topicTokens } from "./topic-context.js";
import { generateDailyConversationSummary } from "./provider.js";

let running = false;
let lastScheduledDate: string | null = null;

export function dailySummaryScheduleParts(now = new Date(), timezone = "America/Sao_Paulo"): { date: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: value("hour"), minute: value("minute") };
}

export function shouldRunDailySummary(now = new Date(), timezone = "America/Sao_Paulo"): boolean {
  const local = dailySummaryScheduleParts(now, timezone);
  if (local.hour !== "23" || local.minute !== "59" || lastScheduledDate === local.date) return false;
  lastScheduledDate = local.date;
  return true;
}

export function resetDailySummaryScheduleForTests(): void {
  lastScheduledDate = null;
}

export function buildDailySummary(batch: PrismaDailyBatch): string | null {
  const userMessages = batch.messages.filter((message) => !message.authorIsPrisma);
  if (!userMessages.length) return null;
  const safeMessages = userMessages.filter((message) => !/https?:\/\/|<@!?\d+>|\b(?:senha|token|cpf|telefone|e-?mail|endere[cç]o)\b/i.test(message.content));
  if (!safeMessages.length) return `Houve ${userMessages.length} mensagem(ns) da pessoa neste dia, sem conteúdo seguro para preservar no resumo.`;

  const frequencies = new Map<string, number>();
  for (const message of safeMessages) for (const token of topicTokens(message.content)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  const topics = [...frequencies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([token]) => token);
  const memories = safeMessages.flatMap((message) => memoryCandidates(batch.userId, message.content, message.messageId));
  const uniqueMemories = [...new Map(memories.map((memory) => [memory.memoryKey ?? memory.content, memory])).values()].slice(0, 6);
  const parts = [`Houve ${userMessages.length} mensagem(ns) da pessoa neste dia.`];
  if (topics.length) parts.push(`Assuntos recorrentes: ${topics.join(", ")}.`);
  if (uniqueMemories.length) parts.push(`Preferências explícitas: ${uniqueMemories.map((memory) => memory.content).join(" ")}`);
  return parts.join(" ").slice(0, 1_200);
}

export function dailySummaryTranscript(batch: PrismaDailyBatch): string {
  return batch.messages
    .filter((message) => !/https?:\/\/|<@!?\d+>|\b(?:senha|token|cpf|telefone|e-?mail|endere[cç]o)\b/i.test(message.content))
    .slice(-80)
    .map((message) => `${message.authorIsPrisma ? "PRISMA" : "PESSOA"}: ${message.content.replace(/\s+/g, " ").slice(0, 500)}`)
    .join("\n")
    .slice(-12_000);
}

export async function summarizeCompletedConversationDays(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const batches = await completedDailyMessageBatches(config.prismaAi.timezone);
    let completed = 0;
    for (const batch of batches) {
      const fallbackSummary = buildDailySummary(batch);
      if (!fallbackSummary) continue;
      const transcript = dailySummaryTranscript(batch);
      const reflection = transcript ? await generateDailyConversationSummary(batch.userId, batch.summaryDate, transcript) : null;
      const summary = reflection?.summary ?? fallbackSummary;
      for (const learning of reflection?.learnings ?? []) await reinforceSelfLearning(learning);
      if (await saveDailySummaryAndDeleteMessages(batch, summary)) completed += 1;
    }
    if (completed) console.log(`[PRISMA-MEMÓRIA] ${completed} dia(s) resumido(s); mensagens detalhadas removidas.`);
    return completed;
  } finally {
    running = false;
  }
}
