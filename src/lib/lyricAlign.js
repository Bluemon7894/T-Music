// Finds how far lyric timestamps are off from the actual recording. A sung line usually starts where
// the sound in the voice's frequency range rises, so the right offset is the one that puts the most
// line starts on such rises. Lyrics are shifted as a whole: this fixes constant offsets, not drift.
const SAMPLE_RATE = 8000;
const HOP_SEC = 0.02;
const MAX_OFFSET_SEC = 6;
const AFTER_SEC = 0.4;
const BEFORE_SEC = 0.3;
const MIN_LINES = 6;
const VOICE_LOW_HZ = 300;
const VOICE_HIGH_HZ = 3000;
const NEAR_PEAK_RATIO = 0.92;
const NEAR_WINDOW_SEC = 1.5;
const NEAR_WINDOW_RATIO = 0.7; // measured: higher values move well-timed lyrics by a bar or more

export const MIN_CONFIDENCE = 2;

// Loudness over time in the frequency range of the voice.
async function voiceEnvelope(encoded) {
  const decoder = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  const decoded = await decoder.decodeAudioData(encoded);
  const render = new OfflineAudioContext(1, decoded.length, SAMPLE_RATE);
  const source = render.createBufferSource();
  source.buffer = decoded;
  const low = render.createBiquadFilter();
  low.type = 'highpass';
  low.frequency.value = VOICE_LOW_HZ;
  const high = render.createBiquadFilter();
  high.type = 'lowpass';
  high.frequency.value = VOICE_HIGH_HZ;
  source.connect(low).connect(high).connect(render.destination);
  source.start();
  const samples = (await render.startRendering()).getChannelData(0);
  const hop = Math.round(HOP_SEC * SAMPLE_RATE);
  const envelope = new Float32Array(Math.floor(samples.length / hop));
  for (let i = 0; i < envelope.length; i++) {
    let sum = 0;
    for (let j = 0; j < hop; j++) sum += samples[i * hop + j] ** 2;
    envelope[i] = Math.log10(sum / hop + 1e-6);
  }
  return envelope;
}

export function bestOffset(envelope, lineTimes) {
  const times = lineTimes.filter((t) => t > 0);
  if (times.length < MIN_LINES) return null;
  const prefix = new Float64Array(envelope.length + 1);
  for (let i = 0; i < envelope.length; i++) prefix[i + 1] = prefix[i] + envelope[i];
  const clamp = (i) => Math.max(0, Math.min(envelope.length, i));
  const mean = (a, b) => {
    const from = clamp(a);
    const to = clamp(b);
    return to > from ? (prefix[to] - prefix[from]) / (to - from) : 0;
  };
  const after = Math.round(AFTER_SEC / HOP_SEC);
  const before = Math.round(BEFORE_SEC / HOP_SEC);
  const span = Math.round(MAX_OFFSET_SEC / HOP_SEC);
  const scores = new Float64Array(span * 2 + 1);
  for (let s = -span; s <= span; s++) {
    let score = 0;
    for (const time of times) {
      const at = Math.round(time / HOP_SEC) + s;
      score += mean(at, at + after) - mean(at - before, at);
    }
    scores[s + span] = score / times.length;
  }
  let peak = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[peak]) peak = i;
  const avg = scores.reduce((n, v) => n + v, 0) / scores.length;
  const deviation = Math.sqrt(scores.reduce((n, v) => n + (v - avg) ** 2, 0) / scores.length) || 1;
  // Music repeats, so a bar or two away can score well too. Timestamps were written by someone
  // listening to this song, so they're rarely far off: a small correction wins unless a big one is
  // clearly better, and among close calls the smallest wins.
  const nearSpan = Math.round(NEAR_WINDOW_SEC / HOP_SEC);
  let nearPeak = span;
  for (let i = span - nearSpan; i <= span + nearSpan; i++) if (scores[i] > scores[nearPeak]) nearPeak = i;
  const top = scores[nearPeak] - avg >= (scores[peak] - avg) * NEAR_WINDOW_RATIO ? nearPeak : peak;
  let chosen = top;
  for (let i = 0; i < scores.length; i++) {
    if (Math.abs(i - span) < Math.abs(chosen - span) && scores[i] - avg >= (scores[top] - avg) * NEAR_PEAK_RATIO) chosen = i;
  }
  return { offset: (chosen - span) * HOP_SEC, confidence: (scores[chosen] - avg) / deviation };
}

// Returns { offset, confidence } in seconds, or null if there are too few lines to judge.
export async function measureLyricOffset(audioUrl, lines) {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`audio ${res.status}`);
  const envelope = await voiceEnvelope(await res.arrayBuffer());
  return bestOffset(envelope, lines.filter((l) => l.text).map((l) => l.time));
}
