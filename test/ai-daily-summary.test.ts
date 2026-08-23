import assert from "node:assert/strict";
import test from "node:test";
import { buildDailySummary, dailySummaryScheduleParts, dailySummaryTranscript, resetDailySummaryScheduleForTests, shouldRunDailySummary } from "../src/modules/ai/daily-summary.js";
import type { PrismaDailyBatch } from "../src/modules/ai/store.js";

function batch(contents: string[]): PrismaDailyBatch {
  return {
    userId: "u1", summaryDate: "2026-08-20",
    messages: contents.map((content, index) => ({ messageId: `m${index}`, guildId: "g", channelId: "c", userId: "u1", content, authorIsPrisma: false, createdAt: `2026-08-20T12:00:0${index}.000Z` })),
  };
}

test("resume tópicos e preferências explícitas do dia", () => {
  const summary = buildDailySummary(batch(["eu gosto de Billie Eilish", "a música nova da Billie ficou ótima", "eu gosto de Fortnite"]));
  assert.match(summary ?? "", /Assuntos recorrentes:/);
  assert.match(summary ?? "", /Gosta de Billie Eilish/);
  assert.match(summary ?? "", /Gosta de Fortnite/);
});

test("prepara transcript sem contatos, links ou menções", () => {
  const transcript = dailySummaryTranscript(batch(["gosto de música", "meu e-mail é teste@example.com", "olha https://example.com", "fala com <@123>"]));
  assert.match(transcript, /gosto de música/);
  assert.doesNotMatch(transcript, /example|<@123>/);
});

test("remove o conteúdo sensível, mas permite limpar as mensagens do dia", () => {
  const summary = buildDailySummary(batch(["meu e-mail é teste@example.com"]));
  assert.match(summary ?? "", /sem conteúdo seguro/);
  assert.doesNotMatch(summary ?? "", /example\.com/);
});

test("agenda o fechamento diário uma vez às 23:59 em Brasília", () => {
  resetDailySummaryScheduleForTests();
  const atSchedule = new Date("2026-08-24T02:59:10.000Z");
  assert.deepEqual(dailySummaryScheduleParts(atSchedule), { date: "2026-08-23", hour: "23", minute: "59" });
  assert.equal(shouldRunDailySummary(atSchedule), true);
  assert.equal(shouldRunDailySummary(new Date("2026-08-24T02:59:50.000Z")), false);
  assert.equal(shouldRunDailySummary(new Date("2026-08-25T02:59:00.000Z")), true);
});
