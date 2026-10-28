import { useEffect, useRef } from 'react';
import { useRoute, useNav } from './store/nav.js';
import { usePlayer } from './store/player.js';
import { useUI } from './store/ui.js';
import TopBar from './components/TopBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import PlayerBar from './components/PlayerBar.jsx';
import QueuePanel from './components/QueuePanel.jsx';
import { ContextMenu, Toast, Dialog } from './components/Overlays.jsx';
import Home from './views/Home.jsx';
import Search from './views/Search.jsx';
import Artist from './views/Artist.jsx';
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
  const queueOpen = useUI((s) => s.queueOpen);
  const mainRef = useRef(null);
  const index = useNav((s) => s.index);
  useShortcuts();

  useEffect(() => { mainRef.current?.scrollTo(0, 0); }, [index]);

  return (
    <div className={`app ${queueOpen ? 'with-queue' : ''}`}>
      <TopBar />
      <Sidebar />
      <main className="main panel" ref={mainRef}>
        <View route={route} />
      </main>
      {queueOpen && <QueuePanel />}
      <PlayerBar />
      <ContextMenu />
      <Dialog />
      <Toast />
    </div>
  );
}
