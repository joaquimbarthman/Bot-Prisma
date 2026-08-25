import { config } from "../../config.js";
import { memoryCandidates } from "./learning.js";
import { claimDailySummary, completedDailyMessageBatches, failDailySummary, reinforceSelfLearning, saveDailySummaryAndDeleteMessages, type PrismaDailyBatch } from "./store.js";
import { topicTokens } from "./topic-context.js";
import { generateDailyConversationChunkSummary, generateDailyConversationSummary } from "./provider.js";

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
  if (local.hour !== "00" || local.minute !== "00" || lastScheduledDate === local.date) return false;
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
  if (!safeMessages.length) return "Hoje conversei com outras pessoas, mas não preservei detalhes porque o conteúdo do dia era sensível.";

  const memories = safeMessages.flatMap((message) => memoryCandidates(batch.userId, message.content, message.messageId));
  const uniqueMemories = [...new Map(memories.map((memory) => [memory.memoryKey ?? memory.content, memory])).values()].slice(0, 6);
  const highlights = [...new Map(safeMessages.flatMap((message) => {
    const content = message.content.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
    const tokens = topicTokens(content);
    if (content.length < 12 || content.length > 240 || tokens.size < 2) return [];
    return [[content.toLocaleLowerCase("pt-BR"), { content, score: Math.min(tokens.size, 10) + (content.length >= 30 ? 2 : 0) }]] as const;
  })).values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((item) => item.content);

  const parts = ["Hoje conversei com outras pessoas."];
  if (highlights.length) parts.push(`Entre os principais momentos, eu disse: ${highlights.map((item) => `“${item}”`).join("; ")}.`);
  if (uniqueMemories.length) parts.push(`Também registrei estes fatos sobre mim: ${uniqueMemories.map((memory) => memory.content
    .replace(/^Não gosta de\s+/i, "eu não gosto de ")
    .replace(/^Gosta de\s+/i, "eu gosto de ")
    .replace(/^Prefere\s+/i, "eu prefiro ")
    .replace(/^Adora\s+/i, "eu adoro ")
    .replace(/\.$/, "")).join("; ")}.`);
  if (!highlights.length && !uniqueMemories.length) parts.push("Foi uma conversa breve, sem acontecimentos específicos que valesse a pena guardar.");
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

export function dailySummaryTranscriptChunks(batch: PrismaDailyBatch, maximumCharacters = 8_000): string[] {
  const lines = batch.messages
    .filter((message) => !/https?:\/\/|<@!?\d+>|\b(?:senha|token|cpf|telefone|e-?mail|endere[cç]o)\b/i.test(message.content))
    .map((message) => `${message.authorIsPrisma ? "PRISMA" : "PESSOA"}: ${message.content.replace(/\s+/g, " ").slice(0, 500)}`);
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maximumCharacters) { chunks.push(current); current = ""; }
    current = `${current}${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function textBlocks(items: string[], maximumCharacters = 8_000): string[] {
  const blocks: string[] = [];
  let current = "";
  for (const item of items) {
    const line = item.slice(0, maximumCharacters);
    if (current && current.length + line.length + 1 > maximumCharacters) { blocks.push(current); current = ""; }
    current = `${current}${current ? "\n" : ""}${line}`;
  }
  if (current) blocks.push(current);
  return blocks;
}

async function condenseDailyPartials(userId: string, summaryDate: string, partials: string[]): Promise<string[]> {
  let current = partials;
  while (current.length > 1 && current.join("\n").length > 10_000) {
    const blocks = textBlocks(current);
    const next = (await Promise.all(blocks.map((block) => generateDailyConversationChunkSummary(userId, summaryDate, block)))).filter((summary): summary is string => !!summary);
    if (!next.length || next.length >= current.length) break;
    current = next;
  }
  return current;
}

export async function summarizeCompletedConversationDays(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const batches = await completedDailyMessageBatches(config.prismaAi.timezone);
    let completed = 0;
    for (const batch of batches) {
      if (!await claimDailySummary(batch)) continue;
      try {
        const fallbackSummary = buildDailySummary(batch);
        if (!fallbackSummary) { await failDailySummary(batch, "Sem mensagens da pessoa para resumir."); continue; }
        const chunks = dailySummaryTranscriptChunks(batch);
        const partials = chunks.length > 1
          ? (await Promise.all(chunks.map((chunk) => generateDailyConversationChunkSummary(batch.userId, batch.summaryDate, chunk)))).filter((summary): summary is string => !!summary)
          : [];
        const condensedPartials = partials.length ? await condenseDailyPartials(batch.userId, batch.summaryDate, partials) : [];
        const transcript = condensedPartials.length
          ? condensedPartials.map((summary, index) => `BLOCO ${index + 1}: ${summary}`).join("\n")
          : chunks[0] ?? dailySummaryTranscript(batch);
        const reflection = transcript ? await generateDailyConversationSummary(batch.userId, batch.summaryDate, transcript) : null;
        const summary = reflection?.summary ?? fallbackSummary;
        if (await saveDailySummaryAndDeleteMessages(batch, summary)) {
          for (const learning of reflection?.learnings ?? []) await reinforceSelfLearning(learning, { userId: batch.userId, observedDate: batch.summaryDate });
          completed += 1;
        } else await failDailySummary(batch, "Não foi possível salvar o resumo final.");
      } catch (error) {
        await failDailySummary(batch, error instanceof Error ? error.message : "Falha inesperada ao resumir o dia.");
      }
    }
    if (completed) console.log(`[PRISMA-MEMÓRIA] ${completed} dia(s) resumido(s); mensagens detalhadas removidas.`);
    return completed;
  } finally {
    running = false;
  }
}
