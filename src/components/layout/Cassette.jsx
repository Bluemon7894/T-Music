// The stage's tape deck. Tape runs at a steady speed, so each reel turns slower as it fills and faster as
// it empties, and the wound tape moves across from left to right with the song. The tape seats itself
// and the play key goes down in time with the clicks of the start sound.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronsLeft, ChevronsRight, Pause, Play } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { DECKS, useDeck } from '../../store/deck.js';
import { getAnalyser } from '../../lib/audio.js';
import { Thumb } from '../common.jsx';
import { useTilt } from '../../lib/motion.js';
import logo from '../../assets/logo-mark.png';

const REEL_LEFT_X = 22;
const REEL_RIGHT_X = 93;
const REEL_Y = 14;
const PACK_MIN = 9;
const PACK_MAX = 30;
const TURN_SPEED = 150; // degrees per second on a half-full reel
const TURN_REFERENCE_RADIUS = 21;
// The meter's pivot sits below its face, as on a real one, so only the long part of the needle shows.
// A VU scale is linear in voltage: +3 is the far end and every other mark falls where its level says.
const NEEDLE_REST = -40;
const NEEDLE_SWING = 80;
const PIVOT_X = 50;
const PIVOT_Y = 70;
const NEEDLE_PIVOT = `${PIVOT_X} ${PIVOT_Y}`;
const SCALE_RADIUS = 52;
const PERCENT_RADIUS = 41;
const VU_MARKS = [-20, -10, -7, -5, -3, -1, 0, 1, 2, 3];
const VU_MINOR_MARKS = [-15, -12, -8.5, -6, -4, -2, -0.5, 0.5, 1.5, 2.5];
const PERCENT_MARKS = [0, 20, 40, 60, 80, 100];
const PEAK_LEVEL = 0.86;
const PEAK_HOLD_S = 0.18;
const VU_BOOST = 3.4;
const BASS_BINS = 6;
const SEAT_LIFT = 3.5; // percent of the tape's height
const SEAT_UP_UNTIL = 0.3;
const SEAT_DOWN_UNTIL = 0.72;
const KEY_PRESS_MS = 240;

const markPosition = (db) => 10 ** ((db - 3) / 20);

function dialPoint(position, radius) {
  const angle = ((NEEDLE_REST + NEEDLE_SWING * position) * Math.PI) / 180;
  return [PIVOT_X + radius * Math.sin(angle), PIVOT_Y - radius * Math.cos(angle)];
}

