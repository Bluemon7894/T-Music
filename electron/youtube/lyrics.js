import { call } from './client.js';
import * as P from './parse.js';

const cache = new Map();

const KOREAN_ARTIST_MAP = {
  '아이유': 'IU',
  '이지금': 'IU',
  '방탄소년단': 'BTS',
  '소녀시대': 'Girls\' Generation',
  '동방신기': 'TVXQ',
  '에스파': 'aespa',
  '르세라핌': 'LE SSERAFIM',
  '아이브': 'IVE',
  '뉴진스': 'NewJeans',
  '블랙핑크': 'BLACKPINK',
  '트와이스': 'TWICE',
  '(여자)아이들': '(G)I-DLE',
  '여자아이들': '(G)I-DLE',
  '세븐틴': 'SEVENTEEN',
  '스트레이키즈': 'Stray Kids',
  '엔하이픈': 'ENHYPEN',
  '투모로우바이투게더': 'TOMORROW X TOGETHER',
  '데이식스': 'DAY6',
  '폴킴': 'Paul Kim',
  '박재정': 'Park Jae Jung',
  '성시경': 'Sung Si Kyung',
  '태연': 'Taeyeon',
  '악뮤': 'AKMU',
  '악동뮤지션': 'AKMU',
  '볼빨간사춘기': 'BOL4',
  '십센치': '10cm',
  '잔나비': 'JANNABI',
  '멜로망스': 'MeloMance',
  '헤이즈': 'Heize',
  '크러쉬': 'Crush',
  '자이언티': 'Zion.T',
  '로이킴': 'Roy Kim',
  '이하이': 'Lee Hi',
  '권진아': 'Kwon Jin Ah',
  '비비': 'BIBI',
  '지코': 'ZICO',
  '창모': 'CHANGMO',
  '버즈': 'Buzz',
  '윤하': 'YOUNHA',
  '임영웅': 'Lim Young Woong',
  '백현': 'Baekhyun',
  '카더가든': 'Car, the garden',
  '이승기': 'Lee Seung Gi',
  '정승환': 'Jung Seung Hwan',
  '적재': 'Jukjae',
  '이무진': 'Lee Mu Jin',
  '김범수': 'Kim Bum Soo',
  '박효신': 'Park Hyo Shin',
  '이적': 'Lee Juck',
  '넬': 'NELL',
  '십센치': '10CM',
  '치즈': 'CHEEZE',
  '스텔라장': 'Stella Jang',
  '선우정아': 'sunwoojunga',
  '비오': 'BE\'O',
  '기리보이': 'GIRIBOY',
  '애쉬아일랜드': 'ASH ISLAND',
  '릴러말즈': 'Leellamarz',
};

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

