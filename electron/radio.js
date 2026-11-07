// What's on the radio right now. Two kinds of channel share one dial:
//  - internet radio stations, from the public Radio Browser directory (only ones that passed its
//    last check, so they're broadcasting), and
//  - YouTube music livestreams that are live at this moment.
// Every channel gets a place on the FM or AM dial. Stations that say their frequency in their name
// keep it; everything else gets a free spot (talk and news on AM, music on FM).
// Runs in the desktop main process and, unchanged, inside the Android app.
import { getClient } from './youtube/client.js';
import * as remote from './remoteConfig.js';

const DIRECTORY = ['https://de1.api.radio-browser.info', 'https://de2.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://nl1.api.radio-browser.info'];
const TIMEOUT_MS = 9000;
const STATION_LIMIT = 70;
const LIVE_LIMIT = 14;
const CACHE_MS = 50 * 1000; // the list refreshes every minute; this only stops double work

export const FM = { min: 87.5, max: 108, step: 0.1 };
export const AM = { min: 531, max: 1602, step: 9 };

// The searches that find music livestreams, per region. A region without its own uses the general ones.
const LIVE_QUERIES = {
  KR: ['음악 라디오 라이브', '케이팝 라이브 24/7', 'lofi radio'],
  JP: ['音楽 ラジオ ライブ', 'lofi radio'],
  ALL: ['music radio live 24/7', 'lofi radio', 'jazz radio live'],
};

const withTimeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

async function directory(path) {
  let last = null;
  for (const host of DIRECTORY) {
    const { signal, done } = withTimeout(TIMEOUT_MS);
    try {
      const res = await fetch(`${host}${path}`, { signal, headers: { 'User-Agent': 'T-Music/radio' } });
      if (res.ok) return await res.json();
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    } finally {
      done();
    }
  }
  throw last || new Error('directory unavailable');
}

// "MBC FM4U 91.9", "KBS 1Radio AM 711", "Classic FM 100.9 MHz"
function statedFrequency(text) {
  const am = /(?:^|\D)(\d{3,4})\s*(?:khz|am)\b/i.exec(text) || /\bam\s*(\d{3,4})(?!\d)/i.exec(text);
  if (am) {
    const f = Number(am[1]);
    if (f >= AM.min && f <= AM.max) return { band: 'AM', freq: f };
  }
  const fm = /(?:^|[^\d.])(\d{2,3}\.\d)(?![\d.])/.exec(text);
  if (fm) {
    const f = Number(fm[1]);
    if (f >= FM.min && f <= FM.max) return { band: 'FM', freq: Math.round(f * 10) / 10 };
  }
  return null;
}

const TALK = /\b(news|talk|sport|sports|politic|religio|christian|catholic|buddh|bible|preach|뉴스|시사|토크|종교|교통)\b/i;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A free spot on the dial near where the channel's id would put it, so a channel keeps its number
// from one refresh to the next unless something new took the spot.
function place(channels) {
  const taken = { FM: new Set(), AM: new Set() };
  const key = (band, f) => (band === 'FM' ? Math.round(f * 10) : f);
  for (const c of channels) if (c.freq) taken[c.band].add(key(c.band, c.freq));
  for (const c of channels) {
    if (c.freq) continue;
    const range = c.band === 'AM' ? AM : FM;
    const slots = c.band === 'AM' ? Math.floor((range.max - range.min) / range.step) + 1 : Math.round((range.max - range.min) / 0.2) + 1;
    let slot = hash(c.id) % slots;
    for (let i = 0; i < slots; i++, slot = (slot + 1) % slots) {
      const freq = c.band === 'AM' ? range.min + slot * range.step : Math.round((range.min + slot * 0.2) * 10) / 10;
      if (!taken[c.band].has(key(c.band, freq))) {
        taken[c.band].add(key(c.band, freq));
        c.freq = freq;
        c.virtual = true;
        break;
      }
    }
  }
  return channels;
}

const httpsOnly = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

async function stations(country) {
  const query = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(STATION_LIMIT) });
  if (country !== 'ALL') query.set('countrycode', country);
  const list = await directory(`/json/stations/search?${query}`);
  const seen = new Set();
  return list
    .filter((s) => s.lastcheckok === 1 && s.url_resolved && /^https?:\/\//.test(s.url_resolved))
    .filter((s) => {
      const name = s.name.trim().toLowerCase();
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((s) => {
      const stated = statedFrequency(`${s.name} ${s.tags || ''}`);
      return {
        id: `rb:${s.stationuuid}`,
        kind: 'station',
        name: s.name.trim().slice(0, 80),
        url: s.url_resolved,
        hls: s.hls === 1 || /\.m3u8(\?|$)/i.test(s.url_resolved),
        logo: httpsOnly(s.favicon),
        tags: String(s.tags || '').split(',').filter(Boolean).slice(0, 4),
        country: s.countrycode || null,
        codec: s.codec || null,
        bitrate: s.bitrate || 0,
        band: stated?.band || (TALK.test(`${s.name} ${s.tags}`) ? 'AM' : 'FM'),
        freq: stated?.freq || null,
      };
    });
}

const textOf = (v) => (typeof v === 'string' ? v : v?.text || v?.toString?.() || '');

async function livestreams(country) {
  const yt = await getClient();
  const found = new Map();
  for (const q of LIVE_QUERIES[country] || LIVE_QUERIES.ALL) {
    try {
      const res = await yt.search(q, { features: ['live'] });
      for (const v of res.videos || res.results || []) {
        const id = v.id || v.video_id;
        if (!id || found.has(id) || v.is_live === false) continue;
        const thumb = v.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        found.set(id, { id: `yt:${id}`, kind: 'youtube', videoId: id, name: textOf(v.title).slice(0, 80), channel: textOf(v.author?.name || v.author).slice(0, 60), logo: thumb.split('?')[0], band: 'FM', freq: null, hls: true });
        if (found.size >= LIVE_LIMIT) break;
      }
    } catch { /* one search failing leaves the others */ }
    if (found.size >= LIVE_LIMIT) break;
  }
  return [...found.values()];
}

const cache = new Map();
export async function channels(country = 'KR') {
  const hit = cache.get(country);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const [a, b] = await Promise.allSettled([
    remote.radioOn('stations') ? stations(country) : [],
    remote.radioOn('youtube') ? livestreams(country) : [],
  ]);
  const list = place([...(a.value || []), ...(b.value || [])]);
  if (!list.length && a.status === 'rejected' && b.status === 'rejected') throw a.reason;
  list.sort((x, y) => x.freq - y.freq);
  cache.set(country, { at: Date.now(), list });
  return list;
}

// A YouTube livestream's HLS address. Only some clients hand one out for live video.
const LIVE_CLIENTS = ['VISIONOS', 'ANDROID_VR', 'IOS'];
const manifests = new Map();
export async function liveManifest(videoId) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('bad id');
  const hit = manifests.get(videoId);
  if (hit && hit.expires > Date.now()) return hit.url;
  const yt = await getClient();
  for (const client of LIVE_CLIENTS) {
    try {
      const info = await yt.getBasicInfo(videoId, { client });
      const url = info.streaming_data?.hls_manifest_url;
      if (info.playability_status?.status === 'OK' && url) {
        const exp = Number(/\/expire\/(\d+)/.exec(url)?.[1]) * 1000;
        manifests.set(videoId, { url, expires: (exp || Date.now() + 3600 * 1000) - 10 * 60 * 1000 });
        return url;
      }
    } catch { /* the next client */ }
  }
  throw new Error('이 방송은 지금 들을 수 없어요');
}
