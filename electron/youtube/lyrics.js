import { call } from './client.js';
import * as P from './parse.js';

const cache = new Map();

const KOREAN_ARTIST_MAP = {
  '아이유': 'IU', '이지금': 'IU', '방탄소년단': 'BTS', '소녀시대': 'Girls\' Generation',
  '동방신기': 'TVXQ', '에스파': 'aespa', '르세라핌': 'LE SSERAFIM', '아이브': 'IVE',
  '뉴진스': 'NewJeans', '블랙핑크': 'BLACKPINK', '트와이스': 'TWICE', '(여자)아이들': '(G)I-DLE',
  '여자아이들': '(G)I-DLE', '세븐틴': 'SEVENTEEN', '스트레이키즈': 'Stray Kids', '엔하이픈': 'ENHYPEN',
  '투모로우바이투게더': 'TOMORROW X TOGETHER', '데이식스': 'DAY6', '폴킴': 'Paul Kim',
  '박재정': 'Park Jae Jung', '성시경': 'Sung Si Kyung', '태연': 'Taeyeon', '악뮤': 'AKMU',
  '악동뮤지션': 'AKMU', '볼빨간사춘기': 'BOL4', '십센치': '10cm', '잔나비': 'JANNABI',
  '멜로망스': 'MeloMance', '헤이즈': 'Heize', '크러쉬': 'Crush', '자이언티': 'Zion.T',
  '로이킴': 'Roy Kim', '이하이': 'Lee Hi', '권진아': 'Kwon Jin Ah', '비비': 'BIBI',
  '지코': 'ZICO', '창모': 'CHANGMO', '버즈': 'Buzz', '윤하': 'YOUNHA',
  '임영웅': 'Lim Young Woong', '백현': 'Baekhyun', '카더가든': 'Car, the garden',
  '이승기': 'Lee Seung Gi', '정승환': 'Jung Seung Hwan', '적재': 'Jukjae',
  '이무진': 'Lee Mu Jin', '김범수': 'Kim Bum Soo', '박효신': 'Park Hyo Shin',
  '이적': 'Lee Juck', '넬': 'NELL', '치즈': 'CHEEZE', '스텔라장': 'Stella Jang',
  '선우정아': 'sunwoojunga', '비오': 'BE\'O', '기리보이': 'GIRIBOY', '애쉬아일랜드': 'ASH ISLAND',
  '릴러말즈': 'Leellamarz', '플레이브': 'PLAVE', '투어스': 'TWS', '라이즈': 'RIIZE',
  '아일릿': 'ILLIT', '보이넥스트도어': 'BOYNEXTDOOR', '엔믹스': 'NMIXX', '스테이씨': 'STAYC',
  '키스오브라이프': 'KISS OF LIFE', '베이비몬스터': 'BABYMONSTER', '실리카겔': 'Silica Gel',
  '검정치마': 'The Black Skirts', '쏜애플': 'Thornapple', '우즈': 'WOODZ', '이창섭': 'Lee Changsub',
  '루시': 'LUCY', '소란': 'SORAN', '딘': 'DEAN', '디피알 라이브': 'DPR LIVE',
  '이찬혁': 'Lee Chanhyuk', '이수현': 'Lee Suhyun', '화사': 'Hwa Sa', '청하': 'CHUNG HA',
  '선미': 'SUNMI', '현아': 'HyunA', '제니': 'JENNIE', '로제': 'ROSÉ', '지수': 'JISOO', '리사': 'LISA',
};

const NOISE_TAG_RE = /[\(\[【][^\)\]】]*(?:official|music\s*video|m\/?v|audio|color\s*coded|lyrics?|가사|자막|live|라이브|lyric\s*video|딩고|dingo|4k|stage\s*mix|교차편집|노래방|반주|special\s*clip|clip|visualizer|tj\.\d+|ky\.\d+|side\s*[a-z0-9]+|mr제거|cover|커버|remaster|soundtrack|ost|원곡[^\)\]】]*)[^\)\]】]*[\)\]】]/gi;

