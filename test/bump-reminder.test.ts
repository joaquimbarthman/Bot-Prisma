import assert from "node:assert/strict";
import test from "node:test";
import { bumpReminderContent, isBumpMessage } from "../src/modules/bump-reminder/index.js";

test("lembrete menciona somente o cargo informado e orienta o bump manual", () => {
  const content = bumpReminderContent("1538337494355935302");
  assert.equal(content, "<@&1538337494355935302> Já está na hora de usar o /bump neste canal.");
  assert.doesNotMatch(content, /@everyone|@here/);
});

test("reconhece o comando e a confirmação de bump", () => {
  assert.ok(isBumpMessage({ content: "/bump", createdTimestamp: 0, author: { id: "1", bot: false }, embeds: [] }));
  assert.ok(isBumpMessage({ content: "", createdTimestamp: 0, author: { id: "302050872383242240", bot: true }, embeds: [{ description: "Bump done!" }] }));
  assert.ok(!isBumpMessage({ content: "Já está na hora de usar o /bump", createdTimestamp: 0, author: { id: "1", bot: true }, embeds: [] }));
});
