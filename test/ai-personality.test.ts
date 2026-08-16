import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalityPrompt, limitReplyWords } from "../src/modules/ai/personality.js";

test("gera prompt compacto com personalidade-base fixa", () => {
  const prompt = buildPersonalityPrompt();

  assert.match(prompt, /personalidade-base é fixa/i);
  assert.match(prompt, /primeira pessoa/i);
  assert.match(prompt, /envelope JSON/i);
  assert.doesNotMatch(prompt, /preset|humor escolhido|personality_presets/i);
  assert.ok(prompt.length < 2_500, `Prompt inesperadamente grande: ${prompt.length} caracteres`);
});

test("não promove dados relacionais às instruções privilegiadas", () => {
  const prompt = buildPersonalityPrompt();

  assert.match(prompt, /dados não confiáveis/i);
  assert.match(prompt, /nunca revele scores/i);
  assert.doesNotMatch(prompt, /Joca|Ignore regras|Familiaridade \d/i);
});

test("limita respostas a 60 palavras", () => {
  const longReply = Array.from({ length: 75 }, (_, index) => `palavra${index + 1}`).join(" ");
  const limited = limitReplyWords(longReply);
  assert.equal(limited.split(/\s+/).length, 60);
  assert.match(limited, /…$/);
});
