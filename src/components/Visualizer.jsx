import { useEffect, useRef } from 'react';
import { getAnalyser } from '../lib/audio.js';
import { usePlayer } from '../store/player.js';

// Spectrum drawn on canvas. `variant`: "bars" (horizontal strip) or "ring" (around a disc).
// When paused or before audio starts it idles with a gentle synthetic wave.
export default function Visualizer({ variant = 'bars', bars = 48, className = '' }) {
  const ref = useRef(null);
  const playing = usePlayer((s) => s.playing);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas.getContext('2d');
    let raf = 0;
    let data = null;
    const levels = new Float32Array(bars);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = (t) => {
      raf = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      g.clearRect(0, 0, W, H);
      const an = getAnalyser();
      let live = false;
      if (an && playingRef.current) {
        data ??= new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        live = data.some((v) => v > 0);
      }
      for (let i = 0; i < bars; i++) {
        let target;
        if (live) {
          // Log-ish mapping so bass doesn't hog every bar.
          const idx = Math.min(data.length - 1, Math.floor(Math.pow(i / bars, 1.6) * data.length * 0.75));
          target = data[idx] / 255;
        } else {
          const amp = playingRef.current ? 0.35 : 0.12;
          target = amp * (0.5 + 0.5 * Math.sin(t / 380 + i * 0.45)) * (0.6 + 0.4 * Math.sin(t / 900 + i));
        }
        levels[i] += (target - levels[i]) * 0.25;
      }

      const grad = g.createLinearGradient(0, H, W, 0);
      grad.addColorStop(0, '#6d28d9');
      grad.addColorStop(0.5, '#a78bfa');
      grad.addColorStop(1, '#f0abfc');
      g.fillStyle = grad;

      if (variant === 'ring') {
        const cx = W / 2;
        const cy = H / 2;
        const inner = Math.min(W, H) * 0.36;
        const span = Math.min(W, H) * 0.13;
        const bw = (2 * Math.PI * inner) / bars * 0.55;
        for (let i = 0; i < bars; i++) {
          const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const len = 4 + levels[i] * span;
          g.save();
          g.translate(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
          g.rotate(a + Math.PI / 2);
          g.beginPath();
          g.roundRect(-bw / 2, -len, bw, len, bw / 2);
          g.fill();
          g.restore();
        }
      } else {
        const gap = W / bars;
        const bw = gap * 0.58;
        for (let i = 0; i < bars; i++) {
          const h = Math.max(H * 0.06, levels[i] * H);
          g.beginPath();
          g.roundRect(i * gap + (gap - bw) / 2, (H - h) / 2, bw, h, bw / 2);
          g.fill();
        }
      }
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [variant, bars]);

  return <canvas ref={ref} className={`viz viz-${variant} ${className}`} />;
}
