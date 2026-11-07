// Web Audio graph for the visualizers and dynamic volume normalization.
// Each <audio> element is routed through one shared fade, analyser and compressor.
import { IS_ANDROID } from './platform.js';

let ctx = null;
let analyser = null;
let compressor = null;
let musicFade = null;
let fadeTarget = 1;
let fadeEndsAt = 0;
let idleTimer = null;
const IDLE_SLEEP_MS = 4000;
const sources = new WeakMap();
const FADE_CURVE_POINTS = 48;

// Five bands, in Hz: low shelf, three peaks, high shelf.
export const EQ_BANDS = [60, 250, 1000, 4000, 12000];
const EQ_SMOOTH_S = 0.05;
let eqPreamp = null;
let eqFilters = [];
let eqGains = [0, 0, 0, 0, 0];

function applyEqualizer() {
  if (!ctx || !eqFilters.length) return;
  const now = ctx.currentTime;
  eqFilters.forEach((f, i) => f.gain.setTargetAtTime(eqGains[i] || 0, now, EQ_SMOOTH_S));
  // Boosting a band can push loud music past full scale and crackle; the louder the boost, the more
  // the whole signal is lowered first.
  const boost = Math.max(0, ...eqGains);
  eqPreamp.gain.setTargetAtTime(10 ** (-boost * 0.6 / 20), now, EQ_SMOOTH_S);
}

// gains: dB per band (-12 to 12), or null for flat.
export function setEqualizer(gains) {
  eqGains = EQ_BANDS.map((_, i) => Math.max(-12, Math.min(12, Number(gains?.[i]) || 0)));
  applyEqualizer();
}

let normalizeEnabled = (() => {
  try {
    return localStorage.getItem('t-music-normalize') === '1';
  } catch {
    return false;
  }
})();

let currentSinkId = (() => {
  try {
    return localStorage.getItem('t-music-sink-id') || '';
  } catch {
    return '';
  }
})();

function setupGraph() {
  if (ctx) return;
  try {
    // Phones can send low-latency audio past their own sound processing, which leaves music thin and dull.
    // Nothing here needs low latency, and the lyrics already allow for however late the sound is.
    ctx = new AudioContext(IS_ANDROID ? { latencyHint: 'playback' } : undefined);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;

    // Ahead of the analyser, so everything that reacts to the music follows the fades too.
    musicFade = ctx.createGain();

    // The equalizer sits between the fade and the analyser, so the visualizer shows what's heard.
    // A flat band does nothing, so it's always connected and "off" is simply every band at 0 dB.
    eqPreamp = ctx.createGain();
    eqFilters = EQ_BANDS.map((band, i) => {
      const f = ctx.createBiquadFilter();
      f.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      f.frequency.value = band;
      f.Q.value = 1;
      f.gain.value = 0;
      return f;
    });
    musicFade.connect(eqPreamp);
    eqFilters.reduce((prev, f) => { prev.connect(f); return f; }, eqPreamp).connect(analyser);
    applyEqualizer();

    compressor = ctx.createDynamicsCompressor();
    // Broadcasting standard multiband-style dynamic loudness leveling:
    compressor.threshold.setValueAtTime(-22, ctx.currentTime);
    compressor.knee.setValueAtTime(30, ctx.currentTime);
    compressor.ratio.setValueAtTime(12, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    reconnectDestination();

    if (currentSinkId && typeof ctx.setSinkId === 'function') {
      ctx.setSinkId(currentSinkId).catch(() => {});
    }
  } catch {
    // AudioContext creation failure fallback
  }
}

function reconnectDestination() {
  if (!ctx || !analyser || !compressor) return;
  try {
    analyser.disconnect();
    compressor.disconnect();

    if (normalizeEnabled) {
      analyser.connect(compressor);
      compressor.connect(ctx.destination);
    } else {
      analyser.connect(ctx.destination);
    }
  } catch {}
}

export function attach(el) {
  try {
    setupGraph();
    if (!ctx) return;
    if (!sources.has(el)) {
      const src = ctx.createMediaElementSource(el);
      src.connect(musicFade);
      sources.set(el, src);
    }
    wakeAudio();
  } catch {
    // Visualizer is optional; playback works without it.
  }
}

export function getAudioContext() {
  setupGraph();
  wakeAudio();
  return ctx;
}

// A running audio graph keeps the sound hardware on and the phone from sleeping, music or not.
export function wakeAudio() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
}

