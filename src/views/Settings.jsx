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
  Languages,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAsync } from '../components/common.jsx';
import { AccountCard, FriendPrivacyCard } from '../components/Account.jsx';
import { useLibrary } from '../store/library.js';
import { usePlayer, applyOutputDevice } from '../store/player.js';
import { useDeck } from '../store/deck.js';
import { usePrefs } from '../store/prefs.js';
import { useSleepTimer } from '../store/sleepTimer.js';
import { useRoom } from '../store/room.js';
import { useAccount } from '../store/account.js';
import { useDownloads, openDownloads } from '../store/downloads.js';
import { useUpdater } from '../store/updater.js';
import { toast, useUI } from '../store/ui.js';
import { fmtBytes } from '../lib/util.js';
import { useEnter } from '../lib/motion.js';
import { IS_ANDROID } from '../lib/platform.js';
import { isNormalizeEnabled, setNormalize, getAudioSinkId, setAudioSinkId } from '../lib/audio.js';
import logo from '../assets/logo-mark.png';
import { LANGUAGE, LANGUAGES, setLanguage, tr } from '../lib/i18n.js';

const SLEEP_CHOICES = [0, 15, 30, 60];
const SLEEP_TICK_MS = 20000;
const LYRIC_SIZES = [{ id: 'small', label: tr('작게') }, { id: 'normal', label: tr('보통') }, { id: 'large', label: tr('크게') }];

function SleepTimerRow() {
  const minutes = useSleepTimer((s) => s.minutes);
  const endsAt = useSleepTimer((s) => s.endsAt);
  const start = useSleepTimer((s) => s.start);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!endsAt) return undefined;
    const t = setInterval(() => tick((n) => n + 1), SLEEP_TICK_MS);
    return () => clearInterval(t);
  }, [endsAt]);

  const left = Math.max(1, Math.ceil((endsAt - Date.now()) / 60000));
  return (
    <div className="set-item" style={{ cursor: 'default' }}>
      <div className="set-item-text">
        <span className="set-item-title">{tr('취침 타이머')}</span>
        <span className="muted small">{endsAt ? tr('{0}분 뒤에 음악이 서서히 작아지며 멈춰요.', left) : tr('정한 시간이 지나면 음악이 서서히 작아지며 멈춰요.')}</span>
      </div>
      <div className="seg">
        {SLEEP_CHOICES.map((m) => <button key={m} className={minutes === m ? 'on' : ''} onClick={() => start(m)}>{m ? tr('{0}분', m) : tr('끔')}</button>)}
      </div>
    </div>
  );
}

