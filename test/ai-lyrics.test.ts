import assert from "node:assert/strict";
import test from "node:test";
import { asksFavoriteSongPart, lyricsSearchQueries, researchLyrics } from "../src/modules/ai/lyrics.js";

test("reconhece pergunta sobre a parte preferida de uma música", () => {
  assert.equal(asksFavoriteSongPart("Prisma, qual trecho dessa música você mais aprecia?"), true);
  assert.equal(asksFavoriteSongPart("qual sua música favorita?"), false);
});

test("reconhece formas naturais e indiretas de pedir um trecho", () => {
  const examples = [
    "o que mais te pega nessa letra?",
    "tem alguma frase que te marca nela?",
    "escolhe uma frase bonita dessa música",
    "em qual momento ela fica melhor?",
    "qual palavra dessa canção você acha mais bonita?",
    "cita um verso dela que chama sua atenção",
  ];
  for (const example of examples) assert.equal(asksFavoriteSongPart(example), true, example);
});

test("não confunde preferência geral de música com pedido de trecho", () => {
  assert.equal(asksFavoriteSongPart("qual é sua música favorita?"), false);
  assert.equal(asksFavoriteSongPart("você gosta dessa música?"), false);
  assert.equal(asksFavoriteSongPart("qual foi a melhor parte do seu dia?"), false);
});

test("prioriza o título citado na pergunta ao montar a busca", () => {
  assert.equal(lyricsSearchQueries('qual parte de "we can\'t be friends" você mais gosta?')[0], "we can't be friends");
});

test("resolve 'dela' pela música e artista da atividade atual", () => {
  const queries = lyricsSearchQueries(
    "qual parte vc mais gosta dela?",
    [],
    ['ouvindo "Honeybee" de Olivia Rodrigo'],
  );
  assert.equal(queries[0], "Honeybee Olivia Rodrigo");
  assert.equal(queries.includes("dela"), false);
});

test("resolve referência indireta pelo histórico recente antes de termos vagos", () => {
  const history = [{ discordId: "1", channelId: "2", role: "assistant" as const, content: 'vc tá ouvindo “Honeybee”, da Olivia Rodrigo, agr', createdAt: new Date().toISOString() }];
  const queries = lyricsSearchQueries("qual parte vc mais gosta dela?", history);
  assert.match(queries[0], /Honeybee/i);
  assert.equal(queries.includes("dela"), false);
});

test("consulta somente o LRCLIB e remove timestamps da letra sincronizada", async () => {
  let requestedUrl = "";
  const fakeFetch = async (input: string | URL | Request) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([{
      trackName: "Teste",
      artistName: "Artista",
      syncedLyrics: "[00:01.00] primeira linha\n[00:04.00] segunda linha",
    }]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await researchLyrics('qual trecho de "Teste" você prefere?', [], fakeFetch as typeof fetch);
  assert.match(requestedUrl, /^https:\/\/lrclib\.net\/api\/search\?q=/);
  assert.equal(result?.lyrics, "primeira linha\nsegunda linha");
});

test("ignora letra do primeiro resultado quando título ou artista não correspondem", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([
    { trackName: "Friday I'm in Love", artistName: "The Cure", plainLyrics: "letra errada" },
    { trackName: "The Cure", artistName: "Olivia Rodrigo", plainLyrics: "letra certa" },
  ]), { status: 200, headers: { "content-type": "application/json" } });

  const result = await researchLyrics("qual sua parte favorita de the cure da olivia?", [], fakeFetch as typeof fetch);
  assert.equal(result?.trackName, "The Cure");
  assert.equal(result?.artistName, "Olivia Rodrigo");
  assert.equal(result?.lyrics, "letra certa");
});

test("não envia letra de outra música quando não há resultado compatível", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([
    { trackName: "Friday I'm in Love", artistName: "The Cure", plainLyrics: "letra errada" },
  ]), { status: 200, headers: { "content-type": "application/json" } });

  const result = await researchLyrics("qual sua parte favorita de the cure da olivia?", [], fakeFetch as typeof fetch);
  assert.equal(result, null);
});

test("não transforma a resposta anterior da Prisma em consulta de letra", () => {
  const history = [
    { discordId: "1", channelId: "2", role: "user" as const, content: "qual sua parte favorita de the cure da olivia?", createdAt: new Date().toISOString() },
    { discordId: "1", channelId: "2", role: "assistant" as const, content: "a letra enviada aqui é de outra música", createdAt: new Date().toISOString() },
  ];
  const queries = lyricsSearchQueries("qual parte vc mais gosta dessa musica da olivia rodrigo?", history);
  assert.equal(queries.some((query) => /letra enviada aqui/i.test(query)), false);
  assert.equal(queries.some((query) => /the cure.*olivia/i.test(query)), true);
});
