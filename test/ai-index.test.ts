import assert from "node:assert/strict";
import test from "node:test";
import { explicitlyRequestedMentionUserIds } from "../src/modules/ai/index.js";

test("autoriza alvo mencionado explicitamente sem depender da menção ao autor", () => {
  const ids = explicitlyRequestedMentionUserIds(
    "Prisma, manda uma mensagem legal para <@300>",
    ["100", "200", "300"],
    "100",
    "200",
  );
  assert.deepEqual(ids, ["300"]);
});

test("não autoriza menções apenas citadas sem pedido direto", () => {
  assert.deepEqual(explicitlyRequestedMentionUserIds("Eu falei com <@300>", ["300"], "100", "200"), []);
});