function dialArc(from, to, radius) {
  const [x0, y0] = dialPoint(from, radius);
  const [x1, y1] = dialPoint(to, radius);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${radius} ${radius} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function dialTick(position, inner, outer) {
  const [x0, y0] = dialPoint(position, inner);
  const [x1, y1] = dialPoint(position, outer);
  return { x1: x0.toFixed(2), y1: y0.toFixed(2), x2: x1.toFixed(2), y2: y1.toFixed(2) };
}

function seatOffset(t) {
  if (t < 0 || t >= SEAT_DOWN_UNTIL) return 0;
  if (t < SEAT_UP_UNTIL) return -SEAT_LIFT * (t / SEAT_UP_UNTIL);
  const falling = (t - SEAT_UP_UNTIL) / (SEAT_DOWN_UNTIL - SEAT_UP_UNTIL);
  return -SEAT_LIFT * (1 - falling * falling);
}

// Skipping a track pushes its key in and lets it spring back.
function useKeyPresses(parts) {
  useEffect(() => {
    const timers = new Map();
    const onKey = (e) => {
      const key = e.detail === 'prev' ? parts.prevKey.current : parts.nextKey.current;
      if (!key) return;
      clearTimeout(timers.get(key));
      key.classList.add('down');
      timers.set(key, setTimeout(() => key.classList.remove('down'), KEY_PRESS_MS));
    };
    window.addEventListener('t-music:deck-key', onKey);
    return () => {
      window.removeEventListener('t-music:deck-key', onKey);
      for (const t of timers.values()) clearTimeout(t);
    };
  }, [parts]);
}

function useCassetteMotion(parts) {
  useLayoutEffect(() => {
    let raf = 0;
    let last = performance.now();
    let speed = 0;
    let left = 0;
    let right = 0;
    let wound = 0;
    let shown = null;
    let needle = 0;
    let peakUntil = 0;
    let bass = 0;
    let wave = null;
    let bins = null;
    let seat = 0;
    let counter = '';

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      // The first frame's timestamp can be slightly older than the moment this loop started.
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      const p = usePlayer.getState();
      const { phase, at } = useDeck.getState();
      const t = (now - at) / 1000;

      const running = phase === 'starting' ? t >= DECKS.cassette.start.cue
        : phase === 'ending' ? t < DECKS.cassette.end.stop
          : p.playing;
      speed += ((running ? 1 : 0) - speed) * Math.min(1, dt * (running ? 7 : 14));
      parts.playKey.current.classList.toggle('down', running);
      parts.pauseKey.current.classList.toggle('down', !running && p.queue.length > 0 && p.time > 0);

      // The stopped player goes back to zero at the very end: the tape stays full until the sound is over.
      const duration = p.duration || p.queue[p.index]?.duration || 0;
      if (phase !== 'ending' || p.playing) wound = duration > 0 ? Math.min(1, p.getPreciseTime() / duration) : 0;
      // Opening in the middle of a song, the tape is already where it should be.
      shown = shown === null ? wound : shown + (wound - shown) * Math.min(1, dt * 4);
      const span = PACK_MAX * PACK_MAX - PACK_MIN * PACK_MIN;
      const radiusLeft = Math.sqrt(PACK_MAX * PACK_MAX - span * shown);
      const radiusRight = Math.sqrt(PACK_MIN * PACK_MIN + span * shown);
      parts.packLeft.current.setAttribute('r', radiusLeft.toFixed(2));
      parts.packRight.current.setAttribute('r', radiusRight.toFixed(2));
      left = (left - speed * TURN_SPEED * (TURN_REFERENCE_RADIUS / radiusLeft) * dt) % 360;
      right = (right - speed * TURN_SPEED * (TURN_REFERENCE_RADIUS / radiusRight) * dt) % 360;
      parts.hubLeft.current.setAttribute('transform', `translate(${REEL_LEFT_X} ${REEL_Y}) rotate(${left.toFixed(1)})`);
      parts.hubRight.current.setAttribute('transform', `translate(${REEL_RIGHT_X} ${REEL_Y}) rotate(${right.toFixed(1)})`);

      const nextSeat = phase === 'starting' ? seatOffset(t) : 0;
      if (nextSeat !== seat) {
        seat = nextSeat;
        parts.tape.current.style.transform = seat ? `translateY(${seat.toFixed(2)}%)` : '';
      }

      let loudness = 0;
      let low = 0;
      const analyser = getAnalyser();
      if (analyser && p.playing) {
        wave ??= new Uint8Array(analyser.fftSize);
        bins ??= new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(wave);
        analyser.getByteFrequencyData(bins);
        let sum = 0;
        for (let i = 0; i < wave.length; i++) sum += ((wave[i] - 128) / 128) ** 2;
        loudness = Math.min(1, Math.sqrt(sum / wave.length) * VU_BOOST);
        for (let i = 0; i < BASS_BINS; i++) low += bins[i] / 255 / BASS_BINS;
      }
      needle += (loudness - needle) * Math.min(1, dt * 7); // a VU needle is deliberately slow
      const needleTurn = `rotate(${(NEEDLE_REST + NEEDLE_SWING * needle).toFixed(2)} ${NEEDLE_PIVOT})`;
      parts.needle.current.setAttribute('transform', needleTurn);
      parts.needleShadow.current.setAttribute('transform', `translate(0.7 0.9) ${needleTurn}`);
      parts.meter.current.classList.toggle('lit', running || p.playing);
      if (loudness >= PEAK_LEVEL) peakUntil = now + PEAK_HOLD_S * 1000;
      parts.peak.current.classList.toggle('on', now < peakUntil);
      bass += (low - bass) * Math.min(1, dt * (low > bass ? 18 : 5));
      parts.glow.current.style.opacity = (0.25 + bass * 0.75).toFixed(3);

      const nextCounter = String(Math.floor(p.getPreciseTime()) % 1000).padStart(3, '0');
      if (nextCounter !== counter) {
        counter = nextCounter;
        parts.counter.current.textContent = counter;
      }
    };
    frame(last); // before the first paint, so the reels never show the wrong amount of tape
    return () => cancelAnimationFrame(raf);
  }, [parts]);
}

