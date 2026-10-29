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

function isRomanizedKorean(text) {
  if (!text) return false;
  // 한글이 이미 포함되어 있으면 순수 로마자 가사가 아님 (한국어+영어 혼합 원곡 형태)
  if (/[\uac00-\ud7a3]/.test(text)) return false;
  const matches = text.match(/\b(sarang|saranghae|saranghaet|saranghaneun|geudae|geudaewa|eotteohke|neoreul|neol|naneun|naega|jigeum|eonjena|gaseum|maeum|chueok|mianhae|yeogiseo|nugunga|nuneul|michidorok|datueotdeon|tteonago|onjongil|teok|kkeutkkaji|chaollatgo|bappeuge|dareun|nuga|bogo|sipseo|eopseo|itseo|isseo|hajiman|geureonde|babocheoreom|haessdeon|nohchigo)\b/gi);
  return !!(matches && matches.length >= 2);
}

function isKnownArtist(str) {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  for (const [kor, eng] of Object.entries(KOREAN_ARTIST_MAP)) {
    if (s === kor.toLowerCase() || s === eng.toLowerCase()) return true;
  }
  return false;
}

function isKoreanTrack(titles, artists) {
  for (const t of titles) {
    if (/[\uac00-\ud7a3]/.test(t)) return true;
  }
  for (const a of artists) {
    if (/[\uac00-\ud7a3]/.test(a)) return true;
    if (isKnownArtist(a)) return true;
  }
  return false;
}

function cleanTitleNoise(str) {
  let s = String(str || '');
  // 이모지 및 특수 기호 정리
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, ' ');
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

  // 1. Extract "원곡: 가수명"
  const origMatch = rawTitle.match(/원곡\s*[:：\-]\s*([^\)\],]+)/i);
  if (origMatch && isValidArtist(origMatch[1].trim())) {
    primaryArtists.push(origMatch[1].trim());
  }

  const cleaned = cleanTitleNoise(rawTitle);

  // 2. Pattern 1: Quotes (e.g. NewJeans 'Ditto' Official MV)
  const quoteMatch = cleaned.match(/^(.*?)\s*['"「『“]([^'"」』”]+)['"」』”]\s*(.*)$/);

  // 3. Pattern 2: Separators: -, –, —, :, |, ~, /
  const sepMatch = cleaned.match(/^(.*?)\s+[-–—:|~]\s+(.*)$/);

  if (quoteMatch) {
    const before = cleanTitleNoise(quoteMatch[1]).replace(/[-–—:|~]\s*$/, '').trim();
    const quoted = quoteMatch[2].trim();
    const after = cleanTitleNoise(quoteMatch[3]).replace(/^[-–—:|~]\s*/, '').trim();

    if (quoted) primaryTitles.push(quoted);
    if (before) primaryArtists.push(before);
    if (after) {
      const subMatch = after.match(/^\(?([^)]+)\)?$/);
      if (subMatch) secondaryTitles.push(subMatch[1].trim());
      else secondaryTitles.push(after);
    }
  } else if (sepMatch) {
    const p1 = sepMatch[1].trim();
    const p2 = sepMatch[2].trim();

    // Check if p2 matches artist or known artist (e.g. "Drowning - WOODZ" vs "WOODZ - Drowning")
    const p1MatchesArtist = artist && p1.toLowerCase().includes(artist.toLowerCase());
    const p2MatchesArtist = artist && p2.toLowerCase().includes(artist.toLowerCase());
    const p1IsKnown = isKnownArtist(p1);
    const p2IsKnown = isKnownArtist(p2);

    if ((p2MatchesArtist || p2IsKnown) && !p1MatchesArtist && !p1IsKnown) {
      primaryArtists.push(p2);
      primaryTitles.push(p1);
      secondaryTitles.push(p2);
      secondaryArtists.push(p1);
    } else {
      primaryArtists.push(p1);
      primaryTitles.push(p2);
      secondaryTitles.push(p1);
      secondaryArtists.push(p2);
    }
  } else {
    // 구분자가 없는 경우: 제목에 곡 이름만 있거나 아티스트명으로 시작하는 형태
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

  // 4. Sub-title extraction from parentheses / brackets: e.g. "밤편지 (Through the Night)", "Drowning (드라우닝)"
  for (const t of [...primaryTitles]) {
    const m = t.match(/^([^\(\[]+)\s*[\(\[]([^\)\]]+)[\)\]]/);
    if (m) {
      primaryTitles.unshift(m[1].trim());
      if (!/feat|prod|with|official|mv|live|audio/i.test(m[2])) {
        secondaryTitles.push(m[2].trim());
      }
    }
    const noFeat = t.replace(/\s*[\(\[](?:feat\.?|prod\.?|with)[^\)\]]*[\)\]]/gi, '').trim();
    if (noFeat && noFeat !== t) primaryTitles.unshift(noFeat);
  }

  // 5. Channel artist inputs: 제목에 아티스트가 없어도 전달된 artist / artistsList와 항상 조합!
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
    if (clean) {
      if (primaryArtists.length === 0) {
        primaryArtists.push(clean);
      } else {
        secondaryArtists.push(clean);
      }
    }
  }

  // 6. Expand and deduplicate artists
  const allArtists = [...primaryArtists, ...secondaryArtists];
  const finalArtists = new Set();
  for (const a of allArtists) {
    if (!a) continue;
    const cleanA = a.replace(/[\(\[].*?[\)\]]/g, '').trim();
    if (isValidArtist(cleanA)) finalArtists.add(cleanA);

    // Parentheses in artist: "아이유 (IU)" -> "아이유", "IU"
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

  // 7. Expand and deduplicate titles
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
  };
}

