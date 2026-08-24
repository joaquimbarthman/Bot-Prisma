import assert from "node:assert/strict";
import test from "node:test";
import { determineContextNeeds } from "../src/modules/ai/context-builder.js";
import { channelFetchPageSizes, temporaryHistoryFromMessages } from "../src/modules/ai/index.js";

test("conversa casual preserva histórico recente sem carregar o canal público", () => {
  const needs = determineContextNeeds("e o outro?");
  assert.equal(needs.recentHistory, true);
  assert.equal(needs.channelContext, false);
  assert.equal(needs.memories, false);
  assert.equal(needs.dailySummaries, false);
});

test("pergunta sobre fala de outra pessoa carrega contexto público", () => {
  assert.equal(determineContextNeeds("oq ele falou?").channelContext, true);
});

test("reply recebe prioridade de contexto sem depender do texto", () => {
  const needs = determineContextNeeds("oq vc acha disso?", { hasReply: true });
  assert.equal(needs.channelContext, true);
});

test("memória antiga e referência a ontem carregam memórias e resumos", () => {
  const project = determineContextNeeds("lembra daquele projeto de discord?");
  assert.equal(project.memories, true);
  assert.equal(project.dailySummaries, true);
  const yesterday = determineContextNeeds("oq eu tinha falado ontem?");
  assert.equal(yesterday.memories, true);
  assert.equal(yesterday.dailySummaries, true);
});

test("roteamento mantém histórico temporário independente de memória permanente", () => {
  assert.equal(determineContextNeeds("pq?").recentHistory, true);
  const history = temporaryHistoryFromMessages([
    { authorId: "user", content: "olha esse banner", createdAt: new Date("2026-01-01T00:00:00Z") },
    { authorId: "bot", content: "gostei", createdAt: new Date("2026-01-01T00:00:01Z") },
    { authorId: "other", content: "assunto paralelo", createdAt: new Date("2026-01-01T00:00:02Z") },
  ], "user", "bot", "channel");
  assert.deepEqual(history.map((item) => [item.role, item.content]), [["user", "olha esse banner"], ["assistant", "gostei"]]);
});

test("limite do canal menor que cem faz uma busca do tamanho configurado", () => {
  assert.deepEqual(channelFetchPageSizes(20), [20]);
  assert.deepEqual(channelFetchPageSizes(50), [50]);
});

test("contexto expandido pagina somente até o limite configurado", () => {
  assert.deepEqual(channelFetchPageSizes(250), [100, 100, 50]);
  assert.deepEqual(channelFetchPageSizes(101), [100, 1]);
});
