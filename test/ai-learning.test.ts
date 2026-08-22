import assert from "node:assert/strict";
import test from "node:test";
import { consolidatePrismaProfile, emotionalUpdateFromMessage, memoryCandidates } from "../src/modules/ai/learning.js";

test("reconhece gatilhos emocionais sem inferir diagnóstico", () => {
  assert.deepEqual(emotionalUpdateFromMessage("obrigada, você me ajudou muito"), { happiness: 58, affection: 42, confidence: 54 });
  assert.deepEqual(emotionalUpdateFromMessage("aff, deu errado de novo"), { irritation: 35, energy: 42 });
  assert.deepEqual(emotionalUpdateFromMessage("tô triste e desanimado"), { sadness: 48, energy: 42, affection: 40 });
  assert.deepEqual(emotionalUpdateFromMessage("cala a boca, que lixo"), { irritation: 50, anger: 35 });
});

test("extrai várias preferências e reconhece rejeições", () => {
  const memories = memoryCandidates("u1", "eu gosto de Fortnite e eu não gosto de Valorant", "m1");
  assert.equal(memories.length, 2);
  assert.equal(memories[0].content, "Gosta de Fortnite.");
  assert.equal(memories[1].content, "Não gosta de Valorant.");
  assert.equal(memories[0].sourceMessageId, "m1");
});

test("usa a mesma chave para uma preferência contraditória", () => {
  const positive = memoryCandidates("u1", "eu gosto de minecraft")[0];
  const negative = memoryCandidates("u1", "eu odeio minecraft")[0];
  assert.equal(positive.memoryKey, negative.memoryKey);
  assert.notEqual(positive.content, negative.content);
});

test("não memoriza dados sensíveis ou estados passageiros", () => {
  assert.deepEqual(memoryCandidates("u1", "eu gosto do meu e-mail teste@example.com"), []);
  assert.deepEqual(memoryCandidates("u1", "eu gosto de dormir agora"), []);
});

test("não atribui à pessoa falas citadas, perguntas ou preferências de terceiros", () => {
  assert.deepEqual(memoryCandidates("u1", "minha amiga disse que eu gosto de Valorant"), []);
  assert.deepEqual(memoryCandidates("u1", "ela falou: eu gosto de Fortnite"), []);
  assert.deepEqual(memoryCandidates("u1", "você acha que eu gosto de Roblox?"), []);
  assert.deepEqual(memoryCandidates("u1", "eu gosto da minha irmã"), []);
});

test("não transforma respostas contextuais ou condicionais em memória", () => {
  assert.deepEqual(memoryCandidates("u1", "eu gosto disso"), []);
  assert.deepEqual(memoryCandidates("u1", "eu gosto quando você responde assim"), []);
  assert.deepEqual(memoryCandidates("u1", "talvez eu goste de Minecraft"), []);
});

test("aprende estilo de comunicação, apelido, projetos e objetivos explícitos", () => {
  const style = memoryCandidates("u1", "eu prefiro respostas curtas", "m1")[0];
  const nickname = memoryCandidates("u1", "pode me chamar de Lúh", "m2")[0];
  const project = memoryCandidates("u1", "estou desenvolvendo um bot para Discord", "m3")[0];
  const goal = memoryCandidates("u1", "quero aprender TypeScript", "m4")[0];
  assert.equal(style.memoryType, "communication");
  assert.match(style.memoryKey ?? "", /^communication-style:/);
  assert.equal(nickname.content, "Prefere ser chamado(a) de Lúh.");
  assert.equal(project.memoryType, "project");
  assert.equal(goal.content, "Tem como objetivo TypeScript.");
});

test("atualiza favoritos e interesses abandonados usando chaves estáveis", () => {
  const oldFavorite = memoryCandidates("u1", "meu jogo favorito é Fortnite")[0];
  const newFavorite = memoryCandidates("u1", "meu jogo favorito é Valorant")[0];
  const liked = memoryCandidates("u1", "eu gosto de Minecraft")[0];
  const stopped = memoryCandidates("u1", "parei de Minecraft")[0];
  assert.equal(oldFavorite.memoryKey, newFavorite.memoryKey);
  assert.equal(liked.memoryKey, stopped.memoryKey);
  assert.match(stopped.content, /^Não gosta mais/);
});

test("marca projeto como concluído usando a mesma chave", () => {
  const active = memoryCandidates("u1", "estou criando o bot Prisma")[0];
  const completed = memoryCandidates("u1", "já terminei o bot Prisma")[0];
  assert.equal(active.memoryKey, completed.memoryKey);
  assert.equal(completed.content, "Concluiu bot Prisma.");
});

test("consolida memórias no perfil aprendido", () => {
  const memories = [
    ...memoryCandidates("u1", "eu gosto de Fortnite", "m1"),
    ...memoryCandidates("u1", "eu prefiro respostas curtas", "m2"),
    ...memoryCandidates("u1", "estou criando um bot", "m3"),
  ];
  const profile = consolidatePrismaProfile(null, memories, "u1", "Lucas");
  assert.equal(profile.displayName, "Lucas");
  assert.equal(profile.communicationStyle, "curtas");
  assert.ok(profile.interests.includes("Fortnite"));
  assert.ok(profile.knownPreferences.includes("Prefere respostas curtas"));
  assert.match(profile.profileSummary ?? "", /Fortnite/);
  assert.match(profile.profileSummary ?? "", /bot/);
});
