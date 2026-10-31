// Finds the best lyrics for a track: every timed-lyrics database is asked at once,
// candidates are ranked by title/artist/length, and the top ones are checked for
// plausible timing and the right language. A confident match ends the search early.
// Plain text is only used when no timed lyrics exist anywhere.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { parseLrc, cleanLines, isPlausibleTiming, isUsableText, stripTimestamps, scriptProfile, looksRomanizedKorean, decodeEntities } from './lrc.js';
import { parseTrack, buildQueries, scoreCandidate } from './match.js';
import { SYNC_SOURCES, videoCaptions, youtubeMusicPlain, naverPlain } from './sources.js';

const CACHE_VERSION = 3;
const EMPTY_TTL = 30 * 60 * 1000;
const EMPTY_TTL_NETWORK_TROUBLE = 60 * 1000;
const ACCEPT_SCORE = 62;
const CONFIDENT_SCORE = 85; // right title, right artist, length within a couple of seconds
const TIGHT_DRIFT = 2.5;

const dir = () => path.join(app.getPath('userData'), 'lyrics');
const fileOf = (id) => path.join(dir(), `${id}.json`);
const memory = new Map();
const emptyUntil = new Map();
const inflight = new Map();

function readDisk(id) {
  try {
    const d = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
    return d.v === CACHE_VERSION || d.custom ? d.data : null;
  } catch {
    return null;
  }
}

function writeDisk(id, data, custom = false) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(fileOf(id), JSON.stringify({ v: CACHE_VERSION, custom, data }));
  } catch { /* the cache is only an optimisation */ }
}

function languageFit(text, meta) {
  const p = scriptProfile(text);
  if (meta.isKorean) {
    if (p.hangul < 0.02 && looksRomanizedKorean(text)) return null; // transliteration
    if (p.han > 0.3 && p.hangul < 0.1) return null; // Chinese translation
    return p.hangul > 0.1 ? 10 : 0;
  }
  const chineseTitle = meta.titles.some((t) => /[一-鿿]/.test(t));
  if (p.han > 0.5 && p.kana < 0.02 && !chineseTitle && !meta.artists.some((a) => /[一-鿿]/.test(a))) return null;
  return 0;
}

const creditOf = (c) => `출처: ${c.source} (${c.artistName} - ${c.trackName})`;

function timedResult(c, e, duration) {
  return {
    plainLyrics: e.plain ? decodeEntities(e.plain) : stripTimestamps(e.synced),
    syncedLyrics: e.synced,
    lines: e.lines,
    lyricsDuration: c.duration || duration,
    source: c.source,
    footer: creditOf(c),
  };
}

const plainResult = (text, source, footer) => ({ plainLyrics: text, syncedLyrics: null, lines: [], source, footer });
const NOTHING = () => ({ plainLyrics: '', syncedLyrics: null, lines: [] });

// Loads one candidate; returns its timed lines when they fit this recording.
async function examine(c, meta) {
  const { synced, plain } = await c.load();
  const lines = synced ? cleanLines(parseLrc(synced), meta.titles) : [];
  const text = synced || plain || '';
  const fit = text ? languageFit(text, meta) : null;
  if (fit === null) return { usable: false };
  const timed = !c.meta.textOnly && lines.length > 0 && isPlausibleTiming(lines, meta.duration);
  return { usable: isUsableText(text), timed, lines, synced, plain, fit };
}

function rank(items, meta, seen) {
  return items
    .filter((c) => !seen.has(c.id))
    .map((c) => ({ ...c, meta: scoreCandidate(c, meta) }))
    .filter((c) => c.meta.ok)
    .sort((a, b) => b.meta.score - a.meta.score);
}

// Asks every source; settles early as soon as one answer is clearly the right song.
function searchRound(query, meta, state) {
  return new Promise((resolve) => {
    const names = Object.keys(SYNC_SOURCES);
    const all = [];
    let pending = names.length;
    let finished = false;
    const finish = (value) => {
      if (!finished) { finished = true; resolve(value); }
    };

    const consider = (c, e) => {
      if (!e.usable) return null;
      const total = c.meta.score + e.fit;
      if (!state.text || total > state.text.total) state.text = { c, e, total };
      return e.timed && total >= ACCEPT_SCORE ? { c, e, total } : null;
    };

    names.forEach((name) => {
      SYNC_SOURCES[name](query, meta)
        .then(async (items) => {
          state.answered = true;
          all.push(...items);
          const top = rank(items, meta, state.seen)[0];
          if (top && top.meta.score >= CONFIDENT_SCORE) {
            state.seen.add(top.id);
            const hit = consider(top, await examine(top, meta));
            if (hit) finish(hit);
          }
        })
        .catch(() => {})
        .finally(async () => {
          if (--pending > 0 || finished) return;
          const ranked = rank(all, meta, state.seen).slice(0, 6);
          ranked.forEach((c) => state.seen.add(c.id));
          const examined = await Promise.all(ranked.map((c) => examine(c, meta).catch(() => ({ usable: false }))));
          let best = null;
          examined.forEach((e, i) => {
            const hit = consider(ranked[i], e);
            if (hit && (!best || hit.total > best.total)) best = hit;
          });
          finish(best);
        });
    });
  });
}