function VuMeter({ parts }) {
  const zero = markPosition(0);
  return (
    <svg className="cs-vu" ref={parts.meter} viewBox="0 0 100 58" aria-hidden="true">
      <defs>
        <radialGradient id="cs-vu-glow" cx="0.5" cy="0.72" r="0.8">
          <stop offset="0" stopColor="#fff3c9" />
          <stop offset="0.55" stopColor="#f6cf7c" />
          <stop offset="1" stopColor="#c98a32" />
        </radialGradient>
        <linearGradient id="cs-vu-bezel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6a5a96" />
          <stop offset="0.5" stopColor="#2a2044" />
          <stop offset="1" stopColor="#4a3b72" />
        </linearGradient>
        <clipPath id="cs-vu-clip"><rect x="3.4" y="3.4" width="93.2" height="51.2" rx="3" /></clipPath>
      </defs>
      <rect className="cs-vu-bezel" x="0.4" y="0.4" width="99.2" height="57.2" rx="5.5" />
      {[[1.9, 1.9], [98.1, 1.9], [1.9, 56.1], [98.1, 56.1]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} className="cs-vu-screw" cx={cx} cy={cy} r="0.75" />)}
      <g clipPath="url(#cs-vu-clip)">
        <rect className="cs-vu-face" x="3.4" y="3.4" width="93.2" height="51.2" />

        <path className="cs-vu-scale" d={dialArc(markPosition(-20), zero, SCALE_RADIUS)} />
        <path className="cs-vu-hot" d={dialArc(zero, 1, SCALE_RADIUS + 1)} />
        {VU_MINOR_MARKS.map((db) => <line key={db} className={db > 0 ? 'cs-vu-tick hot' : 'cs-vu-tick'} {...dialTick(markPosition(db), SCALE_RADIUS, SCALE_RADIUS + 1.8)} />)}
        {VU_MARKS.map((db) => {
          const position = markPosition(db);
          const [x, y] = dialPoint(position, SCALE_RADIUS + 6.2);
          return (
            <g key={db}>
              <line className={db > 0 ? 'cs-vu-tick major hot' : 'cs-vu-tick major'} {...dialTick(position, SCALE_RADIUS - 0.4, SCALE_RADIUS + 3.2)} />
              <text className={db > 0 ? 'cs-vu-number hot' : 'cs-vu-number'} x={x.toFixed(2)} y={y.toFixed(2)} textAnchor="middle">{Math.abs(db)}</text>
            </g>
          );
        })}
        <text className="cs-vu-sign" x="16.5" y="12" textAnchor="middle">−</text>
        <text className="cs-vu-sign hot" x="83.5" y="12" textAnchor="middle">+</text>

        <path className="cs-vu-percent" d={dialArc(0, 1, PERCENT_RADIUS)} />
        {PERCENT_MARKS.map((value) => {
          const position = value / 100 / 1.4125; // 100% is 0 VU, three decibels below the far end
          const [x, y] = dialPoint(position, PERCENT_RADIUS - 4.2);
          return (
            <g key={value}>
              <line className="cs-vu-tick" {...dialTick(position, PERCENT_RADIUS - 1.6, PERCENT_RADIUS)} />
              <text className="cs-vu-small" x={x.toFixed(2)} y={y.toFixed(2)} textAnchor="middle">{value}</text>
            </g>
          );
        })}

        <text className="cs-vu-text" x="50" y="46.5" textAnchor="middle">VU</text>
        <circle ref={parts.peak} className="cs-vu-lamp" cx="87.5" cy="44.5" r="1.7" />
        <text className="cs-vu-small" x="87.5" y="50.6" textAnchor="middle">PEAK</text>
        <text className="cs-vu-small" x="12.5" y="50.6" textAnchor="middle">LEVEL</text>

        <line ref={parts.needleShadow} className="cs-vu-needle-shadow" x1={PIVOT_X} y1={PIVOT_Y} x2={PIVOT_X} y2={PIVOT_Y - SCALE_RADIUS - 3} transform={`rotate(${NEEDLE_REST} ${NEEDLE_PIVOT})`} />
        <line ref={parts.needle} className="cs-vu-needle" x1={PIVOT_X} y1={PIVOT_Y} x2={PIVOT_X} y2={PIVOT_Y - SCALE_RADIUS - 3} transform={`rotate(${NEEDLE_REST} ${NEEDLE_PIVOT})`} />
        <path className="cs-vu-hood" d="M26 58 C34 47 66 47 74 58 Z" />

        <rect className="cs-vu-shade" x="3.4" y="3.4" width="93.2" height="51.2" />
        <path className="cs-vu-glass" d="M3.4 3.4 H62 L34 54.6 H3.4 Z" />
      </g>
    </svg>
  );
}

