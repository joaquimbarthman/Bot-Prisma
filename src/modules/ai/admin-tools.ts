import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config } from "../../config.js";
import { isPrismaCreator } from "./creator.js";
import { checkSupabaseConnection, getPrismaOperatorRulesStatus, getRelevantPrismaMemories, getSettings } from "./store.js";
import { getLyricsRuntimeStatus } from "./lyrics.js";

const PROJECT_ROOT = path.resolve(process.cwd());
const MAX_OUTPUT = 10_000;
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".json", ".sql", ".md"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "coverage"]);
const BLOCKED_NAMES = /^(?:\.env(?:\..*)?|credentials?|secrets?|id_rsa|service-account.*|\.npmrc)$/i;
const BLOCKED_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx"]);
const startedAt = new Date();

export type CommandCheckResult = { name: string; available: boolean; success: boolean; exitCode: number | null; durationMs: number; timedOut: boolean; stdout: string; stderr: string };
export type CreatorAdminToolResult = { tool: string; success: boolean; data: unknown; executedAt: string };
type LogLevel = "debug" | "info" | "warn" | "error";
type LogEntry = { at: string; level: LogLevel; message: string };
const logBuffer: LogEntry[] = [];
let loggingInstalled = false;
let heavyCheckRunning = false;
const heavyCooldowns = new Map<string, number>();

