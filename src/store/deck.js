// The deck the music plays on, and the sounds it makes. A sound plays only when playback really starts
// and when the queue runs out, never on pause, skip or seek. The start sound dies away and the music
// comes in once it's over; the end sound comes up as the music goes, so the two cross.
import { create } from 'zustand';
import { getAudioContext, setMusicFade } from '../lib/audio.js';
import turntableStart from '../assets/sounds/turntable-start.mp3?inline';
import turntableEnd from '../assets/sounds/turntable-end.mp3?inline';
import cassetteStart from '../assets/sounds/cassette-start.mp3?inline';
import cassetteEnd from '../assets/sounds/cassette-end.mp3?inline';

const STYLE_KEY = 't-music-deck-style';
const SOUNDS_KEY = 't-music-deck-sounds';
const PRELOAD_DELAY_MS = 1500;
const CANCEL_FADE_S = 0.15;

const dB = (value) => 10 ** (value / 20);

// Times are seconds into each file, read from its waveform: `cue` is the needle landing or the play key
// going down, `length` is where the music comes in, `stop` is the needle lifting or the key popping back
// up. The files swing from a hiss near
// -46 dB to clicks at full scale, so each has its own gain and a ceiling that keeps its clicks well under
// the level of music.
export const DECKS = {
  turntable: {
    start: { src: turntableStart, gain: dB(0), ceiling: dB(-18), cue: 1.45, length: 5.11, musicRise: 1, fadeFrom: 3.6 },
    end: { src: turntableEnd, gain: dB(-4), ceiling: dB(-18), lead: 3.5, stop: 4.5, rise: 2 },
  },
  cassette: {
    start: { src: cassetteStart, gain: dB(6), ceiling: dB(-16), cue: 2.3, length: 5.09, musicRise: 1, fadeFrom: 3.6 },
    end: { src: cassetteEnd, gain: dB(6), ceiling: dB(-16), lead: 2.05, stop: 2.1, rise: 1.2 },
  },
};

const read = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* it still applies this session */ }
};

// `at` is when the current sound's file begins, on the same clock as performance.now().
export const useDeck = create((set) => ({
  style: read(STYLE_KEY) === 'cassette' ? 'cassette' : 'turntable',
  sounds: read(SOUNDS_KEY) !== '0',
  phase: 'idle', // idle | starting | ending
  at: 0,

  setStyle(style) {
    write(STYLE_KEY, style);
    set({ style });
  },
  setSounds(sounds) {
    write(SOUNDS_KEY, sounds ? '1' : '0');
    set({ sounds });
  },
}));

const spec = (kind) => DECKS[useDeck.getState().style][kind];

function fromBase64(dataUrl) {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

// Applies the gain and holds peaks at the ceiling. The reduction starts a few milliseconds ahead of each
// click and lets go just after it, so a click comes out softer rather than distorted.
function tame(buffer, gain, ceiling) {
  const BLOCK_MS = 1;
  const LOOK_AHEAD = 4;
  const HOLD = 12;
  const size = Math.max(1, Math.round((buffer.sampleRate * BLOCK_MS) / 1000));
  const blocks = Math.ceil(buffer.length / size);
  const wanted = new Float32Array(blocks).fill(1);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < blocks; b++) {
      let peak = 0;
      const end = Math.min(buffer.length, (b + 1) * size);
      for (let i = b * size; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
      if (peak * gain > ceiling) wanted[b] = Math.min(wanted[b], ceiling / (peak * gain));
    }
  }
  const envelope = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let low = 1;
    for (let k = Math.max(0, b - HOLD); k <= Math.min(blocks - 1, b + LOOK_AHEAD); k++) low = Math.min(low, wanted[k]);
    envelope[b] = low;
  }
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) {
      const position = i / size;
      const b = Math.floor(position);
      const after = envelope[Math.min(blocks - 1, b + 1)];
      data[i] *= gain * (envelope[b] + (after - envelope[b]) * (position - b));
    }
  }
  return buffer;
}

const loaded = new Map();
function load({ src, gain, ceiling }) {
  if (!loaded.has(src)) {
    const decoder = new OfflineAudioContext(2, 1, 44100);
    loaded.set(src, decoder.decodeAudioData(fromBase64(src)).then((buffer) => tame(buffer, gain, ceiling)));
  }
  return loaded.get(src);
}

function preload() {
  const { start, end } = DECKS[useDeck.getState().style];
  for (const sound of [start, end]) load(sound).catch((e) => console.warn('[deck]', e));
}
setTimeout(preload, PRELOAD_DELAY_MS);
useDeck.subscribe((s, prev) => { if (s.style !== prev.style) preload(); });