function scoreCandidate(item, { targetTitles, targetArtists, targetDuration, rawTitle, isKorean }) {
  if (!item || item.instrumental) return { score: -1000, artistMatchFound: false };
  if (!item.plainLyrics && !item.syncedLyrics) return { score: -1000, artistMatchFound: false };

  const candTrack = item.trackName || '';
  const candArtist = item.artistName || '';

  // 1. Version keyword mismatch:
  // 원곡 제목에 없는 remix, live, acoustic, instrumental, cover 등은 즉시 배제
  const keywords = ['remix', 'acoustic', 'live', 'instrumental', 'inst', 'orchestra', 'speed up', 'slowed', 'cover'];
  for (const kw of keywords) {
    const targetHas = hasVersionKeyword(rawTitle, kw);
    const candHas = hasVersionKeyword(candTrack, kw);
    if (!targetHas && candHas) {
      return { score: -1000, artistMatchFound: false };
    }
  }

  // 2. Audio duration match: 팬메이드/클립 채널 인트로/아웃트로 감안 최대 8.0초 오차 허용
  if (targetDuration > 0 && item.duration > 0) {
    const durDiff = Math.abs(item.duration - targetDuration);
    if (durDiff > 8.0) {
      return { score: -1000, artistMatchFound: false };
    }
  }

  // 3. Language matching: 한국어 원곡이면 한국어(한글) 가사 우선, 로마자 발음 표기(-haetdeon 등) 전면 배제
  const text = item.syncedLyrics || item.plainLyrics || '';
  const hasH = /[\uac00-\ud7a3]/.test(text);
  const isRom = isRomanizedKorean(text);

  let langBonus = 0;
  if (isKorean) {
    if (isRom) return { score: -1000, artistMatchFound: false }; // 로마자 가사 전면 배제
    if (hasH) langBonus += 150;
    else langBonus -= 120;
  } else {
    if (hasH) langBonus -= 100;
    else langBonus += 50;
  }

  // 4. Artist & Title matching
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

  // 아티스트와 곡 제목 모두 검증되어야 함
  if (!artistMatchFound || (!titleExact && !titleMatchFound)) {
    return { score: -1000, artistMatchFound: false };
  }

  // 5. Validate synced lyrics if present
  if (item.syncedLyrics && !isValidSyncedLyrics(item.syncedLyrics)) {
    return { score: -1000, artistMatchFound: false };
  }

  let score = 50 + langBonus;
  if (artistExact) score += 60;
  else if (artistMatchFound) score += 30;

  if (titleExact) score += 60;
  else if (titleMatchFound) score += 30;

  if (targetDuration > 0 && item.duration > 0) {
    const durDiff = Math.abs(item.duration - targetDuration);
    if (durDiff <= 1.0) score += 50;
    else if (durDiff <= 3.0) score += 30;
    else if (durDiff <= 6.0) score += 15;
    else if (durDiff <= 8.0) score += 5;
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

async function fetchFromNaver(title, artist, artistsList = []) {
  try {
    const { titles, artists } = extractVariants(title, artist, artistsList);
    const searchTerms = [];
    const t0 = titles[0] || title;
    const a0 = artists[0] || artist || '';
    if (a0 && t0) searchTerms.push(`${a0} ${t0}`);
    if (t0) searchTerms.push(t0);

    for (const term of searchTerms) {
      const q = encodeURIComponent(term + ' 가사');
      const url = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&fbm=0&ie=utf8&query=${q}`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(3500),
      });
      if (!r.ok) continue;
      const html = await r.text();
      const m = html.match(/class="[^"]*_content_text[^"]*"[^>]*>(.*?)<\/(?:div|p)>/is)
        || html.match(/class="[^"]*lyrics_box[^"]*"[^>]*>(.*?)<\/(?:div|p)>/is)
        || html.match(/class="[^"]*text_area[^"]*"[^>]*>(.*?)<\/(?:div|p)>/is);
      if (m) {
        const raw = m[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
        if (isValidLyrics(raw)) return raw;
      }
    }
  } catch {}
  return null;
}

async function fetchFromLrclib(title, artist, duration, artistsList = []) {
  const { titles, artists } = extractVariants(title, artist, artistsList);
  const isKorean = isKoreanTrack(titles, artists);
  const headers = { 'User-Agent': 'T-Music/0.3.21 (https://github.com/Bluemon7894/T-Music)' };

  const getPairs = [];
  for (const t of titles.slice(0, 2)) {
    for (const a of artists.slice(0, 2)) {
      getPairs.push([t, a]);
    }
  }

  // 1. Direct GET
  for (const [t, a] of getPairs) {
    try {
      const u = new URL('https://lrclib.net/api/get');
      u.searchParams.set('track_name', t);
      u.searchParams.set('artist_name', a);
      if (duration > 0) u.searchParams.set('duration', Math.round(duration));
      const r = await fetch(u.href, { headers, signal: AbortSignal.timeout(2200) });
      if (r.ok) {
        const d = await r.json();
        const durDiff = (duration > 0 && d.duration > 0) ? Math.abs(d.duration - duration) : 0;
        if (!duration || durDiff <= 8.0) {
          const text = d.syncedLyrics || d.plainLyrics || '';
          const hasH = /[\uac00-\ud7a3]/.test(text);
          const isRom = isRomanizedKorean(text);
          // 한국어 곡인데 한글이 없거나 로마자인 경우 direct GET을 건너뛰고 search에서 한글 가사 탐색
          const langOk = !isKorean || (hasH && !isRom);
          if (langOk) {
            if (d.syncedLyrics && isValidSyncedLyrics(d.syncedLyrics)) {
              return {
                plainLyrics: d.plainLyrics || '',
                syncedLyrics: d.syncedLyrics,
                lines: parseLrc(d.syncedLyrics),
                lyricsDuration: d.duration || duration,
                autoOffset: (duration > 0 && d.duration > 0) ? (duration - d.duration) : 0,
              };
            }
            if (d.plainLyrics && isValidLyrics(d.plainLyrics)) {
              return {
                plainLyrics: d.plainLyrics,
                syncedLyrics: null,
                lines: [],
                lyricsDuration: d.duration || duration,
                autoOffset: 0,
              };
            }
          }
        }
      }
    } catch {}
  }

  // 2. Search
  const searchQueries = [];
  const primaryT = titles[0];
  const primaryA = artists[0];

  if (primaryT && primaryA) searchQueries.push(`${primaryT} ${primaryA}`);
  if (primaryT && !searchQueries.includes(primaryT)) searchQueries.push(primaryT);
  if (titles[1] && primaryA) searchQueries.push(`${titles[1]} ${primaryA}`);

  let candidates = [];
  for (const q of searchQueries.slice(0, 3)) {
    try {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          candidates.push(...list);
          const hasGoodMatch = list.some((item) => {
            const { score, artistMatchFound } = scoreCandidate(item, {
              targetTitles: titles,
              targetArtists: artists,
              targetDuration: duration,
              rawTitle: title,
              isKorean,
            });
            return score >= 120 && artistMatchFound;
          });
          if (hasGoodMatch) break;
        }
      }
    } catch {}
  }

  const seenIds = new Set();
  const unique = [];
  for (const c of candidates) {
    if (c && c.id && !seenIds.has(c.id)) {
      seenIds.add(c.id);
      unique.push(c);
    }
  }

  if (unique.length > 0) {
    const scored = unique.map((c) => {
      const { score, artistMatchFound } = scoreCandidate(c, {
        targetTitles: titles,
        targetArtists: artists,
        targetDuration: duration,
        rawTitle: title,
        isKorean,
      });
      return { ...c, matchScore: score, artistMatchFound };
    }).sort((a, b) => b.matchScore - a.matchScore);

    const best = scored[0];
    if (best && best.matchScore >= 70 && best.artistMatchFound) {
      const durDiff = (duration > 0 && best.duration > 0) ? Math.abs(best.duration - duration) : 0;
      if (!duration || durDiff <= 8.0) {
        if (best.syncedLyrics && isValidSyncedLyrics(best.syncedLyrics)) {
          return {
            plainLyrics: best.plainLyrics || '',
            syncedLyrics: best.syncedLyrics,
            lines: parseLrc(best.syncedLyrics),
            lyricsDuration: best.duration || duration,
            autoOffset: (duration > 0 && best.duration > 0) ? (duration - best.duration) : 0,
          };
        }
        if (best.plainLyrics && isValidLyrics(best.plainLyrics)) {
          return {
            plainLyrics: best.plainLyrics,
            syncedLyrics: null,
            lines: [],
            lyricsDuration: best.duration || duration,
            autoOffset: 0,
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

  // 1. LRCLIB 정밀 매칭 (언어 매칭 및 싱크 가사 우선 탐색)
  const lrc = await fetchFromLrclib(title, artist, duration, track.artists);
  if (lrc && lrc.lines && lrc.lines.length >= 4) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  // 2. YouTube Music 공식 가사 (라이선스 원본 가사)
  const ytm = await fetchFromYouTubeMusic(track.id);
  if (ytm && ytm.plainLyrics && isValidLyrics(ytm.plainLyrics)) {
    cache.set(track.id, ytm);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return ytm;
  }

  // 3. 네이버 공식 바이브/KOMCA 가사 (한국 공식 저작권 등록 가사)
  const naverText = await fetchFromNaver(title, artist, track.artists);
  if (naverText && isValidLyrics(naverText)) {
    const naverLyrics = {
      plainLyrics: naverText,
      syncedLyrics: null,
      lines: [],
      footer: '출처: 네이버 VIBE / 한국음악저작권협회',
    };
    cache.set(track.id, naverLyrics);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return naverLyrics;
  }

  // 4. LRCLIB 일반 가사 (싱크는 없으나 검증된 일반 텍스트 가사)
  if (lrc && lrc.plainLyrics && isValidLyrics(lrc.plainLyrics)) {
    cache.set(track.id, lrc);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return lrc;
  }

  // 5. 검증된 가사가 아예 없는 경우에만 빈 가사 반환
  const empty = { plainLyrics: '', lines: [] };
  cache.set(track.id, empty);
  return empty;
}
