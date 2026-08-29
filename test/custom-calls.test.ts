import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomCallName } from "../src/modules/custom-calls/index.js";

test("gera o mesmo nome padronizado para canal e cargo", () => {
  assert.equal(buildCustomCallName("dscjoaquim"), "💦 • Call dscjoaquim");
});

test("remove quebras de linha e respeita o limite de nome do Discord", () => {
  const name = buildCustomCallName(`usuario\n${"x".repeat(120)}`);
  assert.equal(name.includes("\n"), false);
  assert.ok(name.length <= 100);
});
