import { useMemo } from 'react';
import { Heart } from 'lucide-react';
import { api } from '../api.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { greeting } from '../util.js';
import { useAsync, Thumb, PlayButton, Loading, ErrorMsg } from '../components/common.jsx';
import { Shelf, openItem, playItem } from '../components/Cards.jsx';

function QuickTile({ item, onPlay }) {
  const go = useNav((s) => s.go);
  return (
    <div className="quick-tile" onClick={() => openItem(item, go)}>
      {item.icon ? <div className="quick-art liked-art">{item.icon}</div> : <Thumb src={item.thumb} className="quick-art" />}
      <span className="quick-name">{item.title || item.name}</span>
      <PlayButton size={34} className="quick-play" onClick={onPlay} />
    </div>
  );
}

export default function Home() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const playList = usePlayer((s) => s.playList);
  const seed = lib.recent[0]?.id;
  const home = useAsync(() => api.home(), []);
  const forYou = useAsync(() => (seed ? api.related(seed) : Promise.resolve([])), [seed]);

  const quick = useMemo(() => {
    const items = [];
    if (lib.liked.length) items.push({ kind: 'liked', title: '좋아요 표시한 곡', icon: <Heart size={22} fill="#fff" /> });
    for (const p of lib.playlists.slice(0, 3)) items.push({ kind: 'local', id: p.id, title: p.name, thumb: p.thumb || p.tracks[0]?.thumb, tracks: p.tracks });
    for (const a of lib.savedAlbums.slice(0, 2)) items.push({ kind: 'album', ...a });
    for (const t of lib.recent) {
      if (items.length >= 8) break;
      items.push({ ...t, kind: 'track' });
    }
    return items.slice(0, 8);
  }, [lib.liked.length, lib.playlists, lib.savedAlbums, lib.recent]);

  const playQuick = (it) => {
    if (it.kind === 'liked') return playList(lib.liked, 0, { name: '좋아요 표시한 곡' });
    if (it.kind === 'local') return playList(it.tracks, 0, { name: it.title });
    return playItem(it);
  };

  return (
    <div className="page home">
      <div className="home-glow" />
      <h1 className="greeting">{greeting()}</h1>
      {quick.length > 0 && (
        <div className="quick-grid">
          {quick.map((it, i) => (
            <QuickTile key={it.kind + (it.id || i)} item={it} onPlay={() => playQuick(it)} />
          ))}
        </div>
      )}

      {lib.recent.length > 0 && (
        <Shelf title="최근 재생한 항목" items={lib.recent.slice(0, 20).map((t) => ({ ...t, kind: 'track' }))} />
      )}
      {forYou.data?.length > 0 && (
        <Shelf title={`'${lib.recent[0].title}'와 비슷한 곡`} items={forYou.data.map((t) => ({ ...t, kind: 'track' }))} />
      )}
      {lib.followed.length > 0 && <Shelf title="팔로우한 아티스트" items={lib.followed.map((a) => ({ ...a, kind: 'artist' }))} />}

      {home.loading && !home.data && <Loading />}
      {home.error && <ErrorMsg error={home.error} />}
      {home.data?.shelves.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}

      {!lib.recent.length && (
        <div className="home-hint">
          <p>위쪽 검색창에서 좋아하는 곡이나 아티스트를 찾아보세요.</p>
          <button className="pill white" onClick={() => go('search', {})}>검색하러 가기</button>
        </div>
      )}
    </div>
  );
}