let current = null;
let token = 0;
let musicTimer = null;
let level = 1;
let output = null;
let started = false;
let committed = false;
let waitingForMusic = false;

// Someone skipped a track by hand, so the deck can press its key.
export const pressDeckKey = (key) => window.dispatchEvent(new CustomEvent('t-music:deck-key', { detail: key }));

export const hasStarted = () => started;
export const setStarted = (value) => { started = value; };
export const isStarting = () => useDeck.getState().phase === 'starting';
export const isEnding = () => useDeck.getState().phase === 'ending';
export const isWaitingForMusic = () => waitingForMusic;
export const isEndCommitted = () => committed;
export const commitEnd = () => { committed = true; };
export const endLead = () => spec('end').lead;
export const startLength = () => spec('start').length;

// The sounds follow the player's volume, so turning the music down turns them down too.
export function setDeckLevel(value) {
  level = value;
  if (output) output.gain.setTargetAtTime(value, output.context.currentTime, 0.02);
}

function connect(ctx, buffer) {
  if (!output || output.context !== ctx) {
    output = ctx.createGain();
    output.gain.value = level;
    output.connect(ctx.destination);
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.connect(gain);
  gain.connect(output);
  current = { source, gain };
  return current;
}

function silence() {
  clearTimeout(musicTimer);
  waitingForMusic = false;
  if (!current) return;
  const { source, gain } = current;
  current = null;
  source.onended = null;
  const now = source.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + CANCEL_FADE_S);
  try { source.stop(now + CANCEL_FADE_S + 0.02); } catch { /* it had not started */ }
}

function finish() {
  current = null;
  committed = false;
  useDeck.setState({ phase: 'idle' });
}

export function cancelSound() {
  token++;
  silence();
  committed = false;
  setMusicFade(1, CANCEL_FADE_S);
  useDeck.setState({ phase: 'idle' });
}

// `onMusic(seconds)` runs when the sound is over and how long the music should take to come up. `after`
// holds the whole thing back, for a room whose music starts at a set moment.
export async function playStartSound(onMusic, after = 0) {
  const sound = spec('start');
  const mine = ++token;
  silence();
  committed = false;
  setMusicFade(0);
  waitingForMusic = true;
  useDeck.setState({ phase: 'starting', at: performance.now() + after * 1000 });
  let buffer = null;
  try { buffer = await load(sound); } catch (e) { console.warn('[deck]', e); }
  if (mine !== token) return;
  const ctx = getAudioContext();
  if (!buffer || !ctx) {
    waitingForMusic = false;
    useDeck.setState({ phase: 'idle' });
    onMusic(0);
    return;
  }
  const when = ctx.currentTime + after;
  const { source, gain } = connect(ctx, buffer);
  gain.gain.setValueAtTime(1, when);
  gain.gain.setValueAtTime(1, when + sound.fadeFrom);
  gain.gain.linearRampToValueAtTime(0, when + buffer.duration - 0.05);
  source.onended = () => { if (mine === token && !waitingForMusic) finish(); else if (mine === token) current = null; };
  source.start(when);
  useDeck.setState({ at: performance.now() + after * 1000 });
  musicTimer = setTimeout(() => {
    waitingForMusic = false;
    if (!current) finish();
    onMusic(sound.musicRise);
  }, (after + sound.length) * 1000);
}

// `left` is how much of the music is still to come; 0 means it already stopped.
export async function playEndSound(left = 0) {
  const sound = spec('end');
  const mine = ++token;
  silence();
  committed = false;
  useDeck.setState({ phase: 'ending', at: performance.now() });
  let buffer = null;
  try { buffer = await load(sound); } catch (e) { console.warn('[deck]', e); }
  if (mine !== token) return;
  const ctx = getAudioContext();
  if (!buffer || !ctx) {
    useDeck.setState({ phase: 'idle' });
    return;
  }
  // Noticed late: join the file where it would be by now, so its click still meets the end of the music.
  const offset = left > 0 ? Math.max(0, sound.lead - left) : 0;
  const { source, gain } = connect(ctx, buffer);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(Math.min(1, offset / sound.rise), now);
  gain.gain.linearRampToValueAtTime(1, now + Math.max(0.01, sound.rise - offset));
  if (left > 0) setMusicFade(0, left);
  source.onended = () => {
    if (mine !== token) return;
    finish();
    setMusicFade(1);
  };
  source.start(now, offset);
  useDeck.setState({ at: performance.now() - offset * 1000 });
}
