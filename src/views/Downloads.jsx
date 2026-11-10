import { useRef, useState } from 'react';
import { ArrowDownToLine, FolderOpen, HardDrive, Power, RefreshCw, Search, X, RotateCw, Trash2, WifiOff } from 'lucide-react';
import { useDownloads, cancelDownload, retryDownload, removeDownload, openDownloads } from '../store/downloads.js';
import { usePlayer } from '../store/player.js';
import { chooseMusicFolder, enableLocalMusic, refreshLocalMusic, useLocalMusic } from '../store/localMusic.js';
import { useNav } from '../store/nav.js';
import { useUI } from '../store/ui.js';
import { fmtBytes, totalTime } from '../lib/util.js';
import { useEnter } from '../lib/motion.js';
import { dropOnDownloads, useDrop } from '../lib/drag.js';
import { IS_ANDROID, THIS_DEVICE } from '../lib/platform.js';
import { Thumb, PlayButton, Empty } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { tr } from '../lib/i18n.js';

function JobRow({ job }) {
  const pct = job.total ? Math.round((job.received / job.total) * 100) : 0;
  const t = job.track;
  return (
    <div className={`job ${job.status}`} data-enter>
      <Thumb src={t.thumb} className="job-thumb" />
      <div className="job-main">
        <div className="job-top">
          <b>{t.title}</b>
          <span>{job.status === 'queued' ? tr('대기 중') : job.status === 'error' ? tr('실패') : `${pct}% · ${fmtBytes(job.received)}${job.total ? ` / ${fmtBytes(job.total)}` : ''}`}</span>
        </div>
        <div className="job-bar"><i style={{ width: `${job.status === 'error' ? 100 : pct}%` }} /></div>
        {job.error && <small className="job-err">{job.error}</small>}
      </div>
      {job.status === 'error'
        ? <button className="icon-btn circle" title={tr('다시 시도')} onClick={() => retryDownload(t.id)}><RotateCw size={16} /></button>
        : null}
      <button className="icon-btn circle" title={tr('취소')} onClick={() => cancelDownload(t.id)}><X size={16} /></button>
    </div>
  );
}

const forSearch = (text) => String(text || '').normalize('NFKD').toLowerCase();

// Music already on this device, whatever put it there. It plays like the rest but stays on this device.
function LocalMusic() {
  const { enabled, folder, tracks, busy, loaded } = useLocalMusic();
  const [query, setQuery] = useState('');
  if (!loaded) return null;
  const context = { name: tr('내 기기 음악') };
  if (!enabled) {
    return (
      <section className="local-music" data-enter>
        <h2><HardDrive size={18} />{' '}{tr('내 기기 음악')}</h2>
        <div className="local-music-off">
          <p>{IS_ANDROID
            ? tr('다른 앱으로 받거나 옮겨 둔 음악 파일도 여기서 들을 수 있어요. 폰의 음악 파일을 읽을 권한이 필요해요.')
            : tr('컴퓨터에 있는 음악 파일도 여기서 들을 수 있어요. 처음에는 음악 폴더를 읽어요.')}</p>
          <p className="muted small">{tr('이 기기에서만 재생되고, 최근 재생과 청취 기록에는 남지 않아요. 같이 듣기 방에서는 틀 수 없어요.')}</p>
          <div className="row-btns">
            <button className="btn grad" disabled={busy} onClick={() => enableLocalMusic(true)}><HardDrive size={15} />{' '}{busy ? tr('불러오는 중...') : tr('내 기기 음악 불러오기')}</button>
            {!IS_ANDROID && <button className="btn" disabled={busy} onClick={chooseMusicFolder}><FolderOpen size={15} />{' '}{tr('폴더 고르기')}</button>}
          </div>
        </div>
      </section>
    );
  }
  const wanted = forSearch(query.trim());
  const shown = wanted ? tracks.filter((t) => forSearch(`${t.title} ${(t.artists || []).map((a) => a.name).join(' ')} ${t.album?.name || ''}`).includes(wanted)) : tracks;
  return (
    <section className="local-music">
      <h2 data-enter><HardDrive size={18} />{' '}{tr('내 기기 음악')}{' '}<small className="count">{tracks.length}</small></h2>
      <div className="local-music-bar" data-enter>
        {!IS_ANDROID && folder && <span className="local-music-folder muted small" title={folder}>{folder}</span>}
        <div className="row-btns">
          {shown.length > 0 && <PlayButton size={40} onClick={() => usePlayer.getState().playList(shown, 0, context)} />}
          {!IS_ANDROID && <button className="btn" disabled={busy} onClick={chooseMusicFolder}><FolderOpen size={15} />{' '}{tr('폴더 바꾸기')}</button>}
          <button className="btn" disabled={busy} onClick={refreshLocalMusic}><RefreshCw size={15} className={busy ? 'spin' : ''} />{' '}{tr('새로고침')}</button>
          <button className="btn" disabled={busy} onClick={() => enableLocalMusic(false)}><Power size={15} />{' '}{tr('끄기')}</button>
        </div>
      </div>
      {tracks.length > 20 && (
        <label className="local-music-search" data-enter>
          <Search size={15} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('제목, 가수, 앨범으로 찾기')} />
        </label>
      )}
      {tracks.length === 0
        ? <p className="muted" data-enter>{IS_ANDROID ? tr('폰에서 음악 파일을 찾지 못했어요.') : tr('이 폴더에서 음악 파일을 찾지 못했어요.')}</p>
        : <TrackList tracks={shown} context={context} animate={false} />}
    </section>
  );
}

