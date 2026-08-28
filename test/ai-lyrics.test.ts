import assert from "node:assert/strict";
import test from "node:test";
import { buildTrackCandidates, candidateScore, detectLyricsIntent, referencesCurrentListeningActivity, researchLyrics, trackQueryFromUser } from "../src/modules/ai/lyrics.js";

test("interpreta diferentes formas de pedir o trecho preferido", () => {
  assert.equal(detectLyricsIntent("qual linha mais te toca nessa letra"), "favorite_part");
  assert.equal(detectLyricsIntent("oq mais te marca nessa musica"), "favorite_part");
});

test("extrai titulo e artista de uma pergunta natural de preferencia", () => {
  assert.deepEqual(trackQueryFromUser("prisma qual parte que vc mais gosta de we can't be friends da Ariana Grande?"), { trackName: "we can't be friends", artistName: "Ariana Grande", source: "user" });
  assert.deepEqual(trackQueryFromUser("qual linha te pega mais em vampires da Olivia Rodrigo?"), { trackName: "vampires", artistName: "Olivia Rodrigo", source: "user" });
  assert.deepEqual(trackQueryFromUser("oq mais te marca de Espresso da Sabrina Carpenter?"), { trackName: "Espresso", artistName: "Sabrina Carpenter", source: "user" });
});
test("entende resposta curta como continuacao de uma pergunta sobre trecho", () => {
  const history = [{ discordId: "1", channelId: "1", role: "assistant" as const, content: "qual trecho de intro (end of the world) vc quer q eu pesquise?", createdAt: new Date().toISOString() }];
  assert.equal(detectLyricsIntent("o que vc mais gostar", history), "favorite_part");
  assert.equal(detectLyricsIntent("a que mais me pega", history), "favorite_part");
  assert.equal(buildTrackCandidates("o que vc mais gostar", history)[0]?.trackName, "intro (end of the world)");
});
test("nao aceita outra musica ao pesquisar we can't be friends", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([{ trackName: "Hampstead", artistName: "Ariana Grande", plainLyrics: "errada" }]), { status: 200 });
  assert.equal((await researchLyrics("qual parte que vc mais gosta de we can't be friends da Ariana Grande?", [], fakeFetch as typeof fetch)).status, "not_found");
});

