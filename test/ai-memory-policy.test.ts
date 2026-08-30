import assert from "node:assert/strict";
import test from "node:test";
import { decideMemoryPersistence, planMemoryCleanup, validateMemoryCandidate } from "../src/modules/ai/memory-policy.js";
import type { PrismaMemory } from "../src/modules/ai/store.js";

function memory(content: string, overrides: Partial<PrismaMemory> = {}): PrismaMemory {
  return { userId: "u1", memoryType: "interest", content, importance: 60, confidence: 80, ...overrides };
}

test("descarta memória vaga que não faz sentido sozinha", () => {
  assert.equal(validateMemoryCandidate(memory("Joca gosta dela.")).valid, false);
  assert.equal(decideMemoryPersistence(memory("Gosta disso."), []).action, "DISCARD");
});

test("descarta atividade temporária sem inferir preferência", () => {
  const decision = decideMemoryPersistence(memory("Joca estava ouvindo we can't be friends agora."), []);
  assert.equal(decision.action, "DISCARD");
});

test("aceita preferência explícita, autossuficiente e contextualizada", () => {
  const decision = decideMemoryPersistence(memory("Joca ama jogar de Sombra em Overwatch."), []);
  assert.equal(decision.action, "SAVE");
});

test("detecta redundância semântica mesmo com textos diferentes", () => {
  const existing = memory("Joca gosta de jogar de Sombra em Overwatch.", { id: 1, memoryKey: "game:sombra-overwatch" });
  const decision = decideMemoryPersistence(memory("Joca ama jogar de Sombra em Overwatch."), [existing]);
  assert.equal(decision.action, "MERGE");
  assert.equal(decision.candidate?.memoryKey, existing.memoryKey);
});

test("atualiza contradição da mesma entidade em vez de manter duas verdades", () => {
  const existing = memory("Joca não gosta de Valorant.", { id: 1, memoryKey: "preference:valorant" });
  const candidate = memory("O jogo favorito de Joca é Valorant.", { memoryKey: "preference:valorant", importance: 80, confidence: 90 });
  const decision = decideMemoryPersistence(candidate, [existing]);
  assert.equal(decision.action, "UPDATE");
  assert.equal(decision.candidate?.content, candidate.content);
});

test("limpeza remove vagas e consolida duplicatas sem apagar memória isolada útil", () => {
  const decisions = planMemoryCleanup([
    memory("Gosta dela.", { id: 1 }),
    memory("Joca gosta de jogar de Sombra em Overwatch.", { id: 2, memoryKey: "game:sombra" }),
    memory("Joca ama jogar de Sombra em Overwatch.", { id: 3, memoryKey: "game:sombra" }),
    memory("Joca gosta de Sabrina Carpenter.", { id: 4, memoryKey: "artist:sabrina" }),
  ]);
  assert.equal(decisions.find((item) => item.memoryIds.includes(1))?.action, "DELETE");
  assert.equal(decisions.find((item) => item.memoryIds.includes(2))?.action, "MERGE");
  assert.equal(decisions.find((item) => item.memoryIds.includes(4))?.action, "KEEP");
});

test("não confunde preferência por artista com preferência por uma música específica", () => {
  const artist = memory("Joca gosta de Sabrina Carpenter.", { id: 1, memoryKey: "artist:sabrina" });
  const song = memory("Joca gosta especialmente da música Tears, de Sabrina Carpenter.", { id: 2, memoryKey: "song:tears" });
  assert.equal(decideMemoryPersistence(song, [artist]).action, "SAVE");
  assert.deepEqual(planMemoryCleanup([artist, song]).map((item) => item.action), ["KEEP", "KEEP"]);
});
