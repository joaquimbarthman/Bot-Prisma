import type { HistoryItem } from "./store.js";

const LRCLIB_BASE_URL = "https://lrclib.net/api";
const REQUEST_HEADERS = { "User-Agent": "Bot-Prisma/1.0 (lyrics-context)" };
export type LyricsIntent = "full_lyrics" | "excerpt" | "favorite_part" | "meaning" | "unknown";
export type TrackQuery = { trackName: string; artistName?: string; albumName?: string; duration?: number; source: "user" | "spotify" | "history" | "context" };
export type LyricsResearch = { status: "found"; intent: Exclude<LyricsIntent, "unknown">; trackName: string; artistName: string; lyrics: string; confidence: "high" };
export type LyricsResearchResult = LyricsResearch
  | { status: "ambiguous"; intent: Exclude<LyricsIntent, "unknown">; candidates: Array<{ trackName: string; artistName: string }> }
  | { status: "not_found" | "temporary_error"; intent: Exclude<LyricsIntent, "unknown"> }
  | { status: "not_requested"; intent: "unknown" };
type LrclibTrack = { trackName?: unknown; artistName?: unknown; albumName?: unknown; duration?: unknown; plainLyrics?: unknown; syncedLyrics?: unknown };
const lyricsCache = new Map<string, LyricsResearch>();
export type LyricsRuntimeStatus = { configured: true; lastQueryAt?: string; intent?: LyricsIntent; trackName?: string; artistName?: string; source?: TrackQuery["source"]; returnedCandidates?: number; status?: LyricsResearchResult["status"]; error?: string };
let lyricsRuntimeStatus: LyricsRuntimeStatus = { configured: true };
export function getLyricsRuntimeStatus(): LyricsRuntimeStatus { return { ...lyricsRuntimeStatus }; }
const VERSION_WORDS = /\b(?:remaster(?:ed)?|live|acoustic|sped up|slowed|remix|radio edit|extended|instrumental|karaoke)\b/gi;

export function normalizeTrackText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function detectLyricsIntent(content: string): LyricsIntent {
  const text = normalizeTrackText(content.replace(/<@!?\d+>/g, " "));
  if (!/\b(?:letra|musica|cancao|trecho|verso|parte|linha|dela|dessa|nessa)\b/.test(text)) return "unknown";
  if (/\b(?:oq|o que|que)\b.{0,30}\b(?:significa|quer dizer|fala|trata)\b|\b(?:significado|sentido)\b/.test(text)) return "meaning";
  if (/\b(?:trecho|verso|parte|linha|letra)\b/.test(text) && /\b(?:favorit[oa]|mais gosta|mais curte|prefere|mais te (?:pega|toca|marca)|chama.*atencao)\b/.test(text)) return "favorite_part";
  if (/\b(?:trecho|verso|linha|pedaco|frase|parte)\b/.test(text)) return "excerpt";
  if (/\bletra\b/.test(text) && /\b(?:manda|mande|qual|mostra|envia|pode|quero|queria)\b/.test(text)) return "full_lyrics";
  return "unknown";
}

