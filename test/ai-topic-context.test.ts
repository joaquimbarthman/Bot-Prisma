import assert from "node:assert/strict";
import test from "node:test";
import { selectTopicContext, topicTokens, type ChannelContextMessage } from "../src/modules/ai/topic-context.js";

const base = Date.now() - 60_000;
const messages: ChannelContextMessage[] = [
  { id: "1", authorId: "alice", authorName: "Alice", content: "eu gosto muito da Billie Eilish", createdAt: base },
  { id: "2", authorId: "bob", authorName: "Bob", content: "Fortnite recebeu uma atualização no jogo", createdAt: base + 1_000 },
  { id: "3", authorId: "carol", authorName: "Carol", content: "a música nova da Billie ficou perfeita", createdAt: base + 2_000, replyToId: "1" },
  { id: "4", authorId: "davi", authorName: "Davi", content: "prefiro jogar Minecraft com meus amigos", createdAt: base + 3_000, replyToId: "2" },
];

test("separa música e jogos em assuntos diferentes", () => {
  const context = selectTopicContext(messages, "qual música da Billie vcs preferem?");
  const first = context.split("\n\n")[0];
  assert.match(first, /Billie/i);
  assert.match(first, /autor_id=alice/);
  assert.doesNotMatch(first, /Minecraft/i);
});

test("prioriza a conversa da mensagem respondida", () => {
  const context = selectTopicContext(messages, "concordo com isso", "2");
  const first = context.split("\n\n")[0];
  assert.match(first, /mensagem respondida/);
  assert.match(first, /Fortnite/i);
});

test("remove palavras genéricas ao identificar assunto", () => {
  assert.deepEqual([...topicTokens("eu acho que isso é muito legal")], ["acho", "legal"]);
});
