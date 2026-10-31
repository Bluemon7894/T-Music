import { useEffect, useRef } from 'react';
import { api } from './lib/api.js';
import { useRoute, useNav } from './store/nav.js';
import { usePlayer } from './store/player.js';
import { useUI } from './store/ui.js';
import { initDownloads } from './store/downloads.js';
import { useUpdater } from './store/updater.js';
import Sidebar from './components/layout/Sidebar.jsx';
import TopBar from './components/layout/TopBar.jsx';
import PlayerDock from './components/layout/PlayerDock.jsx';
import NowPanel from './components/layout/NowPanel.jsx';
import Stage from './components/layout/Stage.jsx';
import UpdateModal from './components/UpdateModal.jsx';
import { ContextMenu, Toast, Dialog } from './components/Overlays.jsx';
import Home from './views/Home.jsx';
import Search from './views/Search.jsx';
import Artist from './views/Artist.jsx';
import Library from './views/Library.jsx';
import Downloads from './views/Downloads.jsx';
import Settings from './views/Settings.jsx';
import { Album, Playlist, Liked, LocalPlaylist } from './views/Collection.jsx';

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
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (typing) return;
      const p = usePlayer.getState();

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

export default function App() {
  const route = useRoute();
  const panelOpen = useUI((s) => s.panelOpen);
  const stage = useUI((s) => s.stage);
  const mainRef = useRef(null);
  const index = useNav((s) => s.index);
  const currentTrack = usePlayer((s) => s.queue[s.index]);

  useShortcuts();

  useEffect(() => {
    initDownloads();
    useUpdater.getState().init();
  }, []);

  // Handle media controls from system tray
  useEffect(() => {
    return api.onMediaControl((action) => {
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
      api.updateTrayTooltip('T-Music - 음악 플레이어').catch(() => {});
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

  return (
    <div className={`app ${panelOpen ? 'with-panel' : ''}`}>
      <div className="aurora"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <Sidebar />
      <TopBar />
      <main className="main" ref={mainRef}>
        <View route={route} key={index} />
      </main>
      {panelOpen && <NowPanel />}
      <PlayerDock />
      {stage && <Stage />}
      <ContextMenu />
      <Dialog />
      <Toast />
      <UpdateModal />
    </div>
  );
}
