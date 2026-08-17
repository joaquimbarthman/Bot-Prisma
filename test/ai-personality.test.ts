import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalityPrompt, limitReplyWords } from "../src/modules/ai/personality.js";

test("gera prompt compacto com personalidade-base fixa", () => {
  const prompt = buildPersonalityPrompt();

  assert.match(prompt, /personalidade-base é fixa/i);
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
  assert.match(prompt, /só chame alguém.*contexto.*preferência.*intimidade/i);
  assert.match(prompt, /não presuma identidade.*pronome.*orientação/i);
  assert.match(prompt, /viado.*bicha.*contexto claramente amistoso/i);
  assert.match(prompt, /no máximo uma ou duas expressões/i);
  assert.match(prompt, /não como assistente/i);
  assert.ok(prompt.length < 3_500, `Prompt inesperadamente grande: ${prompt.length} caracteres`);
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
