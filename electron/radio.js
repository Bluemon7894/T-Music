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

// Well-known stations whose Radio Browser entry lacks the frequency in its name.
const KNOWN_STATIONS = [
  // SBS
  { match: /sbs.*power|파워\s*fm|power\s*fm/i, band: 'FM', freq: 107.7 },
  { match: /sbs.*love|러브\s*fm|love\s*fm/i, band: 'FM', freq: 103.5 },
  // MBC
  { match: /mbc.*(?:fm\s*4u|for\s*you|포유)|fm\s*4u|엠비씨\s*fm/i, band: 'FM', freq: 91.9 },
  { match: /mbc.*충북.*표준/i, band: 'FM', freq: 107.1 },
  { match: /mbc.*충북.*fm/i, band: 'FM', freq: 99.7 },
  { match: /mbc.*표준\s*fm|mbc\s*fm\b|mbc\s*라디오/i, band: 'FM', freq: 95.9 },
  { match: /mbc.*올댓뮤직/i, band: 'FM', freq: 92.7 },
  // KBS
  { match: /kbs.*(?:cool|쿨\s*fm|2fm|제2fm)/i, band: 'FM', freq: 89.1 },
  { match: /kbs.*(?:classic|클래식\s*fm|1fm|제1fm)/i, band: 'FM', freq: 93.1 },
  { match: /kbs.*(?:1라디오|제1라디오|1\s*radio)/i, band: 'FM', freq: 97.3 },
  { match: /kbs.*(?:2라디오|제2라디오|2\s*radio|happy\s*fm|해피\s*fm)/i, band: 'FM', freq: 106.1 },
  { match: /kbs.*(?:3라디오|제3라디오|3\s*radio|사랑의\s*소리)/i, band: 'FM', freq: 104.9 },
  // CBS
  { match: /cbs.*(?:음악\s*fm|music\s*fm)/i, band: 'FM', freq: 93.9 },
  { match: /cbs.*(?:표준\s*fm|standard)/i, band: 'FM', freq: 98.1 },
  // TBS
  { match: /tbs.*(?:efm|이\s*fm)/i, band: 'FM', freq: 101.3 },
  { match: /tbs.*(?:fm|교통방송)/i, band: 'FM', freq: 95.1 },
  // EBS
  { match: /ebs.*(?:fm|라디오)/i, band: 'FM', freq: 104.5 },
  // Others
  { match: /ytn.*(?:라디오|fm)/i, band: 'FM', freq: 94.5 },
  { match: /obs.*(?:라디오|fm)/i, band: 'FM', freq: 99.9 },
  { match: /국방\s*fm/i, band: 'FM', freq: 96.7 },
  { match: /bbs.*(?:불교방송|fm)/i, band: 'FM', freq: 101.9 },
  { match: /cpbc.*(?:평화방송|가톨릭|fm)|평화방송/i, band: 'FM', freq: 105.3 },
  { match: /tbn.*(?:교통방송|fm)/i, band: 'FM', freq: 105.5 },
  { match: /arirang.*(?:radio|라디오)/i, band: 'FM', freq: 88.7 },
  { match: /afn.*(?:eagle|humphreys)/i, band: 'FM', freq: 88.3 },
];

// "MBC FM4U 91.9", "KBS 1Radio AM 711", "Classic FM 100.9 MHz"
function statedFrequency(text) {
  const am = /(?:^|\D)(\d{3,4})\s*(?:khz|am)\b/i.exec(text) || /\bam\s*(\d{3,4})(?!\d)/i.exec(text);
  if (am) {
    const f = Number(am[1]);
    if (f >= AM.min && f <= AM.max) return { band: 'AM', freq: f };
  }
  const fm = /(?:^|[^\d.])(\d{2,3}(?:\.\d)?)\s*(?:mhz|fm)\b/i.exec(text) || /(?:^|[^\d.])(\d{2,3}\.\d)(?![\d.])/i.exec(text);
  if (fm) {
    const f = Number(fm[1]);
    if (f >= FM.min && f <= FM.max) return { band: 'FM', freq: Math.round(f * 10) / 10 };
  }
  for (const k of KNOWN_STATIONS) {
    if (k.match.test(text)) return { band: k.band, freq: k.freq };
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
  // Stably sort unplaced channels so virtual frequencies are deterministic across devices and refreshes:
  const unplaced = channels.filter((c) => !c.freq).sort((a, b) => a.id.localeCompare(b.id));
  for (const c of unplaced) {
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

// The directory only says a station worked at its last check. Many have since gone: broadcasters'
// signed addresses expire (403/400), some entries point at a web page, some servers are down. Each
// stream is tried here before it's listed, and the answer is kept for a while.
const PROBE_TIMEOUT_MS = 4500;
const PROBE_KEEP_MS = 15 * 60 * 1000;
const PROBE_PARALLEL = 12;
const probes = new Map();
const AUDIO = /^(audio\/|application\/ogg|video\/mp2t)/i;
const PLAYLIST = /mpegurl|vnd\.apple/i;

// On a phone the page can't reach stations directly; the phone fetches for it (see proxyFetch.js).
const via = (url) => (typeof window !== 'undefined' && window.__tmRadioProxy ? window.__tmRadioProxy(url) : url);

async function reachable(station) {
  const hit = probes.get(station.url);
  if (hit && Date.now() - hit.at < PROBE_KEEP_MS) return hit.ok;
  const { signal, done } = withTimeout(PROBE_TIMEOUT_MS);
  let ok = false;
  try {
    const res = await fetch(via(station.url), { signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Icy-MetaData': '0' } });
    const type = res.headers.get('content-type') || '';
    if (res.ok && PLAYLIST.test(type)) {
      const text = await res.text();
      ok = text.trimStart().startsWith('#EXTM3U');
      // A master playlist can open while the stream it points to is refused: try that one too.
      const variant = ok && /#EXT-X-STREAM-INF/.test(text) && text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      if (variant) {
        const sub = await fetch(via(new URL(variant, station.url).href), { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        ok = sub.ok && (await sub.text()).includes('#EXTINF');
      }
    } else ok = res.ok && AUDIO.test(type);
    if (!PLAYLIST.test(type)) res.body?.cancel();
  } catch { ok = false; } finally {
    done();
  }
  probes.set(station.url, { ok, at: Date.now() });
  return ok;
}

// The phone won't open plain-http connections, which is right; most stream servers answer on https too,
// so there the address is upgraded and the check below drops the ones that don't.
const phone = () => typeof window !== 'undefined' && Boolean(window.__tmRadioProxy);
const secure = (s) => (phone() && s.url.startsWith('http://') ? { ...s, url: `https://${s.url.slice(7)}` } : s);

async function onlyReachable(all) {
  const list = all.map(secure);
  const keep = new Array(list.length).fill(false);
  let next = 0;
  await Promise.all(Array.from({ length: PROBE_PARALLEL }, async () => {
    while (next < list.length) {
      const i = next++;
      keep[i] = await reachable(list[i]);
    }
  }));
  return list.filter((_, i) => keep[i]);
}

const cache = new Map();
export async function channels(country = 'KR') {
  const hit = cache.get(country);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const [a, b] = await Promise.allSettled([
    remote.radioOn('stations') ? stations(country).then(onlyReachable) : [],
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
