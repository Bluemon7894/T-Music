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

const GENERIC_TITLES = new Set(['hello', 'home', 'stay', 'rain', 'love', 'intro', 'outro', 'run', 'fly', 'one', 'you', 'me']);

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
      // Standard LRC offset: positive offset means lyrics should appear earlier (subtract from timestamp)
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

function scoreCandidate(item, { targetTitles, targetArtists, targetDuration, rawTitle, isCoverOrIndie }) {
  if (!item || item.instrumental) return { score: -1000, artistMatchFound: false };
  if (!item.plainLyrics && !item.syncedLyrics) return { score: -1000, artistMatchFound: false };

  let score = 0;
  const candTrack = item.trackName || '';
  const candArtist = item.artistName || '';
  const normCandTrack = normalize(candTrack);
  const normCandArtist = normalize(candArtist);

  // Extract candidate title variants (handles bilingual titles like "Through the Night (밤편지)")
  const candTitles = [candTrack];
  const candMatch = candTrack.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
  if (candMatch) {
    candTitles.push(candMatch[1].trim());
    candTitles.push(candMatch[2].trim());
  }

  // Extract candidate artist variants
  const candArtists = [candArtist];
  const artMatch = candArtist.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
  if (artMatch) {
    candArtists.push(artMatch[1].trim());
    candArtists.push(artMatch[2].trim());
  }

  // 1. Artist matching
  let artistExact = false;
  let artistMatchFound = false;

  for (const a of targetArtists) {
    const normTarget = normalize(a);
    if (!normTarget || normTarget.length < 2) continue;
    for (const ca of candArtists) {
      const normCand = normalize(ca);
      if (normCand === normTarget) {
        artistExact = true;
        artistMatchFound = true;
        break;
      }
      if (normCand.includes(normTarget) || normTarget.includes(normCand)) {
        artistMatchFound = true;
      }
    }
    if (artistExact) break;
  }

  // Check for inverted track/artist upload (e.g. trackName: "NewJeans", artistName: "OMG")
  let invertedMatch = false;
  if (!artistMatchFound) {
    for (const a of targetArtists) {
      const normTargetA = normalize(a);
      if (normTargetA) {
        for (const ct of candTitles) {
          const normCT = normalize(ct);
          if (normCT === normTargetA || normCT.includes(normTargetA)) {
            for (const t of targetTitles) {
              const normTargetT = normalize(t);
              if (normTargetT) {
                for (const ca of candArtists) {
                  const normCA = normalize(ca);
                  if (normCA === normTargetT || normCA.includes(normTargetT)) {
                    invertedMatch = true;
                    artistMatchFound = true;
                    break;
                  }
                }
              }
              if (invertedMatch) break;
            }
          }
          if (invertedMatch) break;
        }
      }
      if (invertedMatch) break;
    }
  }

  // 2. Title matching
  let titleExact = false;
  let titleMatchFound = false;

  for (const t of targetTitles) {
    const normTarget = normalize(t);
    if (!normTarget) continue;
    for (const ct of candTitles) {
      const normCand = normalize(ct);
      if (normCand === normTarget) {
        titleExact = true;
        titleMatchFound = true;
        break;
      }
      if (normCand.includes(normTarget) || normTarget.includes(normCand)) {
        titleMatchFound = true;
      }
    }
    if (titleExact) break;
  }

  // Duration match calculation - HEAVILY reward exact audio length match to avoid MV/live offset drift
  let durationClose = false;
  let durDiff = 999;
  if (targetDuration > 0 && item.duration > 0) {
    durDiff = Math.abs(item.duration - targetDuration);
    if (durDiff <= 1.0) {
      score += 75; // Pinpoint match
      durationClose = true;
    } else if (durDiff <= 2.5) {
      score += 55;
      durationClose = true;
    } else if (durDiff <= 5.0) {
      score += 30;
      durationClose = true;
    } else if (durDiff <= 10.0) {
      score += 10;
    } else if (durDiff <= 20.0) {
      score -= 10;
    } else {
      score -= 40;
    }
  }

  // Apply Artist & Title scores
  if (artistExact) score += 60;
  else if (artistMatchFound) score += 40;
  else {
    // If it's a cover or indie upload, OR non-generic title:
    const isGeneric = GENERIC_TITLES.has(normCandTrack) || normCandTrack.length <= 2;
    if (titleExact && !isGeneric) {
      score += 35;
      artistMatchFound = true; // allow acceptance for covers / indie uploads
    } else if (titleMatchFound && !isGeneric) {
      score += 20;
      artistMatchFound = true;
    } else {
      score -= 80; // Disqualify unrelated songs
    }
  }

  if (titleExact || invertedMatch) score += 60;
  else if (titleMatchFound) score += 35;
  else score -= 90;

  // Version keyword mismatch penalties
  const keywords = ['remix', 'acoustic', 'live', 'instrumental', 'inst', 'orchestra', 'speed up', 'slowed', 'cover'];
  for (const kw of keywords) {
    const targetHas = hasVersionKeyword(rawTitle, kw);
    const candHas = hasVersionKeyword(candTrack, kw);
    if (targetHas !== candHas) score -= 35;
  }

  // Synced lyrics bonus
  if (item.syncedLyrics && item.syncedLyrics.length > 50) {
    score += 45;
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
  const { titles, artists, isCoverOrIndie } = extractVariants(title, artist, artistsList);
  const headers = { 'User-Agent': 'T-Music/0.3.12 (https://github.com/Bluemon7894/T-Music)' };

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
          if (d.syncedLyrics) {
            const lines = parseLrc(d.syncedLyrics);
            if (lines.length >= 3) {
              return {
                plainLyrics: d.plainLyrics || '',
                syncedLyrics: d.syncedLyrics,
                lines,
                lyricsDuration: d.duration || duration,
                autoOffset: 0,
              };
            }
          }
        }
      } catch {}
    }
  }

  // 1b. Direct GET without strict duration (fallback for small differences)
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
          isCoverOrIndie,
        });

        if (score >= 35 && artistMatchFound) {
          const durDiff = (duration > 0 && d.duration > 0) ? Math.abs(d.duration - duration) : 0;
          const canSync = !duration || durDiff <= 25.0;

          if (d.syncedLyrics && canSync) {
            const lines = parseLrc(d.syncedLyrics);
            if (lines.length >= 3) {
              const durDelta = (duration > 0 && d.duration > 0) ? (duration - d.duration) : 0;
              return {
                plainLyrics: d.plainLyrics || '',
                syncedLyrics: d.syncedLyrics || null,
                lines,
                lyricsDuration: d.duration || duration,
                autoOffset: durDelta,
              };
            }
          }

          // If synced lyrics duration differed too much, or only plainLyrics:
          const plain = d.plainLyrics || (d.syncedLyrics ? d.syncedLyrics.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim() : '');
          if (plain) {
            return {
              plainLyrics: plain,
              syncedLyrics: null,
              lines: [],
              lyricsDuration: d.duration || 0,
              autoOffset: 0,
            };
          }
        }
      }
    } catch {}
  }

  // 2. Single or dual gentle targeted searches (DO NOT burst parallel queries to prevent Cloudflare 503 ServerOverloaded)
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
          break; // Stop once we find candidate results
        }
      }
    } catch {}
  }

  // Deduplicate candidates
  const seenIds = new Set();
  const unique = [];
  for (const c of candidates) {
    if (c && c.id && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      unique.push(c);
    }
  }

  if (unique.length > 0) {
    // Score each candidate
    const scored = unique.map((c) => {
      const { score, artistMatchFound } = scoreCandidate(c, {
        targetTitles: titles,
        targetArtists: artists,
        targetDuration: duration,
        rawTitle: title,
        isCoverOrIndie,
      });
      return { ...c, matchScore: score, artistMatchFound };
    }).sort((a, b) => b.matchScore - a.matchScore);

    const best = scored[0];
    if (best && best.matchScore >= 35 && best.artistMatchFound) {
      const durDiff = (duration > 0 && best.duration > 0) ? Math.abs(best.duration - duration) : 0;
      const canSync = !duration || durDiff <= 25.0;

      if (best.syncedLyrics && canSync) {
        const lines = parseLrc(best.syncedLyrics);
        if (lines.length >= 3) {
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

      const plain = best.plainLyrics || (best.syncedLyrics ? best.syncedLyrics.replace(/\[\d{2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim() : '');
      if (plain) {
        return {
          plainLyrics: plain,
          syncedLyrics: null,
          lines: [],
          lyricsDuration: best.duration || 0,
          autoOffset: 0,
        };
      }
    }
  }

  return null;
}

async function fetchFromGenius(title, artist, artistsList = []) {
  try {
    const { titles, artists } = extractVariants(title, artist, artistsList);
    const primaryT = titles[0] || title;
    const primaryA = artists[0] || artist || '';
    const q = `${primaryT} ${primaryA}`.trim();
    if (!q) return null;

    const res = await fetch(`https://genius.com/api/search/multi?q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const sections = data.response?.sections || [];
    const songSection = sections.find((s) => s.type === 'song') || sections[0];
    const hit = songSection?.hits?.[0]?.result;
    if (!hit?.url) return null;

    const pageRes = await fetch(hit.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(4000),
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const matches = [...html.matchAll(/data-lyrics-container="true"[^>]*>(.*?)<\/div>/gs)];
    if (matches.length === 0) return null;

    const raw = matches.map((m) => m[1]).join('\n');
    const clean = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return clean.length >= 15 ? clean : null;
  } catch {
    return null;
  }
}

async function fetchFromLyricsOvh(title, artist, artistsList = []) {
  try {
    const { titles, artists } = extractVariants(title, artist, artistsList);
    const cleanT = titles[0] || title;
    const cleanA = artists[0] || artist;
    if (!cleanA || !cleanT) return null;

    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanA)}/${encodeURIComponent(cleanT)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.lyrics?.trim() || null;
  } catch {
    return null;
  }
}

export async function getLyrics(track) {
  if (!track || !track.id) return { plainLyrics: '', lines: [] };
  if (cache.has(track.id)) return cache.get(track.id);

  const artist = Array.isArray(track.artists) ? track.artists[0]?.name : track.artist || '';
  const title = track.rawTitle || track.title || '';
  const duration = track.duration || 0;

  // 1. Try LRCLIB for real-time synchronized lyrics (or verified plain lyrics)
  const lrc = await fetchFromLrclib(title, artist, duration, track.artists);
  if (lrc && lrc.lines && lrc.lines.length > 0) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  // 2. If LRCLIB already found verified plainLyrics, keep as strong candidate
  let fallbackPlain = lrc?.plainLyrics || null;

  // 3. Try YouTube Music official lyrics tab
  if (!fallbackPlain) {
    const ytm = await fetchFromYouTubeMusic(track.id);
    if (ytm && ytm.plainLyrics) {
      fallbackPlain = ytm.plainLyrics;
    }
  }

  // 4. Try Genius lyrics (covers vast majority of K-Pop, J-Pop, Indie, Vocaloid & Global tracks)
  if (!fallbackPlain) {
    const genius = await fetchFromGenius(title, artist, track.artists);
    if (genius) {
      fallbackPlain = genius;
    }
  }

  // 5. Try Lyrics.ovh open lyrics API
  if (!fallbackPlain) {
    const ovh = await fetchFromLyricsOvh(title, artist, track.artists);
    if (ovh) {
      fallbackPlain = ovh;
    }
  }

  if (fallbackPlain) {
    const res = {
      plainLyrics: fallbackPlain,
      syncedLyrics: null,
      lines: [],
    };
    cache.set(track.id, res);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return res;
  }

  const empty = { plainLyrics: '', lines: [] };
  cache.set(track.id, empty);
  return empty;
}
