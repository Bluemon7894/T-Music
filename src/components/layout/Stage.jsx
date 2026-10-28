// Fullscreen "stage": a spinning 3D vinyl with the cover as its label, a ring
// visualizer around it, and the up-next strip. Esc or the button closes it.
import { useEffect, useLayoutEffect, useRef } from 'react';
import { ChevronDown, Shuffle, SkipBack, SkipForward, Repeat, Repeat1 } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { Thumb, ArtistLinks, PlayButton } from '../common.jsx';
import { LikeButton } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import Visualizer from '../Visualizer.jsx';
import { Slider } from './PlayerDock.jsx';
import { fmtTime } from '../../lib/util.js';
import { animate, createTimeline, ease, stagger, useTilt } from '../../lib/motion.js';

export default function Stage() {
  const p = usePlayer();
  const setStage = useUI((s) => s.setStage);
  const track = p.queue[p.index];
  const root = useRef(null);
  const disc = useRef(null);
  const tilt = useRef(null);
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
    return () => window.removeEventListener('keydown', onKey);
  }, [setStage]);

  // New track: drop the record back in with a bounce.
  useEffect(() => {
    if (disc.current) animate(disc.current, { scale: [0.85, 1], ease: ease.bouncy });
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
      <button className="icon-btn circle glass stage-close" onClick={close} title="닫기 (Esc)"><ChevronDown size={22} /></button>

      <div className="stage-main">
        <div className="stage-disc-wrap" ref={tilt}>
          <Visualizer variant="ring" bars={96} className="stage-ring" />
          <div className={`stage-disc ${p.playing ? 'spinning' : ''}`} ref={disc}>
            <div className="vinyl-grooves" />
            <div className="vinyl-label"><Thumb src={track.thumb} /></div>
            <div className="vinyl-hole" />
          </div>
          <div className={`tonearm ${p.playing ? 'on' : ''}`}><i /></div>
        </div>

        <div className="stage-info">
          <span className="stage-kicker" data-rise>{p.context?.name || '지금 재생 중'}</span>
          <h1 data-rise>{track.title}</h1>
          <div className="stage-artist" data-rise><ArtistLinks artists={track.artists} /></div>
          <div className="stage-actions" data-rise>
            <LikeButton track={track} size={22} />
            <DownloadButton track={track} size={22} />
          </div>
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

      {upcoming.length > 0 && (
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
