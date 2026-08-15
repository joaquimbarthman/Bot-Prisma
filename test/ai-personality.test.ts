import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalityPrompt, limitReplyWords, normalizePersonality, personalityOptions } from "../src/modules/ai/personality.js";

test("normaliza personalidades antigas", () => {
  assert.equal(normalizePersonality("padrao"), "prisma_default");
  assert.equal(normalizePersonality("sarcastico"), "sarcastic");
  assert.equal(normalizePersonality("fofo"), "cute");
  assert.equal(normalizePersonality("caotico"), "chaotic");
});

test("carrega os presets da configuração mestre", () => {
  const values = personalityOptions().map((option) => option.value);
  assert.deepEqual(values, ["prisma_default", "friendly", "sarcastic", "chaotic", "cute", "gamer"]);
});

test("gera apenas um prompt compacto para a personalidade ativa", () => {
  const prompt = buildPersonalityPrompt("sarcastic", "Belzebu", 5);
  assert.match(prompt, /Perfil .*sar/i);
  assert.match(prompt, /Belzebu/);
  assert.match(prompt, /5\/5/);
  assert.ok(prompt.length < 2_000, `Prompt inesperadamente grande: ${prompt.length} caracteres`);
  assert.doesNotMatch(prompt, /personality_presets|response_behavior|interaction_rules/);
});

test("limita respostas a 60 palavras", () => {
  const longReply = Array.from({ length: 75 }, (_, index) => `palavra${index + 1}`).join(" ");
  const limited = limitReplyWords(longReply);
  assert.equal(limited.split(/\s+/).length, 60);
  assert.match(limited, /…$/);
});