function Hub({ hubRef, x }) {
  return (
    <g ref={hubRef} transform={`translate(${x} ${REEL_Y})`}>
      <circle className="cs-hub" r="6.6" />
      <circle className="cs-hub-hole" r="4" />
      {[0, 60, 120, 180, 240, 300].map((turn) => (
        <rect key={turn} className="cs-hub-tooth" x="-0.7" y="-4.4" width="1.4" height="2.3" rx="0.3" transform={`rotate(${turn})`} />
      ))}
    </g>
  );
}

export default function Cassette({ track, playing }) {
  const tilt = useRef(null);
  const parts = useRef({
    tape: { current: null },
    packLeft: { current: null },
    packRight: { current: null },
    hubLeft: { current: null },
    hubRight: { current: null },
    needle: { current: null },
    needleShadow: { current: null },
    meter: { current: null },
    peak: { current: null },
    glow: { current: null },
    counter: { current: null },
    prevKey: { current: null },
    nextKey: { current: null },
    playKey: { current: null },
    pauseKey: { current: null },
  }).current;
  const phase = useDeck((s) => s.phase);

  useTilt(tilt, { max: 8, scale: 1 });
  useCassetteMotion(parts);
  useKeyPresses(parts);

  return (
    <div className="stage-disc-wrap" ref={tilt}>
      <div className="tt-deck cs-deck" data-phase={phase}>
        <img className="tt-logo" src={logo} alt="" draggable={false} />
        <div className="cs-glow" ref={parts.glow} />

        <div className="cs-bay">
          <div className="cs-tape" ref={parts.tape}>
            <i className="cs-screw" style={{ left: '1.6%', top: '3%' }} />
            <i className="cs-screw" style={{ right: '1.6%', top: '3%' }} />
            <i className="cs-screw" style={{ left: '1.6%', bottom: '3%' }} />
            <i className="cs-screw" style={{ right: '1.6%', bottom: '3%' }} />
            <div className="cs-label">
              <Thumb src={track.thumb} />
              <b className="cs-title">{track.title}</b>
            </div>
            <div className="cs-window">
              <svg className="cs-reels" viewBox="0 0 115 28" aria-hidden="true">
                <circle ref={parts.packLeft} className="cs-pack" cx={REEL_LEFT_X} cy={REEL_Y} r={PACK_MAX} />
                <circle ref={parts.packRight} className="cs-pack" cx={REEL_RIGHT_X} cy={REEL_Y} r={PACK_MIN} />
                <Hub hubRef={parts.hubLeft} x={REEL_LEFT_X} />
                <Hub hubRef={parts.hubRight} x={REEL_RIGHT_X} />
              </svg>
            </div>
            <div className="cs-lip" />
          </div>
          <div className="cs-door" />
        </div>

        <div className="cs-panel">
          <VuMeter parts={parts} />
          <div className="cs-side">
            <div className="cs-readout">
              <span className="cs-counter" ref={parts.counter}>000</span>
              <div className={`tt-led ${playing ? 'on' : ''}`}><i />STEREO</div>
            </div>
            <div className="cs-keys" aria-hidden="true">
              <span className="cs-key" ref={parts.prevKey}><ChevronsLeft /></span>
              <span className="cs-key" ref={parts.playKey}><Play fill="currentColor" /></span>
              <span className="cs-key" ref={parts.pauseKey}><Pause fill="currentColor" /></span>
              <span className="cs-key" ref={parts.nextKey}><ChevronsRight /></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
