import { ArrowDownToLine, CircleCheck, X, RotateCw } from 'lucide-react';
import { useDownloads, download, cancelDownload, retryDownload, removeDownload } from '../store/downloads.js';

export function ProgressRing({ value = 0, size = 18, stroke = 2.4 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring ${value ? '' : 'spin'}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-bg" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fg" strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={c * (1 - (value || 0.25))} />
    </svg>
  );
}

// Per-track download state: offer → progress (click cancels) → done (click removes).
export default function DownloadButton({ track, size = 17, className = '' }) {
  const done = useDownloads((s) => s.done.has(track.id));
  const job = useDownloads((s) => s.active[track.id]);

  if (done) {
    return (
      <button className={`icon-btn dl done ${className}`} title="다운로드됨 · 클릭하면 삭제" onClick={(e) => { e.stopPropagation(); removeDownload(track.id); }}>
        <CircleCheck size={size} />
      </button>
    );
  }
  if (job?.status === 'error') {
    return (
      <button className={`icon-btn dl err ${className}`} title={`실패: ${job.error} · 다시 시도`} onClick={(e) => { e.stopPropagation(); retryDownload(track.id); }}>
        <RotateCw size={size} />
      </button>
    );
  }
  if (job) {
    const pct = job.total ? job.received / job.total : 0;
    return (
      <button className={`icon-btn dl busy ${className}`} title={`다운로드 중 ${Math.round(pct * 100)}% · 클릭하면 취소`} onClick={(e) => { e.stopPropagation(); cancelDownload(track.id); }}>
        <ProgressRing value={pct} size={size + 2} />
        <X size={9} className="dl-x" />
      </button>
    );
  }
  return (
    <button className={`icon-btn dl ${className}`} title="다운로드" onClick={(e) => { e.stopPropagation(); download(track); }}>
      <ArrowDownToLine size={size} />
    </button>
  );
}

// Album / playlist level: download everything that isn't saved yet.
export function DownloadAllButton({ tracks }) {
  const done = useDownloads((s) => s.done);
  const active = useDownloads((s) => s.active);
  const total = tracks.length;
  const have = tracks.filter((t) => done.has(t.id)).length;
  const busy = tracks.filter((t) => active[t.id] && active[t.id].status !== 'error').length;
  if (!total) return null;
  if (have === total) {
    return <button className="icon-btn big on" title="모두 다운로드됨"><CircleCheck size={28} /></button>;
  }
  if (busy) {
    return (
      <button className="icon-btn big busy" title={`${have}/${total}곡 완료`}>
        <ProgressRing value={have / total} size={28} stroke={3} />
      </button>
    );
  }
  return (
    <button className="icon-btn big" title={have ? `나머지 ${total - have}곡 다운로드` : `${total}곡 모두 다운로드`} onClick={() => download(tracks.filter((t) => !done.has(t.id)))}>
      <ArrowDownToLine size={26} />
    </button>
  );
}
