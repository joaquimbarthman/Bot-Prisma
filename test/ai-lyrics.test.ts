import assert from "node:assert/strict";
import test from "node:test";
import { asksFavoriteSongPart, lyricsSearchQueries, researchLyrics } from "../src/modules/ai/lyrics.js";

test("reconhece pergunta sobre a parte preferida de uma música", () => {
  assert.equal(asksFavoriteSongPart("Prisma, qual trecho dessa música você mais aprecia?"), true);
  assert.equal(asksFavoriteSongPart("qual sua música favorita?"), false);
});

test("prioriza o título citado na pergunta ao montar a busca", () => {
  assert.equal(lyricsSearchQueries('qual parte de "we can\'t be friends" você mais gosta?')[0], "we can't be friends");
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