export function sanitizeSecrets(text: string): string {
  let output = text;
  for (const secret of [config.token, config.openAiKey, config.supabaseSecretKey]) if (secret && secret.length >= 8) output = output.split(secret).join("[REDACTED]");
  return output
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:postgres(?:ql)?):\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi, "postgres://[REDACTED]")
    .replace(/\b(JWT_SECRET|DATABASE_URL|SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY|OPENAI_API_KEY|DISCORD_TOKEN)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function stringifyLogPart(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function installCreatorLogCapture(): void {
  if (loggingInstalled) return; loggingInstalled = true;
  for (const level of ["debug", "info", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logBuffer.push({ at: new Date().toISOString(), level, message: sanitizeSecrets(args.map(stringifyLogPart).join(" ")).slice(0, 2_000) });
      if (logBuffer.length > 500) logBuffer.splice(0, logBuffer.length - 500);
      original(...args);
    };
  }
}

export function getRecentLogs(userId: string, level?: LogLevel, limit = 50): CreatorAdminToolResult {
  authorize(userId, "getRecentLogs");
  const entries = logBuffer.filter((entry) => !level || entry.level === level).slice(-Math.max(1, Math.min(limit, 100)));
  return result("getRecentLogs", true, { liveCapture: loggingInstalled, entries });
}

function authorize(userId: string, tool: string): void {
  if (!isPrismaCreator(userId)) throw new Error("Ferramenta administrativa indisponível.");
  console.info(`[CreatorTool] user=${userId} tool=${tool}`);
}
function result(tool: string, success: boolean, data: unknown): CreatorAdminToolResult { return { tool, success, data, executedAt: new Date().toISOString() }; }
function safePath(relativePath: string): string {
  const clean = relativePath.replace(/^["'`]+|["'`]+$/g, "").replace(/\\/g, "/");
  if (!clean || clean.includes("\0") || clean.split("/").some((part) => part === ".." || BLOCKED_NAMES.test(part)) || BLOCKED_EXTENSIONS.has(path.extname(clean).toLowerCase())) throw new Error("Arquivo bloqueado.");
  const resolved = path.resolve(PROJECT_ROOT, clean); const relative = path.relative(PROJECT_ROOT, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part))) throw new Error("Caminho fora da raiz permitida.");
  return resolved;
}

export async function readProjectFile(userId: string, relativePath: string): Promise<CreatorAdminToolResult> {
  authorize(userId, "readProjectFile");
  try { const resolved = safePath(relativePath); const extension = path.extname(resolved).toLowerCase(); if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error("Tipo de arquivo não permitido."); const content = sanitizeSecrets(await readFile(resolved, "utf8")); return result("readProjectFile", true, { path: path.relative(PROJECT_ROOT, resolved).replace(/\\/g, "/"), truncated: content.length > 12_000, content: content.slice(0, 12_000) }); }
  catch (error) { return result("readProjectFile", false, { error: error instanceof Error ? error.message : "Falha de leitura." }); }
}

async function projectFiles(directory = PROJECT_ROOT, output: string[] = []): Promise<string[]> {
  if (output.length >= 2_000) return output;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await projectFiles(absolute, output);
    else if (ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !BLOCKED_NAMES.test(entry.name)) output.push(absolute);
    if (output.length >= 2_000) break;
  }
  return output;
}

export async function searchProjectFiles(userId: string, query: string): Promise<CreatorAdminToolResult> {
  authorize(userId, "searchProjectFiles");
  const needle = query.trim().slice(0, 80).toLowerCase(); if (needle.length < 2) return result("searchProjectFiles", false, { error: "Busca muito curta." });
  const matches: Array<{ path: string; line: number; snippet: string }> = [];
  for (const file of await projectFiles()) {
    const relative = path.relative(PROJECT_ROOT, file).replace(/\\/g, "/");
    const lines = (await readFile(file, "utf8").catch(() => "")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) if (relative.toLowerCase().includes(needle) || lines[index].toLowerCase().includes(needle)) { matches.push({ path: relative, line: index + 1, snippet: sanitizeSecrets(lines[index]).trim().slice(0, 300) }); if (matches.length >= 30) break; }
    if (matches.length >= 30) break;
  }
  return result("searchProjectFiles", true, { query, matches });
}

async function scripts(): Promise<Record<string, string>> { const pkg = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> }; return pkg.scripts ?? {}; }
async function npmInvocation(): Promise<{ executable: string; args: string[] }> {
  if (process.platform !== "win32") return { executable: "npm", args: [] };
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((candidate): candidate is string => Boolean(candidate?.toLowerCase().endsWith(".js")));
  for (const candidate of candidates) {
    try { await readFile(candidate); return { executable: process.execPath, args: [candidate] }; } catch { /* try the next installation */ }
  }
  throw new Error("npm-cli.js was not found in the Node installation.");
}
async function runScript(userId: string, name: string, timeoutMs = 120_000): Promise<CommandCheckResult> {
  authorize(userId, `run:${name}`); const available = Object.hasOwn(await scripts(), name);
  if (!available) return { name, available: false, success: false, exitCode: null, durationMs: 0, timedOut: false, stdout: "", stderr: `Script ${name} não configurado.` };
  const started = Date.now();
  let invocation: { executable: string; args: string[] };
  try { invocation = await npmInvocation(); }
  catch (error) { return { name, available: true, success: false, exitCode: null, durationMs: Date.now() - started, timedOut: false, stdout: "", stderr: error instanceof Error ? error.message : "Could not locate npm." }; }
  return new Promise((resolve) => {
    let child;
    try { child = spawn(invocation.executable, [...invocation.args, "run", name], { cwd: PROJECT_ROOT, shell: false, windowsHide: true, env: process.env }); }
    catch (error) { resolve({ name, available: true, success: false, exitCode: null, durationMs: Date.now() - started, timedOut: false, stdout: "", stderr: sanitizeSecrets(error instanceof Error ? error.message : "Could not start process.") }); return; }
    let stdout = "", stderr = "", timedOut = false, settled = false;
    const finish = (exitCode: number | null) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ name, available: true, success: exitCode === 0 && !timedOut, exitCode, durationMs: Date.now() - started, timedOut, stdout: sanitizeSecrets(stdout).slice(-MAX_OUTPUT), stderr: sanitizeSecrets(stderr).slice(-MAX_OUTPUT) }); };
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-MAX_OUTPUT * 2); }); child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-MAX_OUTPUT * 2); });
    child.on("error", (error) => { stderr += error.message; finish(null); }); child.on("close", finish);
    const timer = setTimeout(() => { timedOut = true; if (process.platform === "win32" && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true }); else { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 2_000).unref(); } }, timeoutMs); timer.unref();
  });
}

async function guardedHeavy(userId: string, tool: string, cooldownMs: number, task: () => Promise<CreatorAdminToolResult>): Promise<CreatorAdminToolResult> {
  authorize(userId, tool); if (heavyCheckRunning) return result(tool, false, { error: "Já existe uma verificação em execução." });
  const remaining = cooldownMs - (Date.now() - (heavyCooldowns.get(tool) ?? 0)); if (remaining > 0) return result(tool, false, { error: `Cooldown ativo por mais ${Math.ceil(remaining / 1000)}s.` });
  heavyCheckRunning = true; heavyCooldowns.set(tool, Date.now()); try { return await task(); } finally { heavyCheckRunning = false; }
}
export async function runTests(userId: string): Promise<CreatorAdminToolResult> { return guardedHeavy(userId, "runTests", 10_000, async () => { const check = await runScript(userId, "test"); return result("runTests", check.success, check); }); }
export async function runBuild(userId: string): Promise<CreatorAdminToolResult> { return guardedHeavy(userId, "runBuild", 10_000, async () => { const check = await runScript(userId, "build"); return result("runBuild", check.success, check); }); }
export async function runLint(userId: string): Promise<CreatorAdminToolResult> { return guardedHeavy(userId, "runLint", 10_000, async () => { const check = await runScript(userId, "lint"); return result("runLint", check.success, check); }); }
export async function runAllChecks(userId: string): Promise<CreatorAdminToolResult> { return guardedHeavy(userId, "runAllChecks", 20_000, async () => { const available = await scripts(); const names = ["test", "build", "lint", "typecheck", "check"].filter((name, index, all) => Object.hasOwn(available, name) && all.indexOf(name) === index); const checks: CommandCheckResult[] = []; for (const name of names) checks.push(await runScript(userId, name)); return result("runAllChecks", checks.every((item) => item.success), { checks, unavailable: ["test", "build", "lint", "typecheck"].filter((name) => !Object.hasOwn(available, name)) }); }); }

