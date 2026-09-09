import assert from "node:assert/strict";
import test from "node:test";
import type { GuildMember } from "discord.js";
import { config } from "../src/config.js";
import { accessLevel, canChatWithPrisma, isPrismaWeekend, shouldGrantAccessRole } from "../src/modules/ai/permissions.js";

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

test("todos podem conversar com a Prisma aos sábados e domingos no fuso configurado", () => {
  const originalRole = config.prismaAi.accessRoleId;
  const originalTimezone = config.prismaAi.timezone;
  config.prismaAi.accessRoleId = "cargo-prisma";
  config.prismaAi.timezone = "America/Sao_Paulo";
  try {
    const friday = new Date("2026-09-12T02:59:59.000Z");
    const saturday = new Date("2026-09-12T03:00:00.000Z");
    const sunday = new Date("2026-09-13T15:00:00.000Z");
    const monday = new Date("2026-09-14T03:00:00.000Z");

    assert.equal(isPrismaWeekend(friday), false);
    assert.equal(isPrismaWeekend(saturday), true);
    assert.equal(isPrismaWeekend(sunday), true);
    assert.equal(isPrismaWeekend(monday), false);
    assert.equal(canChatWithPrisma(member([], null), saturday), true);
    assert.equal(canChatWithPrisma(member([], null), sunday), true);
    assert.equal(canChatWithPrisma(member([], null), friday), false);
    assert.equal(canChatWithPrisma(member(["cargo-prisma"], null), monday), true);
  } finally {
    config.prismaAi.accessRoleId = originalRole;
    config.prismaAi.timezone = originalTimezone;
  }
});

test("o acesso por cargo permanece separado da liberação de fim de semana", () => {
  const original = config.prismaAi.accessRoleId;
  config.prismaAi.accessRoleId = "cargo-prisma";
  try {
    assert.equal(accessLevel(member([], null)), "none");
    assert.equal(accessLevel(member(["cargo-prisma"], null)), "member");
  } finally {
    config.prismaAi.accessRoleId = original;
  }
});
