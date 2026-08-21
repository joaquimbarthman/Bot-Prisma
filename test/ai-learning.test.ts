import assert from "node:assert/strict";
import test from "node:test";
import { emotionalUpdateFromMessage } from "../src/modules/ai/learning.js";

test("reconhece gatilhos emocionais sem inferir diagnóstico", () => {
  assert.deepEqual(emotionalUpdateFromMessage("obrigada, você me ajudou muito"), { happiness: 58, affection: 42, confidence: 54 });
  assert.deepEqual(emotionalUpdateFromMessage("aff, deu errado de novo"), { irritation: 35, energy: 42 });
  assert.deepEqual(emotionalUpdateFromMessage("tô triste e desanimado"), { sadness: 48, energy: 42, affection: 40 });
  assert.deepEqual(emotionalUpdateFromMessage("cala a boca, que lixo"), { irritation: 50, anger: 35 });
});
