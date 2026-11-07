// The radio: a dial of live channels, played on an <audio> element of its own. It goes past the Web
// Audio graph on purpose, so the equalizer stays a music thing (and stations send no CORS headers,
// which the graph would need).
//
// Turning it on plays radio-start.mp3 while the dial sweeps to the channel; the broadcast comes in as
// the sound ends. Turning it off plays radio-end.mp3 while the broadcast fades and the dial goes dark.
// The radio and the music never play together: starting one stops the other.
import { create } from 'zustand';
import Hls from 'hls.js';
import { api, errorText } from '../lib/api.js';
import { attachRadio, getAudioContext, wakeAudio } from '../lib/audio.js';
import { IS_ANDROID } from '../lib/platform.js';
import { tr } from '../lib/i18n.js';
import { noteTrouble } from '../lib/trouble.js';
import { usePlayer } from './player.js';
import { useRoom } from './room.js';
import { useDeck } from './deck.js';
import { useLibrary } from './library.js';
import { toast } from './ui.js';
import radioStart from '../assets/sounds/radio-start.mp3?inline';
import radioEnd from '../assets/sounds/radio-end.mp3?inline';

const PREFS_KEY = 't-music-radio';
export const REFRESH_MS = 60 * 1000;
const QUIET_TUNE_MS = 700; // the dial moving with no sound: switching channels, or sounds turned off
const FADE_IN_MS = 600;
const STALL_RETRY_MS = 8000;
const MAX_RETRIES = 3;
export const COUNTRIES = [
  { id: 'KR', label: tr('한국') },
  { id: 'JP', label: tr('일본') },
  { id: 'US', label: tr('미국') },
  { id: 'GB', label: tr('영국') },
  { id: 'FR', label: tr('프랑스') },
  { id: 'DE', label: tr('독일') },
  { id: 'ALL', label: tr('전 세계') },
];

const saved = (() => {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
})();
const savePrefs = (patch) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...saved, ...patch })); Object.assign(saved, patch); } catch { /* this session only */ }
};

// ---- the sounds ----
function decode(dataUrl) {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer);
}
const buffers = { start: null, end: null };
const loadSound = (kind) => (buffers[kind] ??= decode(kind === 'start' ? radioStart : radioEnd).catch((e) => { buffers[kind] = null; throw e; }));
setTimeout(() => { loadSound('start').catch(() => {}); loadSound('end').catch(() => {}); }, 2500);

let soundSource = null;
// Plays a sound at the music's volume and resolves with how long it lasts, in ms (0 if it can't play).
async function playSound(kind) {
  const ctx = getAudioContext();
  let buffer = null;
  try { buffer = await loadSound(kind); } catch { /* no sound */ }
  if (!ctx || !buffer) return 0;
  stopSound();
  const p = usePlayer.getState();
  const gain = ctx.createGain();
  gain.gain.value = p.muted ? 0 : p.volume;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(gain).connect(ctx.destination);
  src.start();
  soundSource = { src, gain };
  return buffer.duration * 1000;
}
function stopSound() {
  if (!soundSource) return;
  try { soundSource.src.stop(); } catch { /* already over */ }
  soundSource = null;
}

// ---- the broadcast ----
const audio = new Audio();
audio.preload = 'none';
audio.crossOrigin = 'anonymous'; // lets the radio set's speaker read the sound (the proxy allows it)
let hls = null;
let fadeTimer = null;
let retries = 0;
let stallTimer = null;

const level = () => {
  const p = usePlayer.getState();
  return p.muted ? 0 : p.volume;
};

function proxied(url) {
  if (IS_ANDROID) return window.__tmRadioProxy(url);
  return `ytm://radio/?u=${encodeURIComponent(url)}`;
}

