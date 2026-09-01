import assert from "node:assert/strict";
import test from "node:test";
import type { GuildMember } from "discord.js";
import { config } from "../src/config.js";
import { accessLevel, shouldGrantAccessRole } from "../src/modules/ai/permissions.js";

function member(roleIds: string[], premiumSinceTimestamp: number | null): GuildMember {
  return { roles: { cache: { has: (id: string) => roleIds.includes(id) } }, premiumSinceTimestamp } as unknown as GuildMember;
}

test("somente o cargo único configurado libera a Prisma IA", () => {
  const original = config.prismaAi.accessRoleId;
  config.prismaAi.accessRoleId = "cargo-prisma";
  try {
    assert.equal(accessLevel(member([], null)), "none");
    assert.equal(accessLevel(member([], Date.now())), "none", "Booster sem o cargo ainda não interage");
    assert.equal(accessLevel(member(["cargo-antigo"], null)), "none");
    assert.equal(accessLevel(member(["cargo-prisma"], null)), "member");
  } finally {
    config.prismaAi.accessRoleId = original;
  }
});

test("Booster sem o cargo entra na fila de concessão automática", () => {
  const original = config.prismaAi.accessRoleId;
  config.prismaAi.accessRoleId = "cargo-prisma";
  try {
    assert.equal(shouldGrantAccessRole(member([], Date.now())), true);
    assert.equal(shouldGrantAccessRole(member(["cargo-prisma"], Date.now())), false);
    assert.equal(shouldGrantAccessRole(member([], null)), false);
  } finally {
    config.prismaAi.accessRoleId = original;
  }
});
