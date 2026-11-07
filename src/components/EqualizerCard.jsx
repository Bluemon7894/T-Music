// Settings card for the equalizer: an on/off switch, presets and five sliders. The sliders share the
// look of the app's other sliders (thin track, violet gradient, white knob), only standing up.
import { useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { EQ_LABELS, EQ_PRESETS, useEqualizer } from '../store/equalizer.js';
import { EQ_BANDS } from '../lib/audio.js';
import { tr } from '../lib/i18n.js';

const RANGE = 12;
const hz = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

function BandSlider({ index, value, disabled }) {
  const setBand = useEqualizer((s) => s.setBand);
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const fromPointer = (e) => {
    const r = ref.current.getBoundingClientRect();
    const t = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setBand(index, t * RANGE * 2 - RANGE);
  };
  const pct = ((value + RANGE) / (RANGE * 2)) * 100;
  const fillFrom = Math.min(pct, 50);
  const fillTo = Math.max(pct, 50);
  return (
    <div className={`eq-band ${disabled ? 'off' : ''}`}>
      <span className="eq-db">{value > 0 ? `+${value}` : value}</span>
      <div
        ref={ref}
        className={`eq-slider ${dragging ? 'dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label={EQ_LABELS[index]}
        aria-valuemin={-RANGE}
        aria-valuemax={RANGE}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          fromPointer(e);
        }}
        onPointerMove={(e) => { if (dragging) fromPointer(e); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => setBand(index, 0)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setBand(index, value + 1); }
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); setBand(index, value - 1); }
        }}
      >
        <div className="eq-track">
          <i className="eq-zero" />
          <div className="eq-fill" style={{ bottom: `${fillFrom}%`, top: `${100 - fillTo}%` }} />
        </div>
        <div className="eq-knob" style={{ bottom: `${pct}%` }} />
      </div>
      <span className="eq-name">{EQ_LABELS[index]}</span>
      <span className="eq-hz">{hz(EQ_BANDS[index])}</span>
    </div>
  );
}

export default function EqualizerCard() {
  const enabled = useEqualizer((s) => s.enabled);
  const preset = useEqualizer((s) => s.preset);
  const gains = useEqualizer((s) => s.gains);
  const { toggle, choosePreset } = useEqualizer.getState();
  return (
    <section className="set-card" data-enter>
      <h2><AudioLines size={18} />{' '}{tr('이퀄라이저')}</h2>
      <p className="muted">{tr('음악의 저음과 고음을 내 스피커나 이어폰에 맞게 바꿔요. 라디오에는 적용되지 않아요.')}</p>
      <div className="set-item" onClick={toggle}>
        <div className="set-item-text">
          <span className="set-item-title">{tr('이퀄라이저 사용')}</span>
          <span className="muted small">{tr('같이 듣기 중에도 내 기기에서만 적용돼요.')}</span>
        </div>
        <div className={`switch ${enabled ? 'on' : ''}`} />
      </div>
      <div className="eq-presets">
        {EQ_PRESETS.map((p) => (
          <button key={p.id} className={enabled && preset === p.id ? 'on' : ''} onClick={() => choosePreset(p.id)}>{p.label}</button>
        ))}
        {preset === 'custom' && <button className={enabled ? 'on' : ''} onClick={() => { if (!enabled) toggle(); }}>{tr('직접 설정')}</button>}
      </div>
      <div className="eq-bands">
        {gains.map((g, i) => <BandSlider key={EQ_BANDS[i]} index={i} value={g} disabled={!enabled} />)}
      </div>
    </section>
  );
}
