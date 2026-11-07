// The stage's radio: an old tabletop valve set in the app's violet, drawn in SVG to fill the same square
// the turntable and the cassette deck use. Lacquered cabinet with a handle, a wide glass dial lit from
// behind with FM and AM scales and a pink pointer, a cloth speaker with bars, a "magic eye" that closes
// up when the station is tuned, piano keys for the band and two knobs.
// The pointer, the tuning knob and the eye follow the radio's `tune` (see store/radio.js): turning on,
// the dial warms up and the pointer sweeps in time with the start sound, landing on the channel as the
// broadcast comes in; turning off, the light fades and the pointer drifts back with the end sound.
import { useRef } from 'react';
import { useRadio } from '../../store/radio.js';
import { usePlayer } from '../../store/player.js';
import { useTilt } from '../../lib/motion.js';
import { BANDS, useNeedle } from '../RadioDial.jsx';

// The glass, in the drawing's units.
const GLASS = { x: 11, y: 21, w: 78, h: 23 };
const SCALE_X0 = GLASS.x + 5;
const SCALE_X1 = GLASS.x + GLASS.w - 5;
const FM_Y = GLASS.y + 8.5;
const AM_Y = GLASS.y + 17;
const FM_LABELS = [88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108];
const AM_LABELS = [60, 70, 80, 90, 100, 120, 140, 160]; // ×10 kHz, printed the way old dials do
const SPEAKER = { x: 11, y: 48, w: 46, h: 38 };
const GRILLE_BARS = [54, 61, 68, 75, 82];
const EYE = { cx: 66, cy: 54 };
const KNOB_TURN = 300;

const xOf = (band, f) => SCALE_X0 + ((f - band.min) / (band.max - band.min)) * (SCALE_X1 - SCALE_X0);
const arcPoint = (r, deg) => [EYE.cx + r * Math.sin((deg * Math.PI) / 180), EYE.cy - r * Math.cos((deg * Math.PI) / 180)];

