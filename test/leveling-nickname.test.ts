import assert from "node:assert/strict";
import test from "node:test";
import { removeLevelRewardEmoji } from "../src/modules/leveling/index.js";
import type { LevelReward } from "../src/modules/leveling/store.js";

const reward = (level: number, emoji: string): LevelReward => ({
  guildId: "guild",
  level,
  roleId: `role-${level}`,
  emoji,
  title: "Marco",
  shortMessage: "Conquista",
});

test("remove o sufixo de level dos apelidos existentes", () => {
  const rewards = [reward(10, "🧊"), reward(20, "🌙")];
  assert.equal(removeLevelRewardEmoji("Joaquim ・🌙", rewards), "Joaquim");
  assert.equal(removeLevelRewardEmoji("Joaquim 🌙", rewards), "Joaquim 🌙");
});