function cleanTitleNoise(str) {
  let s = String(str || '');
  s = s.replace(/^[\[【][^\]】]+[\]】]\s*/g, '');
  s = s.replace(/^Official\s+(?:Music\s*)?Video:\s*/i, '');
  s = s.replace(NOISE_TAG_RE, ' ');
  s = s.replace(/\(?(?:원곡\s*[:：\-]\s*[^\)\],]+)\)?/gi, ' ');
  s = s.replace(/\s*[|/]\s*(?:가사|lyrics?|자막|딩고라이브|딩고|dingo|live|라이브|cover|커버|교차편집|stage\s*mix|official|m\/?v|audio|4k).*$/gi, ' ');
  s = s.replace(/\s*l\s*커버\s*by.*$/gi, ' ');
  s = s.replace(/\s+(?:노래방|반주|MR제거|MR|TJ노래방|KY노래방|커버|Cover|Covered\s*by\s*.*|가사|자막|Lyrics?|M\/?V|Official|Live\s*Clip)\s*$/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function isValidTitle(t) {
  if (!t || t.length < 1) return false;
  if (/^(?:가사|자막|lyrics?|official|music\s*video|m\/?v|audio|live|cover|커버)$/i.test(t)) return false;
  return true;
}

function isValidArtist(a) {
  if (!a || a.length < 1) return false;
  if (/^(?:가사|자막|lyrics?|official|music\s*video|m\/?v|audio|live|cover|커버|딩고|dingo)$/i.test(a)) return false;
  return true;
}

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*[\(\[](?:feat\.?|prod\.?|official|mv|audio|live|remix|acoustic|ver\.|version|inst|instrumental)[^\)\]]*[\)\]]/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function hasVersionKeyword(str, kw) {
  const re = new RegExp(`\\b${kw}\\b|[\\(\\[\\s]${kw}[\\)\\]\\s]`, 'i');
  return re.test(str || '');
}

export function isValidLyrics(str) {
  if (!str || typeof str !== 'string') return false;
  const clean = str.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').replace(/<[^>]+>/g, '').trim();
  if (clean.length < 35) return false;
  if (/^(?:probe|\*rickrolling\*|<instrumental>|instrumental|no lyrics available|lyrics not found|暂无歌词|纯音乐.*)$/i.test(clean)) return false;
  if (clean.includes('暂无歌词')) return false;
  return true;
}

export function isValidSyncedLyrics(lrcText) {
  if (!lrcText || typeof lrcText !== 'string') return false;
  const lines = parseLrc(lrcText);
  if (lines.length < 4) return false;
  return isValidLyrics(lrcText);
}

