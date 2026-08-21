import assert from "node:assert/strict";
import { request, type IncomingHttpHeaders } from "node:http";
import { afterEach, test } from "node:test";
import { createServer, type Server } from "node:http";
import { handleHealthRequest } from "../src/health-server.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function call(method: string, path: string, ready = false) {
  const server = createServer((req, res) => handleHealthRequest({ isReady: () => ready }, req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");

  return new Promise<{ status: number | undefined; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    let responseHeaders: IncomingHttpHeaders = {};
    const req = request({ host: "127.0.0.1", port: address.port, method, path }, (res) => {
      responseHeaders = res.headers;
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body, headers: responseHeaders }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("health aceita GET com barra final e query string", async () => {
  const response = await call("GET", "/health/?source=uptimerobot", true);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).discord, "connected");
});

test("health aceita HEAD sem enviar corpo", async () => {
  const response = await call("HEAD", "/", true);
  assert.equal(response.status, 200);
  assert.equal(response.body, "");
  assert(Number(response.headers["content-length"]) > 0);
});

test("ready confirma que o processo esta vivo durante reconexao do Discord", async () => {
  const response = await call("GET", "/ready", false);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body).discord, "connecting");
});

test("rotas e metodos desconhecidos continuam retornando 404", async () => {
  assert.equal((await call("GET", "/unknown")).status, 404);
  assert.equal((await call("POST", "/health")).status, 404);
});
