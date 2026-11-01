import { useMemo } from 'react';
import { ArrowRight, CheckCircle2, AlertCircle, Download, ExternalLink, RefreshCw, X } from 'lucide-react';
import { marked } from 'marked';
import { useUpdater } from '../store/updater.js';
import { api } from '../lib/api.js';
import { fmtBytes } from '../lib/util.js';
import { IS_ANDROID } from '../lib/platform.js';
import logo from '../assets/logo-mark.png';
import { tr } from '../lib/i18n.js';

export default function UpdateModal() {
  const modalOpen = useUpdater((s) => s.modalOpen);
  const closeModal = useUpdater((s) => s.closeModal);
  const currentVersion = useUpdater((s) => s.currentVersion);
  const latestVersion = useUpdater((s) => s.latestVersion);
  const releaseNotes = useUpdater((s) => s.releaseNotes);
  const assetSize = useUpdater((s) => s.assetSize);
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
      <div className="update-modal-box" role="dialog" aria-label={tr('업데이트')} onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn update-modal-close" onClick={closeModal} aria-label={tr('닫기')}><X size={18} /></button>

        <header className="um-head">
          <img className="um-logo" src={logo} alt="" draggable={false} />
          <div className="um-head-text">
            <span className="um-kicker">{tr('새 버전')}</span>
            <h2>T-Music {latestVersion}</h2>
            <div className="um-versions">
              <span>{currentVersion}</span>
              <ArrowRight size={13} />
              <b>{latestVersion}</b>
              {assetSize > 0 && <em>{fmtBytes(assetSize)}</em>}
            </div>
          </div>
        </header>

        {releaseNotes && (
          <section
            className="um-notes markdown-body"
            dangerouslySetInnerHTML={{ __html: renderedNotes }}
            onClick={(e) => {
              const target = e.target.closest('a');
              if (target && target.href) {
                e.preventDefault();
                api.openExternal(target.href);
              }
            }}
          />
        )}

        {error && (
          <div className="um-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <button className="text-btn" onClick={openReleasePage}>{tr('직접 받기')}</button>
          </div>
        )}

        <footer className="um-foot">
          {downloading ? (
            <div className="um-progress">
              <div className="um-progress-text">
                <span>{tr('받는 중')}</span>
                <span>{progress.total > 0 ? `${fmtBytes(progress.received)} / ${fmtBytes(progress.total)}` : `${progress.percent}%`}</span>
              </div>
              <div className="um-progress-bar"><i style={{ width: `${progress.percent}%` }} /></div>
            </div>
          ) : downloaded ? (
            <button className="um-main" onClick={install}>
              <CheckCircle2 size={17} />{' '}{IS_ANDROID ? tr('설치하기') : tr('재시작하고 설치')}</button>
          ) : (
            <button className="um-main" onClick={download}>
              {error ? <RefreshCw size={17} /> : <Download size={17} />}{' '}{error ? tr('다시 시도') : tr('업데이트')}</button>
          )}
          <div className="um-side">
            <button className="text-btn" onClick={closeModal}>{tr('나중에')}</button>
            <button className="text-btn" onClick={openReleasePage}><ExternalLink size={13} />{' '}{tr('릴리즈 페이지')}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
