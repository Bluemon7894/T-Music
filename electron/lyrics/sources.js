// Lyrics databases. Every search returns the same shape:
//   { id, source, trackName, artistName, albumName, duration, altNames?, load() -> { synced, plain } }
// NetEase, QQ and Kugou are unofficial endpoints with far better Korean coverage than
// LRCLIB; any of them failing just leaves the others to cover for it.
import { call, getClient } from '../youtube/client.js';
import * as P from '../youtube/parse.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const TIMEOUT = 5000;

async function fetchJson(url, init = {}, { retries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
      // LRCLIB answers 503 "server busy" a lot; that isn't the same as "no lyrics".
      if ((res.status === 503 || res.status === 429) && attempt < retries) throw new Error(`HTTP ${res.status}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

// ---- LRCLIB ----
const LRCLIB_HEADERS = { 'User-Agent': 'T-Music (https://github.com/Bluemon7894/T-Music)' };

function fromLrclib(item) {
  if (!item || item.instrumental || (!item.syncedLyrics && !item.plainLyrics)) return null;
  const lyrics = { synced: item.syncedLyrics || null, plain: item.plainLyrics || null };
  return {
    id: `lrclib-${item.id}`,
    source: 'LRCLIB',
    trackName: item.trackName || '',
    artistName: item.artistName || '',
    albumName: item.albumName || '',
    duration: item.duration || 0,
    load: async () => lyrics,
  };
}

async function lrclib({ title, artist, free }, meta) {
  const jobs = [];
  if (free) {
    jobs.push(fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(free)}`, { headers: LRCLIB_HEADERS }, { retries: 2 }));
  } else {
    const u = new URL('https://lrclib.net/api/search');
    u.searchParams.set('track_name', title);
    if (artist) u.searchParams.set('artist_name', artist);
    jobs.push(fetchJson(u.href, { headers: LRCLIB_HEADERS }, { retries: 2 }));
    if (artist && meta.duration > 0) {
      const g = new URL('https://lrclib.net/api/get');
      g.searchParams.set('track_name', title);
      g.searchParams.set('artist_name', artist);
      g.searchParams.set('duration', String(Math.round(meta.duration)));
      jobs.push(fetchJson(g.href, { headers: LRCLIB_HEADERS }, { retries: 1 }).then((x) => (x ? [x] : [])));
    }
  }
  const settled = await Promise.allSettled(jobs);
  if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
  return settled
    .flatMap((r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []))
    .map(fromLrclib)
    .filter(Boolean);
}

// ---- NetEase Cloud Music ----
const NETEASE_HEADERS = { 'User-Agent': BROWSER_UA, Referer: 'https://music.163.com/' };

async function netease({ title, artist, free }) {
  const body = new URLSearchParams({ s: free || `${title} ${artist}`.trim(), type: '1', limit: '12', offset: '0' });
  const j = await fetchJson('https://music.163.com/api/search/get', {
    method: 'POST',
    body,
    headers: { ...NETEASE_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return (j?.result?.songs || []).map((s) => ({
    id: `netease-${s.id}`,
    source: 'NetEase',
    trackName: s.name || '',
    altNames: [...(s.alias || []), ...(s.transNames || [])],
    artistName: (s.artists || []).map((a) => a.name).join(', '),
    albumName: s.album?.name || '',
    duration: (s.duration || 0) / 1000,
    load: async () => {
      const l = await fetchJson(`https://music.163.com/api/song/lyric?id=${s.id}&lv=1&kv=1&tv=-1`, { headers: NETEASE_HEADERS });
      return { synced: l?.lrc?.lyric || null, plain: null };
    },
  }));
}

// ---- QQ Music ----
const QQ_HEADERS = { 'User-Agent': BROWSER_UA, Referer: 'https://y.qq.com/portal/player.html' };

async function qq({ title, artist, free }) {
  const q = encodeURIComponent(free || `${title} ${artist}`.trim());
  const j = await fetchJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&inCharset=utf8&outCharset=utf8&platform=yqq.json&n=12&p=1&w=${q}`, { headers: QQ_HEADERS });
  return (j?.data?.song?.list || []).map((s) => ({
    id: `qq-${s.songmid}`,
    source: 'QQ 뮤직',
    trackName: s.songname || '',
    altNames: [s.songorig, s.lyric].filter(Boolean),
    artistName: (s.singer || []).map((a) => a.name).join(', '),
    albumName: s.albumname || '',
    duration: s.interval || 0,
    load: async () => {
      const l = await fetchJson(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${s.songmid}&format=json&nobase64=1&g_tk=5381`, { headers: QQ_HEADERS });
      return { synced: l?.lyric || null, plain: null };
    },
  }));
}

