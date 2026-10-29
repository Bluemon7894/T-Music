import { useEffect, useRef, useState } from 'react';
import { Radio, X, Maximize2, ListMusic, Sparkles, Mic2 } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { useLibrary } from '../../store/library.js';
import { api } from '../../lib/api.js';
import { Thumb, ArtistLinks, Equalizer, useAutoLyricsSync } from '../common.jsx';
import { LikeButton, trackMenuItems } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import Visualizer from '../Visualizer.jsx';
import { fmtTime } from '../../lib/util.js';
import { useTilt, animate, ease } from '../../lib/motion.js';
import logo from '../../assets/logo-mark.png';

function QueueRow({ track, onPlay, current, menu, index }) {
  const openMenu = useUI((s) => s.openMenu);
  const playing = usePlayer((s) => s.playing);
  return (
    <div className={`q-row ${current ? 'current' : ''}`} onDoubleClick={onPlay} onContextMenu={(e) => openMenu(e, menu)}>
      <span className="q-idx">{current ? <Equalizer playing={playing} /> : index}</span>
      <Thumb src={track.thumb} className="q-thumb" />
      <div className="q-text">
        <div className="q-name">{track.title}</div>
        <ArtistLinks artists={track.artists} className="q-artist" />
      </div>
      <span className="q-dur">{fmtTime(track.duration)}</span>
    </div>
  );
}

function NowCard({ track }) {
  const art = useRef(null);
  const setStage = useUI((s) => s.setStage);
  useTilt(art, { max: 14, scale: 1.02 });

  // Flip the cover in 3D whenever the track changes.
  useEffect(() => {
    if (art.current) animate(art.current.querySelector('.thumb'), { rotateY: [-90, 0], opacity: [0, 1], ease: ease.bouncy });
  }, [track.id]);

  return (
    <div className="now-card">
      <div className="now-art" ref={art} onClick={() => setStage(true)}>
        <Thumb src={track.thumb} />
        <span className="glare" />
        <span className="now-art-hint"><Maximize2 size={16} /> 크게 보기</span>
      </div>
      <div className="now-meta">
        <div className="now-text">
          <h3 title={track.title}>{track.title}</h3>
          <ArtistLinks artists={track.artists} className="now-artist" />
        </div>
        <LikeButton track={track} size={19} />
        <DownloadButton track={track} size={19} />
      </div>
      <Visualizer variant="bars" bars={42} className="now-viz" />
    </div>
  );
}

function Idle() {
  const recent = useLibrary((s) => s.recent.length);
  return (
    <div className="now-idle">
      <div className="idle-orb"><img src={logo} alt="" /></div>
      <h3>{recent ? '다시 들어볼까요?' : '음악을 시작해 보세요'}</h3>
      <p>곡을 더블클릭하거나 카드의 재생 버튼을 누르면 여기에서 앨범 아트, 비주얼라이저, 다음 곡을 볼 수 있어요.</p>
      <ul className="idle-tips">
        <li><kbd>Space</kbd> 재생 / 일시정지</li>
        <li><kbd>Ctrl</kbd> <kbd>K</kbd> 검색</li>
        <li><kbd>Ctrl</kbd> <kbd>→</kbd> 다음 곡</li>
      </ul>
    </div>
  );
}

