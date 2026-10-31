import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Upload,
  FolderOpen,
  FolderEdit,
  Library,
  Keyboard,
  Info,
  RefreshCw,
  Sparkles,
  Radio,
  Monitor,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAsync } from '../components/common.jsx';
import { AccountCard, FriendPrivacyCard } from '../components/Account.jsx';
import { useLibrary } from '../store/library.js';
import { usePlayer, applyOutputDevice } from '../store/player.js';
import { useDownloads, openDownloads } from '../store/downloads.js';
import { useUpdater } from '../store/updater.js';
import { toast } from '../store/ui.js';
import { fmtBytes } from '../lib/util.js';
import { useEnter } from '../lib/motion.js';
import { isNormalizeEnabled, setNormalize, getAudioSinkId, setAudioSinkId } from '../lib/audio.js';
import logo from '../assets/logo-mark.png';

export default function Settings() {
  const status = useAsync(() => api.status(), []);
  const lib = useLibrary();
  const dl = useDownloads();
  const autoplay = usePlayer((s) => s.autoplay);
  const toggleAutoplay = usePlayer((s) => s.toggleAutoplay);
  const checkingUpdate = useUpdater((s) => s.checking);
  const hasUpdate = useUpdater((s) => s.hasUpdate);
  const latestVersion = useUpdater((s) => s.latestVersion);
  const checkUpdate = useUpdater((s) => s.check);
  const openModal = useUpdater((s) => s.openModal);

  // Audio Normalization state
  const [normalize, setNormalizeState] = useState(isNormalizeEnabled);
  const toggleNormalize = () => {
    const next = !normalize;
    setNormalize(next);
    setNormalizeState(next);
    toast(next ? '음량 자동 균일화를 켰습니다' : '음량 자동 균일화를 껐습니다');
  };

  // Audio Output Devices
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(getAudioSinkId);

  useEffect(() => {
    const updateDevices = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const list = await navigator.mediaDevices.enumerateDevices();
        const outputs = list.filter((d) => d.kind === 'audiooutput');
        setDevices(outputs);
      } catch {}
    };
    updateDevices();
    navigator.mediaDevices?.addEventListener('devicechange', updateDevices);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', updateDevices);
  }, []);

  const changeDevice = async (deviceId) => {
    setSelectedDevice(deviceId);
    await setAudioSinkId(deviceId);
    await applyOutputDevice(deviceId);
    toast('오디오 출력 장치를 변경했습니다');
  };

  // Auto-start with Windows
  const [autoStart, setAutoStartState] = useState(() => {
    try { return localStorage.getItem('t-music-autostart') === '1'; } catch { return false; }
  });
  useEffect(() => {
    api.getAutoStart().then((v) => {
      setAutoStartState(Boolean(v));
      try { localStorage.setItem('t-music-autostart', v ? '1' : '0'); } catch {}
    }).catch(() => {});
  }, []);
  const toggleAutoStart = async () => {
    const next = !autoStart;
    try {
      const res = await api.setAutoStart(next);
      const isEnabled = Boolean(res);
      setAutoStartState(isEnabled);
      try { localStorage.setItem('t-music-autostart', isEnabled ? '1' : '0'); } catch {}
      toast(isEnabled ? '윈도우 시작 시 자동 실행을 켰습니다' : '윈도우 시작 시 자동 실행을 껐습니다');
    } catch {
      toast('설정을 변경할 수 없습니다');
    }
  };

  // Discord Rich Presence
  const [discordRPC, setDiscordRPCState] = useState(true);
  const [discordStatus, setDiscordStatus] = useState(null);

  const refreshDiscordStatus = () => {
    api.getDiscordStatus().then(setDiscordStatus).catch(() => {});
  };

  useEffect(() => {
    api.getDiscordRPC().then((v) => setDiscordRPCState(Boolean(v))).catch(() => {});
    refreshDiscordStatus();
    const timer = setInterval(refreshDiscordStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  const toggleDiscordRPC = async () => {
    const next = !discordRPC;
    try {
      const res = await api.setDiscordRPC(next);
      setDiscordRPCState(Boolean(res));
      setTimeout(refreshDiscordStatus, 500);
      toast(res ? '디스코드 활동 상태 연동을 켰습니다' : '디스코드 활동 상태 연동을 껐습니다');
    } catch {
      toast('설정을 변경할 수 없습니다');
    }
  };

  // Choose download folder
  const changeDownloadsDir = async () => {
    try {
      const newDir = await api.chooseDownloadsDir();
      if (newDir) toast('다운로드 폴더를 변경했습니다');
    } catch {
      toast('폴더를 변경할 수 없습니다');
    }
  };

  const ref = useRef(null);
  useEnter(ref, [], { step: 50 });

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
        const listOf = (value) => (Array.isArray(value) ? value.filter((x) => x?.id) : []);
        useLibrary.setState({
          liked: listOf(data.liked),
          playlists: listOf(data.playlists).map((p) => ({ ...p, name: String(p.name || '플레이리스트'), tracks: listOf(p.tracks) })),
          savedAlbums: listOf(data.savedAlbums),
          followed: listOf(data.followed),
        });
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
        <AccountCard />
        <FriendPrivacyCard />

        <section className="set-card" data-enter>
          <h2><Radio size={18} /> 재생 및 음질 설정</h2>
          <p className="muted">오디오 재생 방식과 볼륨, 출력 장치를 설정해요.</p>

          <div className="set-item" onClick={toggleAutoplay}>
            <div className="set-item-text">
              <span className="set-item-title">추천곡 자동 재생</span>
              <span className="muted small">대기열의 마지막 곡이 끝나면 비슷한 추천곡을 자동으로 이어서 재생합니다.</span>
            </div>
            <div className={`switch ${autoplay ? 'on' : ''}`} />
          </div>

          <div className="set-item" onClick={toggleNormalize}>
            <div className="set-item-text">
              <span className="set-item-title">음량 자동 균일화 (Normalizer)</span>
              <span className="muted small">곡마다 들쑥날쑥한 볼륨 차이를 실시간으로 완만하게 맞춰줍니다.</span>
            </div>
            <div className={`switch ${normalize ? 'on' : ''}`} />
          </div>

          {devices.length > 0 && (
            <div className="set-item" style={{ cursor: 'default' }}>
              <div className="set-item-text">
                <span className="set-item-title">오디오 출력 장치</span>
                <span className="muted small">소리를 출력할 스피커 또는 헤드셋을 선택합니다.</span>
              </div>
              <select
                className="set-select"
                value={selectedDevice}
                onChange={(e) => changeDevice(e.target.value)}
              >
                <option value="">시스템 기본값</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `출력 장치 ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        <section className="set-card" data-enter>
          <h2><Monitor size={18} /> 시스템 및 연동</h2>
          <p className="muted">윈도우 시작 및 디스코드 상태 표시 설정을 관리해요.</p>

          <div className="set-item" onClick={toggleAutoStart}>
            <div className="set-item-text">
              <span className="set-item-title">윈도우 시작 시 자동 실행</span>
              <span className="muted small">PC를 켤 때 T-Music을 백그라운드 트레이로 자동 실행합니다.</span>
            </div>
            <div className={`switch ${autoStart ? 'on' : ''}`} />
          </div>

          <div className="set-item" onClick={toggleDiscordRPC}>
            <div className="set-item-text">
              <div className="set-item-head">
                <span className="set-item-title">디스코드 활동 상태 (Rich Presence)</span>
                {discordRPC && (
                  <span className={`set-badge ${discordStatus?.connected ? 'ok' : 'wait'}`}>
                    {discordStatus?.connected
                      ? `연결됨 (${discordStatus.user?.username || 'Discord'})`
                      : '디스코드 PC 앱 실행 대기 중'}
                  </span>
                )}
              </div>
              <span className="muted small">현재 듣고 있는 곡과 재생 시간을 디스코드 프로필에 실시간으로 표시합니다.</span>
            </div>
            <div className={`switch ${discordRPC ? 'on' : ''}`} />
          </div>

          {discordRPC && (
            <div className="set-note">
              <b>디스코드 상태 표시 확인사항</b>
              <ol>
                <li>웹 브라우저가 아닌 <b>디스코드 PC 프로그램(데스크톱 앱)</b>이 실행 중이어야 연동됩니다.</li>
                <li>디스코드 설정(톱니바퀴) &gt; <b>활동 개인정보 보호</b> &gt; <b>'현재 활동을 상태 메시지로 표시'</b>가 켜져 있어야 프로필에 나타납니다.</li>
              </ol>
            </div>
          )}
        </section>

        <section className="set-card" data-enter>
          <h2><Download size={18} /> 다운로드 저장소</h2>
          <p className="muted">{dl.items.length}곡 저장됨 · {fmtBytes(dl.totalSize)}</p>
          <p className="muted small path">{dl.dir}</p>
          <div className="row-btns">
            <button className="btn" onClick={openDownloads}><FolderOpen size={15} /> 폴더 열기</button>
            <button className="btn" onClick={changeDownloadsDir}><FolderEdit size={15} /> 폴더 변경</button>
          </div>
        </section>

        <section className="set-card" data-enter>
          <h2><Library size={18} /> 보관함</h2>
          <p className="muted">좋아요와 플레이리스트는 이 기기에만 안전하게 저장돼요. 유튜브 계정과는 연결되지 않습니다.</p>
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
          <h2><Keyboard size={18} /> 단축키</h2>
          <div className="shortcuts">
            <span><kbd>Space</kbd> 재생 / 일시정지</span>
            <span><kbd>↑</kbd> <kbd>↓</kbd> 음량 조절</span>
            <span><kbd>←</kbd> <kbd>→</kbd> 10초 탐색 (길게 누르면 고속 탐색)</span>
            <span><kbd>Ctrl</kbd> <kbd>→</kbd> 다음 곡</span>
            <span><kbd>Ctrl</kbd> <kbd>←</kbd> 이전 곡</span>
            <span><kbd>Ctrl</kbd> <kbd>K</kbd> 검색창 열기</span>
            <span><kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd> 뒤로 / 앞으로 이동</span>
            <span><kbd>Esc</kbd> 전체 화면 닫기</span>
            <span><kbd>마우스</kbd> 4/5번 앞뒤 이동</span>
          </div>
        </section>

        <section className="set-card about-app" data-enter>
          <h2><Info size={18} /> 앱 정보 및 업데이트</h2>
          <div className="about-app-body">
            <img src={logo} alt="T-Music" />
            <div className="about-app-text">
              <span className="about-app-title">T-Music {status.data?.version ? `v${status.data.version}` : ''}</span>
              <p className="muted small">광고 없는 나만의 음악 플레이어. 개인 학습·사용 목적으로 만들었어요.</p>
            </div>
          </div>
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
        </section>
      </div>
    </div>
  );
}
