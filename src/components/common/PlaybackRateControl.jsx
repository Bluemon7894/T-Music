import { useState, useRef, useEffect } from 'react';
import { Gauge, Check, RotateCcw } from 'lucide-react';
import { usePlayer } from '../../store/player.js';

const SPEED_PRESETS = [0.5, 0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

export default function PlaybackRateControl({ variant = 'dock' }) {
  const playbackRate = usePlayer((s) => s.playbackRate || 1.0);
  const setPlaybackRate = usePlayer((s) => s.setPlaybackRate);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleWheel = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const next = Math.max(0.25, Math.min(2.5, Math.round((playbackRate + delta) * 100) / 100));
    setPlaybackRate(next);
  };

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setPlaybackRate(1.0);
  };

  const isCustom = Math.abs(playbackRate - 1.0) >= 0.02;
  const formattedRate = `${Number(playbackRate.toFixed(2))}x`;

  return (
    <div
      ref={wrapRef}
      className={`rate-control-wrap ${variant} ${open ? 'open' : ''}`}
      onWheel={handleWheel}
    >
      <button
        type="button"
        className={`rate-btn ${isCustom ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        onDoubleClick={handleDoubleClick}
        title={isCustom ? `재생 배속: ${formattedRate} (더블클릭시 1.0x 초기화, 휠로 조절)` : '재생 배속 조절 (휠로 조절 가능)'}
      >
        <Gauge size={variant === 'stage' ? 16 : 14} className="rate-icon" />
        <span className="rate-text">{formattedRate}</span>
      </button>

      {open && (
        <div className={`rate-popover ${variant}`} role="menu">
          <div className="rate-popover-header">
            <span>재생 속도</span>
            {isCustom && (
              <button
                type="button"
                className="rate-reset-btn"
                onClick={() => { setPlaybackRate(1.0); setOpen(false); }}
                title="1.0x 표준 배속으로 리셋"
              >
                <RotateCcw size={12} /> 표준
              </button>
            )}
          </div>
          <div className="rate-popover-list">
            {SPEED_PRESETS.map((speed) => {
              const selected = Math.abs(playbackRate - speed) < 0.02;
              return (
                <button
                  key={speed}
                  type="button"
                  className={`rate-option ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    setPlaybackRate(speed);
                    setOpen(false);
                  }}
                >
                  <span className="rate-option-label">
                    {speed.toFixed(speed % 1 === 0 ? 1 : 2)}x
                    {speed === 1.0 && <small className="rate-standard-tag"> (표준)</small>}
                  </span>
                  {selected && <Check size={14} className="rate-check" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
