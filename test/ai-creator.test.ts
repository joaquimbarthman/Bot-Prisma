import assert from "node:assert/strict";
import test from "node:test";
import { asksAboutPrismaCreator } from "../src/modules/ai/creator.js";
import { buildRuntimePrompt } from "../src/modules/ai/provider.js";

test("reconhece perguntas públicas sobre quem criou a Prisma", () => {
  assert.equal(asksAboutPrismaCreator("quem eh seu dono?"), true);
  assert.equal(asksAboutPrismaCreator("o criador da Prisma falou isso?"), true);
  assert.equal(asksAboutPrismaCreator("quem te criou?"), true);
  assert.equal(asksAboutPrismaCreator("quem eh o criador desse jogo?"), false);
});

test("não existe mais modo criador ou diagnóstico administrativo no prompt", () => {
  const prompt = buildRuntimePrompt({ creatorIdentity: { id: "123", username: "Joca" } });
  assert.doesNotMatch(prompt, /# MODO CRIADOR|creator_runtime_diagnostics|ferramentas administrativas reais/i);
  assert.match(prompt, /não concede permissão especial/i);
});