function LyricsView({ track }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const autoOffset = useAutoLyricsSync(track, data);
  const seek = usePlayer((s) => s.seek);
  const playing = usePlayer((s) => s.playing);
  const activeLineRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    api.lyrics(track)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [track?.id]);

  const lines = data?.lines || [];

  // Real-time 60fps RAF sync loop with automatic offset compensation
  useEffect(() => {
    if (!lines.length) {
      setActiveIdx(-1);
      return;
    }

    let rafId;
    const checkSync = () => {
      const t = usePlayer.getState().getPreciseTime();
      let best = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].time + autoOffset <= t + 0.05) {
          best = i;
        } else {
          break;
        }
      }
      setActiveIdx((prev) => (prev !== best ? best : prev));
      if (usePlayer.getState().playing) {
        rafId = requestAnimationFrame(checkSync);
      }
    };

    checkSync();
    if (playing) {
      rafId = requestAnimationFrame(checkSync);
    }
    return () => cancelAnimationFrame(rafId);
  }, [lines, autoOffset, playing]);

  useEffect(() => {
    const activeLine = activeLineRef.current;
    if (activeLine) {
      const container = activeLine.closest('.np-body');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const lineRect = activeLine.getBoundingClientRect();
        const currentScrollTop = container.scrollTop;
        const targetScrollTop =
          currentScrollTop +
          (lineRect.top - containerRect.top) -
          containerRect.height / 2 +
          lineRect.height / 2;
        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        });
      }
    }
  }, [activeIdx]);

  if (loading) {
    return (
      <div className="lyrics-sk">
        <div className="sk" style={{ width: '60%' }} />
        <div className="sk" style={{ width: '85%' }} />
        <div className="sk" style={{ width: '45%' }} />
        <div className="sk" style={{ width: '75%' }} />
        <div className="sk" style={{ width: '65%' }} />
        <div className="sk" style={{ width: '80%' }} />
      </div>
    );
  }

  const hasLyrics = lines.length > 0 || !!data?.plainLyrics;
  if (!hasLyrics) {
    return (
      <div className="lyrics-empty">
        <Mic2 size={32} opacity={0.35} />
        <p>가사가 제공되지 않는 곡입니다</p>
      </div>
    );
  }

  return (
    <div className="lyrics-view">
      <div className="lyrics-meta">
        <h3>{track.title}</h3>
        <p>{track.artists?.map((a) => a.name).join(', ')}</p>
      </div>
      {lines.length > 0 ? (
        <div className="lyrics-lines">
          {lines.map((l, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={l.time + '-' + i}
                ref={isActive ? activeLineRef : null}
                className={`lyrics-line ${isActive ? 'active' : ''}`}
                onClick={() => seek(Math.max(0, l.time + autoOffset))}
              >
                {l.text || '...'}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="stage-lyrics-plain-box" style={{ padding: '4px 6px' }}>
          <div className="lyrics-plain">{data.plainLyrics}</div>
        </div>
      )}
    </div>
  );
}

export default function NowPanel() {
  const { queue, index, jumpTo, removeAt, autoplay, toggleAutoplay, context } = usePlayer();
  const panelTab = useUI((s) => s.panelTab);
  const setPanelTab = useUI((s) => s.setPanelTab);
  const togglePanel = useUI((s) => s.togglePanel);
  const cur = queue[index];
  const upcoming = queue.map((t, i) => ({ t, i })).slice(index + 1);
  const manualUpcoming = upcoming.filter(({ t }) => !t.isAutoplay);
  const autoUpcoming = upcoming.filter(({ t }) => t.isAutoplay);

  return (
    <aside className="now-panel">
      <div className="np-head">
        <div className="seg">
          <button className={panelTab === 'next' ? 'on' : ''} onClick={() => setPanelTab('next')}><Sparkles size={14} /> 지금 재생</button>
          <button className={panelTab === 'queue' ? 'on' : ''} onClick={() => setPanelTab('queue')}><ListMusic size={14} /> 대기열</button>
          <button className={panelTab === 'lyrics' ? 'on' : ''} onClick={() => setPanelTab('lyrics')}><Mic2 size={14} /> 가사</button>
        </div>
        <button className="icon-btn circle" onClick={togglePanel} aria-label="패널 닫기"><X size={16} /></button>
      </div>

      <div className="np-body">
        {!cur && <Idle />}
        {cur && panelTab === 'lyrics' && <LyricsView track={cur} />}
        {cur && panelTab === 'next' && (
          <>
            <NowCard track={cur} />
            {manualUpcoming.length > 0 && (
              <>
                <div className="np-section">
                  <span>다음 곡</span>
                  {context?.name && <small>{context.name}</small>}
                </div>
                {manualUpcoming.slice(0, 6).map(({ t, i }) => (
                  <QueueRow key={t.id + i} index={i - index} track={t} onPlay={() => jumpTo(i)} menu={trackMenuItems(t)} />
                ))}
              </>
            )}
            {autoUpcoming.length > 0 && (
              <>
                <div className="np-section auto-section">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={13} style={{ color: 'var(--accent)' }} /> 추천곡 자동 재생
                  </span>
                  <small>{autoUpcoming.length}곡</small>
                </div>
                {autoUpcoming.slice(0, manualUpcoming.length > 0 ? Math.max(2, 6 - manualUpcoming.length) : 6).map(({ t, i }) => (
                  <QueueRow key={t.id + i} index={i - index} track={t} onPlay={() => jumpTo(i)} menu={trackMenuItems(t)} />
                ))}
              </>
            )}
            {upcoming.length > 6 && <button className="text-btn block" onClick={() => setPanelTab('queue')}>대기열 전체 보기 ({upcoming.length}곡)</button>}
            {!upcoming.length && <p className="np-hint">{autoplay ? '이 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 마지막 곡입니다. (자동 재생 꺼짐)'}</p>}
            {manualUpcoming.length > 0 && !autoUpcoming.length && (
              <p className="np-hint" style={{ fontSize: '11.5px', marginTop: 8 }}>
                {autoplay ? '대기열의 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 곡이 끝나면 재생이 정지됩니다.'}
              </p>
            )}
          </>
        )}
        {cur && panelTab === 'queue' && (
          <>
            <div className="np-section"><span>지금 재생 중</span></div>
            <QueueRow track={cur} current index={1} menu={trackMenuItems(cur)} />
            {manualUpcoming.length > 0 && (
              <>
                <div className="np-section"><span>다음 곡</span><small>{manualUpcoming.length}곡</small></div>
                {manualUpcoming.map(({ t, i }) => (
                  <QueueRow key={t.id + i} index={i - index} track={t} onPlay={() => jumpTo(i)} menu={trackMenuItems(t, [{ divider: true }, { label: '대기열에서 삭제', icon: X, onClick: () => removeAt(i) }])} />
                ))}
              </>
            )}
            {autoUpcoming.length > 0 && (
              <>
                <div className="np-section auto-section">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={13} style={{ color: 'var(--accent)' }} /> 추천곡 자동 재생
                  </span>
                  <small>{autoUpcoming.length}곡</small>
                </div>
                {autoUpcoming.map(({ t, i }) => (
                  <QueueRow key={t.id + i} index={i - index} track={t} onPlay={() => jumpTo(i)} menu={trackMenuItems(t, [{ divider: true }, { label: '대기열에서 삭제', icon: X, onClick: () => removeAt(i) }])} />
                ))}
              </>
            )}
            {!upcoming.length && <p className="np-hint">{autoplay ? '이 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 마지막 곡입니다. (자동 재생 꺼짐)'}</p>}
            {manualUpcoming.length > 0 && !autoUpcoming.length && (
              <p className="np-hint" style={{ fontSize: '11.5px', marginTop: 8 }}>
                {autoplay ? '대기열의 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 곡이 끝나면 재생이 정지됩니다.'}
              </p>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        className={`autoplay ${autoplay ? 'on' : ''}`}
        onClick={toggleAutoplay}
        title={autoplay ? '추천곡 자동 재생 끄기' : '추천곡 자동 재생 켜기'}
      >
        <Radio size={16} />
        <span><b>자동 재생</b><small>대기열이 끝나면 비슷한 곡 이어 듣기</small></span>
        <i className="switch" />
      </button>
    </aside>
  );
}