export function asksFavoriteSongPart(content: string): boolean { return detectLyricsIntent(content) !== "unknown"; }
function trimValue(value: string): string { return value.replace(/^[\s"“”'`.,:;-]+|[\s"“”'`.,:;-]+$/g, "").replace(/\s+/g, " ").trim(); }
function splitArtist(value: string): { trackName: string; artistName?: string } {
  const separators = [...value.matchAll(/\s+(?:da|do|de|por|by)\s+/giu)]; const separator = separators.at(-1);
  if (!separator?.index) return { trackName: trimValue(value) };
  const trackName = trimValue(value.slice(0, separator.index)); const artistName = trimValue(value.slice(separator.index + separator[0].length));
  return trackName && artistName ? { trackName, artistName } : { trackName: trimValue(value) };
}

export function trackQueryFromUser(content: string): TrackQuery | null {
  const text = content.replace(/<@!?\d+>/g, " ").replace(/^\s*prisma\s*[,;:!-]?\s*/iu, "").trim();
  const quoted = text.match(/["“]([^"”]{2,160})["”](?:\s+(?:da|do|de|por|by)\s+([^?!.]+))?/iu);
  if (quoted) return { trackName: trimValue(quoted[1]), ...(quoted[2] ? { artistName: trimValue(quoted[2]) } : {}), source: "user" };
  const wrapper = text.match(/^(?:(?:me\s+)?(?:manda|mande|envia|envie|mostra|mostre|diz|fala)\s+|(?:qual|oq|o que)\s+(?:e|é)?\s*)?(?:(?:a|um|uma|algum|qual)\s+)?(?:letra|trecho|verso|parte|linha|significado)(?:\s+(?:favorit[oa]|preferid[oa]))?\s+(?:(?:dessa|desta|nessa|da|de)\s+)?(.+?)\s*[?!.]*$/iu);
  if (!wrapper?.[1]) return null;
  const remainder = trimValue(wrapper[1]);
  if (!remainder || /^(?:dela|dessa|desta|nessa|essa|esta|musica|letra)$/iu.test(remainder)) return null;
  return { ...splitArtist(remainder), source: "user" };
}

function activityTrack(description: string): TrackQuery | null {
  const match = description.match(/\bouvindo\s+["“”]?(.+?)["“”]?\s+de\s+(.+)$/iu);
  return match ? { trackName: trimValue(match[1]), artistName: trimValue(match[2]), source: "spotify" } : null;
}
function historyTrack(item: HistoryItem): TrackQuery | null {
  const direct = trackQueryFromUser(item.content); if (direct) return { ...direct, source: "history" };
  const activity = activityTrack(item.content); if (activity) return { ...activity, source: "history" };
  const named = item.content.match(/["“]([^"”]{2,160})["”]\s*(?:,?\s*(?:da|de|por)\s+)([^,.!?\n]{2,100})/iu);
  return named ? { trackName: trimValue(named[1]), artistName: trimValue(named[2]), source: "history" } : null;
}
function sameQuery(a: TrackQuery, b: TrackQuery): boolean { return normalizeTrackText(a.trackName) === normalizeTrackText(b.trackName) && normalizeTrackText(a.artistName ?? "") === normalizeTrackText(b.artistName ?? ""); }

export function buildTrackCandidates(content: string, history: HistoryItem[] = [], contextHints: string[] = []): TrackQuery[] {
  const explicit = trackQueryFromUser(content);
  const reference = /\b(?:dela|dessa|desta|nessa|essa|esta)(?:\s+(?:musica|letra))?\b|\bessa\s+(?:q|que)\s+(?:eu\s+)?(?:to|estou)\s+ouvindo\b/iu.test(content);
  const recent = [...history].reverse().slice(0, 8).map(historyTrack).filter((x): x is TrackQuery => !!x);
  const spotify = contextHints.map(activityTrack).filter((x): x is TrackQuery => !!x);
  const ordered = explicit ? [explicit, ...recent, ...spotify] : reference ? [...recent, ...spotify] : [...recent];
  return ordered.filter((q, i, all) => q.trackName.length >= 2 && all.findIndex((other) => sameQuery(q, other)) === i).slice(0, 5);
}
export function lyricsSearchQueries(content: string, history: HistoryItem[] = [], hints: string[] = []): string[] { return buildTrackCandidates(content, history, hints).map((q) => [q.trackName, q.artistName].filter(Boolean).join(" ")); }

function plainLyrics(track: LrclibTrack): string {
  if (typeof track.plainLyrics === "string" && track.plainLyrics.trim()) return track.plainLyrics.trim();
  return typeof track.syncedLyrics === "string" ? track.syncedLyrics.replace(/^\[[^\]]+\]\s*/gm, "").trim() : "";
}
function metadata(track: LrclibTrack) {
  if (typeof track.trackName !== "string" || typeof track.artistName !== "string") return null;
  return { trackName: track.trackName, artistName: track.artistName, ...(typeof track.albumName === "string" ? { albumName: track.albumName } : {}), ...(typeof track.duration === "number" ? { duration: track.duration } : {}) };
}
function baseTitle(value: string): string { return normalizeTrackText(value.replace(VERSION_WORDS, " ")); }
function requestedVersion(query: TrackQuery): boolean { VERSION_WORDS.lastIndex = 0; return VERSION_WORDS.test(query.trackName); }

export function candidateScore(candidate: LrclibTrack, expected: TrackQuery): number | null {
  const data = metadata(candidate); if (!data || !plainLyrics(candidate)) return null;
  const title = normalizeTrackText(data.trackName), wanted = normalizeTrackText(expected.trackName);
  if (title !== wanted && baseTitle(data.trackName) !== baseTitle(expected.trackName)) return null;
  let score = title === wanted ? 60 : 42;
  if (expected.artistName) {
    const artist = normalizeTrackText(data.artistName), wantedArtist = normalizeTrackText(expected.artistName);
    if (artist !== wantedArtist && !artist.includes(wantedArtist) && !wantedArtist.includes(artist)) { console.debug(`[Lyrics] rejected candidate artist mismatch expected="${expected.artistName}" received="${data.artistName}"`); return null; }
    score += artist === wantedArtist ? 40 : 25;
  }
  if (expected.albumName && data.albumName && normalizeTrackText(expected.albumName) === normalizeTrackText(data.albumName)) score += 10;
  if (expected.duration && data.duration && Math.abs(expected.duration - data.duration) <= 3) score += 10;
  VERSION_WORDS.lastIndex = 0; if (!requestedVersion(expected) && VERSION_WORDS.test(data.trackName)) score -= 20;
  return score;
}
export function candidateMatches(candidate: LrclibTrack, expected: TrackQuery): boolean { return candidateScore(candidate, expected) !== null; }
function cacheKey(q: TrackQuery): string | null { return q.artistName ? `${normalizeTrackText(q.trackName)}::${normalizeTrackText(q.artistName)}` : null; }
async function requestJson(url: string, fetcher: typeof fetch) {
  try { const response = await fetcher(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(5_000) }); if (!response.ok) return { ok: false, temporary: response.status >= 500 || response.status === 429 }; return { ok: true, payload: await response.json() as unknown, temporary: false }; }
  catch { return { ok: false, temporary: true }; }
}
function found(track: LrclibTrack, intent: Exclude<LyricsIntent, "unknown">): LyricsResearch | null {
  const data = metadata(track), lyrics = plainLyrics(track); if (!data || !lyrics) return null;
  return { status: "found", intent, trackName: data.trackName.slice(0, 160), artistName: data.artistName.slice(0, 160), lyrics: lyrics.slice(0, 8_000), confidence: "high" };
}

export async function researchLyrics(content: string, history: HistoryItem[] = [], fetcher: typeof fetch = fetch, hints: string[] = []): Promise<LyricsResearchResult> {
  const intent = detectLyricsIntent(content); if (intent === "unknown") return { status: "not_requested", intent };
  const queries = buildTrackCandidates(content, history, hints); if (!queries.length) return { status: "not_found", intent };
  let temporary = false; const ambiguous = new Map<string, { trackName: string; artistName: string }>();
  for (const query of queries) {
    lyricsRuntimeStatus = { configured: true, lastQueryAt: new Date().toISOString(), intent, trackName: query.trackName, artistName: query.artistName, source: query.source };
    console.debug(`[Lyrics] intent=${intent} source=${query.source} track="${query.trackName}" artist="${query.artistName ?? ""}"`);
    const key = cacheKey(query); if (key && lyricsCache.has(key)) return lyricsCache.get(key)!;
    if (query.artistName) {
      const params = new URLSearchParams({ track_name: query.trackName, artist_name: query.artistName }); if (query.albumName) params.set("album_name", query.albumName); if (query.duration) params.set("duration", String(Math.round(query.duration)));
      const exact = await requestJson(`${LRCLIB_BASE_URL}/get?${params}`, fetcher); temporary ||= exact.temporary;
      if (exact.ok && exact.payload && !Array.isArray(exact.payload) && candidateMatches(exact.payload as LrclibTrack, query)) { const result = found(exact.payload as LrclibTrack, intent); if (result) { if (key) lyricsCache.set(key, result); return result; } }
    }
    const params = new URLSearchParams({ track_name: query.trackName }); if (query.artistName) params.set("artist_name", query.artistName);
    const searched = await requestJson(`${LRCLIB_BASE_URL}/search?${params}`, fetcher); temporary ||= searched.temporary;
    let payload = searched.ok && Array.isArray(searched.payload) ? searched.payload as LrclibTrack[] : [];
    if (!payload.length) { const fallback = await requestJson(`${LRCLIB_BASE_URL}/search?q=${encodeURIComponent([query.trackName, query.artistName].filter(Boolean).join(" "))}`, fetcher); temporary ||= fallback.temporary; payload = fallback.ok && Array.isArray(fallback.payload) ? fallback.payload as LrclibTrack[] : []; }
    console.debug(`[Lyrics] search returned=${payload.length}`);
    lyricsRuntimeStatus.returnedCandidates = payload.length;
    const ranked = payload.map((track) => ({ track, score: candidateScore(track, query) })).filter((x): x is { track: LrclibTrack; score: number } => x.score !== null).sort((a, b) => b.score - a.score);
    if (!query.artistName) {
      for (const item of ranked) { const data = metadata(item.track); if (data) ambiguous.set(`${normalizeTrackText(data.trackName)}::${normalizeTrackText(data.artistName)}`, { trackName: data.trackName, artistName: data.artistName }); }
      if (new Set([...ambiguous.values()].map((x) => normalizeTrackText(x.artistName))).size > 1) continue;
    }
    if (ranked[0] && ranked[0].score >= (query.artistName ? 65 : 55)) { const result = found(ranked[0].track, intent); if (result) { lyricsRuntimeStatus = { ...lyricsRuntimeStatus, status: "found", trackName: result.trackName, artistName: result.artistName }; console.debug(`[Lyrics] selected="${result.trackName}" / "${result.artistName}" score=${ranked[0].score}`); if (key) lyricsCache.set(key, result); return result; } }
  }
  if (ambiguous.size > 1) { lyricsRuntimeStatus = { ...lyricsRuntimeStatus, status: "ambiguous" }; return { status: "ambiguous", intent, candidates: [...ambiguous.values()].slice(0, 5) }; }
  const status = temporary ? "temporary_error" : "not_found"; lyricsRuntimeStatus = { ...lyricsRuntimeStatus, status, ...(temporary ? { error: "Falha temporária na consulta ao LRCLIB." } : {}) }; return { status, intent };
}
