import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Collection, Guild, GuildMember, Snowflake } from "discord.js";
import { config } from "../../config.js";

type GrantState = Record<string, string[]>;

const stateFile = path.resolve(config.dataDir, "paired-role-grants.json");
let state: GrantState = loadState();
let writeQueue = Promise.resolve();
const processing = new Set<string>();

function loadState(): GrantState {
  try {
    const parsed = JSON.parse(readFileSync(stateFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([guildId, ids]) => [
      guildId,
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
    ]));
  } catch {
    return {};
  }
}

function saveState(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(stateFile), { recursive: true });
    const temporary = `${stateFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, stateFile);
  });
  return writeQueue;
}

function wasProcessed(member: GuildMember): boolean {
  return state[member.guild.id]?.includes(member.id) ?? false;
}

function isEligible(member: GuildMember): boolean {
  return !member.user.bot
    && config.pairedRoleGrant.requiredRoleIds.some((roleId) => member.roles.cache.has(roleId));
}

async function remember(member: GuildMember): Promise<void> {
  const members = state[member.guild.id] ?? [];
  if (members.includes(member.id)) return;
  state = { ...state, [member.guild.id]: [...members, member.id] };
  await saveState();
}

export async function grantPairedRoleOnce(member: GuildMember): Promise<boolean> {
  const memberKey = `${member.guild.id}:${member.id}`;
  if (!isEligible(member) || wasProcessed(member) || processing.has(memberKey)) return false;
  processing.add(memberKey);

  try {
    const targetRole = member.guild.roles.cache.get(config.pairedRoleGrant.targetRoleId)
      ?? await member.guild.roles.fetch(config.pairedRoleGrant.targetRoleId).catch(() => null);
    if (!targetRole) throw new Error(`Cargo de destino ${config.pairedRoleGrant.targetRoleId} não encontrado.`);

    // Registre também quem já possui o cargo, respeitando uma remoção manual futura.
    if (!member.roles.cache.has(targetRole.id)) {
      await member.roles.add(targetRole, "Concessão única por possuir um dos cargos necessários");
    }
    await remember(member);
    return true;
  } finally {
    processing.delete(memberKey);
  }
}

export async function syncPairedRoleGrants(
  guild: Guild,
  members?: Collection<Snowflake, GuildMember>,
): Promise<number> {
  await guild.roles.fetch();
  members ??= await guild.members.fetch();
  let processed = 0;
  for (const member of members.values()) {
    if (await grantPairedRoleOnce(member)) processed += 1;
  }
  return processed;
}
