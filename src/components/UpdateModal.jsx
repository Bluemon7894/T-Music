import { useMemo } from 'react';
import { Sparkles, Download, ExternalLink, X, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { marked } from 'marked';
import { useUpdater } from '../store/updater.js';
import { api } from '../lib/api.js';
import { fmtBytes } from '../lib/util.js';
import { IS_ANDROID } from '../lib/platform.js';
import { LANGUAGE, tr } from '../lib/i18n.js';

export default function UpdateModal() {
  const modalOpen = useUpdater((s) => s.modalOpen);
  const closeModal = useUpdater((s) => s.closeModal);
  const currentVersion = useUpdater((s) => s.currentVersion);
  const latestVersion = useUpdater((s) => s.latestVersion);
  const releaseName = useUpdater((s) => s.releaseName);
  const releaseNotes = useUpdater((s) => s.releaseNotes);
  const downloading = useUpdater((s) => s.downloading);
  const downloaded = useUpdater((s) => s.downloaded);
  const progress = useUpdater((s) => s.progress);
  const error = useUpdater((s) => s.error);
  const download = useUpdater((s) => s.download);
  const install = useUpdater((s) => s.install);
  const openReleasePage = useUpdater((s) => s.openReleasePage);

  const renderedNotes = useMemo(() => {
    if (!releaseNotes) return '';
    try {
      // Release notes are text: raw HTML in them is dropped, not rendered.
      const renderer = new marked.Renderer();
      renderer.html = () => '';
      return marked.parse(releaseNotes, { gfm: true, breaks: true, renderer });
    } catch {
      return releaseNotes;
    }
  }, [releaseNotes]);

  if (!modalOpen) return null;

  return (
    <div className="update-modal-backdrop" onClick={closeModal}>
      <div className="update-modal-box" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn update-modal-close" onClick={closeModal} aria-label={tr('닫기')}>
          <X size={18} />
        </button>

        <div className="update-modal-header">
          <div className="update-modal-badge-icon">
            <Sparkles size={24} />
          </div>
          <div>
            <h2 className="update-modal-title">{tr('새로운 버전이 준비되었습니다')}</h2>
            <div className="update-modal-versions">
              <span className="v-tag cur">v{currentVersion}</span>
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
            <div className="update-modal-notes-title">{tr('업데이트 내용')}</div>
            <div
              className="update-modal-notes markdown-body"
              dangerouslySetInnerHTML={{ __html: renderedNotes }}
              onClick={(e) => {
                const target = e.target.closest('a');
                if (target && target.href) {
                  e.preventDefault();
                  api.openExternal(target.href);
                }
              }}
            />
          </div>
        )}

        {downloading && (
          <div className="update-progress-section">
            <div className="update-progress-labels">
              <span>{tr('다운로드 중...')}</span>
              <span>{progress.percent}% {progress.total > 0 && `(${fmtBytes(progress.received)} / ${fmtBytes(progress.total)})`}</span>
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
            <span>{IS_ANDROID ? tr('다운로드가 끝났습니다. 설치를 누르면 Android 설치 화면으로 넘어갑니다.') : tr('설치 파일 다운로드가 완료되었습니다. 지금 재시작하여 설치할 수 있습니다.')}</span>
          </div>
        )}

        {error && (
          <div className="update-error-msg">
            <AlertCircle size={18} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
              <span>{error}</span>
              <button
                type="button"
                className="btn-text"
                style={{
                  alignSelf: 'flex-start',
                  color: '#c4b5fd',
                  textDecoration: 'underline',
                  padding: 0,
                  fontSize: '12px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onClick={openReleasePage}
              >{tr('웹 브라우저에서 직접 설치 파일(')}{IS_ANDROID ? '.apk' : '.exe'}{tr(') 다운로드하기 →')}</button>
            </div>
          </div>
        )}

        <div className="update-modal-actions">
          <button className="btn-ghost" onClick={openReleasePage} title={tr('GitHub 릴리즈 페이지 열기')}>
            <ExternalLink size={14} />{' '}{tr('릴리즈 노트')}</button>
          <div style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={closeModal}>{LANGUAGE === 'en' ? 'Close' : '나가기'}</button>
          {downloaded ? (
            <button className="btn-primary" onClick={install}>
              <CheckCircle2 size={16} /> {IS_ANDROID ? tr('설치') : tr('지금 설치 및 재시작')}
            </button>
          ) : downloading ? (
            <button className="btn-primary" disabled>
              <Download size={16} className="spin" />{' '}{tr('다운로드 중 ({0}%)', progress.percent)}</button>
          ) : (
            <button className="btn-primary" onClick={download}>
              <Download size={16} />{' '}{tr('업데이트하기')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
