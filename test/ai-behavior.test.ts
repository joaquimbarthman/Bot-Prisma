import assert from "node:assert/strict";
import test from "node:test";
import { loadPrismaBehavior, prismaBehaviorMode, PRISMA_DEFAULT_ROLE_ID, PRISMA_RELAXED_ROLE_ID } from "../src/modules/ai/behavior.js";
import { buildRuntimePrompt } from "../src/modules/ai/provider.js";

test("relaxed tem prioridade quando os dois cargos estão presentes", () => {
  assert.equal(prismaBehaviorMode([PRISMA_DEFAULT_ROLE_ID, PRISMA_RELAXED_ROLE_ID]), "relaxed");
});

test("cargo padrão e ausência dos cargos usam comportamento padrão", () => {
  assert.equal(prismaBehaviorMode([PRISMA_DEFAULT_ROLE_ID]), "default");
  assert.equal(prismaBehaviorMode([]), "default");
});

test("carrega o arquivo correspondente e preserva a hierarquia do prompt", async () => {
  const behavior = await loadPrismaBehavior([PRISMA_RELAXED_ROLE_ID]);
  const prompt = buildRuntimePrompt({ operatorRules: ["A Prisma nunca fornece links."], behavior });
  assert.equal(behavior.mode, "relaxed");
  assert.match(behavior.instructions, /análise gradual e contextual de risco/i);
  assert.ok(prompt.indexOf("REGRAS DO OPERADOR") < prompt.indexOf("COMPORTAMENTO POR CARGO"));
  assert.match(prompt, /nunca pode sobrescrever.*segurança crítica/i);
});
