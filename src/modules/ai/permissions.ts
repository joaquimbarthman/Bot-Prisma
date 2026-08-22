import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Collection, Guild, GuildMember, Snowflake } from "discord.js";
import { config } from "../../config.js";

export type AccessLevel = "none" | "member";

type BoosterGrantState = Record<string, string[]>;

const boosterGrantStateFile = path.resolve(config.dataDir, "booster-access-grants.json");
let boosterGrantState = loadBoosterGrantState();
let boosterGrantWriteQueue = Promise.resolve();
const boosterGrantsInProgress = new Set<string>();

function loadBoosterGrantState(): BoosterGrantState {
  try {
    const parsed = JSON.parse(readFileSync(boosterGrantStateFile, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([guildId, ids]) => [
      guildId,
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
    ]));
  } catch {
    return {};
  }
}

function saveBoosterGrantState(): Promise<void> {
  boosterGrantWriteQueue = boosterGrantWriteQueue.then(async () => {
    await mkdir(path.dirname(boosterGrantStateFile), { recursive: true });
    const temporary = `${boosterGrantStateFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(boosterGrantState, null, 2)}\n`, "utf8");
    await rename(temporary, boosterGrantStateFile);
  });
  return boosterGrantWriteQueue;
}

function alreadyReceivedBoosterAccess(member: GuildMember): boolean {
  return boosterGrantState[member.guild.id]?.includes(member.id) ?? false;
}

async function rememberBoosterAccess(member: GuildMember): Promise<void> {
  const members = boosterGrantState[member.guild.id] ?? [];
  if (members.includes(member.id)) return;
  boosterGrantState = { ...boosterGrantState, [member.guild.id]: [...members, member.id] };
  await saveBoosterGrantState();
}

export function accessLevel(member: GuildMember): AccessLevel {
  return member.roles.cache.has(config.prismaAi.accessRoleId) ? "member" : "none";
}

export function shouldGrantAccessRole(member: GuildMember): boolean {
  return member.premiumSinceTimestamp !== null && !member.roles.cache.has(config.prismaAi.accessRoleId);
}

export async function grantAccessRoleToBooster(member: GuildMember): Promise<boolean> {
  if (member.premiumSinceTimestamp === null || alreadyReceivedBoosterAccess(member)) return false;
  const memberKey = `${member.guild.id}:${member.id}`;
  if (boosterGrantsInProgress.has(memberKey)) return false;
  boosterGrantsInProgress.add(memberKey);

  try {
    // Registra também quem já possui o cargo para respeitar uma remoção
    // manual futura, inclusive após uma reinicialização do bot.
    if (member.roles.cache.has(config.prismaAi.accessRoleId)) {
      await rememberBoosterAccess(member);
      return false;
    }
    const role = member.guild.roles.cache.get(config.prismaAi.accessRoleId)
      ?? await member.guild.roles.fetch(config.prismaAi.accessRoleId).catch(() => null);
    if (!role) {
      console.error(`[PRISMA-IA] Cargo de acesso ${config.prismaAi.accessRoleId} não encontrado.`);
      return false;
    }
    await member.roles.add(role, "Acesso Prisma IA concedido automaticamente por Booster");
    await rememberBoosterAccess(member);
    console.log(`[PRISMA-IA] Cargo de acesso concedido ao Booster ${member.user.tag} (${member.id}).`);
    return true;
  } finally {
    boosterGrantsInProgress.delete(memberKey);
  }
}

export async function grantVerifiedRoleToBooster(member: GuildMember): Promise<boolean> {
  const roleId = config.verification.verifiedRoleId;
  if (member.premiumSinceTimestamp === null || !roleId || member.roles.cache.has(roleId)) return false;
  const role = member.guild.roles.cache.get(roleId)
    ?? await member.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    console.error(`[BOOSTER] Cargo de verificado ${roleId} não encontrado.`);
    return false;
  }
  await member.roles.add(role, "Cargo de verificado concedido automaticamente por Booster");
  console.log(`[BOOSTER] Cargo de verificado concedido ao Booster ${member.user.tag} (${member.id}).`);
  return true;
}

export function startedBoosting(
  oldMember: Pick<GuildMember, "premiumSinceTimestamp">,
  newMember: Pick<GuildMember, "premiumSinceTimestamp">,
): boolean {
  return oldMember.premiumSinceTimestamp === null && newMember.premiumSinceTimestamp !== null;
}

export async function syncBoosterAccessRoles(
  guild: Guild,
  members?: Collection<Snowflake, GuildMember>,
): Promise<void> {
  members ??= await guild.members.fetch();
  const boosters = members.filter((member) => member.premiumSinceTimestamp !== null);
  const results = await Promise.allSettled(boosters.map((member) => grantAccessRoleToBooster(member)));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) console.error(`[PRISMA-IA] Falha ao conceder o cargo de acesso a ${failures.length} Booster(s). Verifique a hierarquia e a permissão Gerenciar cargos.`);
}
