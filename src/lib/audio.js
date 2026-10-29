// Web Audio graph for the visualizers and dynamic volume normalization.
// Each <audio> element is routed through one shared analyser and compressor.

let ctx = null;
let analyser = null;
let compressor = null;
const sources = new WeakMap();

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
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;

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
      src.connect(analyser);
      sources.set(el, src);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    // Visualizer is optional; playback works without it.
  }
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
  if (!trackId) return;
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
