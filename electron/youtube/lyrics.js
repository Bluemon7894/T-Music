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
  '치즈': 'CHEEZE',
  '스텔라장': 'Stella Jang',
  '선우정아': 'sunwoojunga',
  '비오': 'BE\'O',
  '기리보이': 'GIRIBOY',
  '애쉬아일랜드': 'ASH ISLAND',
  '릴러말즈': 'Leellamarz',
};

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*[\(\[](?:feat\.?|prod\.?|official|mv|audio|live|remix|acoustic|ver\.|version|inst|instrumental)[^\)\]]*[\)\]]/gi, '')
    .replace(/[\(\[\{][^\)\]\}]*[\)\]\}]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function hasVersionKeyword(str, kw) {
  const re = new RegExp(`\\b${kw}\\b|[\\(\\[\\s]${kw}[\\)\\]\\s]`, 'i');
  return re.test(str || '');
}

export function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = [];

  // Parse global [offset: +/-ms] tag if present
  let offsetMs = 0;
  const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    offsetMs = parseInt(offsetMatch[1], 10) || 0;
  }
  const offsetSec = offsetMs / 1000;

  const tagRegex = /\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\]/g;
  for (const raw of lrcText.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^\[(ti|ar|al|by|offset|length|re|ve):/i.test(trimmed)) continue;

    const timestamps = [];
    let match;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(trimmed)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const time = Math.max(0, minutes * 60 + seconds + offsetSec);
      timestamps.push(time);
    }

    if (timestamps.length > 0) {
      const text = trimmed.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
      for (const time of timestamps) {
        lines.push({ time, text });
      }
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

    // Title inside quotes (e.g. NewJeans 'Ditto' Official MV)
    const quoteMatch = raw.match(/['"']([^'"']+)['"']/);
    if (quoteMatch && quoteMatch[1].trim()) {
      titles.add(quoteMatch[1].trim());
    }

    // Artist - Title format (e.g. IU - 밤편지)
    const dashMatch = raw.match(/^[^-]+-\s*(.+)$/);
    if (dashMatch && dashMatch[1].trim()) {
      titles.add(dashMatch[1].trim());
    }

    const noTags = raw
      .replace(/\s*[\(\[](?:Official\s*(?:Music\s*)?Video|M\/?V|Audio|Color\s*Coded\s*Lyrics|가사|MV|Live|Lyric\s*Video)[^\)\]]*[\)\]]/gi, '')
      .replace(/\s*[\(\[](?:feat\.?|prod\.?)[^\)\]]*[\)\]]/gi, '')
      .trim();
    if (noTags) titles.add(noTags);

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

    for (const [kor, eng] of Object.entries(KOREAN_ARTIST_MAP)) {
      if (raw.includes(kor)) {
        artists.add(eng);
        artists.add(kor);
      }
    }

    const bracket = raw.match(/\[([A-Za-z0-9\s]+?)(?:\s*Official)?\]/i);
    if (bracket && bracket[1]) artists.add(bracket[1].trim());

    const paren = raw.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (paren) {
      if (paren[1]) artists.add(paren[1].trim());
      if (paren[2]) artists.add(paren[2].trim());
    }

    const splitMixed = raw.replace(/([a-zA-Z]+)([가-힣]+)/g, '$1 $2').replace(/([가-힣]+)([a-zA-Z]+)/g, '$1 $2');
    if (splitMixed !== raw) {
      splitMixed.split(/\s+/).forEach((w) => { if (w.length >= 2) artists.add(w); });
    }

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

