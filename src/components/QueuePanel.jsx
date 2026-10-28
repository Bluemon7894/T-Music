import { X, Radio } from 'lucide-react';
import { usePlayer } from '../store/player.js';
import { useUI } from '../store/ui.js';
import { Thumb, ArtistLinks } from './common.jsx';
import { trackMenuItems } from './TrackList.jsx';
import { fmtTime } from '../util.js';

function Row({ track, onPlay, current, menu }) {
  const openMenu = useUI((s) => s.openMenu);
  return (
    <div className={`q-row ${current ? 'current' : ''}`} onDoubleClick={onPlay} onContextMenu={(e) => openMenu(e, menu)}>
      <Thumb src={track.thumb} className="q-thumb" />
      <div className="q-text">
        <div className="q-name">{track.title}</div>
        <ArtistLinks artists={track.artists} className="q-artist" />
      </div>
      <span className="q-dur">{fmtTime(track.duration)}</span>
    </div>
  );
}

export default function QueuePanel() {
  const { queue, index, jumpTo, removeAt, autoplay, toggleAutoplay, context } = usePlayer();
  const toggleQueue = useUI((s) => s.toggleQueue);
  const cur = queue[index];
  const upcoming = queue.map((t, i) => ({ t, i })).slice(index + 1);

  return (
    <aside className="queue panel">
      <div className="q-head">
        <h3>대기열</h3>
        <button className="icon-btn" onClick={toggleQueue} aria-label="닫기"><X size={18} /></button>
      </div>
      <div className="q-body">
        {cur ? (
          <>
            <div className="q-section">지금 재생 중</div>
            <Row track={cur} current menu={trackMenuItems(cur)} />
            {upcoming.length > 0 && <div className="q-section">다음 곡{context?.name ? ` • ${context.name}` : ''}</div>}
            {upcoming.map(({ t, i }) => (
              <Row key={t.id + i} track={t} onPlay={() => jumpTo(i)} menu={trackMenuItems(t, [{ divider: true }, { label: '대기열에서 삭제', icon: X, onClick: () => removeAt(i) }])} />
            ))}
          </>
        ) : (
          <div className="q-empty">대기열이 비어 있습니다</div>
        )}
      </div>
      <div className="q-foot">
        <button className={`autoplay ${autoplay ? 'on' : ''}`} onClick={toggleAutoplay}>
          <Radio size={16} />
          <span>
            <b>자동 재생</b>
            <small>대기열이 끝나면 비슷한 곡을 이어서 재생</small>
          </span>
          <i className="switch" />
        </button>
      </div>
    </aside>
  );
}
