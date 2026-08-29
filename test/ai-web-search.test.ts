import assert from "node:assert/strict";
import test from "node:test";
import { appendWebSources, shouldUseWebSearch, wantsWebSources } from "../src/modules/ai/web-search.js";

test("ativa pesquisa para pedidos explícitos, informações atuais e fontes", () => {
  assert.equal(shouldUseWebSearch("pesquisa isso pra mim"), true);
  assert.equal(shouldUseWebSearch("qual o clima hoje em São Paulo?"), true);
  assert.equal(shouldUseWebSearch("me manda a fonte dessa informação"), true);
  assert.equal(wantsWebSources("quero os links e referências"), true);
});

test("não ativa pesquisa em conversa casual sem intenção de consulta", () => {
  assert.equal(shouldUseWebSearch("oi, como você está?"), false);
  assert.equal(shouldUseWebSearch("lembra do jogo que eu te falei?"), false);
});

test("anexa apenas citações web válidas e sem duplicatas", () => {
  const response = { output: [{ type: "message", content: [{ type: "output_text", annotations: [
    { type: "url_citation", title: "Fonte oficial", url: "https://example.com/noticia" },
    { type: "url_citation", title: "Repetida", url: "https://example.com/noticia" },
    { type: "url_citation", title: "Inválida", url: "javascript:alert(1)" },
  ] }] }] };
  const result = appendWebSources("Resposta verificada.", response);
  assert.equal(result, "Resposta verificada.\n\nFontes: [Repetida](https://example.com/noticia)");
});
