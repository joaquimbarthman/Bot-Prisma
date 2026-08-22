import assert from "node:assert/strict";
import test from "node:test";
import { buildDailySummary, dailySummaryTranscript } from "../src/modules/ai/daily-summary.js";
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
