// Finds how far lyric timestamps are off from the actual recording. Two things are compared at every
// possible offset. Where a line starts, the voice should come in. And across the whole song, the voice
// should be there during lines and gone during the long gaps between them. The first is sharp but repeats
// with the music, so a bar or a line away can look just as good. The second is blunt but has one right
// answer, because a song's intro and instrumental breaks happen only once. Lyrics are shifted as a whole:
// this fixes constant offsets, not drift.
//
// Weights and limits are measured on 34 songs whose lyrics were moved by known amounts: when `sure`, it
// was right 200 times out of 200, where going by line starts alone was wrong 80 times out of 326.
const SAMPLE_RATE = 8000;
const HOP_SEC = 0.02;
const MAX_OFFSET_SEC = 6;
const AFTER_SEC = 0.4;
const BEFORE_SEC = 0.3;
const MIN_LINES = 6;
const VOICE_LOW_HZ = 300;
const VOICE_HIGH_HZ = 3000;
const SIDE_WEIGHT = 0.4; // voices sit in the middle of a stereo mix; what's only at the sides is the band
const LONGEST_LINE_SEC = 6; // a line longer than this has an instrumental gap in it
const MIN_GAP_SEC = 2.5; // the shortest silence between lines worth comparing
const INTRO_SEC = 8;
const GAP_WEIGHT = 0.3;
const SEPARATE_PEAK_SEC = 0.6; // peaks closer than this are the same answer
const SURE_CONFIDENCE = 3;
const SURE_MARGIN = 0.15; // the winner has to beat the next-best answer by this share of its lead over average
const NEAR_SEC = 1; // lyrics written by someone listening to this song are rarely further off than this
const NEAR_CONFIDENCE = 2;

function logEnergy(samples, hop) {
  const out = new Float32Array(Math.floor(samples.length / hop));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < hop; j++) sum += samples[i * hop + j] ** 2;
    out[i] = Math.log10(sum / hop + 1e-6);
  }
  return out;
}

// Loudness over time of what's most likely the voice: the middle of the stereo mix, in the voice's range.
export async function voiceEnvelope(encoded) {
  const decoded = await new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE).decodeAudioData(encoded);
  const left = decoded.getChannelData(0);
  const right = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left;
  const render = new OfflineAudioContext(2, decoded.length, SAMPLE_RATE);
  const split = render.createBuffer(2, decoded.length, SAMPLE_RATE);
  const mid = split.getChannelData(0);
  const side = split.getChannelData(1);
  for (let i = 0; i < decoded.length; i++) {
    mid[i] = (left[i] + right[i]) / 2;
    side[i] = (left[i] - right[i]) / 2;
  }
  const source = render.createBufferSource();
  source.buffer = split;
  const low = render.createBiquadFilter();
  low.type = 'highpass';
  low.frequency.value = VOICE_LOW_HZ;
  const high = render.createBiquadFilter();
  high.type = 'lowpass';
  high.frequency.value = VOICE_HIGH_HZ;
  source.connect(low).connect(high).connect(render.destination);
  source.start();
  const rendered = await render.startRendering();
  const hop = Math.round(HOP_SEC * SAMPLE_RATE);
  const midEnergy = logEnergy(rendered.getChannelData(0), hop);
  const sideEnergy = logEnergy(rendered.getChannelData(1), hop);
  const mono = left === right;
  const envelope = new Float32Array(midEnergy.length);
  for (let i = 0; i < envelope.length; i++) envelope[i] = midEnergy[i] - (mono ? 0 : SIDE_WEIGHT * sideEnergy[i]);
  return envelope;
}

const summary = (values) => {
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / (values.length || 1);
  let spread = 0;
  for (const v of values) spread += (v - mean) ** 2;
  return { mean, deviation: Math.sqrt(spread / (values.length || 1)) || 1 };
};

function standardized(values) {
  const { mean, deviation } = summary(values);
  return Float64Array.from(values, (v) => (v - mean) / deviation);
}

// Each span is [fromSec, toSec] on the lyrics' own clock.
function vocalSpans(times) {
  const during = [];
  const between = [];
  if (times[0] > 1) between.push([Math.max(0, times[0] - INTRO_SEC), times[0] - 0.3]);
  for (let i = 0; i < times.length; i++) {
    const next = i + 1 < times.length ? times[i + 1] : times[i] + 4;
    const line = Math.min(next - times[i], LONGEST_LINE_SEC);
    during.push([times[i] + 0.1, times[i] + Math.max(0.3, line - 0.2)]);
    if (next - times[i] > LONGEST_LINE_SEC + MIN_GAP_SEC) between.push([times[i] + LONGEST_LINE_SEC, next - 0.5]);
  }
  return { during, between };
}

export function bestOffset(rawEnvelope, lineTimes) {
  const times = lineTimes.filter((t) => t > 0);
  if (times.length < MIN_LINES) return null;
  const envelope = standardized(rawEnvelope);
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
  const { during, between } = vocalSpans(times);
  const toHops = (list) => list.map(([a, b]) => [Math.round(a / HOP_SEC), Math.round(b / HOP_SEC)]);
  const duringHops = toHops(during);
  const betweenHops = toHops(between);
  const average = (list, shift) => {
    let total = 0;
    let count = 0;
    for (const [a, b] of list) {
      const from = clamp(a + shift);
      const to = clamp(b + shift);
      if (to > from) { total += prefix[to] - prefix[from]; count += to - from; }
    }
    return count ? total / count : 0;
  };

  const rises = new Float64Array(span * 2 + 1);
  const gaps = new Float64Array(span * 2 + 1);
  for (let s = -span; s <= span; s++) {
    let rise = 0;
    for (const time of times) {
      const at = Math.round(time / HOP_SEC) + s;
      rise += mean(at, at + after) - mean(at - before, at);
    }
    rises[s + span] = rise / times.length;
    gaps[s + span] = average(duringHops, s) - average(betweenHops, s);
  }
  const risesZ = standardized(rises);
  const gapsZ = standardized(gaps);
  const scores = risesZ.map((r, i) => r + GAP_WEIGHT * gapsZ[i]);

  let peak = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[peak]) peak = i;
  const { mean: avg, deviation } = summary(scores);
  const apart = Math.round(SEPARATE_PEAK_SEC / HOP_SEC);
  let second = -Infinity;
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - peak) > apart && scores[i] > second) second = scores[i];
  const confidence = (scores[peak] - avg) / deviation;
  const margin = (scores[peak] - second) / Math.max(1e-6, scores[peak] - avg);
  const sure = confidence >= SURE_CONFIDENCE && margin >= SURE_MARGIN;

  // Not sure which of several places it is. A small correction can't land on the wrong line, so that much
  // can still be done; anything bigger is left alone rather than guessed.
  const nearSpan = Math.round(NEAR_SEC / HOP_SEC);
  let near = span;
  for (let i = span - nearSpan; i <= span + nearSpan; i++) if (rises[i] > rises[near]) near = i;
  const nearUsable = !sure && (risesZ[near] - summary(risesZ).mean) >= NEAR_CONFIDENCE;

  return { offset: ((sure ? peak : near) - span) * HOP_SEC, confidence, margin, sure, near: nearUsable };
}

// Returns { offset, confidence, sure, near } in seconds, or null if there are too few lines to judge.
export async function measureLyricOffset(audioUrl, lines) {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`audio ${res.status}`);
  const envelope = await voiceEnvelope(await res.arrayBuffer());
  return bestOffset(envelope, lines.filter((l) => l.text).map((l) => l.time));
}
