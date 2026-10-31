import { useRef, useState } from 'react';
import { Heart, Link2, ListPlus, Plus, Library as LibraryIcon } from 'lucide-react';
import { api, errorText } from '../lib/api.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { useEnter } from '../lib/motion.js';
import { openSharedPlaylist } from '../lib/sharedPlaylists.js';
import { toast, useUI } from '../store/ui.js';
import { Grid } from '../components/Cards.jsx';
import { Empty, PlayButton } from '../components/common.jsx';
import { tr } from '../lib/i18n.js';

const TABS = [
  { id: 'all', label: tr('전체') },
  { id: 'playlists', label: tr('플레이리스트') },
  { id: 'albums', label: tr('앨범') },
  { id: 'artists', label: tr('아티스트') },
];

const PLAYLIST_ID = /^[\w-]{10,}$/;

// Takes a youtube.com or music.youtube.com link, including one to a video playing from the list, or a bare id.
function playlistIdFrom(text) {
  const value = text.trim();
  if (PLAYLIST_ID.test(value)) return value;
  try {
    const id = new URL(/^https?:/i.test(value) ? value : `https://${value}`).searchParams.get('list');
    return id && PLAYLIST_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export default function Library() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const [tab, setTab] = useState('all');
  const ref = useRef(null);
  useEnter(ref, [tab]);

  const openLink = () => useUI.getState().prompt({
    title: tr('공유 플레이리스트 열기'),
    placeholder: tr('tmusic://playlist/... 링크를 붙여넣으세요'),
    submitLabel: tr('열기'),
    onSubmit: async (text) => {
      const id = await openSharedPlaylist(text).catch(() => null);
      if (id) go('local', { id });
      else toast(tr('공유 플레이리스트를 찾을 수 없습니다'));
    },
  });

  const importFromYouTube = () => useUI.getState().prompt({
    title: tr('YouTube 재생목록 가져오기'),
    placeholder: tr('youtube.com 또는 music.youtube.com 재생목록 링크'),
    submitLabel: tr('가져오기'),
    onSubmit: async (text) => {
      const id = playlistIdFrom(text);
      if (!id) {
        toast(tr('재생목록 링크를 인식하지 못했습니다'));
        return;
      }
      toast(tr('재생목록을 불러오는 중...'));
      try {
        const list = await api.playlist(id);
        if (!list?.tracks?.length) {
          toast(tr('곡을 찾지 못했습니다. 비공개 재생목록은 가져올 수 없어요.'));
          return;
        }
        const created = lib.createPlaylist(list.title, list.tracks, list.thumb ? { thumb: list.thumb } : {});
        toast(tr('\'{0}\' {1}곡을 가져왔습니다', list.title, list.tracks.length));
        go('local', { id: created });
      } catch (e) {
        toast(errorText(e));
      }
    },
  });

  const playlists = lib.playlists.map((p) => ({ kind: 'local', id: p.id, title: p.name, subtitle: tr('{0}곡', p.tracks.length), thumb: p.thumb || p.tracks[0]?.thumb }));
  const albums = lib.savedAlbums.map((a) => ({ ...a, kind: 'album' }));
  const artists = lib.followed.map((a) => ({ ...a, kind: 'artist' }));
  const items = tab === 'playlists' ? playlists : tab === 'albums' ? albums : tab === 'artists' ? artists : [...playlists, ...albums, ...artists];

  return (
    <div className="page library" ref={ref}>
      <div className="page-title" data-enter>
        <h1>{tr('보관함')}</h1>
        <div className="row-btns">
          <button className="btn" onClick={importFromYouTube}><ListPlus size={15} />{' '}{tr('YouTube 가져오기')}</button>
          <button className="btn" onClick={openLink}><Link2 size={15} />{' '}{tr('공유 링크 열기')}</button>
          <button className="btn grad" onClick={() => go('local', { id: lib.createPlaylist() })}><Plus size={15} />{' '}{tr('새 플레이리스트')}</button>
        </div>
      </div>

      <div className="liked-banner" data-enter onClick={() => go('liked')}>
        <div>
          <span className="lb-kicker"><Heart size={14} fill="currentColor" />{' '}{tr('플레이리스트')}</span>
          <h2>{tr('좋아요 표시한 곡')}</h2>
          <p>{lib.liked.length ? lib.liked.slice(0, 4).map((t) => t.title).join(' · ') : tr('하트를 누른 곡이 여기에 모여요')}</p>
          <small>{tr('{0}곡', lib.liked.length)}</small>
        </div>
        {lib.liked.length > 0 && <PlayButton size={56} onClick={() => usePlayer.getState().playList(lib.liked, 0, { name: tr('좋아요 표시한 곡') })} />}
      </div>

      <div className="chips" data-enter>
        {TABS.map((t) => <button key={t.id} className={`chip ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {items.length ? <Grid items={items} /> : (
        <Empty icon={LibraryIcon} title={tr('보관함이 비어 있어요')} text={tr('플레이리스트를 만들거나, 앨범을 저장하고 아티스트를 팔로우해 보세요.')}>
          <button className="btn grad" onClick={() => go('search', {})}>{tr('둘러보기')}</button>
        </Empty>
      )}
    </div>
  );
}
