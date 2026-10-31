import { useRef } from 'react';
import { ArrowDownToLine, FolderOpen, X, RotateCw, Trash2, WifiOff } from 'lucide-react';
import { useDownloads, cancelDownload, retryDownload, removeDownload, openDownloads } from '../store/downloads.js';
import { usePlayer } from '../store/player.js';
import { useNav } from '../store/nav.js';
import { useUI } from '../store/ui.js';
import { fmtBytes, totalTime } from '../lib/util.js';
import { useEnter } from '../lib/motion.js';
import { Thumb, PlayButton, Empty } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';

function JobRow({ job }) {
  const pct = job.total ? Math.round((job.received / job.total) * 100) : 0;
  const t = job.track;
  return (
    <div className={`job ${job.status}`} data-enter>
      <Thumb src={t.thumb} className="job-thumb" />
      <div className="job-main">
        <div className="job-top">
          <b>{t.title}</b>
          <span>{job.status === 'queued' ? '대기 중' : job.status === 'error' ? '실패' : `${pct}% · ${fmtBytes(job.received)}${job.total ? ` / ${fmtBytes(job.total)}` : ''}`}</span>
        </div>
        <div className="job-bar"><i style={{ width: `${job.status === 'error' ? 100 : pct}%` }} /></div>
        {job.error && <small className="job-err">{job.error}</small>}
      </div>
      {job.status === 'error'
        ? <button className="icon-btn circle" title="다시 시도" onClick={() => retryDownload(t.id)}><RotateCw size={16} /></button>
        : null}
      <button className="icon-btn circle" title="취소" onClick={() => cancelDownload(t.id)}><X size={16} /></button>
    </div>
  );
}

export default function Downloads() {
  const { items, jobs, totalSize } = useDownloads();
  const go = useNav((s) => s.go);
  const ref = useRef(null);
  useEnter(ref, [jobs.length > 0, items.length > 0]);
  const context = { name: '다운로드한 곡' };

  return (
    <div className="page downloads" ref={ref}>
      <div className="dl-hero" data-enter>
        <div className="dl-hero-icon"><ArrowDownToLine size={40} /></div>
        <div className="dl-hero-text">
          <span className="ph-kind">오프라인 보관함</span>
          <h1>다운로드</h1>
          <p>{items.length}곡 · {totalTime(items)} · {fmtBytes(totalSize)}</p>
          <p className="dl-note"><WifiOff size={14} /> 다운로드한 곡은 인터넷 없이도 재생돼요</p>
        </div>
        <div className="dl-hero-actions">
          {items.length > 0 && <PlayButton size={58} onClick={() => usePlayer.getState().playList(items, 0, context)} />}
          <button className="btn" onClick={openDownloads}><FolderOpen size={15} /> 폴더 열기</button>
          {items.length > 0 && <button className="btn danger" onClick={() => useUI.getState().prompt({
            title: '다운로드한 곡을 모두 삭제할까요?',
            message: `${items.length}곡(${fmtBytes(totalSize)})이 이 PC에서 삭제됩니다. 보관함의 곡 목록은 그대로예요.`,
            submitLabel: '전체 삭제',
            onSubmit: () => removeDownload(items.map((i) => i.id)),
          })}><Trash2 size={15} /> 전체 삭제</button>}
        </div>
      </div>

      {jobs.length > 0 && (
        <section>
          <h2 data-enter>받는 중 <small className="count">{jobs.length}</small></h2>
          <div className="jobs">{jobs.map((j) => <JobRow key={j.track.id} job={j} />)}</div>
        </section>
      )}

      <section>
        {items.length > 0 ? (
          <>
            <h2 data-enter>저장된 곡</h2>
            <TrackList tracks={items} context={context} />
          </>
        ) : !jobs.length && (
          <Empty icon={ArrowDownToLine} title="아직 다운로드한 곡이 없어요" text="곡 옆의 다운로드 버튼이나 앨범·플레이리스트의 '모두 다운로드'를 눌러보세요.">
            <button className="btn grad" onClick={() => go('search', {})}>곡 찾아보기</button>
          </Empty>
        )}
      </section>
    </div>
  );
}