function release() {
  clearInterval(fadeTimer);
  clearTimeout(stallTimer);
  if (hls) { hls.destroy(); hls = null; }
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function fadeTo(target, ms, then) {
  clearInterval(fadeTimer);
  const from = audio.volume;
  const started = performance.now();
  fadeTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - started) / Math.max(1, ms));
    audio.volume = Math.max(0, Math.min(1, from + (target - from) * t));
    if (t >= 1) { clearInterval(fadeTimer); then?.(); }
  }, 30);
}

// Requests go through the proxy, but a playlist's relative entries must resolve against the station's
// own address, not the proxy's: hls.js falls back to the address it asked for when a response has none.
class ProxyLoader extends Hls.DefaultConfig.loader {
  load(context, config, callbacks) {
    const done = callbacks.onSuccess;
    super.load(context, config, { ...callbacks, onSuccess: (response, ...rest) => done({ ...response, url: context.url }, ...rest) });
  }
}

async function attachStream(station) {
  release();
  attachRadio(audio, () => useRadio.getState().on && !useRadio.getState().paused);
  wakeAudio();
  let url = station.url;
  let useHls = station.hls;
  if (station.kind === 'youtube') {
    url = await api.radioLive(station.videoId);
    useHls = true;
  }
  if (!url) throw new Error('no stream');
  audio.volume = 0;
  if (useHls) {
    if (!Hls.isSupported()) throw new Error('HLS unsupported');
    hls = new Hls({
      lowLatencyMode: false,
      liveSyncDurationCount: 3,
      maxBufferLength: 20,
      loader: ProxyLoader,
      xhrSetup: (xhr, target) => { xhr.open('GET', proxied(target), true); },
    });
    hls.on(Hls.Events.ERROR, (_e, data) => { if (import.meta.env.DEV) (window.__tmHlsErrors ??= []).push(`${data.fatal ? 'FATAL ' : ''}${data.details}`); if (data.fatal) onStreamError(data.details || data.type); });
    if (import.meta.env.DEV) window.__tmHls = hls;
    hls.loadSource(url);
    hls.attachMedia(audio);
  } else {
    audio.src = proxied(url);
  }
}

function onStreamError(why) {
  const { on, station } = useRadio.getState();
  if (!on || !station || useRadio.getState().phase === 'ending' || useRadio.getState().paused) return;
  noteTrouble('radio', { id: station.id, why: String(why).slice(0, 80) });
  if (retries++ < MAX_RETRIES) {
    useRadio.setState({ buffering: true });
    setTimeout(() => {
      const s = useRadio.getState();
      if (s.on && !s.paused && s.station?.id === station.id) start(station, { quiet: true, retry: true });
    }, 1500);
    return;
  }
  useRadio.setState({ buffering: false, failed: true });
  toast(tr('이 방송에 연결할 수 없어요. 다른 채널을 골라 보세요.'));
}

audio.addEventListener('playing', () => {
  retries = 0;
  clearTimeout(stallTimer);
  useRadio.setState({ buffering: false, failed: false });
});
audio.addEventListener('waiting', () => {
  if (useRadio.getState().paused) return;
  useRadio.setState({ buffering: true });
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => onStreamError('stalled'), STALL_RETRY_MS);
});
// Clearing the element for the next channel also raises an error; only a stream we gave it counts.
audio.addEventListener('error', () => { if (!hls && audio.getAttribute('src')) onStreamError(audio.error?.code || 'error'); });

// The radio follows the player's volume.
usePlayer.subscribe((p, prev) => {
  if ((p.volume !== prev.volume || p.muted !== prev.muted) && useRadio.getState().phase === 'on') {
    clearInterval(fadeTimer);
    audio.volume = level();
  }
  if (soundSource && (p.volume !== prev.volume || p.muted !== prev.muted)) soundSource.gain.gain.value = level();
  // Music started: the radio goes quiet without ceremony.
  if (p.playing && !prev.playing) {
    if (useRadio.getState().on) useRadio.getState().powerOff({ quiet: true, local: true });
    // The room goes back to music too, if this person may change what it plays.
    const room = useRoom.getState();
    if (room.attached && room.radio && room.canControl()) room.setRadio(null);
  }
});