async function fixedCommand(executable: string, args: string[]): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => { const child = spawn(executable, args, { cwd: PROJECT_ROOT, shell: false, windowsHide: true }); let output = "", settled = false; const finish = (success: boolean, value = output) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ success, output: sanitizeSecrets(value) }); }; child.stdout.on("data", (chunk) => { output = (output + String(chunk)).slice(-MAX_OUTPUT); }); child.stderr.on("data", (chunk) => { output = (output + String(chunk)).slice(-MAX_OUTPUT); }); child.on("error", (error) => finish(false, error.message)); child.on("close", (code) => finish(code === 0)); const timer = setTimeout(() => { child.kill("SIGTERM"); finish(false, `${output}\nTimeout do diagnóstico.`); }, 10_000); timer.unref(); });
}
export async function getGitStatus(userId: string): Promise<CreatorAdminToolResult> { authorize(userId, "getGitStatus"); const [status, branch, commit] = await Promise.all([fixedCommand("git", ["status", "--short"]), fixedCommand("git", ["branch", "--show-current"]), fixedCommand("git", ["rev-parse", "--short", "HEAD"])]); return result("getGitStatus", status.success && branch.success && commit.success, { branch: branch.output.trim(), commit: commit.output.trim(), changes: status.output.trim().split(/\r?\n/).filter(Boolean).slice(0, 100) }); }
export function getRuntimeStatus(userId: string, guildCount: number, connected: boolean): CreatorAdminToolResult { authorize(userId, "getRuntimeStatus"); const memory = process.memoryUsage(); return result("getRuntimeStatus", true, { uptimeSeconds: Math.floor(process.uptime()), nodeVersion: process.version, environment: process.env.NODE_ENV ?? "unknown", memoryUsage: { rss: memory.rss, heapUsed: memory.heapUsed }, startedAt: startedAt.toISOString(), guildCount, connected }); }
export async function getDatabaseStatus(userId: string): Promise<CreatorAdminToolResult> { authorize(userId, "getDatabaseStatus"); const connected = await checkSupabaseConnection(); return result("getDatabaseStatus", connected, { configured: !!config.supabaseUrl && !!config.supabaseSecretKey, connected }); }
export async function getRulesStatus(userId: string, includeRules = false): Promise<CreatorAdminToolResult> { authorize(userId, "getOperatorRulesStatus"); const status = await getPrismaOperatorRulesStatus(config.prismaAi.operatorUserId); return result("getOperatorRulesStatus", status.databaseReachable, { databaseReachable: status.databaseReachable, databaseRules: status.rules.length, runtimeRules: status.loadedRules, cacheEnabled: status.cacheEnabled, cacheAgeMs: status.cacheAgeMs, lastLoadAt: status.lastLoadAt, lastError: status.error, ...(includeRules ? { activeRules: status.rules.map((rule) => sanitizeSecrets(rule.rule)) } : {}) }); }
export async function getMemoryStatus(userId: string, targetUserId = userId): Promise<CreatorAdminToolResult> { authorize(userId, "getMemoryStatus"); const [settings, memories] = await Promise.all([getSettings(targetUserId), getRelevantPrismaMemories(targetUserId, 30)]); const types = Object.fromEntries([...new Set(memories.map((item) => item.memoryType))].map((type) => [type, memories.filter((item) => item.memoryType === type).length])); return result("getMemoryStatus", true, { userId: targetUserId, enabled: settings.memoryEnabled, activeMemoryCount: memories.length, types, lastUpdate: memories.map((item) => item.lastSeenAt).filter(Boolean).sort().at(-1) ?? null }); }
export function getProviderStatus(userId: string): CreatorAdminToolResult { authorize(userId, "getProviderStatus"); return result("getProviderStatus", !!config.openAiKey, { provider: "openai", model: config.prismaAi.model, configured: !!config.openAiKey, lastError: null }); }
export function getLyricsStatus(userId: string): CreatorAdminToolResult { authorize(userId, "getLyricsStatus"); return result("getLyricsStatus", true, getLyricsRuntimeStatus()); }

