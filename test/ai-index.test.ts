import assert from "node:assert/strict";
import test from "node:test";
import { explicitlyRequestedMentionUserIds, trustedMentionCandidates, trustedMentionUserIdsFromContext } from "../src/modules/ai/index.js";

test("autoriza alvo mencionado explicitamente sem depender da menção ao autor", () => {
  const ids = explicitlyRequestedMentionUserIds(
    "Prisma, manda uma mensagem legal para <@300>",
    ["100", "200", "300"],
    "100",
    "200",
  );
  assert.deepEqual(ids, ["300"]);
});

test("autoriza usuário mencionado na mensagem atual mesmo sem verbo específico", () => {
  assert.deepEqual(explicitlyRequestedMentionUserIds("Prisma pergunte qual o jogo favorito de <@300>", ["300"], "100", "200"), ["300"]);
});

test("extrai o alvo do texto bruto quando a coleção do Discord está incompleta", () => {
  assert.deepEqual(
    explicitlyRequestedMentionUserIds("Diga oi para <@!300>", [], "100", "200"),
    ["300"],
  );
});

test("autoriza menção no pedido informal de dar oi a um novo membro", () => {
  assert.deepEqual(
    explicitlyRequestedMentionUserIds(
      "Prisma de oi pro <@300> novo membro do servidor",
      ["300"],
      "100",
      "200",
    ),
    ["300"],
  );
});

test("descobre usuários confiáveis na mensagem, no reply e no contexto recente", () => {
  const excerpt = "ASSUNTO 1\n[autor_id=300] Pedro: eu topo jogar\n[autor_id=400] Ana: eu tbm";
  assert.deepEqual(trustedMentionUserIdsFromContext(excerpt), ["300", "400"]);
  assert.deepEqual(trustedMentionCandidates(["500"], excerpt, "600", "100", "200"), ["500", "300", "400", "600"]);
});
