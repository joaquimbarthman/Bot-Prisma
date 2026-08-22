import type { HistoryItem } from "./store.js";

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const lyricFragment = "(?:parte|trecho|verso|linha|peda[cç]o|frase|palavra|momento)";
const appreciation = "(?:gosta|curte|aprecia|prefere|favorit[oa]|acha mais bonit[oa]|acha melhor|mais te (?:pega|toca|marca)|te chama mais aten[cç][aã]o)";
const appreciationQuestion = new RegExp([
  `\\b(?:qual|que)\\s+${lyricFragment}\\b.{0,120}\\b(?:m[uú]sica|can[cç][aã]o|letra|${appreciation})\\b`,
  `\\b${lyricFragment}\\b.{0,100}\\b(?:mais\\s+)?${appreciation}\\b`,
  `\\b(?:o que|oq)\\b.{0,30}\\b(?:mais\\s+)?(?:te|vc|voc[eê])\\s+(?:pega|toca|marca|chama\\s+aten[cç][aã]o)\\b.{0,80}\\b(?:letra|m[uú]sica|can[cç][aã]o|nela|dela|nessa|nessa letra)\\b`,
  `\\btem\\s+(?:alguma?|uma?)\\s+${lyricFragment}\\b.{0,80}\\b(?:te\\s+(?:pega|toca|marca)|chama\\s+aten[cç][aã]o|gosta|curte|prefere)\\b`,
  `\\b(?:escolhe|escolha|cita|cite|fala|fale|manda|mande)\\s+(?:uma?|alguma?)\\s+${lyricFragment}\\b.{0,80}\\b(?:letra|m[uú]sica|can[cç][aã]o|dela|nela|dessa|desse)\\b`,
  `\\bem\\s+qual\\s+${lyricFragment}\\b.{0,50}\\b(?:ela|a letra|a m[uú]sica)\\b.{0,30}\\b(?:fica melhor|te pega|te toca|te marca)\\b`,
].join("|"), "iu");

export type LyricsResearch = {
  trackName: string;
  artistName: string;
  lyrics: string;
};

type LrclibTrack = {
  trackName?: unknown;
  artistName?: unknown;
  plainLyrics?: unknown;
  syncedLyrics?: unknown;
};

export function asksFavoriteSongPart(content: string): boolean {
  return appreciationQuestion.test(content.replace(/<@!?\d+>/g, " "));
}

function cleanQuery(value: string): string {
  return value
    .replace(/<@!?\d+>/g, " ")
    .replace(/\b(?:prisma|qual|que|o que|oq|parte|trecho|verso|linha|peda[cç]o|frase|palavra|momento|da|dessa|desta|desse|nessa|nesta|de|uma?|alguma?|m[uú]sica|can[cç][aã]o|letra|voc[eê]|vc|te|mais|gosta|curte|aprecia|prefere|favorit[oa]|pega|toca|marca|chama|aten[cç][aã]o|bonit[oa]|melhor|escolhe|escolha|cita|cite|manda|mande|tem|fica|ouvindo|escutando|e|é|pra|para|mim|me|diz|fala|fale|agora|agr)\b/giu, " ")
    .replace(/[?!.,:;()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usefulQuery(value: string): boolean {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return value.length >= 2
    && !/^(?:dela|dele|delas|deles|essa|esse|isso|nela|nele|aquela|aquele|musica|cancao)$/.test(normalized);
}

function activityQuery(description: string): string {
  const match = description.match(/\bouvindo\s+["“”]?(.+?)["“”]?\s+de\s+(.+)$/iu);
  return match ? `${match[1]} ${match[2]}`.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim() : cleanQuery(description);
}

export function lyricsSearchQueries(content: string, history: HistoryItem[] = [], contextHints: string[] = []): string[] {
  const quoted = [...content.matchAll(/["“]([^"”]{2,100})["”]/g)].map((match) => match[1].trim());
  const current = cleanQuery(content);
  const contextualHints = contextHints.map(activityQuery).filter(usefulQuery);
  const recent = [...history].reverse().slice(0, 6).flatMap((item) => {
    const quotes = [...item.content.matchAll(/["“]([^"”]{2,100})["”]/g)].map((match) => match[1].trim());
    const named = [...item.content.matchAll(/\b(?:m[uú]sica|ouvindo|escutando)\s+([^.!?\n]{2,100})/giu)].map((match) => match[1].trim());
    const contextual = cleanQuery(item.content);
    return [...quotes, ...named, ...(contextual.length >= 2 && contextual.length <= 120 ? [contextual] : [])];
  });
  const contextualQuestion = !quoted.length && (!usefulQuery(current) || /\b(?:dela|dele|dessa|desse|nela|nele|essa|esse|isso)\b/iu.test(content));
  const ordered = contextualQuestion
    ? [...contextualHints, ...recent, current]
    : [...quoted, current, ...contextualHints, ...recent];
  return [...new Set(ordered.map((value) => value.replace(/\s+/g, " ").trim()).filter(usefulQuery))].slice(0, 5);
}

function plainLyrics(track: LrclibTrack): string {
  if (typeof track.plainLyrics === "string" && track.plainLyrics.trim()) return track.plainLyrics.trim();
  if (typeof track.syncedLyrics !== "string") return "";
  return track.syncedLyrics.replace(/^\[[^\]]+\]\s*/gm, "").trim();
}

export async function researchLyrics(
  content: string,
  history: HistoryItem[] = [],
  fetcher: typeof fetch = fetch,
  contextHints: string[] = [],
): Promise<LyricsResearch | null> {
  if (!asksFavoriteSongPart(content)) return null;
  for (const query of lyricsSearchQueries(content, history, contextHints)) {
    try {
      const response = await fetcher(`${LRCLIB_SEARCH_URL}?q=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "Bot-Prisma/1.0 (lyrics-context)" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;
      const payload = await response.json() as unknown;
      if (!Array.isArray(payload)) continue;
      for (const candidate of payload.slice(0, 10) as LrclibTrack[]) {
        const lyrics = plainLyrics(candidate);
        if (!lyrics) continue;
        return {
          trackName: typeof candidate.trackName === "string" ? candidate.trackName.slice(0, 160) : "música encontrada",
          artistName: typeof candidate.artistName === "string" ? candidate.artistName.slice(0, 160) : "artista não informado",
          lyrics: lyrics.slice(0, 8_000),
        };
      }
    } catch {
      // Tenta a próxima forma de identificar a música no contexto recente.
    }
  }
  return null;
}
