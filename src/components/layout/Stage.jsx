// Fullscreen "stage": the turntable, synchronized lyrics and the up-next strip. Esc or the button closes it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Mic2, Volume2, Volume1, VolumeX } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { api } from '../../lib/api.js';
import { Thumb, ArtistLinks, PlayButton } from '../common.jsx';
import { LikeButton } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import { Slider } from './PlayerDock.jsx';
import LyricsView from './LyricsView.jsx';
import Turntable from './Turntable.jsx';
import { fmtTime } from '../../lib/util.js';
import { animate, createTimeline, ease, stagger } from '../../lib/motion.js';

const VOLUME_WHEEL_STEP = 0.05;

export function StageProgress({ fallbackDuration }) {
  const time = usePlayer((s) => s.time);
  const buffered = usePlayer((s) => s.buffered);
  const seek = usePlayer((s) => s.seek);
  const duration = usePlayer((s) => s.duration) || fallbackDuration || 0;
  return (
    <div className="stage-progress" data-rise>
      <Slider className="seek" value={time} max={duration} buffered={buffered} onCommit={(v) => seek(v)} />
      <div className="stage-times"><span>{fmtTime(time)}</span><span>-{fmtTime(Math.max(0, duration - time))}</span></div>
    </div>
  );
}

function StageVolume() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const shown = muted ? 0 : volume;
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div className="stage-volume">
      <button
        className="icon-btn"
        onClick={toggleMute}
        aria-label={muted ? '음소거 해제' : '음소거'}
        title={muted ? '음소거 해제' : `음량: ${Math.round(shown * 100)}%`}
      >
        <Icon size={20} />
      </button>
      <Slider className="volume" value={shown} max={1} onChange={setVolume} />
      <span className="stage-vol-percent">{Math.round(shown * 100)}%</span>
    </div>
  );
}

function StageControls() {
  const playing = usePlayer((s) => s.playing);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  return (
    <div className="stage-controls" data-rise>
      <button className={`icon-btn toggle ${shuffle ? 'on' : ''}`} onClick={toggleShuffle} aria-label="셔플"><Shuffle size={20} /></button>
      <button className="icon-btn" onClick={prev} aria-label="이전 곡"><SkipBack size={28} fill="currentColor" /></button>
      <PlayButton size={72} playing={playing} onClick={toggle} />
      <button className="icon-btn" onClick={() => next()} aria-label="다음 곡"><SkipForward size={28} fill="currentColor" /></button>
      <button className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`} onClick={cycleRepeat} aria-label="반복">{repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}</button>
      <StageVolume />
    </div>
  );
}

function UpNext() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const jumpTo = usePlayer((s) => s.jumpTo);
  const upcoming = queue.slice(index + 1, index + 9);
  if (!upcoming.length) return null;
  return (
    <div className="stage-next" data-rise>
      <span className="stage-next-label">다음 곡</span>
      <div className="stage-next-row">
        {upcoming.map((t, i) => (
          <button key={t.id + i} className="stage-next-item" onClick={() => jumpTo(index + 1 + i)}>
            <Thumb src={t.thumb} />
            <span><b>{t.title}</b><small>{t.artists?.map((a) => a.name).join(', ')}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StageView({ track }) {
  const setStage = useUI((s) => s.setStage);
  const playing = usePlayer((s) => s.playing);
  const contextName = usePlayer((s) => s.context?.name);
  const root = useRef(null);
  const [showLyrics, setShowLyrics] = useState(() => {
    try { return localStorage.getItem('t-music-stage-lyrics') !== '0'; } catch { return true; }
  });

  const toggleLyrics = () => {
    const next = !showLyrics;
    setShowLyrics(next);
    try { localStorage.setItem('t-music-stage-lyrics', next ? '1' : '0'); } catch { /* ignore */ }
  };

  useLayoutEffect(() => {
    const el = root.current;
    createTimeline({ defaults: { ease: ease.soft } })
      .add(el, { opacity: [0, 1], duration: 260, ease: 'out(2)' })
      .add(el.querySelector('.tt-deck'), { rotateX: [40, 0], translateZ: [-240, 0], scale: [0.7, 1] }, 60)
      .add(el.querySelectorAll('[data-rise]'), { opacity: [0, 1], translateY: [30, 0], delay: stagger(50) }, 160);
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setStage(false);
    window.addEventListener('keydown', onKey);
    api.setTitleBarOverlay({ color: 'rgba(0, 0, 0, 0)', symbolColor: '#c4b5fd' }).catch(() => {});
    return () => window.removeEventListener('keydown', onKey);
  }, [setStage]);

  // New track: the record settles onto the platter.
  useEffect(() => {
    const platter = root.current.querySelector('.tt-platter');
    animate(platter, { scale: [0.95, 1], ease: ease.bouncy, duration: 500 });
  }, [track.id]);

  // The wheel sets the volume anywhere on the stage, except over lyrics, which scroll.
  useEffect(() => {
    const el = root.current;
    const onWheel = (e) => {
      if (e.target.closest('.lyr-scroll')) return;
      e.preventDefault();
      const p = usePlayer.getState();
      const delta = e.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP;
      p.setVolume(Math.max(0, Math.min(1, Math.round((p.volume + delta) * 100) / 100)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const close = () => {
    animate(root.current, { opacity: 0, scale: 1.04, duration: 220, ease: 'in(2)', onComplete: () => setStage(false) });
  };

  return (
    <div className="stage" ref={root}>
      <div className="stage-bg" style={{ backgroundImage: track.thumb ? `url("${track.thumb}")` : undefined }} />
      <div className="stage-shade" />
      <div className="stage-top-gradient" />
      <div className="stage-top-drag" />
      <button className="icon-btn circle glass stage-close" onClick={close} title="닫기 (Esc)"><ChevronDown size={22} /></button>

      <div className={`stage-main ${showLyrics ? 'with-lyrics' : ''}`}>
        <Turntable track={track} playing={playing} />

        <div className={`stage-info ${showLyrics ? 'with-lyrics' : ''}`}>
          <div className="stage-header" data-rise>
            <span className="stage-kicker">{contextName || '지금 재생 중'}</span>
            <h1 title={track.title}>{track.title}</h1>
            <div className="stage-artist"><ArtistLinks artists={track.artists} /></div>
            <div className="stage-actions">
              <LikeButton track={track} size={22} />
              <DownloadButton track={track} size={22} />
              <button
                className={`icon-btn circle glass ${showLyrics ? 'on' : ''}`}
                onClick={toggleLyrics}
                title={showLyrics ? '가사 끄기' : '가사 보기'}
              >
                <Mic2 size={20} />
              </button>
            </div>
          </div>

          {showLyrics && <LyricsView key={track.id} track={track} variant="stage" />}

          <StageProgress fallbackDuration={track.duration} />
          <StageControls />
        </div>
      </div>

      {!showLyrics && <UpNext />}
    </div>
  );
}

export default function Stage() {
  const track = usePlayer((s) => s.queue[s.index]);
  return track ? <StageView track={track} /> : null;
}