function scoreCandidate(item, { targetTitles, targetArtists, targetDuration, rawTitle }) {
  if (!item || item.instrumental) return { score: -1000, artistMatchFound: false };
  if (!item.plainLyrics && !item.syncedLyrics) return { score: -1000, artistMatchFound: false };

  let score = 0;
  const candTrack = item.trackName || '';
  const candArtist = item.artistName || '';
  const normCandTrack = normalize(candTrack);
  const normCandArtist = normalize(candArtist);

  // 1. Artist matching
  let artistExact = false;
  let artistMatchFound = false;

  for (const a of targetArtists) {
    const normTarget = normalize(a);
    if (!normTarget) continue;
    if (normCandArtist === normTarget) {
      artistExact = true;
      artistMatchFound = true;
      break;
    }
    if (normCandArtist.includes(normTarget) || normTarget.includes(normCandArtist)) {
      artistMatchFound = true;
    }
  }

  // Check for inverted track/artist upload (e.g. trackName: "NewJeans", artistName: "OMG")
  let invertedMatch = false;
  if (!artistMatchFound) {
    for (const a of targetArtists) {
      const normTargetA = normalize(a);
      if (normTargetA && (normCandTrack === normTargetA || normCandTrack.includes(normTargetA))) {
        for (const t of targetTitles) {
          const normTargetT = normalize(t);
          if (normTargetT && (normCandArtist === normTargetT || normCandArtist.includes(normTargetT))) {
            invertedMatch = true;
            artistMatchFound = true;
            break;
          }
        }
      }
    }
  }

  if (artistExact) score += 60;
  else if (artistMatchFound) score += 40;
  else score -= 120; // Zero artist match penalty: completely disqualifies unrelated songs

  // 2. Title matching
  let titleExact = false;
  let titleMatchFound = false;

  for (const t of targetTitles) {
    const normTarget = normalize(t);
    if (!normTarget) continue;
    if (normCandTrack === normTarget) {
      titleExact = true;
      titleMatchFound = true;
      break;
    }
    if (normCandTrack.includes(normTarget) || normTarget.includes(normCandTrack)) {
      titleMatchFound = true;
    }
  }

  if (titleExact || invertedMatch) score += 60;
  else if (titleMatchFound) score += 35;
  else score -= 90;

  // 3. Version keyword mismatch penalties
  const keywords = ['remix', 'acoustic', 'live', 'instrumental', 'inst', 'orchestra', 'speed up', 'slowed', 'cover'];
  for (const kw of keywords) {
    const targetHas = hasVersionKeyword(rawTitle, kw);
    const candHas = hasVersionKeyword(candTrack, kw);
    if (targetHas !== candHas) score -= 35;
  }

  // 4. Synced lyrics bonus
  if (item.syncedLyrics && item.syncedLyrics.length > 50) {
    score += 45;
  }

  // 5. Duration match (closer duration = better sync guarantee)
  if (targetDuration > 0 && item.duration > 0) {
    const diff = Math.abs(item.duration - targetDuration);
    if (diff <= 1.5) score += 40;
    else if (diff <= 3.5) score += 25;
    else if (diff <= 6) score += 10;
    else if (diff <= 12) score -= 5;
    else if (diff <= 20) score -= 25;
    else score -= 60;
  }

  return { score, artistMatchFound };
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
  const headers = { 'User-Agent': 'T-Music/0.3.1 (https://github.com/Bluemon7894/T-Music)' };

  // 1. Direct GET if clean track and artist available with exact duration
  for (const t of titles.slice(0, 2)) {
    for (const a of artists.slice(0, 2)) {
      try {
        const u = new URL('https://lrclib.net/api/get');
        u.searchParams.set('track_name', t);
        u.searchParams.set('artist_name', a);
        if (duration) u.searchParams.set('duration', String(Math.round(duration)));
        const r = await fetch(u.href, { headers, signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          const d = await r.json();
          const { score, artistMatchFound } = scoreCandidate(d, {
            targetTitles: titles,
            targetArtists: artists,
            targetDuration: duration,
            rawTitle: title,
          });
          if (score >= 120 && artistMatchFound && d.syncedLyrics) {
            const lines = parseLrc(d.syncedLyrics);
            if (lines.length >= 3) {
              return {
                plainLyrics: d.plainLyrics || '',
                syncedLyrics: d.syncedLyrics || null,
                lines,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 2. Search queries: prefer specific field searches first, then targeted query
  const candidates = [];

  // 2a. Field-based search (/api/search?track_name=...&artist_name=...)
  for (const t of titles.slice(0, 2)) {
    for (const a of artists.slice(0, 2)) {
      try {
        const u = `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`;
        const r = await fetch(u, { headers, signal: AbortSignal.timeout(3500) });
        if (r.ok) {
          const list = await r.json();
          if (Array.isArray(list)) candidates.push(...list);
        }
      } catch {}
    }
  }

  // 2b. General query search (/api/search?q=...) with track and artist combined
  if (candidates.length === 0) {
    for (const t of titles.slice(0, 2)) {
      for (const a of artists.slice(0, 2)) {
        try {
          const u = `https://lrclib.net/api/search?q=${encodeURIComponent(`${t} ${a}`)}`;
          const r = await fetch(u, { headers, signal: AbortSignal.timeout(3500) });
          if (r.ok) {
            const list = await r.json();
            if (Array.isArray(list)) candidates.push(...list);
          }
        } catch {}
      }
    }
  }

  // 2c. Track name only search with strict artist verification
  if (candidates.length === 0) {
    for (const t of titles.slice(0, 2)) {
      try {
        const u = `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}`;
        const r = await fetch(u, { headers, signal: AbortSignal.timeout(3500) });
        if (r.ok) {
          const list = await r.json();
          if (Array.isArray(list)) candidates.push(...list);
        }
      } catch {}
    }
  }

  if (candidates.length === 0) return null;

  // Deduplicate candidates
  const seenIds = new Set();
  const unique = [];
  for (const c of candidates) {
    if (c && c.id && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      unique.push(c);
    }
  }

  // Score each candidate
  const scored = unique.map((c) => {
    const { score, artistMatchFound } = scoreCandidate(c, {
      targetTitles: titles,
      targetArtists: artists,
      targetDuration: duration,
      rawTitle: title,
    });
    return { ...c, matchScore: score, artistMatchFound };
  }).sort((a, b) => b.matchScore - a.matchScore);

  const best = scored[0];
  // Require minimum score threshold (>= 70) AND positive artist match
  if (best && best.matchScore >= 70 && best.artistMatchFound) {
    if (best.syncedLyrics) {
      const lines = parseLrc(best.syncedLyrics);
      if (lines.length >= 3) {
        return {
          plainLyrics: best.plainLyrics || '',
          syncedLyrics: best.syncedLyrics,
          lines,
        };
      }
    }
    if (best.plainLyrics) {
      return {
        plainLyrics: best.plainLyrics,
        syncedLyrics: null,
        lines: [],
      };
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

  // 1. Try high-confidence LRCLIB search first to get real-time synced lyrics
  const lrc = await fetchFromLrclib(title, artist, duration, track.artists);
  if (lrc && lrc.lines && lrc.lines.length > 0) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  // 2. If no high-confidence synced lyrics in LRCLIB, fetch YouTube Music official lyrics (100% verified for this track)
  const ytm = await fetchFromYouTubeMusic(track.id);
  if (ytm && ytm.plainLyrics) {
    cache.set(track.id, ytm);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return ytm;
  }

  // 3. Fallback to LRCLIB plain lyrics if verified
  if (lrc && lrc.plainLyrics) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  const empty = { plainLyrics: '', lines: [] };
  cache.set(track.id, empty);
  return empty;
}
