import { useRef, useState } from 'react';
import { Shuffle, SkipBack, SkipForward, Repeat, Repeat1, ListMusic, Volume2, Volume1, VolumeX, Maximize2, Mic2, PictureInPicture2, Bookmark, BookmarkCheck } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useRadio } from '../../store/radio.js';
import { useLibrary } from '../../store/library.js';
import { BANDS } from '../RadioDial.jsx';
import { burst } from '../../lib/motion.js';
import { useUI } from '../../store/ui.js';
import { useNav } from '../../store/nav.js';
import { fmtTime } from '../../lib/util.js';
import { dragProps, dropOnPlayer, trackPayload, useDrop } from '../../lib/drag.js';
import { Thumb, ArtistLinks, PlayButton } from '../common.jsx';
import { LikeButton, trackMenuItems } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import logo from '../../assets/logo-mark.png';
import { tr } from '../../lib/i18n.js';

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

  const hoverPct = max > 0 && hover != null ? Math.max(0, Math.min(100, (hover / max) * 100)) : 0;

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
      {className.includes('seek') && hover != null && (
        <span
          className="slider-tip"
          style={{
            left: `${hoverPct}%`,
            transform: `translateX(-${hoverPct}%)`,
          }}
        >
          {fmtTime(hover)}
        </span>
      )}
    </div>
  );
}

