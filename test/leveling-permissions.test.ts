import assert from "node:assert/strict";
import test from "node:test";
import { PermissionFlagsBits } from "discord.js";
import { levelChannelBenefits, levelChannelPermissionUpdate, levelRoleBenefits } from "../src/modules/leveling/permissions.js";

test("beneficios de canal sao cumulativos entre os marcos", () => {
  assert.deepEqual(levelChannelBenefits(1), [PermissionFlagsBits.SendMessages]);
  assert.ok(levelChannelBenefits(10).includes(PermissionFlagsBits.AttachFiles));
  assert.ok(levelChannelBenefits(10).includes(PermissionFlagsBits.EmbedLinks));
  assert.ok(levelChannelBenefits(20).includes(PermissionFlagsBits.Stream));
  assert.ok(levelChannelBenefits(35).includes(PermissionFlagsBits.EmbedLinks));
  assert.ok(levelChannelBenefits(60).includes(PermissionFlagsBits.UseExternalStickers));
  assert.ok(levelChannelBenefits(75).includes(PermissionFlagsBits.PrioritySpeaker));
  assert.ok(levelChannelBenefits(90).includes(PermissionFlagsBits.MoveMembers));
  assert.ok(levelChannelBenefits(100).includes(PermissionFlagsBits.MuteMembers));
  assert.equal(levelChannelBenefits(50).length, levelChannelBenefits(35).length);
});

test("alterar o proprio apelido e liberado a partir do nivel 10", () => {
  assert.deepEqual(levelRoleBenefits(9), []);
  assert.deepEqual(levelRoleBenefits(10), [PermissionFlagsBits.ChangeNickname]);
  assert.deepEqual(levelRoleBenefits(100), [PermissionFlagsBits.ChangeNickname]);
});

test("enviar mensagens pelo cargo de nivel e liberado somente no chat das calls", () => {
  assert.equal(levelChannelPermissionUpdate(1, true).SendMessages, true);
  assert.equal(levelChannelPermissionUpdate(1, false).SendMessages, null);
  assert.equal(levelChannelPermissionUpdate(10, false).AttachFiles, true);
  assert.equal(levelChannelPermissionUpdate(10, false).EmbedLinks, true);
});