export default function Downloads() {
  const { items, jobs, totalSize } = useDownloads();
  const localOn = useLocalMusic((s) => s.enabled && s.tracks.length > 0);
  const go = useNav((s) => s.go);
  const ref = useRef(null);
  useEnter(ref, [jobs.length > 0, items.length > 0]);
  const context = { name: tr('다운로드한 곡') };
  const { over, dropProps } = useDrop(dropOnDownloads);

  return (
    <div className={`page downloads ${over ? 'playlist-drag-over' : ''}`} ref={ref} {...dropProps}>
      <div className="dl-hero" data-enter>
        <div className="dl-hero-icon"><ArrowDownToLine size={40} /></div>
        <div className="dl-hero-text">
          <span className="ph-kind">{tr('오프라인 보관함')}</span>
          <h1>{tr('다운로드')}</h1>
          <p>{tr('{0}곡 · {1} · {2}', items.length, totalTime(items), fmtBytes(totalSize))}</p>
          <p className="dl-note"><WifiOff size={14} />{' '}{tr('다운로드한 곡은 인터넷 없이도 재생돼요')}</p>
        </div>
        <div className="dl-hero-actions">
          {items.length > 0 && <PlayButton size={58} onClick={() => usePlayer.getState().playList(items, 0, context)} />}
          {!IS_ANDROID && <button className="btn" onClick={openDownloads}><FolderOpen size={15} />{' '}{tr('폴더 열기')}</button>}
          {items.length > 0 && <button className="btn danger" onClick={() => useUI.getState().prompt({
            title: tr('다운로드한 곡을 모두 삭제할까요?'),
            message: tr('{0}곡({1})이 {2}에서 삭제됩니다. 보관함의 곡 목록은 그대로예요.', items.length, fmtBytes(totalSize), THIS_DEVICE),
            submitLabel: tr('전체 삭제'),
            onSubmit: () => removeDownload(items.map((i) => i.id)),
          })}><Trash2 size={15} />{' '}{tr('전체 삭제')}</button>}
        </div>
      </div>

      <LocalMusic />

      {jobs.length > 0 && (
        <section>
          <h2 data-enter>{tr('받는 중')}{' '}<small className="count">{jobs.length}</small></h2>
          <div className="jobs">{jobs.map((j) => <JobRow key={j.track.id} job={j} />)}</div>
        </section>
      )}

      <section>
        {items.length > 0 ? (
          <>
            <h2 data-enter>{tr('저장된 곡')}</h2>
            <TrackList tracks={items} context={context} />
          </>
        ) : !jobs.length && !localOn && (
          <Empty icon={ArrowDownToLine} title={tr('아직 다운로드한 곡이 없어요')} text={tr('곡 옆의 다운로드 버튼이나 앨범·플레이리스트의 \'모두 다운로드\'를 눌러보세요.')}>
            <button className="btn grad" onClick={() => go('search', {})}>{tr('곡 찾아보기')}</button>
          </Empty>
        )}
      </section>
    </div>
  );
}
