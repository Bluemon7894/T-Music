// The full-screen player. On a phone it also holds what desktop keeps in the side panel: lyrics and
// the queue are tabs here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ListMusic, Mic2, MoreHorizontal, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Sparkles } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { useNav } from '../../store/nav.js';
import { animate } from '../../lib/motion.js';
import { ArtistLinks, PlayButton } from '../common.jsx';
import { LikeButton, trackMenuItems } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import Visualizer from '../Visualizer.jsx';
import LyricsView from '../layout/LyricsView.jsx';
import Deck from '../layout/Deck.jsx';
import { QueueList, AutoplayToggle } from '../layout/NowPanel.jsx';
import { NextTrack, StageProgress } from '../layout/Stage.jsx';
import { tr } from '../../lib/i18n.js';

const TABS = [
  { id: 'now', label: tr('지금 재생'), icon: Sparkles },
  { id: 'lyrics', label: tr('가사'), icon: Mic2 },
  { id: 'queue', label: tr('대기열'), icon: ListMusic },
];

const savedTab = () => {
  try { return localStorage.getItem('t-music-stage-tab') || 'now'; } catch { return 'now'; }
};

function Controls() {
  const playing = usePlayer((s) => s.playing);
  const loading = usePlayer((s) => s.loading);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { toggle, next, prev, toggleShuffle, cycleRepeat } = usePlayer.getState();
  return (
    <div className="stage-controls m-stage-controls">
      <button className={`icon-btn toggle ${shuffle ? 'on' : ''}`} onClick={toggleShuffle} aria-label={tr('셔플')}><Shuffle size={22} /></button>
      <button className="icon-btn" onClick={prev} aria-label={tr('이전 곡')}><SkipBack size={30} fill="currentColor" /></button>
      <PlayButton size={68} playing={playing} onClick={toggle} className={loading && playing ? 'dock-play loading' : ''} />
      <button className="icon-btn" onClick={() => next()} aria-label={tr('다음 곡')}><SkipForward size={30} fill="currentColor" /></button>
      <button className={`icon-btn toggle ${repeat !== 'off' ? 'on' : ''}`} onClick={cycleRepeat} aria-label={tr('반복')}>{repeat === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}</button>
    </div>
  );
}

function StageView({ track }) {
  const setStage = useUI((s) => s.setStage);
  const openMenu = useUI((s) => s.openMenu);
  const playing = usePlayer((s) => s.playing);
  const navIndex = useNav((s) => s.index);
  const [tab, setTab] = useState(savedTab);
  const root = useRef(null);
  const openedAt = useRef(navIndex);

  const choose = (next) => {
    setTab(next);
    try { localStorage.setItem('t-music-stage-tab', next); } catch { /* ignore */ }
  };

  useLayoutEffect(() => {
    animate(root.current, { translateY: ['100%', '0%'], duration: 320, ease: 'out(3)' });
  }, []);

  // Going to an artist or album from here means leaving the player.
  useEffect(() => {
    if (navIndex !== openedAt.current) setStage(false);
  }, [navIndex, setStage]);

  const close = () => {
    animate(root.current, { translateY: '100%', duration: 220, ease: 'in(2)', onComplete: () => setStage(false) });
  };

  return (
    <div className="stage m-stage" ref={root}>
      <div className="stage-bg" style={{ backgroundImage: track.thumb ? `url("${track.thumb}")` : undefined }} />
      <div className="stage-shade" />

      <header className="m-stage-top">
        <button className="icon-btn circle glass" onClick={close} aria-label={tr('닫기')}><ChevronDown size={22} /></button>
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => choose(t.id)}><t.icon size={14} /> {t.label}</button>
          ))}
        </div>
        <button className="icon-btn circle glass" onClick={(e) => openMenu(e, trackMenuItems(track))} aria-label={tr('더 보기')}><MoreHorizontal size={20} /></button>
      </header>

      <div className={`m-stage-body tab-${tab}`}>
        {tab === 'now' && (
          <>
            <Deck track={track} playing={playing} />
            <Visualizer variant="bars" bars={36} className="now-viz" />
            <NextTrack />
          </>
        )}
        {tab === 'lyrics' && <LyricsView key={track.id} track={track} variant="stage" />}
        {tab === 'queue' && (
          <>
            <div className="np-body"><QueueList /></div>
            <AutoplayToggle />
          </>
        )}
      </div>

      {tab !== 'queue' && (
        <div className="m-stage-meta">
          <div className="m-stage-text">
            <h1>{track.title}</h1>
            <ArtistLinks artists={track.artists} className="stage-artist" />
          </div>
          <LikeButton track={track} size={23} />
          <DownloadButton track={track} size={23} />
        </div>
      )}
      <StageProgress fallbackDuration={track.duration} />
      <Controls />
    </div>
  );
}

export default function MobileStage() {
  const track = usePlayer((s) => s.queue[s.index]);
  return track ? <StageView track={track} /> : null;
}