export type CreatorAdminIntent = "run_tests" | "run_build" | "run_lint" | "run_all" | "read_file" | "search_files" | "git_status" | "logs" | "runtime" | "database" | "rules" | "memory" | "provider" | "lyrics";
export function detectCreatorAdminIntent(content: string): { intent: CreatorAdminIntent; argument?: string } | null {
  const text = content.trim();
  if (/\b(?:roda|rode|executa|execute)\b.{0,30}\b(?:tudo|todos os testes.*build|checks?)\b/i.test(text)) return { intent: "run_all" };
  if (/\b(?:roda|rode|executa|execute)\b.{0,25}\btestes?\b/i.test(text)) return { intent: "run_tests" };
  if (/\b(?:roda|rode|executa|execute|faz)\b.{0,20}\bbuild\b/i.test(text)) return { intent: "run_build" };
  if (/\b(?:roda|rode|executa|execute)\b.{0,20}\blint\b/i.test(text)) return { intent: "run_lint" };
  const file = text.match(/\b(?:abre|leia|l[eê]|mostra)\s+(?:o\s+arquivo\s+)?([\w./\\-]+\.(?:ts|tsx|js|json|sql|md))\b/i); if (file) return { intent: "read_file", argument: file[1] };
  const search = text.match(/\b(?:busca|procura|pesquisa|acha)\s+(?:no\s+c[oó]digo\s+)?["'`]?([\w.-]{2,80})/i); if (search) return { intent: "search_files", argument: search[1] };
  if (/\bgit\b.{0,20}\b(?:status|branch|commit|mudan[cç]as)|\b(?:status|branch)\s+do\s+git\b/i.test(text)) return { intent: "git_status" };
  if (/\b(?:logs?|erros?|warnings?|avisos?)\b/i.test(text)) return { intent: "logs", argument: /\berros?\b/i.test(text) ? "error" : /\b(?:warnings?|avisos?)\b/i.test(text) ? "warn" : undefined };
  if (/\b(?:runtime|uptime|mem[oó]ria ram|node version)\b/i.test(text)) return { intent: "runtime" };
  if (/\b(?:supabase|banco|database)\b/i.test(text)) return { intent: "database" };
  if (/\b(?:rules?|regras?|prisma_operator_rules)\b/i.test(text)) return { intent: "rules", argument: /\b(?:quais|lista|liste|mostra|mostre|ativas?)\b/i.test(text) ? "list" : undefined };
  if (/\b(?:mem[oó]rias?|memory)\b/i.test(text)) return { intent: "memory", argument: text.match(/<@!?(\d{1,25})>/)?.[1] };
  if (/\b(?:provider|modelo|openai|gpt)\b/i.test(text)) return { intent: "provider" };
  const inspect = text.match(/\b(?:v[eê]|analisa|investiga)\s+(?:pq|por que|porque)?\s*(?:o|seu|sua)?\s*([\w.-]{2,80})/i); if (inspect) return { intent: "search_files", argument: inspect[1] };
  if (/\b(?:lyrics|lrclib|pesquisa de letra|erro.*letra)\b/i.test(text)) return { intent: "lyrics" };
  return null;
}

export async function executeCreatorAdminIntent(userId: string, request: { intent: CreatorAdminIntent; argument?: string }, runtime: { guildCount: number; connected: boolean }): Promise<CreatorAdminToolResult> {
  authorize(userId, `execute:${request.intent}`);
  switch (request.intent) {
    case "run_tests": return runTests(userId); case "run_build": return runBuild(userId); case "run_lint": return runLint(userId); case "run_all": return runAllChecks(userId);
    case "read_file": return readProjectFile(userId, request.argument ?? ""); case "search_files": return searchProjectFiles(userId, request.argument ?? ""); case "git_status": return getGitStatus(userId);
    case "logs": return getRecentLogs(userId, request.argument as LogLevel | undefined); case "runtime": return getRuntimeStatus(userId, runtime.guildCount, runtime.connected); case "database": return getDatabaseStatus(userId);
    case "rules": return getRulesStatus(userId, request.argument === "list"); case "memory": return getMemoryStatus(userId, /^\d{1,25}$/.test(request.argument ?? "") ? request.argument : userId); case "provider": return getProviderStatus(userId); case "lyrics": return getLyricsStatus(userId);
  }
}
