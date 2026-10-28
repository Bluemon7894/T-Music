// Web Audio graph for the visualizers. Each <audio> element is routed through
// one shared analyser; the stream protocol sends CORS headers so the samples
// aren't blanked out.
let ctx = null;
let analyser = null;
const sources = new WeakMap();

export function attach(el) {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(ctx.destination);
    }
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
