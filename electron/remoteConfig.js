// A few settings read from remote-config.json in the GitHub repository, so the most common breakage
// (YouTube refusing one way of asking for audio, a lyrics or radio source going away) can be worked
// around without shipping an update. It can only reorder or switch off things the app already has:
// anything unknown or malformed is ignored, and without the file the built-in defaults apply.
// Runs in the desktop main process and, unchanged, inside the Android app.
const URL = 'https://raw.githubusercontent.com/Bluemon7894/T-Music/main/remote-config.json';
const TIMEOUT_MS = 8000;
const REFRESH_MS = 6 * 60 * 60 * 1000;

export const STREAM_CLIENTS = ['VISIONOS', 'IOS', 'ANDROID_VR', 'TV', 'TV_EMBEDDED', 'WEB_EMBEDDED', 'MWEB', 'ANDROID', 'YTMUSIC', 'WEB'];
const LYRICS_SOURCES = ['lrclib', 'netease', 'qq', 'kugou', 'captions', 'ytmusic', 'naver'];
const RADIO_SOURCES = ['stations', 'youtube'];
const TEXT_MAX = 300;

let config = {};
let timer = null;

const knownList = (value, known) => (Array.isArray(value) ? [...new Set(value.filter((v) => known.includes(v)))] : null);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, TEXT_MAX) : null);

function clean(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  const clients = knownList(raw.streamClients, STREAM_CLIENTS);
  if (clients?.length) out.streamClients = clients;
  const lastResort = knownList(raw.lastResortClients, STREAM_CLIENTS);
  if (lastResort) out.lastResortClients = lastResort;
  out.lyricsOff = knownList(raw.lyricsOff, LYRICS_SOURCES) || [];
  out.radioOff = knownList(raw.radioOff, RADIO_SOURCES) || [];
  const n = raw.notice;
  if (n && typeof n === 'object' && text(n.id) && (text(n.ko) || text(n.en))) out.notice = { id: text(n.id), ko: text(n.ko), en: text(n.en) };
  return out;
}

async function load() {
  const controller = new AbortController();
  const stop = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${URL}?t=${Math.floor(Date.now() / 60000)}`, { signal: controller.signal, cache: 'no-store' });
    if (res.ok) config = clean(await res.json());
  } catch { /* keep what we had */ } finally {
    clearTimeout(stop);
  }
}

let first = null;
export function start() {
  if (!first) {
    first = load();
    timer = setInterval(load, REFRESH_MS);
    timer.unref?.();
  }
  return first;
}

export const streamClients = (fallback) => config.streamClients || fallback;
export const lastResortClients = (fallback) => config.lastResortClients || fallback;
export const lyricsOn = (name) => !(config.lyricsOff || []).includes(name);
export const radioOn = (name) => !(config.radioOff || []).includes(name);
export const notice = () => config.notice || null;
