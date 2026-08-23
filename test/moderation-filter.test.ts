import assert from "node:assert/strict";
import test from "node:test";
import { compactNormalizedText, localModeration, normalizeText } from "../src/modules/moderation/filter.js";
import { trustForWarnings } from "../src/modules/moderation/state.js";

test("normaliza acentos, leetspeak, repetições e separadores", () => {
  assert.equal(normalizeText("BUUU-C3T@@"), "bu ceta");
  assert.equal(compactNormalizedText("b . u _ c - e / t a"), "buceta");
});

test("bloqueia abreviações e variações evasivas", () => {
  for (const content of ["bct", "buceta", "xeraca", "xereca", "b.u.c.e.t.a", "b u c e t a", "buuuceeetaaa"]) {
    assert.equal(localModeration(content).flagged, true, content);
  }
});

test("não transforma palavra maior em abreviação bloqueada", () => {
  assert.equal(localModeration("depois a gente conversa").flagged, false);
});

test("calcula confiança por blocos de três avisos", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 9].map(trustForWarnings), [100, 100, 100, 50, 50, 0, 0]);
});
