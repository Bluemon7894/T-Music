// The full-screen player. On a phone it also holds what desktop keeps in the side panel: lyrics and
// the queue are tabs here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ListMusic, Mic2, MoreHorizontal, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Music2, Bookmark, BookmarkCheck } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useRadio } from '../../store/radio.js';
import { useLibrary } from '../../store/library.js';
import { BANDS } from '../RadioDial.jsx';
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
  { id: 'now', label: tr('지금 재생'), icon: Music2 },
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

// The phone's full-screen radio: the radio set, the channel and channel controls.
function RadioView() {
  const setStage = useUI((s) => s.setStage);
  const station = useRadio((s) => s.station);
  const phase = useRadio((s) => s.phase);
  const buffering = useRadio((s) => s.buffering);
  const saved = useLibrary((s) => Boolean(station) && s.savedStations.some((x) => x.id === station.id));
  const { toggle, step, toggleSave } = useRadio.getState();
  const root = useRef(null);
  useLayoutEffect(() => {
    animate(root.current, { translateY: ['100%', '0%'], duration: 320, ease: 'out(3)' });
  }, []);
  const close = () => animate(root.current, { translateY: '100%', duration: 220, ease: 'in(2)', onComplete: () => setStage(false) });
  const band = BANDS[station?.band || 'FM'];
  return (
    <div className="stage m-stage" ref={root}>
      <div className="stage-bg" style={{ backgroundImage: station?.logo ? `url("${station.logo}")` : undefined }} />
      <div className="stage-shade" />
      <header className="m-stage-top">
        <button className="icon-btn circle glass" onClick={close} aria-label={tr('닫기')}><ChevronDown size={22} /></button>
        <span className="m-stage-radio-label">{tr('라디오')}</span>
        <span />
      </header>
      <div className="m-stage-body tab-now"><Deck /></div>
      <div className="m-stage-meta">
        <div className="m-stage-text">
          <h1>{station?.name || tr('라디오')}</h1>
          <span className="stage-artist">{station ? `${band.fmt(station.freq)} ${station.band}` : ''}{buffering && phase === 'on' ? ` · ${tr('연결 중…')}` : ''}</span>
        </div>
        <button className={`icon-btn like ${saved ? 'on' : ''}`} onClick={toggleSave} aria-label={tr('주파수 저장')}>
          {saved ? <BookmarkCheck size={23} /> : <Bookmark size={23} />}
        </button>
      </div>
      <div className="stage-controls m-stage-controls">
        <button className="icon-btn" onClick={() => step(-1)} aria-label={tr('이전 채널')}><SkipBack size={30} fill="currentColor" /></button>
        <PlayButton size={70} playing={phase !== 'ending'} onClick={toggle} />
        <button className="icon-btn" onClick={() => step(1)} aria-label={tr('다음 채널')}><SkipForward size={30} fill="currentColor" /></button>
      </div>
    </div>
  );
}

export default function MobileStage() {
  const track = usePlayer((s) => s.queue[s.index]);
  const radio = useRadio((s) => s.on);
  if (radio) return <RadioView />;
  return track ? <StageView track={track} /> : null;
}
