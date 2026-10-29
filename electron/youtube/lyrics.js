import { call } from './client.js';
import * as P from './parse.js';

const cache = new Map();

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = [];
  const re = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)/;
  for (const raw of lrcText.split('\n')) {
    const m = re.exec(raw);
    if (m) {
      const time = Number(m[1]) * 60 + Number(m[2]);
      const text = m[3].trim();
      lines.push({ time, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function cleanTitle(title) {
  if (!title) return '';
  return title
    .replace(/\s*[\(\[](?:Official\s*(?:Music\s*)?Video|M\/?V|Audio|Color\s*Coded\s*Lyrics|가사|MV|Live|Lyric\s*Video)[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[](?:feat\.?|prod\.?)[^\)\]]*[\)\]]/gi, '')
    .trim();
}

async function fetchFromYouTubeMusic(videoId) {
  try {
    const nextRes = await call('/next', { client: 'YTMUSIC', videoId });
    const tabs = P.findAll(nextRes, 'tabRenderer');
    const lyricsTab = tabs.find((t) => t.endpoint?.browseEndpoint?.browseId && (t.title?.includes('가사') || t.title?.includes('Lyrics')));
    if (!lyricsTab) return null;
    const browseId = lyricsTab.endpoint.browseEndpoint.browseId;
    const browseRes = await call('/browse', { client: 'YTMUSIC', browseId });
    const shelf = P.find(browseRes, 'musicDescriptionShelfRenderer');
    if (!shelf) return null;
    const plainLyrics = shelf.description?.runs?.map((r) => r.text).join('') || '';
    if (!plainLyrics || plainLyrics.includes('가사가 제공되지 않음')) return null;
    const footer = shelf.footer?.runs?.map((r) => r.text).join('') || '';
    return { plainLyrics, syncedLyrics: null, lines: [], footer };
  } catch {
    return null;
  }
}

async function fetchFromLrclib(title, artist, duration) {
  const cleaned = cleanTitle(title);
  const artistName = artist || '';
  const headers = { 'User-Agent': 'T-Music/0.2.1 (https://github.com/bluemon7894)' };

  // 1. Try exact get if we have clean info
  if (cleaned && artistName) {
    try {
      const u = new URL('https://lrclib.net/api/get');
      u.searchParams.set('track_name', cleaned);
      u.searchParams.set('artist_name', artistName);
      if (duration) u.searchParams.set('duration', String(Math.round(duration)));
      const r = await fetch(u.href, { headers, signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const d = await r.json();
        if (d.plainLyrics || d.syncedLyrics) {
          return {
            plainLyrics: d.plainLyrics || '',
            syncedLyrics: d.syncedLyrics || null,
            lines: parseLrc(d.syncedLyrics),
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Try search queries with fallback variants
  const queries = [
    `${cleaned} ${artistName}`.trim(),
    cleaned,
    `${title} ${artistName}`.trim(),
  ].filter(Boolean);

  for (const q of [...new Set(queries)]) {
    try {
      const u = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const list = await r.json();
        if (Array.isArray(list) && list.length > 0) {
          // If duration is provided, find the closest match
          let match = list[0];
          if (duration && list.length > 1) {
            match = list.reduce((best, cur) => {
              const diffCur = Math.abs((cur.duration || 0) - duration);
              const diffBest = Math.abs((best.duration || 0) - duration);
              return diffCur < diffBest ? cur : best;
            }, list[0]);
          }
          if (match.plainLyrics || match.syncedLyrics) {
            return {
              plainLyrics: match.plainLyrics || '',
              syncedLyrics: match.syncedLyrics || null,
              lines: parseLrc(match.syncedLyrics),
            };
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export async function getLyrics(track) {
  if (!track || !track.id) return { plainLyrics: '', lines: [] };
  if (cache.has(track.id)) return cache.get(track.id);

  const artist = Array.isArray(track.artists) ? track.artists[0]?.name : track.artist || '';
  const title = track.title || '';
  const duration = track.duration || 0;

  // 1. Try YouTube Music official lyrics
  let res = await fetchFromYouTubeMusic(track.id);

  // 2. Fallback to LRCLIB (often provides synced lyrics)
  if (!res || (!res.plainLyrics && !res.syncedLyrics)) {
    const lrc = await fetchFromLrclib(title, artist, duration);
    if (lrc) res = lrc;
  }

  const result = res || { plainLyrics: '', lines: [] };
  cache.set(track.id, result);
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return result;
}