// The dock while the radio is on: the channel instead of a track, channel up and down instead of
// tracks, a live bar instead of a seek bar, and no lyrics, queue or download.
function RadioDock() {
  const station = useRadio((s) => s.station);
  const phase = useRadio((s) => s.phase);
  const buffering = useRadio((s) => s.buffering);
  const saved = useLibrary((s) => Boolean(station) && s.savedStations.some((x) => x.id === station.id));
  const { togglePause, step, toggleSave } = useRadio.getState();
  const paused = useRadio((s) => s.paused);
  const muted = usePlayer((s) => s.muted);
  const volume = usePlayer((s) => s.volume);
  const { setVolume, toggleMute } = usePlayer.getState();
  const setStage = useUI((s) => s.setStage);
  const go = useNav((s) => s.go);
  const VolIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const band = BANDS[station?.band || 'FM'];
  return (
    <footer className="dock radio-dock">
      <div className="dock-left">
        <button className="dock-art" onClick={() => setStage(true)} title={tr('크게 보기')}>
          <Thumb src={station?.logo} />
          <span className="dock-art-hint"><Maximize2 size={16} /></span>
        </button>
        <div className="dock-text">
          <div className="dock-title" onClick={() => go('radio', {})}>{station?.name || tr('라디오')}</div>
          <div className="dock-artist">{station ? `${band.fmt(station.freq)} ${station.band}` : ''}</div>
        </div>
        <button className={`icon-btn like ${saved ? 'on' : ''}`} onClick={(e) => { if (!saved) burst(e.currentTarget, '#f0abfc'); toggleSave(); }} title={saved ? tr('저장한 주파수에서 빼기') : tr('주파수 저장')} aria-label={tr('주파수 저장')}>
          {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
        </button>
      </div>
      <div className="dock-center">
        <div className="dock-controls">
          <button className="icon-btn" onClick={() => step(-1)} title={tr('이전 채널')}><SkipBack size={20} fill="currentColor" /></button>
          <PlayButton size={42} playing={!paused && phase !== 'ending'} onClick={togglePause} className={`dock-play ${buffering ? 'loading' : ''}`} />
          <button className="icon-btn" onClick={() => step(1)} title={tr('다음 채널')}><SkipForward size={20} fill="currentColor" /></button>
        </div>
        <div className="dock-progress radio-live-bar">
          <span className={`radio-onair ${phase === 'on' && !buffering && !paused ? 'on' : ''}`}>{tr('ON AIR')}</span>
          <div className="radio-live-track"><i /></div>
          <span className="time">{tr('실시간')}</span>
        </div>
      </div>
      <div className="dock-right">
        <button className="icon-btn" onClick={() => useUI.getState().setMini(true)} title={tr('미니 플레이어')}><PictureInPicture2 size={17} /></button>
        <button className="icon-btn" onClick={() => setStage(true)} title={tr('전체 화면')}><Maximize2 size={16} /></button>
        <button className="icon-btn" onClick={toggleMute} title={tr('음소거')}><VolIcon size={18} /></button>
        <Slider className="volume" value={muted ? 0 : volume} max={1} onChange={setVolume} />
      </div>
    </footer>
  );
}

export default function PlayerDock() {
  const radioOn = useRadio((s) => s.on);
  if (radioOn) return <RadioDock />;
  return <MusicDock />;
}

function MusicDock() {
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
  const lyricsOn = panelOpen && panelTab === 'lyrics';
  const { over, dropProps } = useDrop(dropOnPlayer);

  return (
    <footer className={`dock ${track ? '' : 'idle'} ${over ? 'drag-over' : ''}`} {...dropProps}>
      <div className="dock-glow" style={{ width: `${duration ? ((scrub ?? p.time) / duration) * 100 : 0}%` }} />
      <div className="dock-left">
        {track ? (
          <>
            <button className="dock-art" onClick={() => setStage(true)} title={tr('크게 보기')}>
              <Thumb key={track.id} src={track.thumb} className="art-swap" />
              <span className="dock-art-hint"><Maximize2 size={16} /></span>
            </button>
            <div className="dock-text" onContextMenu={(e) => openMenu(e, trackMenuItems(track))} {...dragProps(() => trackPayload(track))}>
              <div className="dock-title" onClick={() => track.album?.id && go('album', { id: track.album.id })}>{track.title}</div>
              <ArtistLinks artists={track.artists} className="dock-artist" />
            </div>
            <LikeButton track={track} size={17} />
            <DownloadButton track={track} size={17} />
          </>
        ) : (
          <div className="dock-empty">
            <div className="dock-art idle">
              <img src={logo} alt="T-Music" className="thumb" />
            </div>
            <div className="dock-text">
              <div className="dock-title" style={{ cursor: 'default' }}>T-Music</div>
              <div className="dock-artist"><span className="dock-empty-dot" />{' '}{tr('재생할 곡을 골라보세요')}</div>
            </div>
          </div>
        )}
      </div>

      <div className="dock-center">
        <div className="dock-controls">
          <button className={`icon-btn toggle ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle} title={tr('셔플')}><Shuffle size={17} /></button>
          <button className="icon-btn" onClick={p.prev} title={tr('이전')}><SkipBack size={20} fill="currentColor" /></button>
          <PlayButton size={42} playing={p.playing} onClick={p.toggle} className={`dock-play ${p.loading && p.playing ? 'loading' : ''}`} />
          <button className="icon-btn" onClick={() => p.next()} title={tr('다음')}><SkipForward size={20} fill="currentColor" /></button>
          <button className={`icon-btn toggle ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat} title={{ off: tr('반복 안 함'), all: tr('전체 반복'), one: tr('한 곡 반복') }[p.repeat]}>
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
        <button className={`icon-btn toggle ${lyricsOn ? 'on' : ''}`} onClick={() => (lyricsOn ? useUI.getState().togglePanel() : setPanelTab('lyrics'))} title={tr('가사')} disabled={!track}><Mic2 size={18} /></button>
        <button className={`icon-btn toggle ${queueOn ? 'on' : ''}`} onClick={() => (queueOn ? useUI.getState().togglePanel() : setPanelTab('queue'))} title={tr('대기열')} data-queue-target><ListMusic size={18} /></button>
        <button className="icon-btn" onClick={() => useUI.getState().setMini(true)} title={tr('미니 플레이어')}><PictureInPicture2 size={17} /></button>
        <button className="icon-btn" onClick={() => setStage(true)} title={tr('전체 화면')} disabled={!track}><Maximize2 size={16} /></button>
        <button className="icon-btn" onClick={p.toggleMute} title={tr('음소거')}><VolIcon size={18} /></button>
        <Slider className="volume" value={p.muted ? 0 : p.volume} max={1} onChange={p.setVolume} />
      </div>
    </footer>
  );
}