export function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = [];

  let offsetMs = 0;
  const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  if (offsetMatch) {
    offsetMs = parseInt(offsetMatch[1], 10) || 0;
  }
  const offsetSec = offsetMs / 1000;

  const tagRegex = /\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]/g;
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
      const time = Math.max(0, minutes * 60 + seconds - offsetSec);
      timestamps.push(time);
    }

    if (timestamps.length > 0) {
      const text = trimmed.replace(/\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
      for (const time of timestamps) {
        lines.push({ time, text });
      }
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

function extractVariants(title, artist, artistsList = []) {
  const primaryTitles = [];
  const secondaryTitles = [];
  const primaryArtists = [];
  const secondaryArtists = [];

  const rawTitle = String(title || '').trim();
  const isCoverOrIndie = /cover|커버|가사|자막|lyrics?|딩고|live|라이브|교차편집|노래방|반주|원곡/i.test(rawTitle);

  // Extract "원곡: 가수명"
  const origMatch = rawTitle.match(/원곡\s*[:：\-]\s*([^\)\],]+)/i);
  if (origMatch && isValidArtist(origMatch[1].trim())) {
    primaryArtists.push(origMatch[1].trim());
  }

  const cleaned = cleanTitleNoise(rawTitle);

  // Pattern 1: Quotes (e.g. NewJeans 'Ditto' Official MV)
  const quoteMatch = cleaned.match(/^(.*?)\s*['"「『“]([^'"」』”]+)['"」』”]\s*(.*)$/);
  if (quoteMatch) {
    const before = cleanTitleNoise(quoteMatch[1]).replace(/[-–—]\s*$/, '').trim();
    const quoted = quoteMatch[2].trim();
    const after = cleanTitleNoise(quoteMatch[3]).replace(/^[-–—]\s*/, '').trim();

    if (quoted) primaryTitles.push(quoted);
    if (before) primaryArtists.push(before);
    if (after) {
      const subMatch = after.match(/^\(?([^)]+)\)?$/);
      if (subMatch) secondaryTitles.push(subMatch[1].trim());
      else secondaryTitles.push(after);
    }
  }

  // Pattern 2: Dash (Artist - Title OR Title - Artist/Cover)
  const dashParts = cleaned.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    const p1 = dashParts[0].trim();
    const p2 = dashParts.slice(1).join(' - ').trim();

    const p1IsKnownArtist = Object.keys(KOREAN_ARTIST_MAP).some((k) => p1.toLowerCase().includes(k.toLowerCase()));
    const p2IsKnownArtist = Object.keys(KOREAN_ARTIST_MAP).some((k) => p2.toLowerCase().includes(k.toLowerCase()));

    if (p1IsKnownArtist && !p2IsKnownArtist) {
      primaryArtists.push(p1);
      primaryTitles.push(p2);
      secondaryTitles.push(p1);
      secondaryArtists.push(p2);
    } else if (p2IsKnownArtist && !p1IsKnownArtist) {
      primaryTitles.push(p1);
      primaryArtists.push(p2);
      secondaryTitles.push(p2);
      secondaryArtists.push(p1);
    } else if (isCoverOrIndie || (artist && p2.toLowerCase().includes(artist.toLowerCase()))) {
      primaryTitles.push(p1);
      secondaryTitles.push(p2);
      secondaryArtists.push(p2);
    } else {
      primaryArtists.push(p1);
      primaryTitles.push(p2);
      secondaryTitles.push(p1);
      secondaryArtists.push(p2);
    }

    // If p2 has parentheses (e.g. "사건의 지평선 (Event Horizon)")
    const p2Sub = p2.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (p2Sub) {
      primaryTitles.push(p2Sub[1].trim());
      if (!/feat|prod|with|ost|soundtrack/i.test(p2Sub[2])) {
        secondaryTitles.push(p2Sub[2].trim());
      }
    }
  } else {
    // If no dash, check if starts with known artist: e.g. "버즈 가시" -> "버즈", "가시"
    let matchedPrefix = false;
    for (const [kor, eng] of Object.entries(KOREAN_ARTIST_MAP)) {
      const re = new RegExp(`^(${kor}|${eng})\\s+`, 'i');
      if (re.test(cleaned)) {
        primaryArtists.push(kor);
        const rest = cleaned.replace(re, '').trim();
        if (rest) primaryTitles.push(rest);
        matchedPrefix = true;
        break;
      }
    }
    if (!matchedPrefix && cleaned) {
      primaryTitles.push(cleaned);
    }
  }

  // Channel artist inputs
  const artistInputs = [
    artist,
    ...(Array.isArray(artistsList) ? artistsList.map((a) => (typeof a === 'string' ? a : a?.name)) : []),
  ].filter(Boolean);

  for (const aIn of artistInputs) {
    const raw = String(aIn).trim();
    if (!raw) continue;
    const clean = raw
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/\s*(?:Official|공식|채널|Channel|Music|Entertainment|Records|Studio|VEVO).*$/gi, '')
      .trim();
    if (clean) secondaryArtists.push(clean);
  }

  // Expand and deduplicate artists
  const allArtists = [...primaryArtists, ...secondaryArtists];
  const finalArtists = new Set();
  for (const a of allArtists) {
    if (!a) continue;
    const cleanA = a.replace(/[\(\[].*?[\)\]]/g, '').trim();
    if (isValidArtist(cleanA)) finalArtists.add(cleanA);

    // Bracket sub-names: e.g. "아이유 (IU)" -> "아이유", "IU"
    const m = a.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (m) {
      if (isValidArtist(m[1].trim())) finalArtists.add(m[1].trim());
      if (isValidArtist(m[2].trim())) finalArtists.add(m[2].trim());
    }

    // Korean/English artist mapping
    for (const [kor, eng] of Object.entries(KOREAN_ARTIST_MAP)) {
      if (a.toLowerCase().includes(kor.toLowerCase()) || a.toLowerCase().includes(eng.toLowerCase())) {
        finalArtists.add(eng);
        finalArtists.add(kor);
      }
    }

    // Multiple artists: "A, B & C"
    a.split(/[,&/]/).forEach((sub) => {
      const s = sub.trim();
      if (isValidArtist(s)) finalArtists.add(s);
    });
  }

  // Expand and deduplicate titles
  const allTitles = [...primaryTitles, ...secondaryTitles];
  const finalTitles = new Set();
  for (const t of allTitles) {
    if (!isValidTitle(t)) continue;
    finalTitles.add(t);

    const m = t.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (m) {
      if (isValidTitle(m[1].trim())) finalTitles.add(m[1].trim());
      if (!/feat|prod|official|mv|live|audio/i.test(m[2]) && isValidTitle(m[2].trim())) {
        finalTitles.add(m[2].trim());
      }
    }

    const noFeat = t.replace(/\s*[\(\[](?:feat\.?|prod\.?|with)[^\)\]]*[\)\]]/gi, '').trim();
    if (noFeat && noFeat !== t && isValidTitle(noFeat)) finalTitles.add(noFeat);
  }

  return {
    titles: [...finalTitles],
    artists: [...finalArtists],
    isCoverOrIndie
  };
}

