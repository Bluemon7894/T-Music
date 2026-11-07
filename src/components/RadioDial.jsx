// The tuning dial: a scale for the band with a mark for every channel and a needle. The needle follows
// the radio's `tune` (see store/radio.js): it sweeps across the scale for as long as the start sound
// plays and lands on the channel as the broadcast comes in, and falls back to the start of the scale,
// going dark, while the end sound plays.
import { useEffect, useRef, useState } from 'react';
import { useRadio } from '../store/radio.js';

export const BANDS = {
  FM: { min: 87.5, max: 108, major: 2, unit: 'MHz', fmt: (f) => f.toFixed(1) },
  AM: { min: 531, max: 1602, major: 100, unit: 'kHz', fmt: (f) => String(Math.round(f)) },
};

const frac = (band, f) => (f - band.min) / (band.max - band.min);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Where the needle is `t` (0..1) into a tune. Turning on, it searches: drifts one way, swings back
// past the channel and settles on it. Switching channels is a plain glide.
function needleAt(tune, t, band) {
  const to = tune.to ?? band.min;
  const from = tune.from ?? band.min;
  if (tune.kind === 'off') return from + (band.min - from) * easeInOut(t);
  if (tune.from != null && tune.ms <= 900) return from + (to - from) * easeInOut(t);
  const span = band.max - band.min;
  const far = Math.min(band.max, Math.max(band.min, to + (to - band.min > span / 2 ? -0.35 : 0.35) * span));
  if (t < 0.55) return from + (far - from) * easeInOut(t / 0.55);
  const k = (t - 0.55) / 0.45;
  const settle = to + (far - to) * (1 - easeInOut(k));
  return settle + Math.sin(k * Math.PI * 3) * (1 - k) * span * 0.012;
}

export function useNeedle(bandId) {
  const band = BANDS[bandId] || BANDS.FM;
  const tune = useRadio((s) => s.sweep);
  const station = useRadio((s) => s.station);
  const phase = useRadio((s) => s.phase);
  const rest = phase !== 'off' && station?.band === bandId && Number.isFinite(station.freq) ? station.freq : band.min;
  const [value, setValue] = useState(rest);
  const raf = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    if (!tune || (tune.kind === 'on' && tune.to != null && station?.band !== bandId)) {
      setValue(rest);
      return undefined;
    }
    const step = () => {
      const t = Math.min(1, (performance.now() - tune.at) / Math.max(1, tune.ms));
      setValue(needleAt(tune, t, band));
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf.current);
  }, [tune, bandId]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = Number.isFinite(value) ? value : Number.isFinite(rest) ? rest : band.min;
  return { value: shown, band, pos: frac(band, Math.min(band.max, Math.max(band.min, shown))) };
}

export default function RadioDial({ bandId, channels, current, onPick, compact = false }) {
  const { value, band, pos } = useNeedle(bandId);
  const phase = useRadio((s) => s.phase);
  const lit = phase !== 'off';
  const majors = [];
  for (let f = Math.ceil(band.min / band.major) * band.major; f <= band.max; f += band.major) majors.push(f);
  return (
    <div className={`rdial ${lit ? 'lit' : ''} ${compact ? 'compact' : ''}`}>
      <div className="rdial-readout">
        <span className="rdial-band">{bandId}</span>
        <b>{band.fmt(value)}</b>
        <small>{band.unit}</small>
      </div>
      <div className="rdial-scale">
        {majors.map((f) => (
          <span key={f} className="rdial-major" style={{ left: `${frac(band, f) * 100}%` }}><i />{!compact && <em>{bandId === 'FM' ? f : f}</em>}</span>
        ))}
        {channels.map((c) => (
          <button
            key={c.id}
            className={`rdial-mark ${c.id === current?.id ? 'on' : ''} ${c.kind === 'youtube' ? 'yt' : ''}`}
            style={{ left: `${frac(band, c.freq) * 100}%` }}
            title={`${band.fmt(c.freq)} · ${c.name}`}
            aria-label={c.name}
            onClick={() => onPick?.(c)}
          />
        ))}
        <span className="rdial-needle" style={{ left: `${pos * 100}%` }} />
      </div>
    </div>
  );
}
