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
    const onKey = (e) => {
      const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
      const p = usePlayer.getState();
      if (e.code === 'Space' && !typing) { e.preventDefault(); p.toggle(); }
      else if (e.ctrlKey && e.key === 'ArrowRight') { e.preventDefault(); p.next(); }
      else if (e.ctrlKey && e.key === 'ArrowLeft') { e.preventDefault(); p.prev(); }
      else if (e.ctrlKey && e.key === 'ArrowUp') { e.preventDefault(); p.setVolume(Math.min(1, p.volume + 0.1)); }
      else if (e.ctrlKey && e.key === 'ArrowDown') { e.preventDefault(); p.setVolume(Math.max(0, p.volume - 0.1)); }
      else if (e.altKey && e.key === 'ArrowLeft') useNav.getState().back();
      else if (e.altKey && e.key === 'ArrowRight') useNav.getState().forward();
    };
    // Mouse back/forward buttons.
    const onMouse = (e) => {
      if (e.button === 3) useNav.getState().back();
      if (e.button === 4) useNav.getState().forward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse); };
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

  const playing = usePlayer((s) => s.playing);
  const currentTime = usePlayer((s) => s.time);
  const duration = usePlayer((s) => s.duration);

  // Update tray tooltip with current playing track
  useEffect(() => {
    if (currentTrack) {
      const artist = currentTrack.artists?.map((a) => a.name).join(', ') || currentTrack.artist || '';
      api.updateTrayTooltip(`T-Music | ${currentTrack.title}${artist ? ` - ${artist}` : ''}`).catch(() => {});
    } else {
      api.updateTrayTooltip('T-Music - 음악 플레이어').catch(() => {});
    }
  }, [currentTrack?.id, currentTrack?.title]);

  // Sync Discord Rich Presence
  useEffect(() => {
    if (currentTrack) {
      const artist = currentTrack.artists?.map((a) => a.name).join(', ') || currentTrack.artist || 'T-Music';
      api.updateDiscordActivity({
        title: currentTrack.title,
        artist,
        thumb: currentTrack.thumb,
        playing,
        time: currentTime,
        duration: currentTrack.duration || duration || 0,
      }).catch(() => {});
    } else {
      api.clearDiscordActivity().catch(() => {});
    }
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