function scoreCandidate(item, { targetTitles, targetArtists, targetDuration, rawTitle }) {
  if (!item || item.instrumental) return { score: -1000, artistMatchFound: false };
  if (!item.plainLyrics && !item.syncedLyrics) return { score: -1000, artistMatchFound: false };

  const candTrack = item.trackName || '';
  const candArtist = item.artistName || '';

  // 1. Version keyword mismatch:
  // Disqualify immediately if candidate has remix, live, acoustic, cover, instrumental, speed up, etc. when original does not
  const keywords = ['remix', 'acoustic', 'live', 'instrumental', 'inst', 'orchestra', 'speed up', 'slowed', 'cover'];
  for (const kw of keywords) {
    const targetHas = hasVersionKeyword(rawTitle, kw);
    const candHas = hasVersionKeyword(candTrack, kw);
    if (!targetHas && candHas) {
      return { score: -1000, artistMatchFound: false };
    }
  }

  // 2. Strict audio duration match:
  // Standard Spotify/YouTube Music sync matching requires <= 3.0 seconds tolerance
  if (targetDuration > 0 && item.duration > 0) {
    const durDiff = Math.abs(item.duration - targetDuration);
    if (durDiff > 3.0) {
      return { score: -1000, artistMatchFound: false };
    }
  }

  // 3. Artist & Title matching
  const normCandTrack = normalize(candTrack);
  const normCandArtist = normalize(candArtist);

  let artistExact = false;
  let artistMatchFound = false;
  for (const tArtist of targetArtists) {
    const normTarget = normalize(tArtist);
    if (!normTarget || normTarget.length < 2) continue;
    if (normCandArtist === normTarget) {
      artistExact = true;
      artistMatchFound = true;
      break;
    }
    if (normCandArtist.includes(normTarget) || normTarget.includes(normCandArtist)) {
      artistMatchFound = true;
    }
  }

  let titleExact = false;
  let titleMatchFound = false;
  for (const tTitle of targetTitles) {
    const normTarget = normalize(tTitle);
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

  // Must match both artist and title
  if (!artistMatchFound || (!titleExact && !titleMatchFound)) {
    return { score: -1000, artistMatchFound: false };
  }

  // 4. Validate synced lyrics if present
  if (item.syncedLyrics && !isValidSyncedLyrics(item.syncedLyrics)) {
    return { score: -1000, artistMatchFound: false };
  }

  let score = 50;
  if (artistExact) score += 60;
  else if (artistMatchFound) score += 30;

  if (titleExact) score += 60;
  else if (titleMatchFound) score += 30;

  if (targetDuration > 0 && item.duration > 0) {
    const durDiff = Math.abs(item.duration - targetDuration);
    if (durDiff <= 1.0) score += 50;
    else if (durDiff <= 2.0) score += 30;
    else if (durDiff <= 3.0) score += 15;
  }

  if (item.syncedLyrics && isValidSyncedLyrics(item.syncedLyrics)) {
    score += 50;
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
  const headers = { 'User-Agent': 'T-Music/0.3.17 (https://github.com/Bluemon7894/T-Music)' };

  const getPairs = [];
  if (titles[0] && artists[0]) getPairs.push([titles[0], artists[0]]);
  if (titles[0] && artists[1]) getPairs.push([titles[0], artists[1]]);
  if (titles[1] && artists[0]) getPairs.push([titles[1], artists[0]]);

  // 1a. Try direct GET with EXACT track duration first (finds the exact studio/video audio sync)
  if (duration > 0) {
    for (const [t, a] of getPairs) {
      try {
        const u = new URL('https://lrclib.net/api/get');
        u.searchParams.set('track_name', t);
        u.searchParams.set('artist_name', a);
        u.searchParams.set('duration', Math.round(duration));
        const r = await fetch(u.href, { headers, signal: AbortSignal.timeout(2200) });
        if (r.ok) {
          const d = await r.json();
          if (d.syncedLyrics && isValidSyncedLyrics(d.syncedLyrics)) {
            const durDiff = (duration > 0 && d.duration > 0) ? Math.abs(d.duration - duration) : 0;
            if (!duration || durDiff <= 3.0) {
              const lines = parseLrc(d.syncedLyrics);
              return {
                plainLyrics: d.plainLyrics || '',
                syncedLyrics: d.syncedLyrics,
                lines,
                lyricsDuration: d.duration || duration,
                autoOffset: (duration > 0 && d.duration > 0) ? (duration - d.duration) : 0,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 1b. Direct GET without strict duration (only accept if duration is within 3.0s)
  for (const [t, a] of getPairs) {
    try {
      const u = new URL('https://lrclib.net/api/get');
      u.searchParams.set('track_name', t);
      u.searchParams.set('artist_name', a);
      const r = await fetch(u.href, { headers, signal: AbortSignal.timeout(2200) });
      if (r.ok) {
        const d = await r.json();
        const { score, artistMatchFound } = scoreCandidate(d, {
          targetTitles: titles,
          targetArtists: artists,
          targetDuration: duration,
          rawTitle: title,
        });

        if (score >= 80 && artistMatchFound) {
          const durDiff = (duration > 0 && d.duration > 0) ? Math.abs(d.duration - duration) : 0;
          if (!duration || durDiff <= 3.0) {
            if (d.syncedLyrics && isValidSyncedLyrics(d.syncedLyrics)) {
              const lines = parseLrc(d.syncedLyrics);
              const durDelta = (duration > 0 && d.duration > 0) ? (duration - d.duration) : 0;
              return {
                plainLyrics: d.plainLyrics || '',
                syncedLyrics: d.syncedLyrics,
                lines,
                lyricsDuration: d.duration || duration,
                autoOffset: durDelta,
              };
            }
          }
        }
      }
    } catch {}
  }

  // 2. Targeted search
  const searchQueries = [];
  const primaryT = titles[0];
  const primaryA = artists[0];

  if (primaryT && primaryA) {
    searchQueries.push(`${primaryT} ${primaryA}`);
  }
  if (primaryT && !searchQueries.includes(primaryT)) {
    searchQueries.push(primaryT);
  }

  let candidates = [];
  for (const q of searchQueries.slice(0, 2)) {
    try {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          candidates.push(...list);
          break;
        }
      }
    } catch {}
  }

  // Deduplicate and filter candidates
  const seenIds = new Set();
  const unique = [];
  for (const c of candidates) {
    if (c && c.id && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      unique.push(c);
    }
  }

  if (unique.length > 0) {
    const validCandidates = unique.filter((c) => isValidSyncedLyrics(c.syncedLyrics));
    const scored = (validCandidates.length > 0 ? validCandidates : unique).map((c) => {
      const { score, artistMatchFound } = scoreCandidate(c, {
        targetTitles: titles,
        targetArtists: artists,
        targetDuration: duration,
        rawTitle: title,
      });
      return { ...c, matchScore: score, artistMatchFound };
    }).sort((a, b) => b.matchScore - a.matchScore);

    const best = scored[0];
    if (best && best.matchScore >= 80 && best.artistMatchFound) {
      const durDiff = (duration > 0 && best.duration > 0) ? Math.abs(best.duration - duration) : 0;
      if (!duration || durDiff <= 3.0) {
        if (best.syncedLyrics && isValidSyncedLyrics(best.syncedLyrics)) {
          const lines = parseLrc(best.syncedLyrics);
          const durDelta = (duration > 0 && best.duration > 0) ? (duration - best.duration) : 0;
          return {
            plainLyrics: best.plainLyrics || '',
            syncedLyrics: best.syncedLyrics,
            lines,
            lyricsDuration: best.duration || duration,
            autoOffset: durDelta,
          };
        }
      }
    }
  }

  return null;
}

export async function getLyrics(track) {
  if (!track || !track.id) return { plainLyrics: '', lines: [] };
  if (cache.has(track.id)) return cache.get(track.id);

  const artist = Array.isArray(track.artists) ? track.artists[0]?.name : track.artist || '';
  const title = track.rawTitle || track.title || '';
  const duration = track.duration || 0;

  // 1. LRCLIB 엄격 매칭 (스포티파이/유튜브 뮤직 방식의 정확한 메타데이터 & 오디오 길이 ±3초 이내 검증)
  const lrc = await fetchFromLrclib(title, artist, duration, track.artists);
  if (lrc && lrc.lines && lrc.lines.length >= 4) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  // 2. YouTube Music 공식 가사 (재생 중인 비디오 트랙의 100% 공식 라이선스 가사)
  const ytm = await fetchFromYouTubeMusic(track.id);
  if (ytm && ytm.plainLyrics && isValidLyrics(ytm.plainLyrics)) {
    cache.set(track.id, ytm);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return ytm;
  }

  // 3. 확실하게 검증된 공식 가사가 없는 경우:
  // 엉뚱한 리믹스, 다른 곡, 잘못된 가사를 일절 불러오지 않고 없음으로 처리
  const empty = { plainLyrics: '', lines: [] };
  cache.set(track.id, empty);
  return empty;
}
