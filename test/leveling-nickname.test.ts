import assert from "node:assert/strict";
import test from "node:test";
import { levelRewardNickname, removeLevelRewardEmoji } from "../src/modules/leveling/index.js";
import type { LevelReward } from "../src/modules/leveling/store.js";

const reward = (level: number, emoji: string): LevelReward => ({
  guildId: "guild",
  level,
  roleId: `role-${level}`,
  emoji,
  title: "Marco",
  shortMessage: "Conquista",
});

test("adiciona o emoji do level ao apelido", () => {
  assert.equal(levelRewardNickname("Joaquim", [reward(10, "🧊")], "🧊"), "Joaquim ・🧊");
});

test("troca o emoji do marco anterior sem acumular sufixos", () => {
  const rewards = [reward(10, "🧊"), reward(20, "🌙")];
  assert.equal(levelRewardNickname("Joaquim ・🧊", rewards, "🌙"), "Joaquim ・🌙");
});

test("respeita o limite de 32 caracteres do apelido do Discord", () => {
  const nickname = levelRewardNickname("Um nome de usuario extremamente comprido", [reward(100, "🫧")], "🫧");
  assert.ok([...nickname].length <= 32);
  assert.ok(nickname.endsWith(" ・🫧"));
});

test("remove somente o sufixo de emoji correspondente a um level", () => {
  const rewards = [reward(10, "🧊"), reward(20, "🌙")];
  assert.equal(removeLevelRewardEmoji("Joaquim ・🌙", rewards), "Joaquim");
  assert.equal(removeLevelRewardEmoji("Joaquim 🌙", rewards), "Joaquim 🌙");
});