test("detecta pedidos gerais de letra, trecho, parte favorita e significado", () => {
  assert.equal(detectLyricsIntent("manda a letra de Bad Romance"), "full_lyrics");
  assert.equal(detectLyricsIntent("manda um trecho dessa música"), "excerpt");
  assert.equal(detectLyricsIntent("qual seu trecho favorito dessa música"), "favorite_part");
  assert.equal(detectLyricsIntent("oq essa letra fala"), "meaning");
  assert.equal(detectLyricsIntent("qual sua música favorita?"), "unknown");
});
test("separa título e artista informados pelo usuário", () => { assert.deepEqual(trackQueryFromUser("manda a letra de Bad Romance da Lady Gaga"), { trackName: "Bad Romance", artistName: "Lady Gaga", source: "user" }); });
test("não destrói palavras comuns que fazem parte do título", () => {
  assert.equal(trackQueryFromUser("qual a letra de Agora Hills da Doja Cat")?.trackName, "Agora Hills");
  assert.equal(trackQueryFromUser("manda um trecho de Me Against the Music da Britney Spears")?.trackName, "Me Against the Music");
  assert.equal(trackQueryFromUser("qual a letra de O Que É, O Que É? do Gonzaguinha")?.trackName, "O Que É, O Que É?");
});
test("usa Spotify somente quando a pessoa cita explicitamente a atividade atual", () => {
  assert.equal(referencesCurrentListeningActivity("qual parte da música que eu tô ouvindo vc gosta?"), true);
  assert.equal(referencesCurrentListeningActivity("qual parte vc mais gosta?"), false);
  assert.deepEqual(buildTrackCandidates("qual parte da música que eu tô ouvindo vc gosta?", [], ['ouvindo "Flowers" de Miley Cyrus'])[0], { trackName: "Flowers", artistName: "Miley Cyrus", source: "spotify" });
  assert.equal(buildTrackCandidates("manda um trecho dessa", [], ['ouvindo "Flowers" de Miley Cyrus'])[0], undefined);
});
test("música explícita vence a atividade do Spotify", () => { assert.deepEqual(buildTrackCandidates("manda um trecho de Poker Face", [], ['ouvindo "Bad Romance" de Lady Gaga'])[0], { trackName: "Poker Face", source: "user" }); });
test("pergunta curta prioriza a música da mensagem respondida sobre o histórico", () => {
  const history = [{ discordId: "1", channelId: "1", role: "user" as const, content: "qual parte vc mais gosta de Kiss Me da Ariana Grande?", createdAt: new Date().toISOString() }];
  assert.equal(trackQueryFromUser("qual parte vc mais gosta?"), null);
  assert.deepEqual(buildTrackCandidates("qual parte vc mais gosta?", history, ['“Sempre Você” é bem gostosinha, Luísa entregou nessa.'])[0], { trackName: "Sempre Você", source: "context" });
});
test("pergunta curta não troca o contexto do chat pela atividade atual", () => {
  const history = [{ discordId: "1", channelId: "1", role: "user" as const, content: "qual parte vc mais gosta de Kiss Me da Ariana Grande?", createdAt: new Date().toISOString() }];
  assert.deepEqual(buildTrackCandidates("qual parte vc mais gosta?", history, ['ouvindo "Sempre Você" de Luísa Sonza'])[0], { trackName: "Kiss Me", artistName: "Ariana Grande", source: "history" });
});
test("consulta exata e estruturada antes da busca genérica", async () => {
  const urls: string[] = [];
  const fakeFetch = async (input: string | URL | Request) => { urls.push(String(input)); return new Response(JSON.stringify(urls.length === 1 ? {} : [{ trackName: "Bad Romance", artistName: "Lady Gaga", plainLyrics: "linha" }]), { status: urls.length === 1 ? 404 : 200 }); };
  const result = await researchLyrics("manda a letra de Bad Romance da Lady Gaga", [], fakeFetch as typeof fetch);
  assert.equal(result.status, "found"); assert.match(urls[0], /\/api\/get\?track_name=Bad\+Romance&artist_name=Lady\+Gaga/); assert.match(urls[1], /\/api\/search\?track_name=Bad\+Romance&artist_name=Lady\+Gaga/);
});
test("seleciona título e artista corretos mesmo quando não são o primeiro resultado", async () => {
  const fakeFetch = async (input: string | URL | Request) => String(input).includes("/get?") ? new Response("{}", { status: 404 }) : new Response(JSON.stringify([{ trackName: "Flowers", artistName: "Outro Artista", plainLyrics: "errada" }, { trackName: "Flowers", artistName: "Miley Cyrus", plainLyrics: "certa" }]), { status: 200 });
  const result = await researchLyrics("manda a letra de Flowers da Miley Cyrus", [], fakeFetch as typeof fetch);
  assert.equal(result.status, "found"); if (result.status === "found") { assert.equal(result.artistName, "Miley Cyrus"); assert.equal(result.lyrics, "certa"); }
});
test("título sem artista e com candidatos diferentes retorna ambiguidade", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([{ trackName: "Flowers", artistName: "Miley Cyrus", plainLyrics: "a" }, { trackName: "Flowers", artistName: "Lauren Spencer Smith", plainLyrics: "b" }]), { status: 200 });
  assert.equal((await researchLyrics("manda a letra de Flowers", [], fakeFetch as typeof fetch)).status, "ambiguous");
});
test("rejeita título ou artista incompatível e não inventa letra", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([{ trackName: "Friday I'm in Love", artistName: "The Cure", plainLyrics: "errada" }]), { status: 200 });
  assert.equal((await researchLyrics("qual sua parte favorita de The Cure da Olivia Rodrigo", [], fakeFetch as typeof fetch)).status, "not_found");
});
test("remove timestamps da letra sincronizada validada", async () => {
  const fakeFetch = async () => new Response(JSON.stringify([{ trackName: "Teste", artistName: "Artista", syncedLyrics: "[00:01.00] primeira linha\n[00:04.00] segunda linha" }]), { status: 200 });
  const result = await researchLyrics('qual trecho de "Teste" vc prefere?', [], fakeFetch as typeof fetch); assert.equal(result.status, "found"); if (result.status === "found") assert.equal(result.lyrics, "primeira linha\nsegunda linha");
});
test("erro ou timeout do LRCLIB é tratado sem derrubar a pesquisa", async () => { assert.equal((await researchLyrics("manda a letra de Música Inexistente", [], (async () => { throw new Error("timeout"); }) as typeof fetch)).status, "temporary_error"); });
test("penaliza versão alternativa não solicitada", () => {
  const expected = { trackName: "Bad Romance", artistName: "Lady Gaga", source: "user" as const };
  const normal = candidateScore({ trackName: "Bad Romance", artistName: "Lady Gaga", plainLyrics: "x" }, expected); const live = candidateScore({ trackName: "Bad Romance - Live", artistName: "Lady Gaga", plainLyrics: "x" }, expected);
  assert.ok(normal !== null && live !== null && normal > live);
});
