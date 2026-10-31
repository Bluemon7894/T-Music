// LRC parsing, cleanup and sanity checks shared by every lyrics source.

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const META_LINE = /^\[(ti|ar|al|by|offset|length|re|ve|kana|language|id|hash|sign|qq|total):/i;

// Staff credits that Chinese lyric databases put in timed lines ("作词 : ...").
const CREDIT_LINE = /^(?:作词|作詞|作曲|编曲|編曲|制作人|製作人|监制|監製|混音|母带|母帶|和声|和聲|吉他|贝斯|貝斯|鼓|弦乐|录音|錄音|出品|发行|發行|演唱|原唱|歌手|词|詞|曲|词曲|詞曲|작사|작곡|편곡|lyrics?(?:\s+by)?|lyricist|compos(?:ed\s+by|er)|written\s+by|writer|arrange(?:d\s+by|r)|producer|produced\s+by|publisher|vocals?|op|sp|isrc)\s*[:：]/i;
const NO_LYRICS_TEXT = /^(?:此歌曲为没有填词的纯音乐|纯音乐|純音樂|暂无歌词|暫無歌詞|no lyrics|instrumental|\*rickrolling\*|probe)/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[\da-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? m;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
}

export function parseLrc(raw) {
  const text = decodeEntities(raw);
  if (!text) return [];
  const offsetTag = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  const offset = offsetTag ? Number(offsetTag[1]) / 1000 : 0;
  const lines = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    // NetEase prefixes credits as JSON lines; those carry no timing we want.
    if (!line || line[0] === '{' || META_LINE.test(line)) continue;
    const stamps = [];
    TIME_TAG.lastIndex = 0;
    let m;
    while ((m = TIME_TAG.exec(line)) !== null) {
      const frac = m[3] ? Number(`0.${m[3]}`) : 0;
      stamps.push(Math.max(0, Number(m[1]) * 60 + Number(m[2]) + frac - offset));
    }
    if (!stamps.length) continue;
    const body = line.replace(TIME_TAG, '').trim();
    for (const time of stamps) lines.push({ time, text: body });
  }
  return lines.sort((a, b) => a.time - b.time);
}

const squash = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Removes credits and the "Title - Artist" banner, and collapses runs of blank lines.
export function cleanLines(lines, titles = []) {
  const nTitles = titles.map(squash).filter((t) => t.length >= 2);
  const out = [];
  lines.forEach((l, i) => {
    if (CREDIT_LINE.test(l.text) || NO_LYRICS_TEXT.test(l.text)) return;
    if (i < 4 && l.time < 20 && / - |《/.test(l.text) && nTitles.some((t) => squash(l.text).includes(t))) return;
    if (!l.text && (!out.length || !out[out.length - 1].text)) return;
    out.push(l);
  });
  while (out.length && !out[out.length - 1].text) out.pop();
  return out;
}

// Rejects timings that can't belong to this recording, or that were clearly generated.
export function isPlausibleTiming(lines, duration = 0) {
  const sung = lines.filter((l) => l.text);
  if (sung.length < 5) return false;
  if (new Set(sung.map((l) => l.time)).size < sung.length * 0.6) return false;
  const last = sung[sung.length - 1].time;
  if (duration > 0 && (last > duration + 6 || last < duration * 0.35)) return false;
  const gaps = sung.slice(1).map((l, i) => l.time - sung[i].time);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean <= 0) return false;
  const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance) / mean >= 0.05; // perfectly even spacing = auto-generated
}

export function stripTimestamps(lrc) {
  return decodeEntities(lrc)
    .split(/\r?\n/)
    .filter((l) => !META_LINE.test(l.trim()) && l.trim()[0] !== '{')
    .map((l) => l.replace(TIME_TAG, '').trim())
    .filter((l) => !CREDIT_LINE.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isUsableText(text) {
  const clean = stripTimestamps(text);
  return clean.length >= 35 && !NO_LYRICS_TEXT.test(clean);
}

// Share of each script among letters, used to catch transliterated or translated lyrics.
export function scriptProfile(text) {
  const body = stripTimestamps(text);
  const count = (re) => (body.match(re) || []).length;
  const hangul = count(/[가-힣]/g);
  const kana = count(/[぀-ヿ]/g);
  const han = count(/[一-鿿]/g);
  const latin = count(/[a-z]/gi);
  const total = hangul + kana + han + latin || 1;
  return { hangul: hangul / total, kana: kana / total, han: han / total, latin: latin / total };
}

const ROMANIZED_KOREAN = /\b(sarang\w*|geudae\w*|eotteo\w*|neoreul|neol|naneun|naega|jigeum|eonjena|gaseum|maeum|chueok|mianhae|nugunga|nuneul|kkeutkkaji|bogo\s?sipeo|eopseo|isseo|hajiman|geureonde|haessdeon|nae\s?ga)\b/gi;
export function looksRomanizedKorean(text) {
  return (stripTimestamps(text).match(ROMANIZED_KOREAN) || []).length >= 3;
}
