import assert from "node:assert/strict";
import test from "node:test";
import { calculateLevel, calculateXpAward, getTotalXpRequired, getXpRequiredForLevel } from "../src/modules/leveling/progression.js";

test("calcula XP progressivo sem tabela fixa", () => {
  assert.equal(getXpRequiredForLevel(1), 32);
  assert.equal(getXpRequiredForLevel(10), 118);
  assert.equal(getXpRequiredForLevel(100), 5_428);
  assert.equal(getTotalXpRequired(10), 690);
  assert.equal(getTotalXpRequired(100), 192_150);
});

test("calcula limites de nivel e respeita o nivel maximo", () => {
  assert.equal(calculateLevel(0), 0);
  assert.equal(calculateLevel(31), 0);
  assert.equal(calculateLevel(32), 1);
  assert.equal(calculateLevel(689), 9);
  assert.equal(calculateLevel(690), 10);
  assert.equal(calculateLevel(999_999), 100);
});

test("rejeita entradas invalidas", () => {
  assert.throws(() => getXpRequiredForLevel(0), RangeError);
  assert.throws(() => getTotalXpRequired(-1), RangeError);
  assert.throws(() => calculateLevel(-1), RangeError);
  assert.throws(() => calculateXpAward(1, -1, 2), RangeError);
});

test("soma XP global, da atividade e do Booster", () => {
  assert.equal(calculateXpAward(1, 1), 2);
  assert.equal(calculateXpAward(1, 1, 2), 4);
});
