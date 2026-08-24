import assert from "node:assert/strict";
import test from "node:test";
import * as adminTools from "../src/modules/ai/admin-tools.js";
import { PRISMA_CREATOR_ID } from "../src/config.js";

test("roteia pedidos reais do criador para ferramentas fechadas", () => {
  assert.equal(adminTools.detectCreatorAdminIntent("prisma roda seus testes")?.intent, "run_tests");
  assert.equal(adminTools.detectCreatorAdminIntent("roda tudo pra ver se ta funcionando")?.intent, "run_all");
  assert.equal(adminTools.detectCreatorAdminIntent("abre src/modules/ai/lyrics.ts")?.intent, "read_file");
  assert.equal(adminTools.detectCreatorAdminIntent("mostra seus logs de erro")?.intent, "logs");
  assert.equal(adminTools.detectCreatorAdminIntent("oi prisma"), null);
});

test("usuário comum não consegue executar nem ler ferramenta administrativa", async () => {
  await assert.rejects(adminTools.readProjectFile("999", "src/modules/ai/lyrics.ts"), /indisponível/);
  await assert.rejects(adminTools.runTests("999"), /indisponível/);
});

test("criador lê arquivo permitido dentro do projeto", async () => {
  const output = await adminTools.readProjectFile(PRISMA_CREATOR_ID, "src/modules/ai/lyrics.ts");
  assert.equal(output.success, true);
  assert.match(JSON.stringify(output.data), /researchLyrics/);
});

test("path traversal, env, chaves e diretórios internos são bloqueados", async () => {
  for (const target of ["../../.env", ".env", ".env.example", "server.pem", ".git/config", "node_modules/x/package.json"]) {
    const output = await adminTools.readProjectFile(PRISMA_CREATOR_ID, target);
    assert.equal(output.success, false, target);
  }
});

test("busca código sem acessar diretórios ou extensões proibidas", async () => {
  const output = await adminTools.searchProjectFiles(PRISMA_CREATOR_ID, "researchLyrics");
  assert.equal(output.success, true);
  assert.match(JSON.stringify(output.data), /lyrics\.ts/);
  assert.doesNotMatch(JSON.stringify(output.data), /node_modules|\.git\//);
});

test("script inexistente é informado sem inventar comando", async () => {
  const output = await adminTools.runLint(PRISMA_CREATOR_ID);
  assert.equal(output.success, false);
  assert.match(JSON.stringify(output.data), /não configurado/);
});

test("sanitiza secrets em logs e resultados administrativos", () => {
  assert.equal(adminTools.sanitizeSecrets("OPENAI_API_KEY=sk-abcdefghijklmnop Bearer abcdefghijklmnop"), "OPENAI_API_KEY=[REDACTED] Bearer [REDACTED]");
});

test("captura logs novos em tempo real com nível e limite", () => {
  adminTools.installCreatorLogCapture();
  console.warn("[teste] aviso administrativo seguro");
  const output = adminTools.getRecentLogs(PRISMA_CREATOR_ID, "warn", 1);
  assert.match(JSON.stringify(output.data), /aviso administrativo seguro/);
});

test("não expõe terminal genérico nem ações destrutivas", () => {
  const exports = Object.keys(adminTools).join(" ");
  assert.doesNotMatch(exports, /executeShell|runShell|executeCommand|resetGit|gitPush|deleteFile/i);
});
