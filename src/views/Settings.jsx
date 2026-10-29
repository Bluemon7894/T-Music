import { useRef, useState } from 'react';
import { Activity, CheckCircle2, XCircle, Download, Upload, FolderOpen, Gauge, Library, Keyboard, Info, RefreshCw, Sparkles, Radio } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAsync } from '../components/common.jsx';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useDownloads, openDownloads } from '../store/downloads.js';
import { useUpdater } from '../store/updater.js';
import { toast } from '../store/ui.js';
import { fmtBytes } from '../lib/util.js';
import { useEnter } from '../lib/motion.js';
import logo from '../assets/logo-mark.png';

const METHOD_LABEL = {
  IOS: 'InnerTube · iOS',
  ANDROID_VR: 'InnerTube · Android VR',
  VISIONOS: 'InnerTube · visionOS',
};

export default function Settings() {
  const status = useAsync(() => api.status(), []);
  const [diag, setDiag] = useState(null);
  const [running, setRunning] = useState(false);
  const lib = useLibrary();
  const dl = useDownloads();
  const autoplay = usePlayer((s) => s.autoplay);
  const toggleAutoplay = usePlayer((s) => s.toggleAutoplay);
  const checkingUpdate = useUpdater((s) => s.checking);
  const hasUpdate = useUpdater((s) => s.hasUpdate);
  const latestVersion = useUpdater((s) => s.latestVersion);
  const checkUpdate = useUpdater((s) => s.check);
  const openModal = useUpdater((s) => s.openModal);
  const ref = useRef(null);
  useEnter(ref, [], { step: 50 });

  const runDiag = async () => {
    setRunning(true);
    try { setDiag(await api.diagnose()); } finally { setRunning(false); }
  };

  const exportLib = () => {
    const blob = new Blob([JSON.stringify({ liked: lib.liked, playlists: lib.playlists, savedAlbums: lib.savedAlbums, followed: lib.followed }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `t-music-library-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast('백업 파일을 저장했습니다');
  };
  const importLib = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        useLibrary.setState({ liked: data.liked || [], playlists: data.playlists || [], savedAlbums: data.savedAlbums || [], followed: data.followed || [] });
        toast('보관함을 복원했습니다');
      } catch {
        toast('파일을 읽을 수 없습니다');
      }
    };
    input.click();
  };

  return (
    <div className="page settings" ref={ref}>
      <div className="page-title" data-enter><h1>설정</h1></div>

      <div className="settings-grid">
        <section className="set-card" data-enter>
          <h2><Gauge size={18} /> 재생 엔진</h2>
          <p className="muted">곡마다 아래 방법을 순서대로 시도해요. 최근에 실패한 방법은 몇 시간 동안 뒤로 밀렸다가 다시 시도됩니다.</p>
          <div className="method-list">
            {status.data?.methods.map((m, i) => (
              <div key={m.name} className="method">
                <span className="method-order">{i + 1}</span>
                <span className="method-name">{METHOD_LABEL[m.name] || m.name}</span>
                <span className="muted small">성공 {m.ok} · 실패 {m.fail}</span>
              </div>
            ))}
          </div>
          <button className="btn grad" onClick={runDiag} disabled={running}><Activity size={15} /> {running ? '진단 중… (최대 1분)' : '재생 진단 실행'}</button>
          {diag && (
            <div className="method-list">
              {diag.map((d) => (
                <div key={d.name} className="method">
                  {d.ok ? <CheckCircle2 size={17} className="ok" /> : <XCircle size={17} className="bad" />}
                  <span className="method-name">{METHOD_LABEL[d.name] || d.name}</span>
                  <span className="muted small">{d.ok ? `${d.ms}ms` : d.error}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="set-card" data-enter>
          <h2><Radio size={18} /> 재생 설정</h2>
          <p className="muted">대기열의 등록된 음악이 끝났을 때의 재생 방식을 설정해요.</p>
          <div
            onClick={toggleAutoplay}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
              borderTop: '1px solid var(--line)',
            }}
          >
            <div>
              <div style={{ color: '#fff', fontWeight: 600, fontSize: '14px' }}>추천곡 자동 재생</div>
              <div className="muted small">대기열의 마지막 곡이 끝나면 비슷한 추천곡을 자동으로 이어서 재생합니다.</div>
            </div>
            <div className={`switch ${autoplay ? 'on' : ''}`} style={{ flex: 'none', marginLeft: '16px' }} />
          </div>
        </section>

        <section className="set-card" data-enter>
          <h2><Library size={18} /> 보관함</h2>
          <p className="muted">좋아요와 플레이리스트는 이 PC에만 저장돼요. 유튜브 계정과는 연결되지 않습니다.</p>
          <div className="set-stats">
            <div><b>{lib.liked.length}</b><span>좋아요</span></div>
            <div><b>{lib.playlists.length}</b><span>플레이리스트</span></div>
            <div><b>{lib.savedAlbums.length}</b><span>앨범</span></div>
            <div><b>{lib.followed.length}</b><span>아티스트</span></div>
          </div>
          <div className="row-btns">
            <button className="btn" onClick={exportLib}><Download size={15} /> 백업</button>
            <button className="btn" onClick={importLib}><Upload size={15} /> 복원</button>
          </div>
        </section>

        <section className="set-card" data-enter>
          <h2><Download size={18} /> 다운로드</h2>
          <p className="muted">{dl.items.length}곡 · {fmtBytes(dl.totalSize)}</p>
          <p className="muted small path">{dl.dir}</p>
          <button className="btn" onClick={openDownloads}><FolderOpen size={15} /> 폴더 열기</button>
        </section>

        <section className="set-card" data-enter>
          <h2><Keyboard size={18} /> 단축키</h2>
          <div className="shortcuts">
            <span><kbd>Space</kbd> 재생 / 일시정지</span>
            <span><kbd>Ctrl</kbd> <kbd>→</kbd> 다음 곡</span>
            <span><kbd>Ctrl</kbd> <kbd>←</kbd> 이전 곡</span>
            <span><kbd>Ctrl</kbd> <kbd>↑</kbd> <kbd>↓</kbd> 볼륨</span>
            <span><kbd>Ctrl</kbd> <kbd>K</kbd> 검색</span>
            <span><kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd> 뒤로 / 앞으로</span>
            <span><kbd>Esc</kbd> 전체 화면 닫기</span>
          </div>
        </section>

        <section className="set-card about-app" data-enter>
          <img src={logo} alt="" />
          <div className="about-app-info">
            <h2><Info size={18} /> T-Music {status.data?.version ? `v${status.data.version}` : ''}</h2>
            <p className="muted">광고 없는 나만의 음악 플레이어. 개인 학습·사용 목적으로 만들었어요.</p>
            <div className="update-check-row">
              <button className="btn" onClick={() => checkUpdate(false)} disabled={checkingUpdate}>
                <RefreshCw size={14} className={checkingUpdate ? 'spin' : ''} /> {checkingUpdate ? '확인 중…' : '업데이트 확인'}
              </button>
              {hasUpdate && (
                <button className="btn grad update-available-btn" onClick={openModal}>
                  <Sparkles size={14} /> v{latestVersion} 업데이트 가능
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
