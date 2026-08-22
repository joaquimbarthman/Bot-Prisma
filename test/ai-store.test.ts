import assert from "node:assert/strict";
import test from "node:test";
import { defaultMemoryValidUntil, profileFacetsFromMemories, selectRecentHistory, type HistoryItem, type PrismaMemory } from "../src/modules/ai/store.js";

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

test("define validade menor para eventos e projetos do que para preferências", () => {
  const base = new Date("2026-08-22T00:00:00.000Z");
  const days = (type: string) => (Date.parse(defaultMemoryValidUntil(type, base)) - base.getTime()) / 86_400_000;
  assert.equal(days("event"), 30);
  assert.equal(days("project"), 180);
  assert.equal(days("relationship"), 365);
  assert.equal(days("preference"), 730);
  assert.equal(days("communication"), 730);
});

test("deriva interesses e preferências somente das memórias fornecidas", () => {
  const base = { userId: "u1", importance: 60, confidence: 70 };
  const memories: PrismaMemory[] = [
    { ...base, memoryType: "interest", content: "Gosta de Minecraft." },
    { ...base, memoryType: "interest", content: "Não gosta mais de Fortnite." },
    { ...base, memoryType: "communication", content: "Prefere respostas curtas." },
    { ...base, memoryType: "preference", content: "Não gosta de spoilers." },
  ];
  assert.deepEqual(profileFacetsFromMemories(memories), {
    interests: ["Minecraft"],
    knownPreferences: ["Prefere respostas curtas", "Não gosta de spoilers"],
  });
});
