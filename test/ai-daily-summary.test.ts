import assert from "node:assert/strict";
import test from "node:test";
import { buildDailySummary, dailySummaryScheduleParts, dailySummaryTranscript, dailySummaryTranscriptChunks, resetDailySummaryScheduleForTests, shouldRunDailySummary } from "../src/modules/ai/daily-summary.js";
import type { PrismaDailyBatch } from "../src/modules/ai/store.js";

function batch(contents: string[]): PrismaDailyBatch {
  return {
    userId: "u1", summaryDate: "2026-08-20",
    messages: contents.map((content, index) => ({ messageId: `m${index}`, guildId: "g", channelId: "c", userId: "u1", content, authorIsPrisma: false, createdAt: `2026-08-20T12:00:0${index}.000Z` })),
  };
}

test("cria um registro de diário com momentos e preferências explícitas", () => {
  const summary = buildDailySummary(batch(["eu gosto de Billie Eilish", "a música nova da Billie ficou ótima", "eu gosto de Fortnite"]));
  assert.match(summary ?? "", /^Hoje conversei com outras pessoas/);
  assert.match(summary ?? "", /Entre os principais momentos, eu disse:/);
  assert.doesNotMatch(summary ?? "", /Assuntos recorrentes:/);
  assert.match(summary ?? "", /eu gosto de Billie Eilish/);
  assert.match(summary ?? "", /eu gosto de Fortnite/);
  assert.doesNotMatch(summary ?? "", /\d+ mensagens/);
});

test("prepara transcript sem contatos, links ou menções", () => {
  const transcript = dailySummaryTranscript(batch(["gosto de música", "meu e-mail é teste@example.com", "olha https://example.com", "fala com <@123>"]));
  assert.match(transcript, /gosto de música/);
  assert.doesNotMatch(transcript, /example|<@123>/);
});

test("divide um dia longo em blocos sem perder as mensagens do começo", () => {
  const longBatch = batch(Array.from({ length: 10 }, (_, index) => `mensagem importante ${index} sobre um assunto diferente`));
  const chunks = dailySummaryTranscriptChunks(longBatch, 150);
  assert.ok(chunks.length > 1);
  assert.match(chunks[0], /mensagem importante 0/);
  assert.match(chunks.at(-1) ?? "", /mensagem importante 9/);
});

test("remove o conteúdo sensível, mas permite limpar as mensagens do dia", () => {
  const summary = buildDailySummary(batch(["meu e-mail é teste@example.com"]));
  assert.match(summary ?? "", /não preservei detalhes/);
  assert.doesNotMatch(summary ?? "", /example\.com/);
});

test("agenda o fechamento diário uma vez após a virada do dia em Brasília", () => {
  resetDailySummaryScheduleForTests();
  const atSchedule = new Date("2026-08-24T03:00:10.000Z");
  assert.deepEqual(dailySummaryScheduleParts(atSchedule), { date: "2026-08-24", hour: "00", minute: "00" });
  assert.equal(shouldRunDailySummary(atSchedule), true);
  assert.equal(shouldRunDailySummary(new Date("2026-08-24T03:00:50.000Z")), false);
  assert.equal(shouldRunDailySummary(new Date("2026-08-25T03:00:00.000Z")), true);
});
