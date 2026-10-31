import { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, ChevronsUp, Radio, X, Maximize2, ListMusic, Sparkles, Mic2, MoreHorizontal } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { useLibrary } from '../../store/library.js';
import { useRoom } from '../../store/room.js';
import { safeTrack } from '../../lib/safeTrack.js';
import { Thumb, ArtistLinks, Equalizer } from '../common.jsx';
import { LikeButton, trackMenuItems } from '../TrackList.jsx';
import DownloadButton from '../DownloadButton.jsx';
import Visualizer from '../Visualizer.jsx';
import LyricsView from './LyricsView.jsx';
import { fmtTime } from '../../lib/util.js';
import { auth } from '../../lib/firebase.js';
import { useTilt, animate, ease } from '../../lib/motion.js';
import { IS_ANDROID } from '../../lib/platform.js';
import logo from '../../assets/logo-mark.png';

function QueueRow({ track, onPlay, current, menu, index }) {
  const openMenu = useUI((s) => s.openMenu);
  const playing = usePlayer((s) => s.playing);
  return (
    <div className={`q-row ${current ? 'current' : ''}`} onClick={IS_ANDROID ? onPlay : undefined} onDoubleClick={IS_ANDROID ? undefined : onPlay} onContextMenu={(e) => openMenu(e, menu)}>
      <span className="q-idx">{current ? <Equalizer playing={playing} /> : index}</span>
      <Thumb src={track.thumb} className="q-thumb" />
      <div className="q-text">
        <div className="q-name">{track.title}</div>
        <ArtistLinks artists={track.artists} className="q-artist" />
      </div>
      <span className="q-dur">{fmtTime(track.duration)}</span>
      {IS_ANDROID && <button className="icon-btn q-more" onClick={(e) => openMenu(e, menu)} aria-label="더 보기"><MoreHorizontal size={18} /></button>}
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

// While following a room, what plays next comes from the room's shared queue.
function RoomQueueSection() {
  const queue = useRoom((s) => s.queue);
  const uid = auth.currentUser?.uid;
  const isHost = useRoom((s) => s.meta?.hostUid === uid);
  const canReorder = useRoom((s) => s.meta?.hostUid === uid || s.meta?.controlMode === 'everyone');
  const { removeFromQueue, moveInQueue } = useRoom.getState();
  return (
    <>
      <div className="np-section"><span>같이듣기 대기열</span><small>{queue.length}곡</small></div>
      {queue.map((item, i) => {
        const track = safeTrack(item.track);
        if (!track) return null;
        const extra = [
          ...(canReorder && i > 0 ? [{ label: '맨 위로', icon: ChevronsUp, onClick: () => moveInQueue(i, 0) }, { label: '위로', icon: ChevronUp, onClick: () => moveInQueue(i, i - 1) }] : []),
          ...(canReorder && i < queue.length - 1 ? [{ label: '아래로', icon: ChevronDown, onClick: () => moveInQueue(i, i + 1) }] : []),
          ...(isHost || item.by === uid ? [{ divider: true }, { label: '대기열에서 삭제', icon: X, onClick: () => removeFromQueue(item.key) }] : []),
        ];
        return <QueueRow key={item.key} index={i + 1} track={track} menu={trackMenuItems(track, extra)} />;
      })}
      {!queue.length && <p className="np-hint">{IS_ANDROID ? '곡의 ⋯ 버튼으로 대기열에 추가하면 멤버 모두의 다음 곡이 돼요.' : '곡을 우클릭해서 대기열에 추가하면 멤버 모두의 다음 곡이 돼요.'}</p>}
    </>
  );
}

// The queue tab: on desktop in the side panel, on a phone in the full-screen player.
export function QueueList() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const autoplay = usePlayer((s) => s.autoplay);
  const { jumpTo, removeAt } = usePlayer.getState();
  const inRoom = useRoom((s) => s.attached);
  const cur = queue[index];
  const upcoming = queue.map((t, i) => ({ t, i })).slice(index + 1);
  const manualUpcoming = upcoming.filter(({ t }) => !t.isAutoplay);
  const autoUpcoming = upcoming.filter(({ t }) => t.isAutoplay);
  if (!cur) return null;

  return (
    <>
      <div className="np-section"><span>지금 재생 중</span></div>
      <QueueRow track={cur} current index={1} menu={trackMenuItems(cur)} />
      {inRoom && <RoomQueueSection />}
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
      {!inRoom && !upcoming.length && <p className="np-hint">{autoplay ? '이 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 마지막 곡입니다. (자동 재생 꺼짐)'}</p>}
      {manualUpcoming.length > 0 && !autoUpcoming.length && (
        <p className="np-hint" style={{ fontSize: '11.5px', marginTop: 8 }}>
          {autoplay ? '대기열의 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 곡이 끝나면 재생이 정지됩니다.'}
        </p>
      )}
    </>
  );
}

export function AutoplayToggle() {
  const autoplay = usePlayer((s) => s.autoplay);
  const toggleAutoplay = usePlayer((s) => s.toggleAutoplay);
  return (
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
  );
}

export default function NowPanel() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const autoplay = usePlayer((s) => s.autoplay);
  const contextName = usePlayer((s) => s.context?.name);
  const { jumpTo } = usePlayer.getState();
  const inRoom = useRoom((s) => s.attached);
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
        {cur && panelTab === 'lyrics' && <LyricsView key={cur.id} track={cur} />}
        {cur && panelTab === 'next' && (
          <>
            <NowCard track={cur} />
            {inRoom && <RoomQueueSection />}
            {manualUpcoming.length > 0 && (
              <>
                <div className="np-section">
                  <span>다음 곡</span>
                  {contextName && <small>{contextName}</small>}
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
            {!inRoom && !upcoming.length && <p className="np-hint">{autoplay ? '이 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 마지막 곡입니다. (자동 재생 꺼짐)'}</p>}
            {manualUpcoming.length > 0 && !autoUpcoming.length && (
              <p className="np-hint" style={{ fontSize: '11.5px', marginTop: 8 }}>
                {autoplay ? '대기열의 곡이 끝나면 비슷한 곡을 이어서 재생해요.' : '대기열의 곡이 끝나면 재생이 정지됩니다.'}
              </p>
            )}
          </>
        )}
        {cur && panelTab === 'queue' && <QueueList />}
      </div>

      <AutoplayToggle />
    </aside>
  );
}