let token = 0;
async function start(station, { quiet = false, retry = false } = {}) {
  const mine = ++token;
  const prev = useRadio.getState();
  const wasOn = prev.on && prev.phase !== 'ending';
  if (usePlayer.getState().playing) usePlayer.getState().toggle();
  if (!retry) retries = 0;
  const sounds = !quiet && !wasOn && useDeck.getState().sounds;
  const fromFreq = wasOn && prev.station?.band === station.band ? prev.station.freq : null;
  useRadio.setState({ on: true, paused: false, phase: 'tuning', station, buffering: true, failed: false, band: station.band, sweep: { at: performance.now(), ms: QUIET_TUNE_MS, from: fromFreq, to: station.freq, kind: 'on' } });
  savePrefs({ last: station, band: station.band });
  const soundMs = sounds ? await playSound('start') : 0;
  if (mine !== token) return;
  const ms = soundMs || QUIET_TUNE_MS;
  useRadio.setState({ sweep: { at: performance.now(), ms, from: fromFreq, to: station.freq, kind: 'on' } });
  try {
    await attachStream(station);
  } catch (e) {
    if (mine !== token) return;
    useRadio.setState({ buffering: false, failed: true });
    toast(errorText(e) || tr('이 방송에 연결할 수 없어요. 다른 채널을 골라 보세요.'));
    return;
  }
  if (mine !== token) return;
  // The broadcast starts quietly under the end of the sound and comes up as the dial lands.
  setTimeout(() => {
    if (mine !== token) return;
    audio.play().catch(() => onStreamError('play refused'));
    fadeTo(level(), FADE_IN_MS);
    useRadio.setState({ phase: 'on' });
  }, Math.max(0, ms - FADE_IN_MS / 2));
}

