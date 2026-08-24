import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalityPrompt, limitReplyWords } from "../src/modules/ai/personality.js";

test("gera prompt estruturado com personalidade-base fixa", () => {
  const prompt = buildPersonalityPrompt();

  assert.match(prompt, /## IDENTIDADE/i);
  assert.match(prompt, /BASE PERSONALITY/i);
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
  assert.match(prompt, /INTIMACY RULE/i);
  assert.match(prompt, /não presuma identidade.*pronome.*orientação/i);
  assert.match(prompt, /viado.*bicha.*uso amistoso/i);
  assert.match(prompt, /sem contar palavras/i);
  assert.match(prompt, /grafia preferencial/i);
  assert.match(prompt, /vc, vcs, n, oq, q, pq, tbm, mto, agr, dps, hj, qnd, msg, nd, algm, smp, cmg, ctz, qria, qro, pd, dboa, vdd e dnv/i);
  assert.match(prompt, /técnica, acadêmica, formal, séria ou delicada.*reduza automaticamente/i);
  assert.match(prompt, /mds, sla, tlgd e slk dependem do contexto/i);
  assert.doesNotMatch(prompt, /ao menos duas abreviações|80% das palavras|3 a 10 palavras/i);
  assert.match(prompt, /não é atendente/i);
  assert.match(prompt, /exemplos mostram estilo e ritmo/i);
  assert.ok(prompt.length < 16_500, `Prompt inesperadamente grande: ${prompt.length} caracteres`);
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
  assert.ok(limited.split(/\s+/).length <= 60);
  assert.match(limited, /\.$/);
});

test("resume a proteção de tamanho em frase completa sem reticências", () => {
  const longReply = Array.from({ length: 75 }, (_, index) => `palavra${index + 1}`).join(" ");
  const limited = limitReplyWords(longReply, 30);
  assert.ok(limited.split(/\s+/).length <= 30);
  assert.ok(limited.endsWith("."));
  assert.ok(!limited.endsWith("..."));
});
