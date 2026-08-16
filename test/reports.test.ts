import assert from "node:assert/strict";
import test from "node:test";
import { reportChannelName } from "../src/modules/reports/index.js";

test("gera nome seguro para o canal de denúncia", () => {
  assert.equal(reportChannelName("João da Silva!"), "denuncia-joao-da-silva");
});

test("usa nome alternativo quando o apelido não tem caracteres válidos", () => {
  assert.equal(reportChannelName("✨✨"), "denuncia-usuario");
});