export const useRadio = create((set, get) => ({
  on: false,
  phase: 'off', // off | tuning | on | ending
  station: null,
  band: saved.band === 'AM' ? 'AM' : 'FM',
  country: COUNTRIES.some((c) => c.id === saved.country) ? saved.country : 'KR',
  channels: [],
  loading: false,
  error: null,
  updatedAt: 0,
  buffering: false,
  failed: false,
  paused: false, // stopped for now but still tuned in; resuming picks the broadcast up live
  sweep: null, // { at, ms, from, to, kind }: what the dial is doing, for the radio's drawing
  last: saved.last || null,

  async refresh() {
    const country = get().country;
    set({ loading: true, error: null });
    try {
      const channels = await api.radioChannels(country);
      if (get().country !== country) return;
      set({ channels: Array.isArray(channels) ? channels : [], updatedAt: Date.now(), loading: false });
    } catch (e) {
      set({ loading: false, error: errorText(e) || tr('라디오 목록을 불러오지 못했어요') });
    }
  },
  setCountry(country) {
    if (country === get().country) return;
    savePrefs({ country });
    set({ country, channels: [] });
    get().refresh();
  },
  setBand(band) {
    savePrefs({ band });
    set({ band });
  },

  // Tune to a channel, turning the radio on if needed. In a room, the whole room tunes in.
  tune(station, { fromRoom = false } = {}) {
    if (!station) return;
    const room = useRoom.getState();
    if (!fromRoom && room.code && room.attached) {
      if (!room.setRadio(station)) return;
    }
    start(station);
  },

  powerOn() {
    const s = get();
    const station = s.station || s.last || s.channels.find((c) => c.band === s.band) || s.channels[0];
    if (station) get().tune(station);
    else toast(tr('채널 목록을 불러오는 중이에요'));
  },

  // `local`: only this device (music started here, or the room changed its mind).
  powerOff({ quiet = false, fromRoom = false, local = false } = {}) {
    if (!get().on) return;
    const room = useRoom.getState();
    if (!fromRoom && !local && room.code && room.attached && room.radio) {
      if (!room.setRadio(null)) return;
    }
    const mine = ++token;
    const freq = get().station?.freq;
    if (quiet || !useDeck.getState().sounds) {
      stopSound();
      release();
      set({ on: false, paused: false, phase: 'off', buffering: false, sweep: { at: performance.now(), ms: QUIET_TUNE_MS, from: freq, to: null, kind: 'off' } });
      return;
    }
    set({ phase: 'ending', buffering: false });
    playSound('end').then((ms) => {
      if (mine !== token) return;
      const length = ms || QUIET_TUNE_MS;
      set({ sweep: { at: performance.now(), ms: length, from: freq, to: null, kind: 'off' } });
      fadeTo(0, length, () => {
        if (mine !== token) return;
        release();
        set({ on: false, paused: false, phase: 'off' });
      });
    });
  },

  toggle() {
    if (get().on && get().phase !== 'ending') get().powerOff();
    else get().powerOn();
  },

  // Play/pause on the radio: the set stays on and tuned. A broadcast can't be paused, so resuming
  // jumps to what's on air now rather than where it stopped.
  togglePause() {
    const s = get();
    if (!s.on || s.phase === 'ending') { get().powerOn(); return; }
    if (!s.paused) {
      clearInterval(fadeTimer);
      clearTimeout(stallTimer);
      audio.pause();
      set({ paused: true });
      return;
    }
    set({ paused: false, buffering: true });
    wakeAudio();
    if (hls) {
      const live = hls.liveSyncPosition;
      if (Number.isFinite(live)) audio.currentTime = live;
      hls.startLoad();
      audio.play().catch(() => onStreamError('resume refused'));
    } else if (s.station) {
      start(s.station, { quiet: true, retry: true });
    }
    audio.volume = level();
  },

  // The next channel up or down the dial on the current band.
  step(dir) {
    const { channels, station, band } = get();
    const list = channels.filter((c) => c.band === (station?.band || band));
    if (!list.length) return;
    const i = list.findIndex((c) => c.id === station?.id);
    const next = list[(i + dir + list.length) % list.length] || list[0];
    get().tune(next);
  },

  toggleSave() {
    const station = get().station;
    if (!station) return;
    const lib = useLibrary.getState();
    const was = lib.isStationSaved(station.id);
    lib.toggleStation(station);
    toast(was ? tr('저장한 주파수에서 뺐어요') : tr('주파수를 저장했어요'));
  },
}));

// Following the room: its channel, or back to music when it clears it.
useRoom.subscribe((r, prev) => {
  if (!r.attached) return;
  const ch = r.radio;
  const was = prev.attached ? prev.radio : null;
  if (ch?.id === was?.id && (r.attached === prev.attached)) return;
  const radio = useRadio.getState();
  if (ch && radio.station?.id !== ch.id) radio.tune({ ...ch }, { fromRoom: true });
  else if (!ch && radio.on) radio.powerOff({ fromRoom: true });
});

export const isRadioOn = () => useRadio.getState().on;
if (import.meta.env.DEV) { window.__tmRadioStore = useRadio; window.__tmRadioAudio = audio; } // for poking at it while testing

// For the media keys, the tray and the phone's notification, which are wired to the music player.
globalThis.__tmRadioControl = {
  active: () => useRadio.getState().on,
  toggle: () => useRadio.getState().togglePause(),
  step: (dir) => useRadio.getState().step(dir),
};

// What the system shows as playing: the channel while the radio is on.
useRadio.subscribe((s, prev) => {
  if (s.station === prev.station && s.on === prev.on) return;
  if (!s.on || !s.station) return;
  const band = s.station.band === 'AM' ? 'kHz' : 'MHz';
  try { api.updateTrayTooltip(`T-Music | ${s.station.name} (${s.station.freq} ${band})`); } catch { /* ignore */ }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: s.station.name,
      artist: `${s.station.band} ${s.station.freq}`,
      album: tr('라디오'),
      artwork: s.station.logo ? [{ src: s.station.logo, sizes: '256x256' }] : [],
    });
  }
});