export function sleepAudioSoon(stillIdle) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    const idle = stillIdle();
    if (idle === null) sleepAudioSoon(stillIdle); // a sound is still finishing: look again
    else if (idle && ctx?.state === 'running') ctx.suspend().catch(() => {});
  }, IDLE_SLEEP_MS);
}

// Music that should be heard but can't be: the system stopped the graph (a call, the app coming back
// from the background), or a fade was lost along with the timer that was going to finish it.
export function healSound() {
  if (!ctx) return;
  wakeAudio();
  if (musicFade && fadeTarget === 1 && ctx.currentTime >= fadeEndsAt && musicFade.gain.value < 0.99) setMusicFade(1);
}

export function isSoundBlocked() {
  return Boolean(ctx && ctx.state !== 'running');
}

// Fades the music on the audio clock, so it stays smooth with the window hidden or the phone locked.
// Both directions spend longest at the quiet end, which is how a fade should sound.
export function setMusicFade(to, seconds = 0) {
  setupGraph();
  if (!ctx || !musicFade) return;
  const gain = musicFade.gain;
  const now = ctx.currentTime;
  const from = gain.value;
  fadeTarget = to;
  fadeEndsAt = now + Math.max(0, seconds);
  gain.cancelScheduledValues(now);
  if (seconds <= 0 || Math.abs(from - to) < 0.001) {
    gain.setValueAtTime(to, now);
    return;
  }
  const curve = new Float32Array(FADE_CURVE_POINTS);
  for (let i = 0; i < FADE_CURVE_POINTS; i++) {
    const t = i / (FADE_CURVE_POINTS - 1);
    curve[i] = to > from ? from + (to - from) * t * t : to + (from - to) * (1 - t) * (1 - t);
  }
  gain.setValueCurveAtTime(curve, now, seconds);
}

// How long sound takes from here to the speakers. Bluetooth makes this large enough to hear.
export function getOutputLatency() {
  return ctx ? (ctx.outputLatency || 0) + (ctx.baseLatency || 0) : 0;
}

export function getAnalyser() {
  return analyser;
}

export function setNormalize(enabled) {
  normalizeEnabled = Boolean(enabled);
  try {
    localStorage.setItem('t-music-normalize', normalizeEnabled ? '1' : '0');
  } catch {}
  reconnectDestination();
  return normalizeEnabled;
}

export function isNormalizeEnabled() {
  return normalizeEnabled;
}

export async function setAudioSinkId(deviceId) {
  currentSinkId = deviceId || '';
  try {
    localStorage.setItem('t-music-sink-id', currentSinkId);
  } catch {}

  if (ctx && typeof ctx.setSinkId === 'function') {
    try {
      await ctx.setSinkId(currentSinkId);
    } catch (e) {
      console.warn('ctx.setSinkId failed:', e);
    }
  }
  return currentSinkId;
}

export function getAudioSinkId() {
  return currentSinkId;
}

// Automatic audio onset and silence detector for zero-configuration lyrics sync
let onsetTrackId = null;
let currentOnsetSec = 0;
let onsetCheckTimer = null;

export function getAudioOnset(trackId) {
  return onsetTrackId === trackId ? currentOnsetSec : 0;
}

export function startAudioOnsetDetection(audioEl, trackId) {
  if (!trackId || onsetTrackId === trackId) return; // once per track; pause/resume must not reset it
  onsetTrackId = trackId;
  currentOnsetSec = 0;
  clearInterval(onsetCheckTimer);

  if (!analyser || !audioEl) return;
  if (audioEl.currentTime > 2.0) return;

  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let checks = 0;

  onsetCheckTimer = setInterval(() => {
    checks++;
    if (checks > 150 || audioEl.paused || audioEl.currentTime > 7.0) {
      clearInterval(onsetCheckTimer);
      return;
    }

    analyser.getByteFrequencyData(buffer);
    let sum = 0;
    for (let i = 2; i < 90; i++) {
      sum += buffer[i];
    }
    const avg = sum / 88;

    if (avg >= 16) {
      if (currentOnsetSec === 0 && audioEl.currentTime >= 0.45) {
        currentOnsetSec = Math.round(audioEl.currentTime * 10) / 10;
        window.dispatchEvent(new CustomEvent('audio-onset-detected', {
          detail: { trackId, onset: currentOnsetSec }
        }));
      }
      clearInterval(onsetCheckTimer);
    }
  }, 40);
}
