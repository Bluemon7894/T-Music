import { useState } from 'react';
import { Library, Plus, Heart, Search, ListMusic, Download, Trash2, Pencil } from 'lucide-react';
import { useLibrary } from '../store/library.js';
import { useNav, useRoute } from '../store/nav.js';
import { useUI, toast } from '../store/ui.js';
import { usePlayer } from '../store/player.js';
import { api, errorText } from '../api.js';
import { Thumb } from './common.jsx';

const FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'playlists', label: '플레이리스트' },
  { id: 'albums', label: '앨범' },
  { id: 'artists', label: '아티스트' },
];

// Accepts a full YouTube / YT Music URL or a bare playlist id.
function playlistIdFrom(input) {
  const s = input.trim();
  try {
    const u = new URL(s);
    return u.searchParams.get('list');
  } catch {
    return /^[\w-]{10,}$/.test(s) ? s : null;
  }
}

export async function importPlaylist() {
  useUI.getState().prompt({
    title: 'YouTube 재생목록 가져오기',
    placeholder: 'https://music.youtube.com/playlist?list=... 또는 youtube.com 링크',
    submitLabel: '가져오기',
    async onSubmit(value) {
      const id = playlistIdFrom(value);
      if (!id) return toast('재생목록 링크를 인식하지 못했습니다');
      toast('재생목록을 불러오는 중…');
      try {
        const pl = await api.playlist(id);
        const newId = useLibrary.getState().createPlaylist(pl.title, pl.tracks, { source: id, thumb: pl.thumb });
        toast(`'${pl.title}' ${pl.tracks.length}곡을 가져왔습니다`);
        useNav.getState().go('local', { id: newId });
      } catch (e) {
        toast(errorText(e));
      }
    },
  });
}

export default function Sidebar() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const route = useRoute();
  const openMenu = useUI((s) => s.openMenu);
  const prompt = useUI((s) => s.prompt);
  const currentCtx = usePlayer((s) => s.context?.name);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);

  const isActive = (name, id) => route.name === name && (id == null || route.params.id === id);
  const match = (s) => !q || (s || '').toLowerCase().includes(q.toLowerCase());

  const newPlaylist = () => {
    const id = lib.createPlaylist();
    go('local', { id });
  };

  const playlistMenu = (e, p) => openMenu(e, [
    { label: '이름 바꾸기', icon: Pencil, onClick: () => prompt({ title: '플레이리스트 이름 바꾸기', value: p.name, submitLabel: '저장', onSubmit: (v) => v.trim() && lib.renamePlaylist(p.id, v.trim()) }) },
    { label: '삭제', icon: Trash2, onClick: () => { lib.deletePlaylist(p.id); if (isActive('local', p.id)) go('home'); toast('플레이리스트를 삭제했습니다'); } },
  ]);

  const rows = [];
  if (filter === 'all' || filter === 'playlists') {
    if (match('좋아요 표시한 곡')) {
      rows.push(
        <div key="liked" className={`lib-row ${isActive('liked') ? 'active' : ''}`} onClick={() => go('liked')}>
          <div className="lib-art liked-art"><Heart size={18} fill="#fff" /></div>
          <div className="lib-text">
            <div className={`lib-name ${currentCtx === '좋아요 표시한 곡' ? 'playing' : ''}`}>좋아요 표시한 곡</div>
            <div className="lib-sub">플레이리스트 • {lib.liked.length}곡</div>
          </div>
        </div>,
      );
    }
    for (const p of lib.playlists.filter((p) => match(p.name))) {
      rows.push(
        <div key={p.id} className={`lib-row ${isActive('local', p.id) ? 'active' : ''}`} onClick={() => go('local', { id: p.id })} onContextMenu={(e) => playlistMenu(e, p)}>
          {p.thumb || p.tracks[0]?.thumb ? <Thumb src={p.thumb || p.tracks[0]?.thumb} className="lib-art" /> : <div className="lib-art"><ListMusic size={20} /></div>}
          <div className="lib-text">
            <div className={`lib-name ${currentCtx === p.name ? 'playing' : ''}`}>{p.name}</div>
            <div className="lib-sub">플레이리스트 • {p.tracks.length}곡</div>
          </div>
        </div>,
      );
    }
  }
  if (filter === 'all' || filter === 'albums') {
    for (const a of lib.savedAlbums.filter((a) => match(a.title))) {
      rows.push(
        <div key={'al' + a.id} className={`lib-row ${isActive('album', a.id) ? 'active' : ''}`} onClick={() => go('album', { id: a.id })}>
          <Thumb src={a.thumb} className="lib-art" />
          <div className="lib-text">
            <div className="lib-name">{a.title}</div>
            <div className="lib-sub">{a.type || '앨범'} • {a.artists?.map((x) => x.name).join(', ')}</div>
          </div>
        </div>,
      );
    }
  }
  if (filter === 'all' || filter === 'artists') {
    for (const a of lib.followed.filter((a) => match(a.name))) {
      rows.push(
        <div key={'ar' + a.id} className={`lib-row ${isActive('artist', a.id) ? 'active' : ''}`} onClick={() => go('artist', { id: a.id })}>
          <Thumb src={a.thumb} round className="lib-art" />
          <div className="lib-text">
            <div className="lib-name">{a.name}</div>
            <div className="lib-sub">아티스트</div>
          </div>
        </div>,
      );
    }
  }

  return (
    <aside className="sidebar panel">
      <div className="lib-head">
        <div className="lib-title"><Library size={22} /> 내 라이브러리</div>
        <div className="lib-actions">
          <button className="icon-btn circle" title="YouTube 재생목록 가져오기" onClick={importPlaylist}><Download size={17} /></button>
          <button className="icon-btn circle" title="플레이리스트 만들기" onClick={newPlaylist}><Plus size={18} /></button>
        </div>
      </div>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <div className="lib-search">
        {searching ? (
          <input autoFocus value={q} placeholder="내 라이브러리에서 검색" onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} />
        ) : (
          <button className="icon-btn" onClick={() => setSearching(true)} aria-label="라이브러리 검색"><Search size={16} /></button>
        )}
      </div>
      <div className="lib-list">
        {rows}
        {rows.length <= 1 && !q && (
          <div className="lib-empty">
            <p className="lib-empty-title">첫 플레이리스트를 만들어 보세요</p>
            <p>어렵지 않아요. 저희가 도와드릴게요.</p>
            <button className="pill white" onClick={newPlaylist}>플레이리스트 만들기</button>
            <button className="pill" onClick={importPlaylist}>YouTube 재생목록 가져오기</button>
          </div>
        )}
      </div>
    </aside>
  );
}
