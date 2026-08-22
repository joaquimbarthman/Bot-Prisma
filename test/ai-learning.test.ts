import assert from "node:assert/strict";
import test from "node:test";
import { emotionalUpdateFromMessage, memoryCandidates } from "../src/modules/ai/learning.js";

test("reconhece gatilhos emocionais sem inferir diagnóstico", () => {
  assert.deepEqual(emotionalUpdateFromMessage("obrigada, você me ajudou muito"), { happiness: 58, affection: 42, confidence: 54 });
  assert.deepEqual(emotionalUpdateFromMessage("aff, deu errado de novo"), { irritation: 35, energy: 42 });
  assert.deepEqual(emotionalUpdateFromMessage("tô triste e desanimado"), { sadness: 48, energy: 42, affection: 40 });
  assert.deepEqual(emotionalUpdateFromMessage("cala a boca, que lixo"), { irritation: 50, anger: 35 });
});

test("extrai várias preferências e reconhece rejeições", () => {
  const memories = memoryCandidates("u1", "eu gosto de Fortnite e eu não gosto de Valorant", "m1");
  assert.equal(memories.length, 2);
  assert.equal(memories[0].content, "Gosta de Fortnite.");
  assert.equal(memories[1].content, "Não gosta de Valorant.");
  assert.equal(memories[0].sourceMessageId, "m1");
});

test("usa a mesma chave para uma preferência contraditória", () => {
  const positive = memoryCandidates("u1", "eu gosto de minecraft")[0];
  const negative = memoryCandidates("u1", "eu odeio minecraft")[0];
  assert.equal(positive.memoryKey, negative.memoryKey);
  assert.notEqual(positive.content, negative.content);
});

test("não memoriza dados sensíveis ou estados passageiros", () => {
  assert.deepEqual(memoryCandidates("u1", "eu gosto do meu e-mail teste@example.com"), []);
  assert.deepEqual(memoryCandidates("u1", "eu gosto de dormir agora"), []);
});
