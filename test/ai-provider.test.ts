import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeOutput } from "../src/modules/ai/provider.js";

test("preserva somente menções de usuários autorizados", () => {
  const output = sanitizeOutput("Oi <@123>, chama <@!456> e <@789>.", ["123", "456"]);

  assert.equal(output, "Oi <@123>, chama <@!456> e [menção removida].");
});

test("continua bloqueando menções amplas, cargos e canais", () => {
  const output = sanitizeOutput("@everyone @here <@&123> <#456>", ["123", "456"]);

  assert.equal(output, "[menção removida] [menção removida] [menção removida] [menção removida]");
});
