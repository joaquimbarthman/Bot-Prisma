import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Client } from "discord.js";
import { config } from "./config.js";

const HEALTH_PATHS = new Set(["/", "/health", "/ready"]);

type HealthClient = { isReady(): boolean };

export function handleHealthRequest(client: HealthClient, request: IncomingMessage, response: ServerResponse): void {
  const method = request.method ?? "GET";
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

  if (!["GET", "HEAD"].includes(method) || !HEALTH_PATHS.has(pathname)) {
    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(method === "HEAD" ? undefined : JSON.stringify({ status: "not_found" }));
    return;
  }

  const ready = client.isReady();
  const isReadinessProbe = pathname === "/ready";
  const body = JSON.stringify({
    status: "ok",
    discord: ready ? "connected" : "connecting",
    uptimeSeconds: Math.floor(process.uptime()),
  });
  response.writeHead(isReadinessProbe && !ready ? 503 : 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(method === "HEAD" ? undefined : body);
}

export function startHealthServer(client: Client): Server {
  const port = config.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT deve ser uma porta válida.");

  const server = createServer((request, response) => handleHealthRequest(client, request, response));

  server.on("error", (error) => console.error("[HEALTH] Falha no servidor HTTP:", error));
  server.listen(port, "0.0.0.0", () => console.log(`[HEALTH] Endpoint ativo em 0.0.0.0:${port}/health.`));
  return server;
}
