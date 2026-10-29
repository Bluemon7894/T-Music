// Fullscreen "stage": a spinning 3D vinyl with the cover as its label, a ring
// visualizer around it, synchronized real-time lyrics, and the up-next strip. Esc or the button closes it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Shuffle, SkipBack, SkipForward, Repeat, Repeat1, Mic2 } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { api } from '../../lib/api.js';
import { Thumb, ArtistLinks, PlayButton, useLyricsSync, SyncControl } from '../common.jsx';
import { LikeButton } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import Visualizer from '../Visualizer.jsx';
import { Slider } from './PlayerDock.jsx';
import { fmtTime } from '../../lib/util.js';
import { animate, createTimeline, ease, stagger, useTilt } from '../../lib/motion.js';

function StageLyrics({ track }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { offset, adjust, reset } = useLyricsSync(track?.id);
  const currentTime = usePlayer((s) => s.time);
  const seek = usePlayer((s) => s.seek);
  const activeLineRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    if (!track?.id) { setLoading(false); return; }
    api.lyrics(track)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [track?.id]);

  const lines = data?.lines || [];
  const activeIdx = lines.length > 0
    ? lines.reduce((best, l, i) => (l.time + offset <= currentTime + 0.1 ? i : best), -1)
    : -1;

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx]);

  if (loading) {
    return (
      <div className="stage-lyrics-sk">
        <div className="sk" style={{ width: '45%' }} />
        <div className="sk" style={{ width: '75%' }} />
        <div className="sk" style={{ width: '38%' }} />
        <div className="sk" style={{ width: '65%' }} />
        <div className="sk" style={{ width: '58%' }} />
        <div className="sk" style={{ width: '72%' }} />
      </div>
    );
  }

  const hasLyrics = lines.length > 0 || !!data?.plainLyrics;
  if (!hasLyrics) {
    return (
      <div className="stage-lyrics-empty">
        <Mic2 size={36} opacity={0.35} />
        <p>가사가 제공되지 않는 곡입니다</p>
      </div>
    );
  }

  return (
    <div className="stage-lyrics-wrapper">
      {lines.length > 0 && <SyncControl offset={offset} onAdjust={adjust} onReset={reset} />}
      <div className="stage-lyrics-container" ref={containerRef}>
        {lines.length > 0 ? (
          <div className="stage-lyrics-lines">
            {lines.map((l, i) => {
              const isActive = i === activeIdx;
              return (
                <div
                  key={l.time + '-' + i}
                  ref={isActive ? activeLineRef : null}
                  className={`stage-lyrics-line ${isActive ? 'active' : ''}`}
                  onClick={() => seek(Math.max(0, l.time + offset))}
                >
                  {l.text || '...'}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="stage-lyrics-plain">{data.plainLyrics}</div>
        )}
      </div>
    </div>
  );
}

export default function Stage() {
  const p = usePlayer();
  const setStage = useUI((s) => s.setStage);
  const track = p.queue[p.index];
  const root = useRef(null);
  const disc = useRef(null);
  const tilt = useRef(null);
  const [showLyrics, setShowLyrics] = useState(() => {
    try { return localStorage.getItem('t-music-stage-lyrics') !== '0'; } catch { return true; }
  });

  const toggleLyrics = () => {
    setShowLyrics((prev) => {
      const next = !prev;
      try { localStorage.setItem('t-music-stage-lyrics', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  useTilt(tilt, { max: 10, scale: 1 });

  useLayoutEffect(() => {
    const el = root.current;
    createTimeline({ defaults: { ease: ease.soft } })
      .add(el, { opacity: [0, 1], duration: 260, ease: 'out(2)' })
      .add(el.querySelector('.stage-disc-wrap'), { rotateX: [55, 0], translateZ: [-300, 0], scale: [0.6, 1] }, 60)
      .add(el.querySelectorAll('[data-rise]'), { opacity: [0, 1], translateY: [30, 0], delay: stagger(50) }, 160);
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setStage(false);
    window.addEventListener('keydown', onKey);
    api.setTitleBarOverlay({ color: 'rgba(0, 0, 0, 0)', symbolColor: '#c4b5fd' }).catch(() => {});
    return () => window.removeEventListener('keydown', onKey);
  }, [setStage]);

  // New track: drop the record back in with a bounce.
  useEffect(() => {
    const deck = root.current?.querySelector('.turntable-deck');
    if (deck) animate(deck, { scale: [0.94, 1], ease: ease.bouncy, duration: 400 });
  }, [track?.id]);

  const close = () => {
    animate(root.current, { opacity: 0, scale: 1.04, duration: 220, ease: 'in(2)', onComplete: () => setStage(false) });
  };

  if (!track) return null;
  const duration = p.duration || track.duration || 0;
  const upcoming = p.queue.slice(p.index + 1, p.index + 9);

  return (
    <div className="stage" ref={root}>
      <div className="stage-bg" style={{ backgroundImage: track.thumb ? `url("${track.thumb}")` : undefined }} />
      <div className="stage-shade" />
      <div className="stage-top-gradient" />
      <div className="stage-top-drag" />
      <button className="icon-btn circle glass stage-close" onClick={close} title="닫기 (Esc)"><ChevronDown size={22} /></button>
      <button
        className={`icon-btn circle glass stage-lyrics-toggle ${showLyrics ? 'on' : ''}`}
        onClick={toggleLyrics}
        title={showLyrics ? '가사 끄기' : '가사 보기'}
      >
        <Mic2 size={20} />
      </button>

      <div className={`stage-main ${showLyrics ? 'with-lyrics' : ''}`}>
        <div className="stage-disc-wrap" ref={tilt}>
          <Visualizer variant="ring" bars={96} className="stage-ring" />
          <div className="turntable-deck">
            <div className="turntable-platter">
              <div className={`platter-strobe ${p.playing ? 'spinning' : ''}`} />
            </div>
            <div className={`stage-disc ${p.playing ? 'spinning' : ''}`} ref={disc}>
              <div className="vinyl-grooves" />
              <div className="vinyl-sheen" />
              <div className="vinyl-label"><Thumb src={track.thumb} /></div>
              <div className="vinyl-hole" />
            </div>
            <div className={`tonearm ${p.playing ? 'on' : 'resting'}`}><i /></div>
            <div className="turntable-indicator">
              <span className={`turntable-indicator-dot ${p.playing ? 'on' : ''}`} />
              <span>33 RPM</span>
            </div>
          </div>
        </div>

        <div className={`stage-info ${showLyrics ? 'with-lyrics' : ''}`}>
          <div className="stage-header" data-rise>
            <span className="stage-kicker">{p.context?.name || '지금 재생 중'}</span>
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

          {showLyrics && <StageLyrics track={track} />}

          <div className="stage-progress" data-rise>
            <Slider className="seek" value={p.time} max={duration} buffered={p.buffered} onCommit={(v) => p.seek(v)} />
            <div className="stage-times"><span>{fmtTime(p.time)}</span><span>-{fmtTime(Math.max(0, duration - p.time))}</span></div>
          </div>
          <div className="stage-controls" data-rise>
            <button className={`icon-btn toggle ${p.shuffle ? 'on' : ''}`} onClick={p.toggleShuffle}><Shuffle size={20} /></button>
            <button className="icon-btn" onClick={p.prev}><SkipBack size={28} fill="currentColor" /></button>
            <PlayButton size={72} playing={p.playing} onClick={p.toggle} />
            <button className="icon-btn" onClick={() => p.next()}><SkipForward size={28} fill="currentColor" /></button>
            <button className={`icon-btn toggle ${p.repeat !== 'off' ? 'on' : ''}`} onClick={p.cycleRepeat}>{p.repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}</button>
          </div>
        </div>
      </div>

      {!showLyrics && upcoming.length > 0 && (
        <div className="stage-next" data-rise>
          <span className="stage-next-label">다음 곡</span>
          <div className="stage-next-row">
            {upcoming.map((t, i) => (
              <button key={t.id + i} className="stage-next-item" onClick={() => p.jumpTo(p.index + 1 + i)}>
                <Thumb src={t.thumb} />
                <span><b>{t.title}</b><small>{t.artists?.map((a) => a.name).join(', ')}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
