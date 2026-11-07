import { Component, useEffect, useRef } from 'react';
import { setupUndo } from './lib/undoSetup.js';
import { undoLast } from './store/undo.js';
import { recoverFromCrash, watchForeground } from './lib/heal.js';
import FriendProfile from './views/FriendProfile.jsx';
import ResizeHandle from './components/layout/ResizeHandle.jsx';
import { api } from './lib/api.js';
import { useRoute, useNav } from './store/nav.js';
import { resumeOnLaunch, usePlayer } from './store/player.js';
import { SIDE, toast, useUI } from './store/ui.js';
import { openSharedPlaylist } from './lib/sharedPlaylists.js';
import { initDownloads } from './store/downloads.js';
import { useUpdater } from './store/updater.js';
import { useAccount } from './store/account.js';
import { useRoom } from './store/room.js';
import Sidebar from './components/layout/Sidebar.jsx';
import TopBar from './components/layout/TopBar.jsx';
import PlayerDock from './components/layout/PlayerDock.jsx';
import NowPanel from './components/layout/NowPanel.jsx';
import Stage from './components/layout/Stage.jsx';
import MiniPlayer from './components/layout/MiniPlayer.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import { ContextMenu, Toast, Dialog } from './components/Overlays.jsx';
import Login, { Splash } from './views/Login.jsx';
import Home from './views/Home.jsx';
import Search from './views/Search.jsx';
import Artist from './views/Artist.jsx';
import Library from './views/Library.jsx';
import Downloads from './views/Downloads.jsx';
import Settings from './views/Settings.jsx';
import Room from './views/Room.jsx';
import Friends from './views/Friends.jsx';
import Radio from './views/Radio.jsx';
import InvitePrompt from './components/InvitePrompt.jsx';
import MobileShell from './components/mobile/MobileShell.jsx';
import { IS_ANDROID } from './lib/platform.js';
import { Album, Playlist, Liked, LocalPlaylist } from './views/Collection.jsx';
import { LANGUAGE, tr } from './lib/i18n.js';
import { installErrorReporting, reportError } from './lib/telemetry.js';
import './store/equalizer.js'; // applies the saved equalizer before anything plays
import { startQuickBridge } from './lib/quickBridge.js';
import { tintFrom } from './lib/tint.js';

installErrorReporting();

// A notice from remote-config.json, shown once per notice on this device.
const NOTICE_KEY = 't-music-notice-seen';
function showRemoteNotice() {
  api.remoteNotice().then((n) => {
    const text = n && (LANGUAGE === 'en' ? n.en || n.ko : n.ko || n.en);
    if (!text) return;
    try {
      if (localStorage.getItem(NOTICE_KEY) === n.id) return;
      localStorage.setItem(NOTICE_KEY, n.id);
    } catch { /* show it anyway */ }
    setTimeout(() => toast(text), 2500);
  }).catch(() => {});
}

function View({ route }) {
  const p = route.params;
  switch (route.name) {
    case 'search': return <Search q={p.q} />;
    case 'album': return <Album key={p.id} id={p.id} />;
    case 'artist': return <Artist key={p.id} id={p.id} />;
    case 'playlist': return <Playlist key={p.id} id={p.id} />;
    case 'liked': return <Liked />;
    case 'local': return <LocalPlaylist key={p.id} id={p.id} />;
    case 'library': return <Library />;
    case 'downloads': return <Downloads />;
    case 'settings': return <Settings />;
    case 'room': return <Room />;
    case 'friends': return <Friends />;
    case 'friend': return <FriendProfile key={p.uid} uid={p.uid} />;
    case 'radio': return <Radio />;
    default: return <Home />;
  }
}

function useShortcuts() {
  useEffect(() => {
    let holdStartTime = 0;
    let heldKey = null;

    const stopHold = () => {
      heldKey = null;
      holdStartTime = 0;
    };

    const onKey = (e) => {
      if (document.querySelector('.modal-back,.lyrics-picker-backdrop,.update-modal-backdrop')) return;
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (typing) return;
      const p = usePlayer.getState();

      if (e.ctrlKey && !e.shiftKey && (e.code === 'KeyZ' || e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        p.toggle();
        return;
      }
      if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault();
        p.next();
        return;
      }
      if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        p.prev();
        return;
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        useNav.getState().back();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight') {
        useNav.getState().forward();
        return;
      }

      // ArrowUp: Volume up (5%)
      if (e.key === 'ArrowUp' && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const next = Math.min(1, Math.round((p.volume + 0.05) * 100) / 100);
        p.setVolume(next);
        return;
      }

      // ArrowDown: Volume down (5%)
      if (e.key === 'ArrowDown' && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const next = Math.max(0, Math.round((p.volume - 0.05) * 100) / 100);
        p.setVolume(next);
        return;
      }

      // ArrowLeft / ArrowRight: Seek 10s on tap, and accelerating fast seek when held down
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const curTime = typeof p.getPreciseTime === 'function' ? p.getPreciseTime() : p.time;

        if (!e.repeat) {
          heldKey = e.key;
          holdStartTime = performance.now();
          p.seek(curTime + dir * 10);
        } else {
          const elapsed = performance.now() - (holdStartTime || performance.now());
          const step = elapsed > 2000 ? 8 : elapsed > 800 ? 4 : 2;
          p.seek(curTime + dir * step);
        }
        return;
      }
    };

    const onKeyUp = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        stopHold();
      }
    };

    // Mouse back/forward buttons.
    const onMouse = (e) => {
      if (e.button === 3) useNav.getState().back();
      if (e.button === 4) useNav.getState().forward();
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', stopHold);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stopHold);
      window.removeEventListener('mouseup', onMouse);
      stopHold();
    };
  }, []);
}

