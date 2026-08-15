import assert from "node:assert/strict";
import test from "node:test";
import type { GuildMember } from "discord.js";
import { config } from "../src/config.js";
import { accessLevel, hasPersonalityAccess } from "../src/modules/ai/permissions.js";

function member(roleIds: string[], premiumSinceTimestamp: number | null): GuildMember {
  return { roles: { cache: { has: (id: string) => roleIds.includes(id) } }, premiumSinceTimestamp } as unknown as GuildMember;
}

test("membro comum não acessa a IA", () => {
  assert.equal(accessLevel(member([], null)), "none");
});

test("booster acessa a IA", () => {
  assert.equal(accessLevel(member([], Date.now())), "booster");
});

test("cargo Booster configurado acessa a IA", () => {
  assert.equal(accessLevel(member(["1538022012591538176"], null)), "booster");
});

test("Amigos do Chefe tem prioridade sobre Booster", () => {
  const original = config.prismaAi.friendsRoleId;
  config.prismaAi.friendsRoleId = "cargo-amigo";
  try { assert.equal(accessLevel(member(["cargo-amigo"], Date.now())), "friend"); }
  finally { config.prismaAi.friendsRoleId = original; }
});

test("personalidade exige o cargo Prisma AI", () => {
  assert.equal(hasPersonalityAccess(member(["1538257302606319716"], null)), true);
  assert.equal(hasPersonalityAccess(member(["1538253635392376862"], null)), false);
});
