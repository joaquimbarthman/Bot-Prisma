import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSocialTreatment, clampRelationScore } from "../src/modules/ai/social-reciprocity.js";
import { applyValidatedStateUpdate, defaultRelationship, defaultTemperament } from "../src/modules/ai/state.js";

test("insulto direto diminui somente a relaÃ§Ã£o da pessoa atual", () => {
  const signal = analyzeSocialTreatment("prisma vc eh uma idiota");
  assert.equal(signal.directedAtPrisma, true); assert.equal(signal.relationshipDelta, -1);
  const userA = applyValidatedStateUpdate({ relationship: defaultRelationship("A"), temperament: defaultTemperament("A") }, { attitudeDelta: signal.relationshipDelta });
  const userB = defaultRelationship("B");
  assert.equal(userA.relationship.attitudeScore, -1); assert.equal(userB.attitudeScore, 0);
});

test("insulto contra terceiro, palavrÃ£o positivo e discordÃ¢ncia nÃ£o sÃ£o ataques", () => {
  for (const content of ["prisma aquele cara Ã© um idiota", "prisma esse jogo ta bom pra caralho", "caralho prisma ficou perfeito", "acho q vc ta errada", "vc entendeu errado"]) {
    const signal = analyzeSocialTreatment(content);
    assert.equal(signal.directedAtPrisma, false, content); assert.equal(signal.relationshipDelta, 0, content);
  }
});

test("provocaÃ§Ã£o leve e ataque forte recebem intensidades proporcionais", () => {
  assert.equal(analyzeSocialTreatment("vc eh lerda hein").hostilityLevel, 1);
  const strong = analyzeSocialTreatment("vc eh inutil dnv");
  assert.equal(strong.hostilityLevel, 3); assert.equal(strong.relationshipDelta, -2);
});

test("clamp social nunca passa de menos cinco ou mais dez", () => {
  assert.equal(clampRelationScore(-5 - 2), -5); assert.equal(clampRelationScore(10 + 3), 10);
  const high = applyValidatedStateUpdate({ relationship: { ...defaultRelationship("A"), attitudeScore: 10 }, temperament: defaultTemperament("A") }, { attitudeDelta: 1 });
  const low = applyValidatedStateUpdate({ relationship: { ...defaultRelationship("A"), attitudeScore: -5 }, temperament: defaultTemperament("A") }, { attitudeDelta: -2 });
  assert.equal(high.relationship.attitudeScore, 10); assert.equal(low.relationship.attitudeScore, -5);
});

test("mensagem normal em score negativo nÃ£o inicia briga e desculpa recupera devagar", () => {
  const normal = analyzeSocialTreatment("qual horÃ¡rio do evento?", -5);
  assert.equal(normal.hostilityLevel, 0); assert.match(normal.guidance, /retome nem inicie/i);
  const apology = analyzeSocialTreatment("foi mal por ter te xingado antes", -5);
  assert.equal(apology.apology, true); assert.equal(apology.relationshipDelta, 1);
});

test("histÃ³rico positivo transforma provocaÃ§Ã£o claramente brincalhona em banter", () => {
  const signal = analyzeSocialTreatment("sua idiota KKKKK", 9);
  assert.equal(signal.playful, true); assert.equal(signal.relationshipDelta, 0); assert.equal(signal.hostilityLevel, 1);
});
