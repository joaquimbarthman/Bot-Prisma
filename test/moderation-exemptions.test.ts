import assert from "node:assert/strict";
import test from "node:test";
import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import { config } from "../src/config.js";
import { hasCensorshipBypassRole } from "../src/modules/moderation/exemptions.js";

test("cargo configurado ignora os filtros de censura", () => {
  const previous = config.censorshipBypassRoleId;
  config.censorshipBypassRoleId = "1538337494355935302";
  try {
    const cachedMember = { roles: { cache: { has: (id: string) => id === config.censorshipBypassRoleId } } } as unknown as GuildMember;
    const apiMember = { roles: ["1538337494355935302"] } as APIInteractionGuildMember;
    const regularMember = { roles: ["outro-cargo"] } as APIInteractionGuildMember;
    assert.equal(hasCensorshipBypassRole(cachedMember), true);
    assert.equal(hasCensorshipBypassRole(apiMember), true);
    assert.equal(hasCensorshipBypassRole(regularMember), false);
  } finally {
    config.censorshipBypassRoleId = previous;
  }
});
