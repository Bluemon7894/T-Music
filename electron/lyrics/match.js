// Works out what a track really is (video titles are messy) and how well a
// lyrics database entry matches it.

const ARTIST_ALIASES = {
  아이유: 'IU', 이지금: 'IU', 방탄소년단: 'BTS', 소녀시대: "Girls' Generation", 동방신기: 'TVXQ', 에스파: 'aespa',
  르세라핌: 'LE SSERAFIM', 아이브: 'IVE', 뉴진스: 'NewJeans', 블랙핑크: 'BLACKPINK', 트와이스: 'TWICE', '(여자)아이들': '(G)I-DLE',
  여자아이들: '(G)I-DLE', 세븐틴: 'SEVENTEEN', 스트레이키즈: 'Stray Kids', 엔하이픈: 'ENHYPEN', 투모로우바이투게더: 'TOMORROW X TOGETHER',
  데이식스: 'DAY6', 폴킴: 'Paul Kim', 박재정: 'Park Jae Jung', 성시경: 'Sung Si Kyung', 태연: 'TAEYEON', 악뮤: 'AKMU', 악동뮤지션: 'AKMU',
  볼빨간사춘기: 'BOL4', 십센치: '10CM', 잔나비: 'JANNABI', 멜로망스: 'MeloMance', 헤이즈: 'Heize', 크러쉬: 'Crush', 자이언티: 'Zion.T',
  로이킴: 'Roy Kim', 이하이: 'Lee Hi', 권진아: 'Kwon Jin Ah', 비비: 'BIBI', 지코: 'ZICO', 창모: 'CHANGMO', 버즈: 'Buzz', 윤하: 'YOUNHA',
  임영웅: 'Lim Young Woong', 백현: 'BAEKHYUN', 카더가든: 'Car, the garden', 이승기: 'Lee Seung Gi', 정승환: 'Jung Seung Hwan', 적재: 'Jukjae',
  이무진: 'Lee Mujin', 김범수: 'Kim Bum Soo', 박효신: 'Park Hyo Shin', 이적: 'Lee Juck', 넬: 'NELL', 치즈: 'CHEEZE', 스텔라장: 'Stella Jang',
  선우정아: 'sunwoojunga', 비오: "BE'O", 기리보이: 'GIRIBOY', 애쉬아일랜드: 'ASH ISLAND', 릴러말즈: 'Leellamarz', 플레이브: 'PLAVE', 투어스: 'TWS',
  라이즈: 'RIIZE', 아일릿: 'ILLIT', 보이넥스트도어: 'BOYNEXTDOOR', 엔믹스: 'NMIXX', 스테이씨: 'STAYC', 키스오브라이프: 'KISS OF LIFE',
  베이비몬스터: 'BABYMONSTER', 실리카겔: 'Silica Gel', 검정치마: 'The Black Skirts', 쏜애플: 'Thornapple', 우즈: 'WOODZ', 이창섭: 'Lee Changsub',
  루시: 'LUCY', 소란: 'SORAN', 딘: 'DEAN', 이찬혁: 'Lee Chanhyuk', 이수현: 'Lee Suhyun', 화사: 'Hwa Sa', 청하: 'CHUNG HA', 선미: 'SUNMI',
  현아: 'HyunA', 제니: 'JENNIE', 로제: 'ROSÉ', 지수: 'JISOO', 리사: 'LISA', 다이나믹듀오: 'Dynamic Duo', 너드커넥션: 'Nerd Connection',
  미연: 'MIYEON', 정국: 'Jung Kook', 뷔: 'V', 지민: 'Jimin', 슈가: 'SUGA', 빅뱅: 'BIGBANG', 엑소: 'EXO', 레드벨벳: 'Red Velvet', 있지: 'ITZY',
  마마무: 'MAMAMOO', 오마이걸: 'OH MY GIRL', 여자친구: 'GFRIEND', 샤이니: 'SHINee', 'NCT 드림': 'NCT DREAM', 더보이즈: 'THE BOYZ', 에이핑크: 'Apink',
};

