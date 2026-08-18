import assert from "node:assert/strict";
import test from "node:test";
import { bumpReminderContent } from "../src/modules/bump-reminder/index.js";

test("lembrete menciona somente o cargo informado e orienta o bump manual", () => {
  const content = bumpReminderContent("1538337494355935302");
  assert.equal(content, "<@&1538337494355935302> Já está na hora de usar o /bump neste canal.");
  assert.doesNotMatch(content, /@everyone|@here/);
});
