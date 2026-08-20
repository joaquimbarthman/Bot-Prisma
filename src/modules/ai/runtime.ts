import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";

type RuntimeState = { testModeEnabled: boolean; enabledByUserId?: string; enabledAt?: string };
const file = path.resolve(config.dataDir, "ai-runtime-state.json");
const notices = new Map<string, number>();
let cached: RuntimeState | undefined;

export async function getAiRuntimeState(): Promise<RuntimeState> {
  if (cached) return cached;
  try { cached = JSON.parse(await readFile(file, "utf8")) as RuntimeState; }
  catch { cached = { testModeEnabled: false }; }
  return cached;
}
export async function setAiTestMode(enabled: boolean, userId: string): Promise<RuntimeState> {
  cached = enabled ? { testModeEnabled: true, enabledByUserId: userId, enabledAt: new Date().toISOString() } : { testModeEnabled: false };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cached, null, 2), "utf8");
  return cached;
}
export function canSendTestNotice(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  if (now - (notices.get(key) ?? 0) < cooldownMs) return false;
  notices.set(key, now); return true;
}
