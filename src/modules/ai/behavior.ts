import { readFile } from "node:fs/promises";
import path from "node:path";

export const PRISMA_RELAXED_ROLE_ID = "1542323955837308998";
export const PRISMA_DEFAULT_ROLE_ID = "1542324605564485783";

export type PrismaBehaviorMode = "default" | "relaxed";
export type PrismaBehavior = { mode: PrismaBehaviorMode; instructions: string };

const behaviorFiles: Record<PrismaBehaviorMode, string> = {
  default: "default.md",
  relaxed: "relaxed.md",
};

export function prismaBehaviorMode(roleIds: Iterable<string>): PrismaBehaviorMode {
  const roles = new Set(roleIds);
  return roles.has(PRISMA_RELAXED_ROLE_ID) ? "relaxed" : "default";
}

export async function loadPrismaBehavior(roleIds: Iterable<string>): Promise<PrismaBehavior> {
  const mode = prismaBehaviorMode(roleIds);
  const file = path.resolve("data/personality/behaviors", behaviorFiles[mode]);
  const instructions = (await readFile(file, "utf8")).trim();
  if (!instructions) throw new Error(`[PRISMA-IA] Arquivo de comportamento vazio: ${file}`);
  return { mode, instructions };
}
