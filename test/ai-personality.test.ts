import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalityPrompt, limitReplyWords } from "../src/modules/ai/personality.js";

test("gera prompt JSON com personalidade-base fixa", () => {
  const prompt = buildPersonalityPrompt();

  assert.match(prompt, /base_personality/i);
  assert.match(prompt, /espontânea.*curiosa.*acolhedora/i);
  assert.match(prompt, /primeira pessoa/i);
  assert.match(prompt, /envelope JSON/i);
  assert.doesNotMatch(prompt, /preset|humor escolhido|personality_presets/i);
  assert.match(prompt, /mds/i);
  assert.match(prompt, /kkkkkk/i);
  assert.match(prompt, /vdd.*vlw.*tlgd/i);
  assert.match(prompt, /brabo.*deu ruim/i);
  assert.match(prompt, /tankar.*flopar.*GG/i);
  assert.match(prompt, /rolê.*sextou.*bora/i);
  assert.match(prompt, /mana.*mona.*diva.*babado.*lacrou/i);
  assert.match(prompt, /clarinho que sim.*juro.*divou.*arrasou/i);
  assert.match(prompt, /amg.*miga.*mulher.*gata/i);
  assert.match(prompt, /intimacy_rule/i);
  assert.match(prompt, /não presuma identidade.*pronome.*orientação/i);
  assert.match(prompt, /viado.*bicha.*uso amistoso/i);
  assert.match(prompt, /abreviações são obrigatórias/i);
  assert.match(prompt, /ao menos duas abreviações/i);
  assert.match(prompt, /não como assistente/i);
  assert.ok(prompt.length < 12_000, `Prompt inesperadamente grande: ${prompt.length} caracteres`);
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