// Channels that upload other people's songs, so their name says nothing about the singer.
const LABEL_CHANNEL = /^(?:1thek.*|hybe\s*labels|smtown|jyp\s*ent.*|yg\s*ent.*|stone\s*music.*|genie\s*music|melon|mnet.*|m2|kbs.*|mbc.*|sbs.*|jtbc.*|tvn.*|dingo.*|딩고.*|it'?s\s*live|killing\s*verse|lyrics?.*|.*\blyrics?$|.*가사.*|tj\s*karaoke|tj노래방.*|금영노래방.*|kakao\s*ent.*|warner.*|sony\s*music.*|universal\s*music.*|.*\bvevo$|.*\brecords?$|.*\bentertainment$|.*엔터테인먼트$)$/i;

const VIDEO_NOISE = /[([【「『][^)\]】」』]*(?:official|music\s*video|m\/?v\b|audio|color\s*coded|lyrics?|가사|자막|live|라이브|lyric\s*video|딩고|dingo|4k|stage\s*mix|교차편집|노래방|반주|special\s*clip|\bclip\b|visualizer|tj\.\d+|ky\.\d+|mr제거|remaster|hd|hq|full\s*ver[^)\]】」』]*|원곡[^)\]】」』]*)[^)\]】」』]*[)\]】」』]/gi;
const TAIL_NOISE = /\s*[|/_-]?\s*(?:official\s*(?:music\s*)?(?:video|audio|mv)?|m\/?v|music\s*video|lyrics?(?:\s*video)?|가사|자막|노래방|반주|mr제거|4k|live\s*clip|visualizer)\s*$/i;
const INSTRUMENTAL = /(?:^|[\s([])(?:inst\.?|instrumental|mr|반주|off\s*vocal|karaoke|노래방)(?:$|[\s)\]])/i;
const VERSION_WORDS = ['remix', 'acoustic', 'live', 'instrumental', 'inst', 'karaoke', 'orchestra', 'sped up', 'slowed', 'nightcore', 'cover', '现场', '伴奏', '翻唱', '라이브', '커버'];

export function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[([](?:feat|ft|prod|with)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const hasHangul = (s) => /[가-힣]/.test(s || '');

export function aliasesOf(name) {
  const n = norm(name);
  const out = new Set();
  if (!n) return out;
  // Names sharing an English form are the same act (아이유, 이지금 -> IU).
  const groups = new Set();
  for (const [kr, en] of Object.entries(ARTIST_ALIASES)) {
    if (norm(kr) === n || norm(en) === n) groups.add(en);
  }
  for (const [kr, en] of Object.entries(ARTIST_ALIASES)) {
    if (groups.has(en)) { out.add(kr); out.add(en); }
  }
  return out;
}

// "이지금 [IU Official]" -> ["이지금", "IU"], "A, B & C" -> ["A", "B", "C"]
function splitArtistNames(raw) {
  const out = [];
  const add = (s) => {
    const clean = String(s || '')
      .replace(/\s*-\s*topic$/i, '')
      .replace(/\b(?:official|channel|vevo)\b|공식|채널/gi, '')
      .trim();
    if (clean && !/^(?:가사|자막|lyrics?|official|mv|audio|live|cover|커버)$/i.test(clean)) out.push(clean);
  };
  const inner = String(raw || '').match(/[([]([^)\]]+)[)\]]/);
  if (inner) add(inner[1]);
  const outer = String(raw || '').replace(/[([][^)\]]*[)\]]/g, ' ');
  for (const part of outer.split(/\s*[,&/、;×]\s*|\s+x\s+|\s+및\s+/i)) {
    // "aespa 에스파", "폴킴 Paul Kim": one act written in two scripts.
    const both = scriptSplit(part);
    add(part);
    both.forEach(add);
  }
  return out;
}

