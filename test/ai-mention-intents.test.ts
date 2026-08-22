import assert from "node:assert/strict";
import test from "node:test";
import { explicitlyRequestedMentionUserIds } from "../src/modules/ai/index.js";

test("autoriza menção ao pedir para puxar assunto com alguém", () => {
  assert.deepEqual(explicitlyRequestedMentionUserIds("prisma puxa um assunto ai com o <@300>", ["300"], "100", "200"), ["300"]);
});

test("autoriza saudações e conversa dirigidas a alguém", () => {
  assert.deepEqual(explicitlyRequestedMentionUserIds("cumprimenta <@300>", ["300"], "100", "200"), ["300"]);
  assert.deepEqual(explicitlyRequestedMentionUserIds("conversa com <@300>", ["300"], "100", "200"), ["300"]);
  assert.deepEqual(explicitlyRequestedMentionUserIds("dá um bom dia para <@300>", ["300"], "100", "200"), ["300"]);
});

test("autoriza menção ao pedir opinião sobre o que alguém falou", () => {
  assert.deepEqual(explicitlyRequestedMentionUserIds("oq vc acha desse assunto que o <@300> falou?", ["300"], "100", "200"), ["300"]);
  assert.deepEqual(explicitlyRequestedMentionUserIds("vc concorda com a ideia que <@300> comentou?", ["300"], "100", "200"), ["300"]);
});

test("não menciona alguém que foi apenas citado", () => {
  assert.deepEqual(explicitlyRequestedMentionUserIds("ontem eu conversei com <@300> sobre jogos", ["300"], "100", "200"), []);
});