function Knob({ cx, cy, r, turn, label }) {
  return (
    <g>
      <circle cx={cx} cy={cy + 0.7} r={r + 0.4} fill="rgba(8,4,20,0.55)" />
      <g transform={`rotate(${turn} ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="url(#rd-metal)" stroke="#1a1030" strokeWidth="0.3" />
        {Array.from({ length: 24 }, (_, i) => (
          <line key={i} x1={cx} y1={cy - r} x2={cx} y2={cy - r + 0.9} stroke="rgba(30,18,60,0.5)" strokeWidth="0.35" transform={`rotate(${i * 15} ${cx} ${cy})`} />
        ))}
        <circle cx={cx} cy={cy} r={r * 0.66} fill="url(#rd-metal-cap)" />
        <rect x={cx - 0.45} y={cy - r * 0.62} width="0.9" height={r * 0.42} rx="0.3" fill="#2e1065" />
      </g>
      <text x={cx} y={cy + r + 3.6} className="rd-label" textAnchor="middle">{label}</text>
    </g>
  );
}

export default function RadioDevice() {
  const tilt = useRef(null);
  const station = useRadio((s) => s.station);
  const phase = useRadio((s) => s.phase);
  const buffering = useRadio((s) => s.buffering);
  const volume = usePlayer((s) => (s.muted ? 0 : s.volume));
  const bandId = station?.band || useRadio.getState().band;
  const { pos } = useNeedle(bandId);
  useTilt(tilt, { max: 8, scale: 1 });

  const lit = phase !== 'off';
  const live = phase === 'on' && !buffering;
  const fm = BANDS.FM;
  const am = BANDS.AM;
  const pointerX = SCALE_X0 + pos * (SCALE_X1 - SCALE_X0);
  // The eye's dark wedge: wide while searching, nearly shut once the station is in.
  const open = live ? 14 : lit ? 70 : 110;
  const [ax, ay] = arcPoint(3.4, -open / 2);
  const [bx, by] = arcPoint(3.4, open / 2);

  return (
    <div className="stage-disc-wrap" ref={tilt}>
      <div className={`tt-deck rd-deck ${lit ? 'lit' : ''} ${live ? 'live' : ''}`} data-phase={phase}>
        <svg className="rd-set" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id="rd-body" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#6d4bb8" />
              <stop offset="0.45" stopColor="#3f2780" />
              <stop offset="1" stopColor="#1f1242" />
            </linearGradient>
            <linearGradient id="rd-sheen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(255,255,255,0.22)" />
              <stop offset="0.18" stopColor="rgba(255,255,255,0.04)" />
              <stop offset="1" stopColor="rgba(0,0,0,0.25)" />
            </linearGradient>
            <pattern id="rd-cloth" width="1" height="1" patternUnits="userSpaceOnUse">
              <rect width="1" height="1" fill="#1d1238" />
              <path d="M0 0.5 H1 M0.5 0 V1" stroke="rgba(196,181,253,0.2)" strokeWidth="0.3" />
            </pattern>
            <linearGradient id="rd-trim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f5f3ff" />
              <stop offset="0.5" stopColor="#b9a8ec" />
              <stop offset="1" stopColor="#6d5aa8" />
            </linearGradient>
            <radialGradient id="rd-metal" cx="0.35" cy="0.3" r="0.9">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.45" stopColor="#d6cdf2" />
              <stop offset="1" stopColor="#6a5c96" />
            </radialGradient>
            <radialGradient id="rd-metal-cap" cx="0.4" cy="0.35" r="0.8">
              <stop offset="0" stopColor="#f5f3ff" />
              <stop offset="1" stopColor="#a497cc" />
            </radialGradient>
            <linearGradient id="rd-glass-off" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1a1030" />
              <stop offset="1" stopColor="#0d0820" />
            </linearGradient>
            <radialGradient id="rd-glass-on" cx="0.5" cy="0.6" r="0.8">
              <stop offset="0" stopColor="#fdf4ff" />
              <stop offset="0.5" stopColor="#ddd6fe" />
              <stop offset="1" stopColor="#a78bfa" />
            </radialGradient>
            <radialGradient id="rd-eye" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#2e1065" />
              <stop offset="0.35" stopColor="#f0abfc" />
              <stop offset="1" stopColor="#a21caf" />
            </radialGradient>
            <radialGradient id="rd-lamp" cx="0.5" cy="0.45" r="0.6">
              <stop offset="0" stopColor="#fdf4ff" />
              <stop offset="0.5" stopColor="#e879f9" />
              <stop offset="1" stopColor="#701a75" />
            </radialGradient>
            <filter id="rd-soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2" /></filter>
            <clipPath id="rd-glass-clip"><rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} rx="2.4" /></clipPath>
          </defs>

          {/* handle */}
          <path d="M28 14 C28 3 72 3 72 14" fill="none" stroke="#140a2c" strokeWidth="3.6" strokeLinecap="round" />
          <path d="M28 14 C28 3 72 3 72 14" fill="none" stroke="#4c1d95" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M31 12.6 C32 5.4 68 5.4 69 12.6" fill="none" stroke="rgba(221,214,254,0.28)" strokeWidth="0.45" strokeDasharray="1.2 1" />
          <rect x="25" y="11.5" width="6" height="4" rx="1" fill="url(#rd-trim)" />
          <rect x="69" y="11.5" width="6" height="4" rx="1" fill="url(#rd-trim)" />

          {/* cabinet */}
          <rect x="3" y="14" width="94" height="81" rx="8" fill="url(#rd-body)" />
          <rect x="3" y="14" width="94" height="81" rx="8" fill="url(#rd-sheen)" />
          <rect x="3.6" y="14.6" width="92.8" height="79.8" rx="7.5" fill="none" stroke="rgba(221,214,254,0.3)" strokeWidth="0.5" />
          <rect x="7" y="18" width="86" height="73" rx="5" fill="#120a26" opacity="0.5" />
          <rect x="7.4" y="18.4" width="85.2" height="72.2" rx="4.7" fill="none" stroke="url(#rd-trim)" strokeWidth="0.55" />

          {/* dial glass */}
          <rect x={GLASS.x - 0.8} y={GLASS.y - 0.8} width={GLASS.w + 1.6} height={GLASS.h + 1.6} rx="3" fill="url(#rd-trim)" />
          <rect x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} rx="2.4" fill="url(#rd-glass-off)" />
          <rect className="rd-backlight" x={GLASS.x} y={GLASS.y} width={GLASS.w} height={GLASS.h} rx="2.4" fill="url(#rd-glass-on)" />
          <g clipPath="url(#rd-glass-clip)">
            <text x={GLASS.x + 2.4} y={FM_Y - 3.2} className={`rd-band-name ${bandId === 'FM' ? 'on' : ''}`}>FM  MHz</text>
            <line x1={SCALE_X0} y1={FM_Y} x2={SCALE_X1} y2={FM_Y} className="rd-rule" />
            {Array.from({ length: 41 }, (_, i) => 88 + i * 0.5).map((f) => (
              <line key={f} x1={xOf(fm, f)} y1={FM_Y} x2={xOf(fm, f)} y2={FM_Y + (f % 2 === 0 ? 1.8 : f % 1 === 0 ? 1.1 : 0.6)} className="rd-rule" />
            ))}
            {FM_LABELS.map((f) => <text key={f} x={xOf(fm, f)} y={FM_Y + 4.4} className="rd-num" textAnchor="middle">{f}</text>)}
            <text x={GLASS.x + 2.4} y={AM_Y - 1.6} className={`rd-band-name ${bandId === 'AM' ? 'on' : ''}`}>AM  ×10kHz</text>
            <line x1={SCALE_X0} y1={AM_Y} x2={SCALE_X1} y2={AM_Y} className="rd-rule" />
            {Array.from({ length: 22 }, (_, i) => 550 + i * 50).filter((f) => f <= am.max).map((f) => (
              <line key={f} x1={xOf(am, f)} y1={AM_Y} x2={xOf(am, f)} y2={AM_Y + (f % 100 === 0 ? 1.4 : 0.7)} className="rd-rule" />
            ))}
            {AM_LABELS.map((f) => <text key={f} x={xOf(am, f * 10)} y={AM_Y + 4.2} className="rd-num" textAnchor="middle">{f}</text>)}
            <g style={{ transform: `translateX(${pointerX}px)` }}>
              <rect x="-1.4" y={GLASS.y + 1} width="2.8" height={GLASS.h - 2} fill="#f0abfc" opacity="0.3" filter="url(#rd-soft)" className="rd-pointer-glow" />
              <rect x="-0.35" y={GLASS.y + 1} width="0.7" height={GLASS.h - 2} rx="0.3" className="rd-pointer" />
            </g>
          </g>
          <path d={`M${GLASS.x + 1} ${GLASS.y + 1} H${GLASS.x + 30} L${GLASS.x + 18} ${GLASS.y + GLASS.h - 1} H${GLASS.x + 1} Z`} fill="rgba(255,255,255,0.07)" />

          {/* speaker */}
          <rect x={SPEAKER.x} y={SPEAKER.y} width={SPEAKER.w} height={SPEAKER.h} rx="4" fill="url(#rd-cloth)" />
          <rect x={SPEAKER.x} y={SPEAKER.y} width={SPEAKER.w} height={SPEAKER.h} rx="4" className="rd-cloth-glow" fill="#c4b5fd" />
          {GRILLE_BARS.map((y) => <rect key={y} x={SPEAKER.x} y={y - 0.55} width={SPEAKER.w} height="1.1" rx="0.5" fill="url(#rd-trim)" opacity="0.8" />)}
          <rect x={SPEAKER.x} y={SPEAKER.y} width={SPEAKER.w} height={SPEAKER.h} rx="4" fill="none" stroke="url(#rd-trim)" strokeWidth="0.7" />

          {/* magic eye and power lamp */}
          <circle cx={EYE.cx} cy={EYE.cy} r="4.5" fill="url(#rd-trim)" />
          <circle cx={EYE.cx} cy={EYE.cy} r="3.7" fill="#12082a" />
          <g className="rd-eye">
            <circle cx={EYE.cx} cy={EYE.cy} r="3.3" fill="url(#rd-eye)" />
            <path d={`M${EYE.cx} ${EYE.cy} L${ax} ${ay} A3.4 3.4 0 0 1 ${bx} ${by} Z`} fill="#12082a" />
          </g>
          <circle cx={EYE.cx} cy={EYE.cy} r="1" fill="#0a0418" />
          <text x={EYE.cx} y={EYE.cy + 7.6} className="rd-label" textAnchor="middle">SIGNAL</text>
          <circle cx="84" cy={EYE.cy} r="2.1" fill="url(#rd-trim)" />
          <circle cx="84" cy={EYE.cy} r="1.5" className="rd-lamp" fill="url(#rd-lamp)" />
          <text x="84" y={EYE.cy + 7.6} className="rd-label" textAnchor="middle">POWER</text>

          {/* band keys */}
          {['AM', 'FM'].map((b, i) => {
            const down = bandId === b;
            const x = 61 + i * 14;
            return (
              <g key={b}>
                <rect x={x} y={down ? 66.4 : 65.4} width="12" height="5.6" rx="1" fill="#ede9fe" stroke="#7c6bb0" strokeWidth="0.3" />
                <rect x={x} y={down ? 71 : 70} width="12" height="1.1" rx="0.5" fill="#a497cc" />
                <text x={x + 6} y={down ? 70.2 : 69.2} className="rd-key-text" textAnchor="middle">{b}</text>
              </g>
            );
          })}

          <Knob cx={67} cy={79.4} r={5.3} turn={-135 + volume * 270} label="VOLUME" />
          <Knob cx={83} cy={79.4} r={5.3} turn={-KNOB_TURN / 2 + pos * KNOB_TURN} label="TUNING" />

          {/* feet */}
          <rect x="12" y="94.5" width="12" height="2.6" rx="1.1" fill="#0d0720" />
          <rect x="76" y="94.5" width="12" height="2.6" rx="1.1" fill="#0d0720" />
        </svg>
      </div>
    </div>
  );
}
