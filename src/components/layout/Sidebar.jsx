import { useLayoutEffect, useRef, useState } from 'react';
import { Home, Search, Library, ArrowDownToLine, Plus, Heart, ListMusic, Link2, Trash2, Pencil, Disc3 } from 'lucide-react';
import { useLibrary } from '../../store/library.js';
import { useNav, useRoute } from '../../store/nav.js';
import { useUI, toast } from '../../store/ui.js';
import { usePlayer } from '../../store/player.js';
import { useDownloads } from '../../store/downloads.js';
import { api, errorText } from '../../lib/api.js';
import { animate, ease } from '../../lib/motion.js';
import { Thumb, Equalizer } from '../common.jsx';
import logo from '../../assets/logo-mark.png';

const NAV = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'search', label: '검색', icon: Search },
  { id: 'library', label: '보관함', icon: Library },
  { id: 'downloads', label: '다운로드', icon: ArrowDownToLine },
];

// Accepts a full YouTube / YT Music URL or a bare playlist id.
function playlistIdFrom(input) {
  const s = input.trim();
  try {
    return new URL(s).searchParams.get('list');
  } catch {
    return /^[\w-]{10,}$/.test(s) ? s : null;
  }
}

export function importPlaylist() {
  useUI.getState().prompt({
    title: 'YouTube 재생목록 가져오기',
    placeholder: 'music.youtube.com 또는 youtube.com 재생목록 링크',
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

function NavList() {
  const route = useRoute();
  const go = useNav((s) => s.go);
  const jobs = useDownloads((s) => s.jobs.filter((j) => j.status !== 'error').length);
  const list = useRef(null);
  const pill = useRef(null);
  const active = NAV.findIndex((n) => n.id === route.name || (n.id === 'library' && ['liked', 'local'].includes(route.name)));

  // Slide the highlight pill to the active item with a spring.
  useLayoutEffect(() => {
    const items = list.current?.querySelectorAll('.nav-item');
    if (!items || active < 0) { if (pill.current) pill.current.style.opacity = 0; return; }
    const el = items[active];
    pill.current.style.opacity = 1;
    animate(pill.current, { translateY: el.offsetTop, height: el.offsetHeight, ease: ease.bouncy });
  }, [active]);

  return (
    <nav className="nav" ref={list}>
      <span className="nav-pill" ref={pill} />
      {NAV.map((n, i) => (
        <button key={n.id} className={`nav-item ${i === active ? 'on' : ''}`} onClick={() => go(n.id, {})}>
          <n.icon size={20} />
          <span>{n.label}</span>
          {n.id === 'downloads' && jobs > 0 && <b className="nav-badge">{jobs}</b>}
        </button>
      ))}
    </nav>
  );
}

export default function Sidebar() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const route = useRoute();
  const openMenu = useUI((s) => s.openMenu);
  const prompt = useUI((s) => s.prompt);
  const ctxName = usePlayer((s) => s.context?.name);
  const playing = usePlayer((s) => s.playing);
  const [tab, setTab] = useState('playlists');

  const isActive = (name, id) => route.name === name && (id == null || route.params.id === id);
  const newPlaylist = () => go('local', { id: lib.createPlaylist() });

  const playlistMenu = (e, p) => openMenu(e, [
    { label: '이름 바꾸기', icon: Pencil, onClick: () => prompt({ title: '플레이리스트 이름 바꾸기', value: p.name, submitLabel: '저장', onSubmit: (v) => v.trim() && lib.renamePlaylist(p.id, v.trim()) }) },
    { label: '삭제', icon: Trash2, onClick: () => { lib.deletePlaylist(p.id); if (isActive('local', p.id)) go('home'); toast('플레이리스트를 삭제했습니다'); } },
  ]);

  const Row = ({ active, onClick, onContextMenu, art, name, sub }) => (
    <div className={`lib-row ${active ? 'active' : ''}`} onClick={onClick} onContextMenu={onContextMenu}>
      {art}
      <div className="lib-text">
        <div className={`lib-name ${ctxName === name ? 'playing' : ''}`}>{name}</div>
        <div className="lib-sub">{sub}</div>
      </div>
      {ctxName === name && <Equalizer playing={playing} />}
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="brand" onClick={() => go('home')}>
        <img src={logo} alt="" />
        <span>T-Music</span>
      </div>
      <NavList />

      <div className="lib-head">
        <div className="seg">
          <button className={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>플레이리스트</button>
          <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>앨범·아티스트</button>
        </div>
        <div className="lib-actions">
          <button className="icon-btn circle" title="YouTube 재생목록 가져오기" onClick={importPlaylist}><Link2 size={16} /></button>
          <button className="icon-btn circle accent" title="새 플레이리스트" onClick={newPlaylist}><Plus size={17} /></button>
        </div>
      </div>

      <div className="lib-list">
        {tab === 'playlists' ? (
          <>
            <Row active={isActive('liked')} onClick={() => go('liked')} name="좋아요 표시한 곡" sub={`${lib.liked.length}곡`} art={<div className="lib-art liked-art"><Heart size={18} fill="#fff" /></div>} />
            {lib.playlists.map((p) => (
              <Row key={p.id} active={isActive('local', p.id)} onClick={() => go('local', { id: p.id })} onContextMenu={(e) => playlistMenu(e, p)} name={p.name} sub={`플레이리스트 · ${p.tracks.length}곡`}
                art={p.thumb || p.tracks[0]?.thumb ? <Thumb src={p.thumb || p.tracks[0]?.thumb} className="lib-art" /> : <div className="lib-art"><ListMusic size={18} /></div>} />
            ))}
            {!lib.playlists.length && (
              <div className="lib-cta">
                <p>나만의 플레이리스트를 만들어 보세요</p>
                <button className="btn sm grad" onClick={newPlaylist}><Plus size={14} /> 새로 만들기</button>
                <button className="btn sm" onClick={importPlaylist}><Link2 size={14} /> YouTube에서 가져오기</button>
              </div>
            )}
          </>
        ) : (
          <>
            {lib.savedAlbums.map((a) => (
              <Row key={'al' + a.id} active={isActive('album', a.id)} onClick={() => go('album', { id: a.id })} name={a.title} sub={`${a.type || '앨범'} · ${a.artists?.map((x) => x.name).join(', ')}`} art={<Thumb src={a.thumb} className="lib-art" />} />
            ))}
            {lib.followed.map((a) => (
              <Row key={'ar' + a.id} active={isActive('artist', a.id)} onClick={() => go('artist', { id: a.id })} name={a.name} sub="아티스트" art={<Thumb src={a.thumb} round className="lib-art" />} />
            ))}
            {!lib.savedAlbums.length && !lib.followed.length && (
              <div className="lib-cta">
                <Disc3 size={26} />
                <p>앨범을 저장하거나 아티스트를 팔로우하면 여기에 모입니다</p>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
