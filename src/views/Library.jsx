import { useRef, useState } from 'react';
import { Heart, Link2, Plus, Library as LibraryIcon } from 'lucide-react';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { useEnter } from '../lib/motion.js';
import { openSharedPlaylist } from '../lib/sharedPlaylists.js';
import { toast, useUI } from '../store/ui.js';
import { Grid } from '../components/Cards.jsx';
import { Empty, PlayButton } from '../components/common.jsx';

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'playlists', label: '플레이리스트' },
  { id: 'albums', label: '앨범' },
  { id: 'artists', label: '아티스트' },
];

export default function Library() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const [tab, setTab] = useState('all');
  const ref = useRef(null);
  useEnter(ref, [tab]);

  const openLink = () => useUI.getState().prompt({
    title: '공유 플레이리스트 열기',
    placeholder: 'tmusic://playlist/... 링크를 붙여넣으세요',
    submitLabel: '열기',
    onSubmit: async (text) => {
      const id = await openSharedPlaylist(text).catch(() => null);
      if (id) go('local', { id });
      else toast('공유 플레이리스트를 찾을 수 없습니다');
    },
  });

  const playlists = lib.playlists.map((p) => ({ kind: 'local', id: p.id, title: p.name, subtitle: `${p.tracks.length}곡`, thumb: p.thumb || p.tracks[0]?.thumb }));
  const albums = lib.savedAlbums.map((a) => ({ ...a, kind: 'album' }));
  const artists = lib.followed.map((a) => ({ ...a, kind: 'artist' }));
  const items = tab === 'playlists' ? playlists : tab === 'albums' ? albums : tab === 'artists' ? artists : [...playlists, ...albums, ...artists];

  return (
    <div className="page library" ref={ref}>
      <div className="page-title" data-enter>
        <h1>보관함</h1>
        <div className="row-btns">
          <button className="btn" onClick={openLink}><Link2 size={15} /> 공유 링크 열기</button>
          <button className="btn grad" onClick={() => go('local', { id: lib.createPlaylist() })}><Plus size={15} /> 새 플레이리스트</button>
        </div>
      </div>

      <div className="liked-banner" data-enter onClick={() => go('liked')}>
        <div>
          <span className="lb-kicker"><Heart size={14} fill="currentColor" /> 플레이리스트</span>
          <h2>좋아요 표시한 곡</h2>
          <p>{lib.liked.length ? lib.liked.slice(0, 4).map((t) => t.title).join(' · ') : '하트를 누른 곡이 여기에 모여요'}</p>
          <small>{lib.liked.length}곡</small>
        </div>
        {lib.liked.length > 0 && <PlayButton size={56} onClick={() => usePlayer.getState().playList(lib.liked, 0, { name: '좋아요 표시한 곡' })} />}
      </div>

      <div className="chips" data-enter>
        {TABS.map((t) => <button key={t.id} className={`chip ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {items.length ? <Grid items={items} /> : (
        <Empty icon={LibraryIcon} title="보관함이 비어 있어요" text="플레이리스트를 만들거나, 앨범을 저장하고 아티스트를 팔로우해 보세요.">
          <button className="btn grad" onClick={() => go('search', {})}>둘러보기</button>
        </Empty>
      )}
    </div>
  );
}
