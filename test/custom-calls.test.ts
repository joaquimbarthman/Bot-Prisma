import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomCallName, parseCustomCallEmoji } from "../src/modules/custom-calls/index.js";

test("gera o mesmo nome em letras minúsculas para canal e cargo", () => {
  assert.equal(buildCustomCallName("DscJoaquim"), "💦・call dscjoaquim");
});

test("remove quebras de linha e respeita o limite de nome do Discord", () => {
  const name = buildCustomCallName(`usuario\n${"x".repeat(120)}`);
  assert.equal(name.includes("\n"), false);
  assert.ok(name.length <= 100);
});

test("aplica um emoji escolhido ao canal e ao cargo", () => {
  assert.equal(buildCustomCallName("DscJoaquim", "🌸"), "🌸・call dscjoaquim");
});

test("aceita um único emoji Unicode e recusa texto ou emoji do servidor", () => {
  assert.equal(parseCustomCallEmoji(" 🫧 "), "🫧");
  assert.equal(parseCustomCallEmoji("👩‍💻"), "👩‍💻");
  assert.equal(parseCustomCallEmoji("🌸🌼"), null);
  assert.equal(parseCustomCallEmoji("flor"), null);
  assert.equal(parseCustomCallEmoji("<:flor:123456789012345678>"), null);
});
