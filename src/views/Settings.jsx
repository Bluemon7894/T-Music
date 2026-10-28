import { useState } from 'react';
import { Activity, CheckCircle2, XCircle, Download } from 'lucide-react';
import { api } from '../api.js';
import { useAsync } from '../components/common.jsx';
import { importPlaylist } from '../components/Sidebar.jsx';
import { useLibrary } from '../store/library.js';
import { toast } from '../store/ui.js';

const METHOD_LABEL = {
  IOS: 'InnerTube (iOS 앱으로 요청)',
  ANDROID_VR: 'InnerTube (안드로이드 VR 앱으로 요청)',
  VISIONOS: 'InnerTube (visionOS 앱으로 요청)',
  'yt-dlp': 'yt-dlp (자동 업데이트)',
};

export default function Settings() {
  const status = useAsync(() => api.status(), []);
  const [diag, setDiag] = useState(null);
  const [running, setRunning] = useState(false);
  const lib = useLibrary();

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
  };
  const importLib = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        useLibrary.setState({
          liked: data.liked || [], playlists: data.playlists || [], savedAlbums: data.savedAlbums || [], followed: data.followed || [],
        });
        toast('라이브러리를 복원했습니다');
      } catch {
        toast('파일을 읽을 수 없습니다');
      }
    };
    input.click();
  };

  return (
    <div className="page settings">
      <h1>설정</h1>

      <section>
        <h2>재생 엔진</h2>
        <p className="muted">곡을 재생할 때 아래 방법을 순서대로 시도합니다. 최근에 실패한 방법은 몇 시간 동안 뒤로 밀렸다가 다시 시도됩니다.</p>
        <div className="method-list">
          {status.data?.methods.map((m, i) => (
            <div key={m.name} className="method">
              <span className="method-order">{i + 1}</span>
              <span className="method-name">{METHOD_LABEL[m.name] || m.name}</span>
              <span className="muted">성공 {m.ok} · 실패 {m.fail}</span>
            </div>
          ))}
        </div>
        {status.data?.ytdlp && (
          <p className="muted">yt-dlp: {status.data.ytdlp.status}{status.data.ytdlp.version ? ` (버전 ${status.data.ytdlp.version})` : ''}{status.data.ytdlp.error ? ` · ${status.data.ytdlp.error}` : ''}</p>
        )}
        <button className="pill white" onClick={runDiag} disabled={running}><Activity size={16} /> {running ? '진단 중… (최대 1분)' : '재생 진단 실행'}</button>
        {diag && (
          <div className="method-list">
            {diag.map((d) => (
              <div key={d.name} className="method">
                {d.ok ? <CheckCircle2 size={18} color="var(--accent)" /> : <XCircle size={18} color="#f15e6c" />}
                <span className="method-name">{METHOD_LABEL[d.name] || d.name}</span>
                <span className="muted">{d.ok ? `${d.ms}ms` : d.error}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>라이브러리</h2>
        <p className="muted">좋아요, 플레이리스트는 이 컴퓨터에만 저장됩니다. 유튜브 계정과 연결되지 않습니다.</p>
        <div className="row-btns">
          <button className="pill" onClick={importPlaylist}><Download size={16} /> YouTube 재생목록 가져오기</button>
          <button className="pill" onClick={exportLib}>라이브러리 백업</button>
          <button className="pill" onClick={importLib}>백업에서 복원</button>
        </div>
      </section>

      <section>
        <h2>단축키</h2>
        <div className="shortcuts">
          <span><kbd>Space</kbd> 재생 / 일시정지</span>
          <span><kbd>Ctrl</kbd>+<kbd>→</kbd> 다음 곡</span>
          <span><kbd>Ctrl</kbd>+<kbd>←</kbd> 이전 곡</span>
          <span><kbd>Ctrl</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> 볼륨</span>
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> 검색</span>
          <span><kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd> 뒤로 / 앞으로</span>
        </div>
      </section>
    </div>
  );
}
