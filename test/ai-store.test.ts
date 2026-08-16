import assert from "node:assert/strict";
import test from "node:test";
import { selectRecentHistory, type HistoryItem } from "../src/modules/ai/store.js";

const now = new Date("2026-08-16T12:00:00.000Z");
const item = (discordId: string, channelId: string, content: string, createdAt: string): HistoryItem => ({
  discordId,
  channelId,
  role: "user",
  content,
  createdAt,
});

test("histórico isola usuário/canal e descarta texto com mais de 48 horas", () => {
  const selected = selectRecentHistory([
    item("a", "canal", "expirado", "2026-08-14T11:59:59.000Z"),
    item("b", "canal", "outro usuário", "2026-08-16T10:00:00.000Z"),
    item("a", "outro", "outro canal", "2026-08-16T10:00:00.000Z"),
    item("a", "canal", "válido", "2026-08-16T11:00:00.000Z"),
  ], "a", "canal", 10, 100, now);

  assert.deepEqual(selected.map((entry) => entry.content), ["válido"]);
});

test("histórico respeita quantidade e orçamento de caracteres", () => {
  const entries = Array.from({ length: 12 }, (_, index) => item("a", "canal", `m${index}`.padEnd(10, "x"), new Date(now.getTime() - (12 - index) * 1_000).toISOString()));
  const selected = selectRecentHistory(entries, "a", "canal", 10, 25, now);

  assert.ok(selected.length <= 10);
  assert.ok(selected.reduce((sum, entry) => sum + entry.content.length, 0) <= 25);
  assert.equal(selected.at(-1)?.content, entries.at(-1)?.content);
});
