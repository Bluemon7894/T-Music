import { Sparkles, Download, ExternalLink, X, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { useUpdater } from '../store/updater.js';
import { fmtBytes } from '../lib/util.js';

export default function UpdateModal() {
  const modalOpen = useUpdater((s) => s.modalOpen);
  const closeModal = useUpdater((s) => s.closeModal);
  const hasUpdate = useUpdater((s) => s.hasUpdate);
  const currentVersion = useUpdater((s) => s.currentVersion);
  const latestVersion = useUpdater((s) => s.latestVersion);
  const releaseName = useUpdater((s) => s.releaseName);
  const releaseNotes = useUpdater((s) => s.releaseNotes);
  const assetSize = useUpdater((s) => s.assetSize);
  const downloading = useUpdater((s) => s.downloading);
  const downloaded = useUpdater((s) => s.downloaded);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const download = useUpdater((s) => s.download);
  const install = useUpdater((s) => s.install);
  const openReleasePage = useUpdater((s) => s.openReleasePage);

  if (!modalOpen) return null;

  return (
    <div className="update-modal-backdrop" onClick={closeModal}>
      <div className="update-modal-box" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn update-modal-close" onClick={closeModal} aria-label="닫기">
          <X size={18} />
        </button>

        <div className="update-modal-header">
          <div className="update-modal-badge-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h2 className="update-modal-title">새로운 버전이 준비되었습니다</h2>
            <div className="update-modal-versions">
              <span className="v-tag cur">v{currentVersion || '0.2.2'}</span>
              <ArrowRight size={14} className="v-arrow" />
              <span className="v-tag next">v{latestVersion}</span>
            </div>
          </div>
        </div>

        {releaseName && releaseName !== latestVersion && (
          <div className="update-modal-relname">{releaseName}</div>
        )}

        {releaseNotes && (
          <div className="update-modal-notes-wrapper">
            <div className="update-modal-notes-title">업데이트 내용</div>
            <div className="update-modal-notes">
              <pre>{releaseNotes}</pre>
            </div>
          </div>
        )}

        {downloading && (
          <div className="update-progress-section">
            <div className="update-progress-labels">
              <span>다운로드 중...</span>
              <span>{progress.percent}% {progress.total > 0 && `(${fmtBytes ? fmtBytes(progress.received) : Math.round(progress.received / (1024 * 1024)) + 'MB'} / ${fmtBytes ? fmtBytes(progress.total) : Math.round(progress.total / (1024 * 1024)) + 'MB'})`}</span>
            </div>
            <div className="update-progress-bar-bg">
              <div
                className="update-progress-bar-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}

        {downloaded && (
          <div className="update-completed-msg">
            <CheckCircle2 size={18} className="text-success" />
            <span>설치 파일 다운로드가 완료되었습니다. 지금 재시작하여 설치할 수 있습니다.</span>
          </div>
        )}

        {error && (
          <div className="update-error-msg">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="update-modal-actions">
          {downloaded ? (
            <button className="btn-primary" onClick={install}>
              <CheckCircle2 size={16} /> 지금 설치 및 재시작
            </button>
          ) : downloading ? (
            <button className="btn-primary" disabled>
              <Download size={16} className="spin" /> 다운로드 중 ({progress.percent}%)
            </button>
          ) : (
            <button className="btn-primary" onClick={download}>
              <Download size={16} /> 지금 업데이트 다운로드
            </button>
          )}

          <button className="btn-ghost" onClick={openReleasePage}>
            <ExternalLink size={16} /> GitHub에서 보기
          </button>
        </div>
      </div>
    </div>
  );
}