async function fromCaptions(track, meta) {
  try {
    const raw = await videoCaptions(track.id, meta);
    if (!raw) return null;
    const lines = cleanLines(raw, meta.titles);
    const text = lines.map((l) => l.text).join('\n');
    if (!isPlausibleTiming(lines, meta.duration) || languageFit(text, meta) === null) return null;
    const stamp = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
    return {
      plainLyrics: text,
      syncedLyrics: lines.map((l) => `[${stamp(l.time)}]${l.text}`).join('\n'),
      lines,
      lyricsDuration: meta.duration,
      source: 'YouTube 자막',
      footer: '출처: 이 영상의 공식 자막',
    };
  } catch {
    return null;
  }
}

async function search(track) {
  const meta = parseTrack(track);
  if (meta.instrumental || !meta.titles.length) return { result: NOTHING(), answered: true };

  const state = { seen: new Set(), text: null, answered: false };
  let best = null;
  for (const query of buildQueries(meta).slice(0, 3)) {
    const hit = await searchRound(query, meta, state);
    if (hit && (!best || hit.total > best.total)) best = hit;
    if (best && (best.c.meta.drift ?? 0) <= TIGHT_DRIFT) break;
  }
  const tight = best && (best.c.meta.drift ?? 0) <= TIGHT_DRIFT;
  if (tight) return { result: timedResult(best.c, best.e, meta.duration), answered: true };

  // Nothing lines up to the second (typically a music video longer than the song):
  // the video's own captions beat a database entry for a different cut.
  const captions = await fromCaptions(track, meta);
  if (captions) return { result: captions, answered: true };
  if (best) return { result: timedResult(best.c, best.e, meta.duration), answered: true };

  // No timed lyrics anywhere. Licensed text first, then the best entry we saw.
  const ytm = await youtubeMusicPlain(track.id);
  if (ytm && isUsableText(ytm.text)) return { result: plainResult(ytm.text, 'YouTube Music', ytm.footer), answered: true };
  if (state.text) {
    const { c, e } = state.text;
    return { result: plainResult(e.plain ? decodeEntities(e.plain) : stripTimestamps(e.synced), c.source, creditOf(c)), answered: true };
  }
  const naver = await naverPlain(meta.titles[0], meta.artists[0] || '');
  if (naver && isUsableText(naver)) return { result: plainResult(naver, '네이버', '출처: 네이버'), answered: true };
  return { result: NOTHING(), answered: state.answered };
}

