import { useRef, useState } from 'react';
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, ListMusic, Volume2, Volume1, VolumeX } from 'lucide-react';
import { usePlayer } from '../store/player.js';
import { useUI } from '../store/ui.js';
import { useNav } from '../store/nav.js';
import { fmtTime } from '../util.js';
import { Thumb, ArtistLinks, PlayButton } from './common.jsx';
import { LikeButton, trackMenuItems } from './TrackList.jsx';

function Slider({ value, max, onChange, onCommit, buffered = 0, className = '' }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
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
      const nv = at(ev);
      setDrag(null);
      (onCommit || onChange)?.(nv);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={`slider ${drag != null ? 'dragging' : ''} ${className}`} ref={ref} onPointerDown={down}>
      <div className="slider-track">
        <div className="slider-buf" style={{ width: `${max ? Math.min(1, buffered / max) * 100 : 0}%` }} />
        <div className="slider-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="slider-knob" style={{ left: `${ratio * 100}%` }} />
    </div>
  );
}

export default function PlayerBar() {
  const p = usePlayer();
  const track = p.queue[p.index];
  const openMenu = useUI((s) => s.openMenu);
  const queueOpen = useUI((s) => s.queueOpen);
  const toggleQueue = useUI((s) => s.toggleQueue);
  const go = useNav((s) => s.go);
  const [scrub, setScrub] = useState(null);
  const VolIcon = p.muted || p.volume === 0 ? VolumeX : p.volume < 0.5 ? Volume1 : Volume2;
  const duration = p.duration || track?.duration || 0;

  return (
    <footer className="playerbar">
      <div className="pb-left">
        {track && (
          <>
            <Thumb src={track.thumb} className="pb-thumb" />
            <div className="pb-text" onContextMenu={(e) => openMenu(e, trackMenuItems(track))}>
              <div className="pb-title" onClick={() => track.album?.id && go('album', { id: track.album.id })}>{track.title}</div>
              <ArtistLinks artists={track.artists} className="pb-artist" />
            </div>
            <LikeButton track={track} />
          </>
        )}
      </div>

      <div className="pb-center">
        <div className="pb-controls">
          <button className={`icon-btn toggle ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle} title="셔플"><Shuffle size={17} /></button>
          <button className="icon-btn" onClick={p.prev} title="이전"><SkipBack size={20} fill="currentColor" /></button>
          <PlayButton size={34} playing={p.playing} onClick={p.toggle} className={`pb-play ${p.loading && p.playing ? 'loading' : ''}`} />
          <button className="icon-btn" onClick={() => p.next()} title="다음"><SkipForward size={20} fill="currentColor" /></button>
          <button className={`icon-btn toggle ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} title={{ off: '반복 안 함', all: '전체 반복', one: '한 곡 반복' }[p.repeat]}>
            {p.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <div className="pb-progress">
          <span className="time">{fmtTime(scrub ?? p.time)}</span>
          <Slider value={p.time} max={duration} buffered={p.buffered} onChange={setScrub} onCommit={(v) => { setScrub(null); p.seek(v); }} />
          <span className="time">{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="pb-right">
        <button className={`icon-btn toggle ${queueOpen ? 'on' : ''}`} onClick={toggleQueue} title="대기열"><ListMusic size={18} /></button>
        <button className="icon-btn" onClick={p.toggleMute} title="음소거"><VolIcon size={18} /></button>
        <Slider className="volume" value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} />
      </div>
    </footer>
  );
}