// ---- Kugou ----
async function kugou({ title, artist, free }, meta) {
  const keyword = free || (artist ? `${artist} - ${title}` : title);
  const dur = meta.duration > 0 ? `&duration=${Math.round(meta.duration * 1000)}` : '';
  const j = await fetchJson(`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(keyword)}${dur}&hash=`, { headers: { 'User-Agent': BROWSER_UA } });
  return (j?.candidates || []).map((c) => ({
    id: `kugou-${c.id}`,
    source: 'Kugou',
    trackName: c.song || '',
    artistName: c.singer || '',
    albumName: '',
    duration: (c.duration || 0) / 1000,
    load: async () => {
      const d = await fetchJson(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${c.id}&accesskey=${c.accesskey}&fmt=lrc&charset=utf8`, { headers: { 'User-Agent': BROWSER_UA } });
      return { synced: d?.content ? Buffer.from(d.content, 'base64').toString('utf8') : null, plain: null };
    },
  }));
}

export const SYNC_SOURCES = { lrclib, netease, qq, kugou };

// ---- the video's own captions ----
// Creator-written captions are timed to this exact upload, so they stay in sync on music
// videos whose intro and outro throw off every database. Auto-generated ones are skipped,
// and so are translations: only the song's own language counts.
export async function videoCaptions(videoId, meta) {
  const yt = await getClient();
  const info = await yt.getBasicInfo(videoId, { client: 'VISIONOS' });
  const manual = (info.captions?.caption_tracks || []).filter((t) => t.kind !== 'asr');
  const wanted = meta.isKorean ? /^ko/ : meta.titles.some((t) => /[぀-ヿ]/.test(t)) ? /^ja/ : /^en/;
  const track = manual.find((t) => wanted.test(t.language_code));
  if (!track) return null;
  const j = await fetchJson(`${track.base_url}&fmt=json3`, { headers: { 'User-Agent': BROWSER_UA } });
  const lines = (j?.events || [])
    .filter((e) => e.segs)
    .map((e) => ({
      time: (e.tStartMs || 0) / 1000,
      text: e.segs.map((s) => s.utf8 || '').join('').replace(/\s*\n\s*/g, ' ').replace(/[♪♫]/g, '').trim(),
    }))
    .filter((l) => l.text && !/^[[(].*[\])]$/.test(l.text));
  return lines.length ? lines : null;
}

// ---- plain-text fallbacks ----
export async function youtubeMusicPlain(videoId) {
  try {
    const next = await call('/next', { client: 'YTMUSIC', videoId });
    const tab = P.findAll(next, 'tabRenderer').find((t) => t.endpoint?.browseEndpoint?.browseId && /가사|lyrics/i.test(t.title || ''));
    if (!tab) return null;
    const page = await call('/browse', { client: 'YTMUSIC', browseId: tab.endpoint.browseEndpoint.browseId });
    const shelf = P.find(page, 'musicDescriptionShelfRenderer');
    const text = shelf?.description?.runs?.map((r) => r.text).join('') || '';
    if (!text || text.includes('가사가 제공되지 않음')) return null;
    return { text, footer: shelf.footer?.runs?.map((r) => r.text).join('') || '출처: YouTube Music' };
  } catch {
    return null;
  }
}

export async function naverPlain(title, artist) {
  try {
    const q = encodeURIComponent(`${artist} ${title} 가사`.trim());
    const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&ie=utf8&query=${q}`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/class="[^"]*(?:_content_text|lyrics_box|text_area)[^"]*"[^>]*>(.*?)<\/(?:div|p)>/is);
    if (!m) return null;
    return m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim() || null;
  } catch {
    return null;
  }
}