function extractVariants(title, artist, artistsList = []) {
  const titles = new Set();
  const artists = new Set();

  // 1. Title variants
  if (title) {
    const raw = String(title).trim();
    titles.add(raw);

    const noTags = raw
      .replace(/\s*[\(\[](?:Official\s*(?:Music\s*)?Video|M\/?V|Audio|Color\s*Coded\s*Lyrics|가사|MV|Live|Lyric\s*Video)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s*[\(\[](?:feat\.?|prod\.?)[^\)\]]*[\)\]]/gi, '')
      .trim();
    if (noTags) titles.add(noTags);

    // Extract inside/outside parentheses (e.g., "Through the Night (밤편지)", "너를 만나 (Me After You)")
    const parenMatch = raw.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (parenMatch) {
      const p1 = parenMatch[1].trim();
      const p2 = parenMatch[2].trim();
      if (p1) titles.add(p1);
      if (p2 && !/feat|prod|official|mv|live|audio/i.test(p2)) titles.add(p2);
    }
  }

  // 2. Artist variants
  const artistInputs = [
    artist,
    ...(Array.isArray(artistsList) ? artistsList.map((a) => (typeof a === 'string' ? a : a?.name)) : []),
  ].filter(Boolean);

  for (const aIn of artistInputs) {
    const raw = String(aIn).trim();
    artists.add(raw);

    // Match Korean aliases
    for (const [kor, eng] of Object.entries(KOREAN_ARTIST_MAP)) {
      if (raw.includes(kor)) {
        artists.add(eng);
        artists.add(kor);
      }
    }

    // Inside bracket name (e.g. "이지금 [IU Official]" -> "IU")
    const bracket = raw.match(/\[([A-Za-z0-9\s]+?)(?:\s*Official)?\]/i);
    if (bracket && bracket[1]) artists.add(bracket[1].trim());

    // Inside parenthesis (e.g. "윤하 (YOUNHA)" -> "윤하", "YOUNHA")
    const paren = raw.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (paren) {
      if (paren[1]) artists.add(paren[1].trim());
      if (paren[2]) artists.add(paren[2].trim());
    }

    // Separate connected English & Korean (e.g. "izi오진성" -> "izi", "오진성")
    const splitMixed = raw.replace(/([a-zA-Z]+)([가-힣]+)/g, '$1 $2').replace(/([가-힣]+)([a-zA-Z]+)/g, '$1 $2');
    if (splitMixed !== raw) {
      splitMixed.split(/\s+/).forEach((w) => { if (w.length >= 2) artists.add(w); });
    }

    // Clean channel suffixes (- Topic, Official, 채널, etc.)
    const clean = raw
      .replace(/\s*-\s*Topic/i, '')
      .replace(/\s*\[.*?\]/g, '')
      .replace(/\s*\(.*?\)/g, '')
      .replace(/\s*(?:Official|공식|채널)/gi, '')
      .trim();
    if (clean) artists.add(clean);
  }

  return {
    titles: [...titles].filter(Boolean),
    artists: [...artists].filter(Boolean),
  };
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

async function fetchFromLrclib(title, artist, duration, artistsList = []) {
  const { titles, artists } = extractVariants(title, artist, artistsList);
  const headers = { 'User-Agent': 'T-Music/0.2.3 (https://github.com/Bluemon7894/T-Music)' };

  // 1. Direct GET if clean track and artist available
  for (const t of titles.slice(0, 3)) {
    for (const a of artists.slice(0, 3)) {
      try {
        const u = new URL('https://lrclib.net/api/get');
        u.searchParams.set('track_name', t);
        u.searchParams.set('artist_name', a);
        if (duration) u.searchParams.set('duration', String(Math.round(duration)));
        const r = await fetch(u.href, { headers, signal: AbortSignal.timeout(3000) });
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
      } catch {}
    }
  }

  // 2. Search queries
  const queries = [];
  for (const t of titles) {
    for (const a of artists) {
      queries.push(`${t} ${a}`.trim());
    }
  }
  for (const t of titles) {
    queries.push(t.trim());
  }

  const seen = new Set();
  for (const q of queries) {
    if (seen.has(q)) continue;
    seen.add(q);

    try {
      const u = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(3500) });
      if (!r.ok) continue;
      const list = await r.json();
      if (!Array.isArray(list) || list.length === 0) continue;

      let match = list[0];
      if (duration && list.length > 1) {
        const filtered = list.filter((item) => !duration || Math.abs((item.duration || 0) - duration) <= 18);
        if (filtered.length > 0) {
          match = filtered.reduce((best, cur) => {
            const diffCur = Math.abs((cur.duration || 0) - duration);
            const diffBest = Math.abs((best.duration || 0) - duration);
            return diffCur < diffBest ? cur : best;
          }, filtered[0]);
        }
      }

      if (match && (match.plainLyrics || match.syncedLyrics)) {
        return {
          plainLyrics: match.plainLyrics || '',
          syncedLyrics: match.syncedLyrics || null,
          lines: parseLrc(match.syncedLyrics),
        };
      }
    } catch {}
  }

  return null;
}

export async function getLyrics(track) {
  if (!track || !track.id) return { plainLyrics: '', lines: [] };
  if (cache.has(track.id)) return cache.get(track.id);

  const artist = Array.isArray(track.artists) ? track.artists[0]?.name : track.artist || '';
  const title = track.title || '';
  const duration = track.duration || 0;

  // 1. Try LRCLIB first to see if we can get real-time synced lyrics
  const lrc = await fetchFromLrclib(title, artist, duration, track.artists);
  if (lrc && lrc.lines && lrc.lines.length > 0) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  // 2. Try YouTube Music official lyrics
  const ytm = await fetchFromYouTubeMusic(track.id);
  if (ytm && ytm.plainLyrics) {
    // If LRCLIB had plain lyrics but no sync, prefer LRCLIB if YTM didn't exist, else YTM
    const result = ytm;
    cache.set(track.id, result);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return result;
  }

  // 3. If LRCLIB had plain text lyrics at least
  if (lrc && lrc.plainLyrics) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  const empty = { plainLyrics: '', lines: [] };
  cache.set(track.id, empty);
  return empty;
}
