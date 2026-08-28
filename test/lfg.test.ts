import assert from "node:assert/strict";
import test from "node:test";
import { isLfgGameKey, lfgVoiceChannelName } from "../src/modules/lfg/index.js";

test("isLfgGameKey aceita somente jogos configurados", () => {
  assert.equal(isLfgGameKey("fortnite"), true);
  assert.equal(isLfgGameKey("genshin_impact"), true);
  assert.equal(isLfgGameKey("jogo-removido"), false);
  assert.equal(isLfgGameKey(undefined), false);
});

test("nomeia o canal e o cargo do lobby sem hífen após lobby", () => {
  assert.equal(lfgVoiceChannelName("dscjoaquim"), "🕹️・lobby dscjoaquim");
});
