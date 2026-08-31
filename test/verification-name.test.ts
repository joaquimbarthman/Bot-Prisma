import assert from "node:assert/strict";
import test from "node:test";
import { isValidFullName } from "../src/modules/verification/index.js";

test("aceita nomes completos comuns", () => {
  assert.equal(isValidFullName("João da Silva"), true);
  assert.equal(isValidFullName("maria eduarda souza"), true);
  assert.equal(isValidFullName("Ana Beatriz D'Ávila"), true);
  assert.equal(isValidFullName("Jean-Luc Picard"), true);
});

test("rejeita mensagens comuns no lugar do nome", () => {
  assert.equal(isValidFullName("oi tudo bem com você"), false);
  assert.equal(isValidFullName("meu nome é João Silva"), false);
  assert.equal(isValidFullName("quero falar com a staff"), false);
  assert.equal(isValidFullName("bom dia"), false);
  assert.equal(isValidFullName("qual seu nome"), false);
});

test("rejeita dados que não têm estrutura de nome completo", () => {
  assert.equal(isValidFullName("João"), false);
  assert.equal(isValidFullName("31/08/2000"), false);
  assert.equal(isValidFullName("João Silva!"), false);
  assert.equal(isValidFullName("123456"), false);
  assert.equal(isValidFullName("a b"), false);
});
