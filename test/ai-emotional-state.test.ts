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

test("emoções temporárias decaem para o neutro", () => {
  const initial = { ...defaultEmotionalState("u", "2026-01-01T00:00:00.000Z"), anger: 80, energy: 10 };
  const decayed = decayEmotionalState(initial, new Date("2026-01-01T06:00:00.000Z"));
  assert.ok(decayed.anger < initial.anger);
  assert.ok(decayed.energy > initial.energy);
});
