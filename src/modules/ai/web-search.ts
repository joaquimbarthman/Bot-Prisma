type ResponseWithWebCitations = {
  output?: Array<{
    type?: unknown;
    content?: Array<{
      type?: unknown;
      annotations?: Array<{ type?: unknown; title?: unknown; url?: unknown }>;
    }>;
  }>;
};

const webIntent = /\b(?:pesquis(?:a|e|ar)|procura(?:r)?|busca(?:r)?|pesquise|procure|busque|google|internet|not[ií]cia(?:s)?|novidade(?:s)?|atualizad[oa]|hoje|agora|pre[cç]o|cota[cç][aã]o|clima|tempo(?:\s+em)?|placar|resultado(?:s)?|lan[cç]amento|lan[cç]ou|vers[aã]o|conhece|sabe(?:\s+(?:quem|o que|sobre))?|quem\s+[ée]|o\s+que\s+[ée]|fala\s+sobre|me\s+conta|me\s+explica)\b/i;
const sourceIntent = /\b(?:fonte(?:s)?|link(?:s)?|refer[eê]ncia(?:s)?|de\s+onde\s+(?:tirou|vem|veio)|onde\s+viu|cita(?:r|ção|coes|ções))\b/i;

export function shouldUseWebSearch(content: string): boolean {
  return webIntent.test(content.replace(/<@!?\d+>/g, " "));
}

export function wantsWebSources(content: string): boolean {
  return sourceIntent.test(content);
}

function cleanTitle(value: string): string {
  return value.replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function appendWebSources(reply: string, response: unknown): string {
  const citations = new Map<string, string>();
  const output = (response as ResponseWithWebCitations).output ?? [];
  for (const item of output) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const annotation of part.annotations ?? []) {
        if (annotation.type !== "url_citation" || typeof annotation.url !== "string") continue;
        try {
          const url = new URL(annotation.url);
          if (url.protocol !== "https:" && url.protocol !== "http:") continue;
          citations.set(url.href, cleanTitle(typeof annotation.title === "string" ? annotation.title : url.hostname));
        } catch {
          continue;
        }
      }
    }
  }

  const sources = [...citations].slice(0, 3).map(([url, title]) => `[${title || "Fonte"}](${url})`);
  if (!sources.length) return reply;
  const suffix = `\n\nFontes: ${sources.join(" • ")}`;
  return `${reply.slice(0, Math.max(1, 1_800 - suffix.length)).trim()}${suffix}`;
}
