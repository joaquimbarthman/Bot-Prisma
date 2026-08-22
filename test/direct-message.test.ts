import assert from "node:assert/strict";
import test from "node:test";
import { DirectMessageRotation, PRISMA_SERVER_INVITE, directMessageTemplates } from "../src/modules/direct-message/index.js";

test("usa todas as variações antes de repetir no privado", () => {
  const rotation = new DirectMessageRotation(() => 0.5);
  const messages = Array.from({ length: directMessageTemplates.length }, () => rotation.next("u1"));
  assert.equal(new Set(messages).size, directMessageTemplates.length);
  assert.ok(messages.every((message) => message.includes(PRISMA_SERVER_INVITE)));
  assert.ok(messages.every((message) => !message.includes("[Link]")));
});

test("não repete na virada da rotação e separa usuários", () => {
  const rotation = new DirectMessageRotation(() => 0.25);
  const firstCycle = Array.from({ length: directMessageTemplates.length }, () => rotation.next("u1"));
  const nextCycleMessage = rotation.next("u1");
  assert.notEqual(nextCycleMessage, firstCycle.at(-1));
  assert.equal(rotation.next("u2"), firstCycle[0]);
});