export async function getLyrics(track) {
  const id = track?.id;
  if (!id) return NOTHING();
  if (memory.has(id)) return memory.get(id);
  const stored = readDisk(id);
  if (stored) {
    memory.set(id, stored);
    return stored;
  }
  if (emptyUntil.get(id) > Date.now()) return NOTHING();
  if (inflight.has(id)) return inflight.get(id);

  const job = search(track)
    .then(({ result, answered }) => {
      if (result.lines.length || result.plainLyrics) {
        memory.set(id, result);
        writeDisk(id, result);
      } else {
        // Don't let a network hiccup hide lyrics for long.
        emptyUntil.set(id, Date.now() + (answered ? EMPTY_TTL : EMPTY_TTL_NETWORK_TROUBLE));
      }
      return result;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

// The listener asked to look again. Lyrics they chose by hand stay, and a worse result (or none,
// on a network hiccup) doesn't replace what's already here.
export async function refreshLyrics(track) {
  const id = track?.id;
  if (!id) return NOTHING();
  let custom = false;
  try { custom = JSON.parse(fs.readFileSync(fileOf(id), 'utf8')).custom === true; } catch { /* nothing saved yet */ }
  const current = memory.get(id) || readDisk(id);
  if (custom && current) return current;
  const { result } = await search(track);
  const better = result.lines.length || (result.plainLyrics && !current?.lines?.length);
  if (!better) return current || result;
  memory.set(id, result);
  emptyUntil.delete(id);
  writeDisk(id, result);
  return result;
}

// A lyric the user chose by hand survives restarts and is never replaced automatically.
export function setCustom(trackId, lyricsData) {
  if (!trackId || !lyricsData) return { ok: false };
  memory.set(trackId, lyricsData);
  emptyUntil.delete(trackId);
  writeDisk(trackId, lyricsData, true);
  return { ok: true };
}

function preview(text) {
  return stripTimestamps(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' / ');
}

async function toPickerEntry(c, duration) {
  const { synced, plain } = await c.load();
  const lines = synced ? cleanLines(parseLrc(synced)) : [];
  const hasSynced = lines.length > 0 && isPlausibleTiming(lines, 0);
  const text = (hasSynced ? synced : plain) || (synced ? stripTimestamps(synced) : '');
  if (!text || !isUsableText(text)) return null;
  const plainText = plain ? decodeEntities(plain) : stripTimestamps(text);
  return {
    id: c.id,
    source: `${c.source} (${hasSynced ? '싱크' : '일반'})`,
    trackName: c.trackName,
    artistName: c.artistName,
    albumName: c.albumName,
    duration: c.duration,
    hasSynced,
    lineCount: hasSynced ? lines.filter((l) => l.text).length : plainText.split('\n').filter(Boolean).length,
    preview: preview(text),
    data: {
      plainLyrics: plainText,
      syncedLyrics: hasSynced ? synced : null,
      lines: hasSynced ? lines : [],
      lyricsDuration: c.duration || duration,
      source: c.source,
      footer: creditOf(c),
    },
  };
}

// Everything the "가사 직접 찾기" dialog lists: free-text search or the track's own candidates.
export async function getCandidates(track, customQuery) {
  if (!track) return [];
  const meta = parseTrack(track);
  const typed = typeof customQuery === 'string' ? customQuery.trim() : '';
  const queries = typed ? [{ free: typed, title: typed, artist: '' }] : buildQueries(meta).slice(0, 2);

  const rounds = await Promise.all(queries.map(async (q) => {
    const settled = await Promise.allSettled(Object.values(SYNC_SOURCES).map((fn) => fn(q, meta)));
    return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }));
  const seen = new Set();
  const items = rounds.flat().filter((c) => !seen.has(c.id) && seen.add(c.id));
  const ranked = items
    .map((c) => ({ c, s: scoreCandidate(c, meta) }))
    .sort((a, b) => b.s.score - a.s.score);
  // Typed searches show whatever was asked for; automatic ones hide other songs.
  const chosen = (typed ? ranked : ranked.filter((x) => x.s.ok)).slice(0, 16).map((x) => x.c);

  const entries = (await Promise.all(chosen.map((c) => toPickerEntry(c, meta.duration).catch(() => null)))).filter(Boolean);

  const texts = new Set();
  const unique = entries.filter((e) => {
    const key = e.data.syncedLyrics || e.data.plainLyrics;
    if (texts.has(key)) return false;
    texts.add(key);
    return true;
  });

  if (!typed) {
    const addOwn = (source, data, hasSynced) => unique.push({
      id: `${source}-${track.id}`,
      source: `${source} (${hasSynced ? '싱크' : '일반'})`,
      trackName: track.title || '',
      artistName: meta.artists[0] || '',
      albumName: meta.album,
      duration: meta.duration,
      hasSynced,
      lineCount: hasSynced ? data.lines.length : data.plainLyrics.split('\n').filter(Boolean).length,
      preview: preview(data.plainLyrics),
      data,
    });
    const [captions, ytm] = await Promise.all([fromCaptions(track, meta), youtubeMusicPlain(track.id)]);
    if (captions) addOwn('YouTube 자막', captions, true);
    if (ytm && isUsableText(ytm.text)) addOwn('YouTube Music', plainResult(ytm.text, 'YouTube Music', ytm.footer), false);
  }

  const drift = (e) => (meta.duration > 0 && e.duration > 0 ? Math.abs(e.duration - meta.duration) : 999);
  return unique.sort((a, b) => (a.hasSynced !== b.hasSynced ? (a.hasSynced ? -1 : 1) : drift(a) - drift(b)));
}

export function getCleanSearchTerm(track) {
  if (!track) return '';
  const meta = parseTrack(track);
  return [meta.titles[0], meta.artists[0]].filter(Boolean).join(' ');
}