function ConvenienceCard() {
  const resume = usePrefs((s) => s.resumeOnLaunch);
  const lyricSize = usePrefs((s) => s.lyricSize);
  const calm = usePrefs((s) => s.calmMotion);
  const setPref = usePrefs((s) => s.setPref);
  return (
    <section className="set-card" data-enter>
      <h2><SlidersHorizontal size={18} />{' '}{tr('편의 기능')}</h2>
      <p className="muted">{tr('듣는 습관에 맞게 조금씩 바꿔 보세요.')}</p>
      <SleepTimerRow />
      <div className="set-item" onClick={() => setPref({ resumeOnLaunch: !resume })}>
        <div className="set-item-text">
          <span className="set-item-title">{tr('앱을 열면 이어서 재생')}</span>
          <span className="muted small">{tr('마지막으로 듣던 곡을 그 위치부터 바로 재생합니다.')}</span>
        </div>
        <div className={`switch ${resume ? 'on' : ''}`} />
      </div>
      <div className="set-item" style={{ cursor: 'default' }}>
        <div className="set-item-text">
          <span className="set-item-title">{tr('가사 글자 크기')}</span>
          <span className="muted small">{tr('가사 화면의 글자 크기를 바꿉니다.')}</span>
        </div>
        <div className="seg">
          {LYRIC_SIZES.map((size) => <button key={size.id} className={lyricSize === size.id ? 'on' : ''} onClick={() => setPref({ lyricSize: size.id })}>{size.label}</button>)}
        </div>
      </div>
      <div className="set-item" onClick={() => setPref({ calmMotion: !calm })}>
        <div className="set-item-text">
          <span className="set-item-title">{tr('애니메이션 줄이기')}</span>
          <span className="muted small">{tr('화면 전환과 배경 움직임을 줄입니다. 기기가 느릴 때 좋아요.')}</span>
        </div>
        <div className={`switch ${calm ? 'on' : ''}`} />
      </div>
    </section>
  );
}

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

  const deckStyle = useDeck((s) => s.style);
  const deckSounds = useDeck((s) => s.sounds);
  const inRoom = useRoom((s) => s.attached);
  const roomSounds = useRoom((s) => s.meta?.sounds === true);
  const isRoomHost = useRoom((s) => s.meta?.hostUid) === useAccount((s) => s.user?.uid);

  // Audio Normalization state
  const [normalize, setNormalizeState] = useState(isNormalizeEnabled);
  const toggleNormalize = () => {
    const next = !normalize;
    setNormalize(next);
    setNormalizeState(next);
    toast(next ? tr('음량 자동 균일화를 켰습니다') : tr('음량 자동 균일화를 껐습니다'));
  };

  // Audio Output Devices
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(getAudioSinkId);

  useEffect(() => {
    if (IS_ANDROID) return undefined;
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
    toast(tr('오디오 출력 장치를 변경했습니다'));
  };

  // Auto-start with Windows
  const [autoStart, setAutoStartState] = useState(() => {
    try { return localStorage.getItem('t-music-autostart') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (IS_ANDROID) return;
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
      toast(isEnabled ? tr('윈도우 시작 시 자동 실행을 켰습니다') : tr('윈도우 시작 시 자동 실행을 껐습니다'));
    } catch {
      toast(tr('설정을 변경할 수 없습니다'));
    }
  };

  // Discord Rich Presence
  const [discordRPC, setDiscordRPCState] = useState(true);
  const [discordStatus, setDiscordStatus] = useState(null);

  const refreshDiscordStatus = () => {
    api.getDiscordStatus().then(setDiscordStatus).catch(() => {});
  };

  useEffect(() => {
    if (IS_ANDROID) return undefined;
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
      toast(res ? tr('디스코드 활동 상태 연동을 켰습니다') : tr('디스코드 활동 상태 연동을 껐습니다'));
    } catch {
      toast(tr('설정을 변경할 수 없습니다'));
    }
  };

  // Choose download folder
  const changeDownloadsDir = async () => {
    try {
      const newDir = await api.chooseDownloadsDir();
      if (newDir) toast(tr('다운로드 폴더를 변경했습니다'));
    } catch {
      toast(tr('폴더를 변경할 수 없습니다'));
    }
  };

  const ref = useRef(null);
  useEnter(ref, [], { step: 50 });

  const exportLib = async () => {
    const text = JSON.stringify({ liked: lib.liked, playlists: lib.playlists, savedAlbums: lib.savedAlbums, followed: lib.followed }, null, 1);
    const name = `t-music-library-${new Date().toISOString().slice(0, 10)}.json`;
    if (IS_ANDROID) {
      if (await api.saveFile(name, 'application/json', text)) toast(tr('백업 파일을 저장했습니다'));
      return;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    toast(tr('백업 파일을 저장했습니다'));
  };
  const importLib = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        const listOf = (value) => (Array.isArray(value) ? value.filter((x) => x?.id) : []);
        useUI.getState().prompt({
          title: tr('보관함을 복원할까요?'),
          message: tr('지금 있는 좋아요, 플레이리스트, 앨범, 팔로우가 백업 내용으로 바뀌고 계정에도 반영됩니다.'),
          submitLabel: tr('복원'),
          onSubmit: () => {
            useLibrary.setState({
              liked: listOf(data.liked),
              playlists: listOf(data.playlists).map((p) => ({ ...p, name: String(p.name || tr('플레이리스트')), tracks: listOf(p.tracks) })),
              savedAlbums: listOf(data.savedAlbums),
              followed: listOf(data.followed),
            });
            toast(tr('보관함을 복원했습니다'));
          },
        });
      } catch {
        toast(tr('파일을 읽을 수 없습니다'));
      }
    };
    input.click();
  };

  return (
    <div className="page settings" ref={ref}>
      <div className="page-title" data-enter><h1>{tr('설정')}</h1></div>

      <div className="settings-grid">
        <div className="settings-col">
          <AccountCard />

          <section className="set-card" data-enter>
            <h2><Radio size={18} />{' '}{tr('재생 및 음질 설정')}</h2>
            <p className="muted">{IS_ANDROID ? tr('오디오 재생 방식을 설정해요.') : tr('오디오 재생 방식과 볼륨, 출력 장치를 설정해요.')}</p>

            <div className="set-item" onClick={toggleAutoplay}>
              <div className="set-item-text">
                <span className="set-item-title">{tr('추천곡 자동 재생')}</span>
                <span className="muted small">{tr('대기열의 마지막 곡이 끝나면 비슷한 추천곡을 자동으로 이어서 재생합니다.')}</span>
              </div>
              <div className={`switch ${autoplay ? 'on' : ''}`} />
            </div>

            <div className="set-item" onClick={toggleNormalize}>
              <div className="set-item-text">
                <span className="set-item-title">{tr('음량 자동 균일화 (Normalizer)')}</span>
                <span className="muted small">{tr('곡마다 들쑥날쑥한 볼륨 차이를 실시간으로 완만하게 맞춰줍니다.')}</span>
              </div>
              <div className={`switch ${normalize ? 'on' : ''}`} />
            </div>

            <div className="set-item" style={{ cursor: 'default' }}>
              <div className="set-item-text">
                <span className="set-item-title">{tr('플레이어 스타일')}</span>
                <span className="muted small">{tr('전체 화면 플레이어를 턴테이블이나 카세트로 바꿉니다. 효과음도 함께 바뀝니다.')}</span>
              </div>
              <div className="seg">
                <button className={deckStyle === 'turntable' ? 'on' : ''} onClick={() => useDeck.getState().setStyle('turntable')}>{tr('턴테이블')}</button>
                <button className={deckStyle === 'cassette' ? 'on' : ''} onClick={() => useDeck.getState().setStyle('cassette')}>{tr('카세트')}</button>
              </div>
            </div>

            <div className="set-item" onClick={() => useDeck.getState().setSounds(!deckSounds)}>
              <div className="set-item-text">
                <span className="set-item-title">{tr('시작·끝 효과음')}</span>
                <span className="muted small">
                  {inRoom && !isRoomHost
                    ? tr('같이 듣기 중에는 방장의 설정을 따릅니다. 지금 방은 {0}이에요.', roomSounds ? tr('켜짐') : tr('꺼짐'))
                    : tr('처음 재생할 때와 대기열이 모두 끝날 때 소리가 음악과 자연스럽게 이어집니다. 일시정지나 곡 넘김에는 나지 않아요.')}
                </span>
              </div>
              <div className={`switch ${deckSounds ? 'on' : ''}`} />
            </div>

            {!IS_ANDROID && devices.length > 0 && (
              <div className="set-item" style={{ cursor: 'default' }}>
                <div className="set-item-text">
                  <span className="set-item-title">{tr('오디오 출력 장치')}</span>
                  <span className="muted small">{tr('소리를 출력할 스피커 또는 헤드셋을 선택합니다.')}</span>
                </div>
                <select
                  className="set-select"
                  value={selectedDevice}
                  onChange={(e) => changeDevice(e.target.value)}
                >
                  <option value="">{tr('시스템 기본값')}</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || tr('출력 장치 {0}', i + 1)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </section>

          <section className="set-card" data-enter>
            <h2><Download size={18} />{' '}{tr('다운로드 저장소')}</h2>
            <p className="muted">{tr('{0}곡 저장됨 · {1}', dl.items.length, fmtBytes(dl.totalSize))}</p>
            {!IS_ANDROID && <p className="muted small path">{dl.dir}</p>}
            {!IS_ANDROID && (
              <div className="row-btns">
                <button className="btn" onClick={openDownloads}><FolderOpen size={15} />{' '}{tr('폴더 열기')}</button>
                <button className="btn" onClick={changeDownloadsDir}><FolderEdit size={15} />{' '}{tr('폴더 변경')}</button>
              </div>
            )}
          </section>

          {!IS_ANDROID && <section className="set-card" data-enter>
            <h2><Keyboard size={18} />{' '}{tr('단축키')}</h2>
            <div className="shortcuts">
              <span><kbd>Space</kbd>{' '}{tr('재생 / 일시정지')}</span>
              <span><kbd>↑</kbd> <kbd>↓</kbd>{' '}{tr('음량 조절')}</span>
              <span><kbd>←</kbd> <kbd>→</kbd>{' '}{tr('10초 탐색 (길게 누르면 고속 탐색)')}</span>
              <span><kbd>Ctrl</kbd> <kbd>→</kbd>{' '}{tr('다음 곡')}</span>
              <span><kbd>Ctrl</kbd> <kbd>←</kbd>{' '}{tr('이전 곡')}</span>
              <span><kbd>Ctrl</kbd> <kbd>K</kbd>{' '}{tr('검색창 열기')}</span>
              <span><kbd>Alt</kbd> <kbd>←</kbd> <kbd>→</kbd>{' '}{tr('뒤로 / 앞으로 이동')}</span>
              <span><kbd>Esc</kbd>{' '}{tr('전체 화면 닫기')}</span>
              <span><kbd>{tr('마우스')}</kbd>{' '}{tr('4/5번 앞뒤 이동')}</span>
            </div>
          </section>}

          <section className="set-card about-app" data-enter>
            <h2><Info size={18} />{' '}{tr('앱 정보 및 업데이트')}</h2>
            <div className="about-app-body">
              <img src={logo} alt="T-Music" />
              <div className="about-app-text">
                <span className="about-app-title">T-Music {status.data?.version ? `v${status.data.version}` : ''}</span>
                <p className="muted small">{tr('광고 없는 나만의 음악 플레이어. 개인 학습·사용 목적으로 만들었어요.')}</p>
              </div>
            </div>
            <div className="update-check-row">
              <button className="btn" onClick={() => checkUpdate(false)} disabled={checkingUpdate}>
                <RefreshCw size={14} className={checkingUpdate ? 'spin' : ''} /> {checkingUpdate ? tr('확인 중…') : tr('업데이트 확인')}
              </button>
              {hasUpdate && (
                <button className="btn grad update-available-btn" onClick={openModal}>
                  <Sparkles size={14} />{' '}{tr('v{0} 업데이트 가능', latestVersion)}</button>
              )}
            </div>
          </section>
        </div>
        <div className="settings-col">
          <FriendPrivacyCard />

          {!IS_ANDROID && <section className="set-card" data-enter>
            <h2><Monitor size={18} />{' '}{tr('시스템 및 연동')}</h2>
            <p className="muted">{tr('윈도우 시작 및 디스코드 상태 표시 설정을 관리해요.')}</p>

            <div className="set-item" onClick={toggleAutoStart}>
              <div className="set-item-text">
                <span className="set-item-title">{tr('윈도우 시작 시 자동 실행')}</span>
                <span className="muted small">{tr('PC를 켤 때 T-Music을 백그라운드 트레이로 자동 실행합니다.')}</span>
              </div>
              <div className={`switch ${autoStart ? 'on' : ''}`} />
            </div>

            <div className="set-item" onClick={toggleDiscordRPC}>
              <div className="set-item-text">
                <div className="set-item-head">
                  <span className="set-item-title">{tr('디스코드 활동 상태 (Rich Presence)')}</span>
                  {discordRPC && (
                    <span className={`set-badge ${discordStatus?.connected ? 'ok' : 'wait'}`}>
                      {discordStatus?.connected
                        ? tr('연결됨 ({0})', discordStatus.user?.username || 'Discord')
                        : tr('디스코드 PC 앱 실행 대기 중')}
                    </span>
                  )}
                </div>
                <span className="muted small">{tr('현재 듣고 있는 곡과 재생 시간을 디스코드 프로필에 실시간으로 표시합니다.')}</span>
              </div>
              <div className={`switch ${discordRPC ? 'on' : ''}`} />
            </div>

            {discordRPC && (
              <div className="set-note">
                <b>{tr('디스코드 상태 표시 확인사항')}</b>
                <ol>
                  <li>{tr('웹 브라우저가 아닌')}{' '}<b>{tr('디스코드 PC 프로그램(데스크톱 앱)')}</b>{tr('이 실행 중이어야 연동됩니다.')}</li>
                  <li>{tr('디스코드 설정(톱니바퀴) >')}{' '}<b>{tr('활동 개인정보 보호')}</b> &gt; <b>{tr('\'현재 활동을 상태 메시지로 표시\'')}</b>{tr('가 켜져 있어야 프로필에 나타납니다.')}</li>
                </ol>
              </div>
            )}
          </section>}

          <section className="set-card" data-enter>
            <h2><Languages size={18} />{' '}{tr('언어')}</h2>
            <div className="set-item" style={{ cursor: 'default' }}>
              <div className="set-item-text">
                <span className="set-item-title">{tr('앱 표시 언어')}</span>
                <span className="muted small">{tr('메뉴와 안내 문구의 언어를 바꿉니다. 앱을 다시 불러와서 재생이 멈춰요. 곡 제목처럼 YouTube에서 오는 내용은 그대로예요.')}</span>
              </div>
              <div className="seg">
                {LANGUAGES.map((l) => <button key={l.id} className={LANGUAGE === l.id ? 'on' : ''} onClick={() => setLanguage(l.id)}>{l.label}</button>)}
              </div>
            </div>
          </section>

          <ConvenienceCard />

          <section className="set-card" data-enter>
            <h2><Library size={18} />{' '}{tr('보관함')}</h2>
            <p className="muted">{tr('좋아요와 플레이리스트는 계정에 저장돼서 다른')}{' '}{IS_ANDROID ? tr('기기') : 'PC'}{tr('에서도 이어져요. 유튜브 계정과는 연결되지 않습니다.')}</p>
            <div className="set-stats">
              <div><b>{lib.liked.length}</b><span>{tr('좋아요')}</span></div>
              <div><b>{lib.playlists.length}</b><span>{tr('플레이리스트')}</span></div>
              <div><b>{lib.savedAlbums.length}</b><span>{tr('앨범')}</span></div>
              <div><b>{lib.followed.length}</b><span>{tr('아티스트')}</span></div>
            </div>
            <div className="row-btns">
              <button className="btn" onClick={exportLib}><Download size={15} />{' '}{tr('백업')}</button>
              <button className="btn" onClick={importLib}><Upload size={15} />{' '}{tr('복원')}</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
