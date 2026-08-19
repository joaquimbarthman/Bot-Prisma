import { createServer, type Server } from "node:http";
import type { Client } from "discord.js";
import { config } from "./config.js";

export function startHealthServer(client: Client): Server {
  const port = config.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT deve ser uma porta válida.");

  const server = createServer((request, response) => {
    if (request.method !== "GET" || !["/", "/health", "/ready"].includes(request.url ?? "")) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ status: "not_found" }));
      return;
    }
    const ready = client.isReady();
    const readinessCheck = request.url === "/ready";
    response.writeHead(readinessCheck && !ready ? 503 : 200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ status: ready ? "ok" : "starting", discord: ready ? "connected" : "connecting", uptimeSeconds: Math.floor(process.uptime()) }));
  });

  server.on("error", (error) => console.error("[HEALTH] Falha no servidor HTTP:", error));
  server.listen(port, "0.0.0.0", () => console.log(`[HEALTH] Endpoint ativo em 0.0.0.0:${port}/health.`));
  return server;
}