function MainApp() {
  const route = useRoute();
  const panelOpen = useUI((s) => s.panelOpen);
  const stage = useUI((s) => s.stage);
  const mini = useUI((s) => s.mini);
  const mainRef = useRef(null);
  const index = useNav((s) => s.index);
  const currentTrack = usePlayer((s) => s.queue[s.index]);

  const sideOpen = useUI((s) => s.sideOpen);
  const sideWidth = useUI((s) => s.sideWidth);
  const panelWidth = useUI((s) => s.panelWidth);

  useShortcuts();

  useEffect(() => {
    initDownloads();
    useUpdater.getState().init();
    showRemoteNotice();
    startQuickBridge();
    return watchForeground();
  }, []);

  // Invite links: tmusic://join/CODE, possibly opened before the app was running or signed in.
  useEffect(() => {
    const openInvite = () => {
      api.takeInvite().then(async (invite) => {
        if (!invite) return;
        useUI.getState().setMini(false);
        if (invite.kind === 'room') {
          useNav.getState().go('room', {});
          if (useRoom.getState().code === invite.code) return;
          useRoom.getState().join(invite.code);
          return;
        }
        const id = await openSharedPlaylist(invite.code).catch(() => null);
        if (id) useNav.getState().go('local', { id });
        else toast(tr('공유 플레이리스트를 찾을 수 없습니다'));
      }).catch(() => {});
    };
    openInvite();
    return api.onInvite(openInvite);
  }, []);

  // Handle media controls from system tray
  useEffect(() => {
    return api.onMediaControl((action) => {
      const radio = globalThis.__tmRadioControl;
      if (radio?.active()) {
        if (action === 'toggle') radio.toggle();
        else radio.step(action === 'next' ? 1 : -1);
        return;
      }
      const p = usePlayer.getState();
      if (action === 'toggle') p.toggle();
      else if (action === 'next') p.next();
      else if (action === 'prev') p.prev();
    });
  }, []);

  // Don't subscribe to the playback time here: it would re-render the whole app four times a second.
  const playing = usePlayer((s) => s.playing);

  // Update tray tooltip with current playing track
  useEffect(() => {
    if (currentTrack) {
      const artist = currentTrack.artists?.map((a) => a.name).join(', ') || currentTrack.artist || '';
      api.updateTrayTooltip(`T-Music | ${currentTrack.title}${artist ? ` - ${artist}` : ''}`).catch(() => {});
    } else {
      api.updateTrayTooltip(tr('T-Music - 음악 플레이어')).catch(() => {});
    }
  }, [currentTrack?.id, currentTrack?.title]);

  // Sync Discord Rich Presence (seeking moves the timer shown on the profile too)
  useEffect(() => {
    if (!currentTrack) {
      api.clearDiscordActivity().catch(() => {});
      return undefined;
    }
    const send = () => {
      const p = usePlayer.getState();
      api.updateDiscordActivity({
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artists?.map((a) => a.name).join(', ') || currentTrack.artist || 'T-Music',
        thumb: currentTrack.thumb,
        playing,
        time: p.getPreciseTime(),
        duration: currentTrack.duration || p.duration || 0,
      }).catch(() => {});
    };
    send();
    window.addEventListener('t-music:seeked', send);
    return () => window.removeEventListener('t-music:seeked', send);
  }, [currentTrack?.id, currentTrack?.title, playing]);

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [index]);

  // The background takes the colour of the cover that's playing.
  useEffect(() => { tintFrom(currentTrack?.thumb); }, [currentTrack?.thumb]);

  if (IS_ANDROID) return <MobileShell mainRef={mainRef}><View route={route} key={index} /></MobileShell>;
  if (mini) return <><MiniPlayer /><Toast /></>;

  return (
    <div className={`app ${panelOpen ? 'with-panel' : ''} ${sideOpen ? '' : 'side-closed'}`} style={{ '--side': `${sideOpen ? sideWidth : SIDE.rail}px`, '--panel': `${panelWidth}px` }}>
      <div className="aurora"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <Sidebar />
      <TopBar />
      <main className="main" ref={mainRef}>
        <View route={route} key={index} />
      </main>
      <ResizeHandle bar="side" />
      {panelOpen && <NowPanel />}
      {panelOpen && <ResizeHandle bar="panel" />}
      <PlayerDock />
      {stage && <Stage />}
      <ContextMenu />
      <Dialog />
      <Toast />
      <InvitePrompt />
      <UpdateModal />
    </div>
  );
}

// Without this, an error while drawing any part of the app leaves the whole window blank.
class CrashScreen extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[app]', error);
    reportError('crash', error?.message || String(error), { screen: true, stack: String(info?.componentStack || '').slice(0, 400) });
    recoverFromCrash();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="login">
        <div className="login-drag" />
        <main className="login-card">
          <h1>{tr('문제가 생겼어요')}</h1>
          <p className="login-lead">{tr('화면을 그리다 오류가 났어요. 보관함과 계정은 그대로예요.')}</p>
          <div className="login-actions">
            <button className="login-btn google" onClick={() => window.location.reload()}>{tr('다시 시작')}</button>
          </div>
        </main>
      </div>
    );
  }
}

setupUndo();

function Root() {
  const status = useAccount((s) => s.status);
  const offline = useAccount((s) => s.offline);
  useEffect(() => {
    if (status === 'signedIn' || offline) resumeOnLaunch();
  }, [status, offline]);
  if (status === 'loading') return <Splash />;
  if (status === 'signedOut' && !offline) return <Login />;
  return <MainApp />;
}

export default function App() {
  return <CrashScreen><Root /></CrashScreen>;
}
