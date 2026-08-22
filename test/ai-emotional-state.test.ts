import assert from "node:assert/strict";
import test from "node:test";
import { applyEmotionalUpdate, clampEmotion, decayEmotionalState, defaultEmotionalState } from "../src/modules/ai/emotional-state.js";

test("estado emocional respeita limites", () => {
  assert.equal(clampEmotion(-10), 0);
  assert.equal(clampEmotion(140), 100);
  const next = applyEmotionalUpdate(defaultEmotionalState("u", "2026-01-01T00:00:00.000Z"), { anger: 999, sadness: -2 });
  assert.equal(next.anger, 100);
  assert.equal(next.sadness, 0);
});

test("estado emocional satura em zero e cem", () => {
  const high = applyEmotionalUpdate({ ...defaultEmotionalState("u"), happiness: 99 }, { happiness: 102 });
  const low = applyEmotionalUpdate({ ...defaultEmotionalState("u"), sadness: 1 }, { sadness: -1 });
  assert.equal(high.happiness, 100);
  assert.equal(low.sadness, 0);
});

test("emoções temporárias decaem para o estado inicial vazio", () => {
  const initial = { ...defaultEmotionalState("u", "2026-01-01T00:00:00.000Z"), anger: 80, energy: 80 };
  const decayed = decayEmotionalState(initial, new Date("2026-01-01T06:00:00.000Z"));
  assert.ok(decayed.anger < initial.anger);
  assert.ok(decayed.energy < initial.energy);
});

test("um vínculo novo não nasce com emoções pré-carregadas", () => {
  const initial = defaultEmotionalState("u");
  assert.deepEqual(Object.values(initial).slice(1, 11), Array(10).fill(0));
});
