import assert from "node:assert/strict";
import test from "node:test";
import { LFG_GAMES } from "../src/modules/lfg/config.js";
import { isLfgGameKey, lfgGameRoleMention } from "../src/modules/lfg/index.js";

test("isLfgGameKey aceita somente jogos configurados", () => {
  assert.equal(isLfgGameKey("fortnite"), true);
  assert.equal(isLfgGameKey("genshin_impact"), true);
  assert.equal(isLfgGameKey("jogo-removido"), false);
  assert.equal(isLfgGameKey(undefined), false);
});

test("monta a menção do cargo correspondente ao jogo", () => {
  assert.equal(lfgGameRoleMention("fortnite"), `<@&${LFG_GAMES.fortnite.roleId}>`);
  assert.equal(lfgGameRoleMention("genshin_impact"), `<@&${LFG_GAMES.genshin_impact.roleId}>`);
});
