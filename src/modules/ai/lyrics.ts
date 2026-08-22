import type { HistoryItem } from "./store.js";

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const appreciationQuestion = /\b(?:qual|que)\s+(?:parte|trecho|verso|linha|peda[cç]o)\b.{0,100}\b(?:m[uú]sica|can[cç][aã]o|letra|gosta|curte|aprecia|prefere|favorit[oa])\b|\b(?:parte|trecho|verso|linha|peda[cç]o)\b.{0,80}\b(?:mais\s+)?(?:gosta|curte|aprecia|prefere|favorit[oa])\b/iu;

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
    .replace(/\b(?:prisma|qual|que|parte|trecho|verso|linha|peda[cç]o|da|dessa|desta|de|uma?|m[uú]sica|can[cç][aã]o|letra|voc[eê]|vc|mais|gosta|curte|aprecia|prefere|favorit[oa]|e|é|pra|para|mim|me|diz|fala)\b/giu, " ")
    .replace(/[?!.,:;()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function lyricsSearchQueries(content: string, history: HistoryItem[] = []): string[] {
  const quoted = [...content.matchAll(/["“”']([^"“”']{2,100})["“”']/g)].map((match) => match[1].trim());
  const current = cleanQuery(content);
  const recent = [...history].reverse().slice(0, 6).flatMap((item) => {
    const quotes = [...item.content.matchAll(/["“”']([^"“”']{2,100})["“”']/g)].map((match) => match[1].trim());
    const named = [...item.content.matchAll(/\b(?:m[uú]sica|ouvindo|escutando)\s+([^.!?\n]{2,100})/giu)].map((match) => match[1].trim());
    const contextual = cleanQuery(item.content);
    return [...quotes, ...named, ...(contextual.length >= 2 && contextual.length <= 120 ? [contextual] : [])];
  });
  return [...new Set([...quoted, current, ...recent].map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length >= 2))].slice(0, 5);
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
): Promise<LyricsResearch | null> {
  if (!asksFavoriteSongPart(content)) return null;
  for (const query of lyricsSearchQueries(content, history)) {
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
