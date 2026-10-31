// The stage's record player. Platter speed, tonearm travel and the glow all run from one animation
// loop: the platter eases up and down like a real motor, the arm tracks inward with song progress,
// and the light under the platter breathes with the bass.
import { useEffect, useRef } from 'react';
import { usePlayer } from '../../store/player.js';
import { getAnalyser } from '../../lib/audio.js';
import { Thumb } from '../common.jsx';
import Visualizer from '../Visualizer.jsx';
import { useTilt } from '../../lib/motion.js';
import logo from '../../assets/logo-mark.png';

const DEGREES_PER_SECOND = 120; // one turn every 3 seconds
const ARM_REST = -7;
const ARM_OUTER_GROOVE = 12;
const ARM_INNER_GROOVE = 32;
const BASS_BINS = 6;

function useDeckMotion({ platter, arm, glow }) {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let angle = 0;
    let speed = 0;
    let armAngle = ARM_REST;
    let bass = 0;
    let bins = null;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const p = usePlayer.getState();

      speed += ((p.playing ? 1 : 0) - speed) * Math.min(1, dt * (p.playing ? 2.4 : 1.1));
      angle = (angle + speed * DEGREES_PER_SECOND * dt) % 360;
      platter.current.style.transform = `rotate(${angle}deg)`;

      const duration = p.duration || p.queue[p.index]?.duration || 0;
      const progress = duration > 0 ? Math.min(1, p.getPreciseTime() / duration) : 0;
      const armTarget = p.playing ? ARM_OUTER_GROOVE + (ARM_INNER_GROOVE - ARM_OUTER_GROOVE) * progress : ARM_REST;
      armAngle += (armTarget - armAngle) * Math.min(1, dt * 3);
      arm.current.setAttribute('transform', `rotate(${armAngle.toFixed(2)} 88 14)`);

      let level = 0;
      const analyser = getAnalyser();
      if (analyser && p.playing) {
        bins ??= new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(bins);
        for (let i = 0; i < BASS_BINS; i++) level += bins[i] / 255 / BASS_BINS;
      }
      bass += (level - bass) * Math.min(1, dt * (level > bass ? 18 : 5));
      glow.current.style.opacity = (0.3 + bass * 0.7).toFixed(3);
      glow.current.style.transform = `scale(${(1 + bass * 0.09).toFixed(3)})`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [platter, arm, glow]);
}

export default function Turntable({ track, playing }) {
  const tilt = useRef(null);
  const platter = useRef(null);
  const arm = useRef(null);
  const glow = useRef(null);

  useTilt(tilt, { max: 8, scale: 1 });
  useDeckMotion({ platter, arm, glow });

  return (
    <div className="stage-disc-wrap" ref={tilt}>
      <div className="tt-deck">
        <img className="tt-logo" src={logo} alt="" draggable={false} />
        <Visualizer variant="ring" bars={96} innerRatio={0.405} spanRatio={0.07} className="tt-ring" />
        <div className="tt-glow" ref={glow} />

        <div className="tt-platter">
          <div className="tt-spin" ref={platter}>
            <div className="tt-strobe" />
            <div className="tt-vinyl">
              <div className="tt-label"><Thumb src={track.thumb} /></div>
            </div>
          </div>
          <div className="tt-sheen" />
          <div className="tt-spindle" />
        </div>

        <svg className="tt-arm" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="tt-arm-metal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#f5f1ff" />
              <stop offset="1" stopColor="#9d8cd0" />
            </linearGradient>
            <radialGradient id="tt-arm-base" cx="0.38" cy="0.32" r="0.8">
              <stop offset="0" stopColor="#efe9ff" />
              <stop offset="0.55" stopColor="#8b78c4" />
              <stop offset="1" stopColor="#3b2d63" />
            </radialGradient>
          </defs>
          <circle className="tt-arm-plate" cx="88" cy="14" r="7" />
          <g ref={arm} className="tt-arm-swing" transform={`rotate(${ARM_REST} 88 14)`}>
            <rect className="tt-arm-weight" x="85.6" y="3.4" width="4.8" height="6.4" rx="1.3" />
            <path className="tt-arm-tube" d="M88 14 C88 24 85 28 85.8 36 S88.8 50 88 57.5" />
            <g transform="rotate(16 88 58)">
              <rect className="tt-arm-head" x="86.3" y="56.6" width="3.4" height="6.6" rx="0.9" />
              <rect className="tt-arm-finger" x="90" y="57.6" width="2" height="0.7" rx="0.35" />
            </g>
          </g>
          <circle cx="88" cy="14" r="4.2" fill="url(#tt-arm-base)" />
          <circle className="tt-arm-cap" cx="88" cy="14" r="1.3" />
        </svg>

        <div className="tt-knob" />
        <div className={`tt-led ${playing ? 'on' : ''}`}><i />33⅓</div>
      </div>
    </div>
  );
}
