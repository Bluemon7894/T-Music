import { useRef, useState } from 'react';
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, ListMusic, Volume2, Volume1, VolumeX, Maximize2 } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { useNav } from '../../store/nav.js';
import { fmtTime } from '../../lib/util.js';
import { Thumb, ArtistLinks, PlayButton } from '../common.jsx';
import { LikeButton, trackMenuItems } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';

export function Slider({ value, max, onChange, onCommit, buffered = 0, className = '' }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const ratio = max ? Math.min(1, (drag ?? value) / max) : 0;

  const at = (e) => {
    const r = ref.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * max;
  };
  const down = (e) => {
    if (!max) return;
    e.preventDefault();
    const v = at(e);
    setDrag(v);
    onChange?.(v);
    const move = (ev) => { const nv = at(ev); setDrag(nv); onChange?.(nv); };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      (onCommit || onChange)?.(at(ev));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={`slider ${drag != null ? 'dragging' : ''} ${className}`}
      ref={ref}
      onPointerDown={down}
      onPointerMove={(e) => max && setHover(at(e))}
      onPointerLeave={() => setHover(null)}
    >
      <div className="slider-track">
        <div className="slider-buf" style={{ width: `${max ? Math.min(1, buffered / max) * 100 : 0}%` }} />
        <div className="slider-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="slider-knob" style={{ left: `${ratio * 100}%` }} />
      {className.includes('seek') && hover != null && <span className="slider-tip" style={{ left: `${(hover / max) * 100}%` }}>{fmtTime(hover)}</span>}
    </div>
  );
}

export default function PlayerDock() {
  const p = usePlayer();
  const track = p.queue[p.index];
  const openMenu = useUI((s) => s.openMenu);
  const panelTab = useUI((s) => s.panelTab);
  const panelOpen = useUI((s) => s.panelOpen);
  const setPanelTab = useUI((s) => s.setPanelTab);
  const setStage = useUI((s) => s.setStage);
  const go = useNav((s) => s.go);
  const [scrub, setScrub] = useState(null);
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const duration = p.duration || track?.duration || 0;
  const queueOn = panelOpen && panelTab === 'queue';

  return (
    <footer className={`dock ${track ? '' : 'idle'}`}>
      <div className="dock-glow" style={{ width: `${duration ? ((scrub ?? p.time) / duration) * 100 : 0}%` }} />
      <div className="dock-left">
        {track ? (
          <>
            <button className="dock-art" onClick={() => setStage(true)} title="크게 보기">
              <Thumb src={track.thumb} />
              <span className="dock-art-hint"><Maximize2 size={16} /></span>
            </button>
            <div className="dock-text" onContextMenu={(e) => openMenu(e, trackMenuItems(track))}>
              <div className="dock-title" onClick={() => track.album?.id && go('album', { id: track.album.id })}>{track.title}</div>
              <ArtistLinks artists={track.artists} className="dock-artist" />
            </div>
            <LikeButton track={track} size={17} />
            <DownloadButton track={track} size={17} />
          </>
        ) : (
          <div className="dock-empty"><span className="dock-empty-dot" />재생할 곡을 골라보세요</div>
        )}
      </div>

      <div className="dock-center">
        <div className="dock-controls">
          <button className={`icon-btn toggle ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle} title="셔플"><Shuffle size={17} /></button>
          <button className="icon-btn" onClick={p.prev} title="이전"><SkipBack size={20} fill="currentColor" /></button>
          <PlayButton size={42} playing={p.playing} onClick={p.toggle} className={`dock-play ${p.loading && p.playing ? 'loading' : ''}`} />
          <button className="icon-btn" onClick={() => p.next()} title="다음"><SkipForward size={20} fill="currentColor" /></button>
          <button className={`icon-btn toggle ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} title={{ off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' }[p.repeat]}>
            {p.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <div className="dock-progress">
          <span className="time">{fmtTime(scrub ?? p.time)}</span>
          <Slider className="seek" value={p.time} max={duration} buffered={p.buffered} onChange={setScrub} onCommit={(v) => { setScrub(null); p.seek(v); }} />
          <span className="time">{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="dock-right">
        <button className={`icon-btn toggle ${queueOn ? 'on' : ''}`} onClick={() => (queueOn ? useUI.getState().togglePanel() : setPanelTab('queue'))} title="대기열"><ListMusic size={18} /></button>
        <button className="icon-btn" onClick={() => setStage(true)} title="전체 화면" disabled={!track}><Maximize2 size={16} /></button>
        <button className="icon-btn" onClick={p.toggleMute} title="음소거"><VolIcon size={18} /></button>
        <Slider className="volume" value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} />
      </div>
    </footer>
  );
}