// "한 페이지가 될 수 있게 Time of Our Life" -> ["한 페이지가 될 수 있게", "Time of Our Life"]
function scriptSplit(s) {
  const text = String(s || '').trim();
  const local = text.match(/^([\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s\d]*?)\s+([A-Za-z][A-Za-z0-9\s',.!?&-]+)$/u)
    || text.match(/^([A-Za-z][A-Za-z0-9\s',.!?&-]*?)\s+([\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s\d]*)$/u);
  return local ? [local[1].trim(), local[2].trim()].filter((x) => norm(x).length >= 2) : [];
}

function stripNoise(raw) {
  let s = String(raw || '')
    .normalize('NFKC')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/^\s*[[【][^\]】]+[\]】]\s*/, '')
    .replace(VIDEO_NOISE, ' ');
  for (let i = 0; i < 3; i++) s = s.replace(TAIL_NOISE, '');
  return s.replace(/\s+/g, ' ').trim();
}

const NOT_A_TITLE = /^(?:original|ost|sound\s*track|.*\bost\b.*|.*드라마.*|part\.?\s*\d+|vol\.?\s*\d+|.*스페셜.*|special|remaster.*|\d{4})$/i;

// "밤편지 (Through the Night)" -> tries each half on its own, the separate names first
// because that's how lyric databases list them.
function titleForms(t) {
  const noFeat = t
    .replace(/^['"‘“\s]+|['"’”\s]+$/g, '')
    .replace(/[([](?:feat|ft|prod|with)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/\s+(?:feat|ft|featuring)\.?\s.*$/i, '')
    .trim();
  const base = noFeat.split(/[([]/)[0].replace(/\s*\/\s.*$/, '').trim();
  const inside = [...noFeat.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1].trim()).filter((x) => !NOT_A_TITLE.test(x));
  const out = new Set();
  for (const part of [base, ...inside]) {
    if (!part) continue;
    const both = scriptSplit(part);
    both.forEach((x) => out.add(x));
    out.add(part);
  }
  out.add(noFeat);
  return [...out].filter((x) => norm(x));
}

// Everything we can tell about a track from its title and channel.
export function parseTrack(track) {
  const rawTitle = String(track?.rawTitle || track?.title || '').trim();
  const channelNames = (Array.isArray(track?.artists) ? track.artists : [])
    .map((a) => (typeof a === 'string' ? a : a?.name))
    .concat(track?.artist || [])
    .filter(Boolean);

  const cleaned = stripNoise(rawTitle);
  const titled = [];
  const artistsFromTitle = [];

  const known = (s) => {
    const n = norm(s);
    return Boolean(n) && (aliasesOf(s).size > 0 || channelNames.some((c) => splitArtistNames(c).some((x) => norm(x) === n)));
  };

  const quote = cleaned.match(/^(.*?)\s*['"‘“「『]([^'"’”」』]+)['"’”」』]\s*(.*)$/);
  const sep = cleaned.match(/^(.+?)\s*(?:\s[-–—:|~]\s|\s_\s)\s*(.+)$/);
  // A quote after the separator is a comment, not the song's name ("가수 - 곡 "한줄평"").
  if (quote && !(sep && sep[1].length < quote[1].length)) {
    titled.push(quote[2].trim());
    if (quote[1].trim()) artistsFromTitle.push(quote[1].replace(/[-–—:|~_]\s*$/, '').trim());
    const after = quote[3].replace(/^[-–—:|~_]\s*/, '').trim();
    if (after && !/official|\bm\/?v\b|\bver\b|performance|video|audio/i.test(after)) titled.push(after);
  } else if (sep) {
    const [, left, right] = sep;
    // "곡 - 가수" and "가수 - 곡" both happen; a recognised name tells which is which.
    if (known(right) && !known(left)) { titled.push(left); artistsFromTitle.push(right); } else { titled.push(right); artistsFromTitle.push(left); }
  } else {
    let matched = false;
    for (const [kr, en] of Object.entries(ARTIST_ALIASES)) {
      for (const name of [kr, en]) {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${esc}(?:\\s*[([][^)\\]]*[)\\]])?\\s+(.+)$`, 'i');
        const m = cleaned.match(re);
        if (m) { artistsFromTitle.push(name); titled.push(m[1]); matched = true; break; }
      }
      if (matched) break;
    }
    if (!matched && cleaned) titled.push(cleaned);
  }

  let titles = [...new Set(titled.flatMap(titleForms))];
  if (!titles.length && cleaned) titles.push(cleaned);

  const fromChannels = channelNames.filter((c) => !LABEL_CHANNEL.test(String(c).trim())).flatMap(splitArtistNames);
  const fromTitle = artistsFromTitle.flatMap(splitArtistNames);
  const base = [...fromTitle, ...fromChannels];
  const artists = [];
  for (const a of base) {
    if (!artists.some((x) => norm(x) === norm(a))) artists.push(a);
    for (const al of aliasesOf(a)) if (!artists.some((x) => norm(x) === norm(al))) artists.push(al);
  }

  const isKorean = [...titles, ...base].some(hasHangul) || base.some((a) => aliasesOf(a).size > 0);
  // Korean databases and uploaders list the Korean name, so search with it first.
  if (isKorean) titles = [...titles.filter(hasHangul), ...titles.filter((t) => !hasHangul(t))];
  return {
    rawTitle,
    titles,
    artists,
    duration: Number(track?.duration) || 0,
    album: track?.album?.name || '',
    isKorean,
    instrumental: INSTRUMENTAL.test(rawTitle),
  };
}

// Search strings from most to least specific.
export function buildQueries(meta) {
  const [t0, t1] = meta.titles;
  const [a0, a1] = meta.artists;
  const q = [];
  const push = (title, artist) => { if (title) q.push({ title, artist: artist || '' }); };
  push(t0, a0);
  // The other language's title on its own: databases often spell the singer differently too.
  if (t1) push(t1, '');
  if (a1) push(t0, a1);
  if (a0) push(t0, '');
  if (t1 && a0) push(t1, a0);
  return q;
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

function closeness(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= 2 && long.includes(short)) {
    const ratio = short.length / long.length;
    if (ratio >= 0.5) return 0.85;
    if (short.length >= 4) return 0.6;
  }
  const d = dice(a, b);
  return d >= 0.7 ? d * 0.85 : 0;
}

export function titleMatch(candidateNames, meta) {
  let best = 0;
  for (const name of [].concat(candidateNames).filter(Boolean)) {
    for (const form of [name, ...titleForms(String(name))]) {
      const c = norm(form);
      for (const t of meta.titles) best = Math.max(best, closeness(c, norm(t)));
    }
  }
  return best;
}

export function artistMatch(candidateArtist, meta) {
  const names = splitArtistNames(candidateArtist);
  const expanded = new Set(names);
  for (const n of names) for (const al of aliasesOf(n)) expanded.add(al);
  let best = 0;
  for (const c of expanded) {
    const nc = norm(c);
    for (const a of meta.artists) {
      const na = norm(a);
      if (!nc || !na) continue;
      if (nc === na) return 1;
      if (Math.min(nc.length, na.length) >= 2 && (nc.includes(na) || na.includes(nc))) best = Math.max(best, 0.75);
    }
  }
  return best;
}

export function versionConflict(candidateName, meta) {
  const name = String(candidateName || '').toLowerCase();
  const raw = meta.rawTitle.toLowerCase();
  return VERSION_WORDS.some((w) => name.includes(w) && !raw.includes(w));
}

// Longest gap between a video and a lyrics entry we still trust the timestamps for.
export const MAX_SYNC_DRIFT = 8;

// 0-100 from metadata alone. `ok` is false for anything that is probably another song.
export function scoreCandidate(c, meta) {
  const names = [c.trackName, ...(c.altNames || [])];
  if (versionConflict(c.trackName, meta)) return { ok: false, score: 0, textOnly: false };
  const title = titleMatch(names, meta);
  const artist = artistMatch(c.artistName, meta);
  const drift = meta.duration > 0 && c.duration > 0 ? Math.abs(meta.duration - c.duration) : null;

  if (title < 0.6) return { ok: false, score: 0, textOnly: false };
  const shortTitle = norm(meta.titles[0]).length <= 3;
  // A different spelling of the singer is fine when the length also lines up to the second.
  const trusted = artist > 0 || (drift !== null && drift <= 2 && title >= 0.85 && !shortTitle);
  if (!trusted) return { ok: false, score: 0, textOnly: false };

  const durScore = drift === null ? 0.5 : drift <= 1 ? 1 : drift <= 2 ? 0.9 : drift <= 4 ? 0.6 : drift <= MAX_SYNC_DRIFT ? 0.25 : 0;
  const score = title * 45 + artist * 30 + durScore * 25;
  // Right song, wrong cut: the words are usable but the timestamps are not.
  const textOnly = drift !== null && drift > MAX_SYNC_DRIFT;
  return { ok: true, score, textOnly, drift };
}
