import { useLayoutEffect, useRef, useState } from 'react';
import { Home, Search, Library, ArrowDownToLine, Users, UserRoundPlus, Plus, Heart, ListMusic, Trash2, Pencil, Disc3, PanelLeftClose, PanelLeftOpen, Radio } from 'lucide-react';
import { useLibrary } from '../../store/library.js';
import { canEditPlaylist, confirmDeletePlaylist } from '../../lib/sharedPlaylists.js';
import { useNav, useRoute } from '../../store/nav.js';
import { useUI } from '../../store/ui.js';
import { dragProps, dropOnDownloads, dropOnLibrary, dropOnLiked, dropOnNewPlaylist, dropOnPlaylist, dropOnRoom, dropOnSearch, itemPayload, useDrop } from '../../lib/drag.js';
import { usePlayer } from '../../store/player.js';
import { useDownloads } from '../../store/downloads.js';
import { useFriends } from '../../store/friends.js';
import { useRoom } from '../../store/room.js';
import { animate, ease } from '../../lib/motion.js';
import { Thumb, Equalizer } from '../common.jsx';
import logo from '../../assets/logo-mark.png';
import { tr } from '../../lib/i18n.js';

const NAV = [
  { id: 'home', label: tr('홈'), icon: Home },
  { id: 'search', label: tr('검색'), icon: Search },
  { id: 'radio', label: tr('라디오'), icon: Radio },
  { id: 'library', label: tr('보관함'), icon: Library },
  { id: 'downloads', label: tr('다운로드'), icon: ArrowDownToLine },
  { id: 'room', label: tr('같이 듣기'), icon: Users },
  { id: 'friends', label: tr('친구'), icon: UserRoundPlus },
];

const NAV_DROPS = { search: dropOnSearch, library: dropOnLibrary, downloads: dropOnDownloads, room: dropOnRoom };

function NavItem({ n, on, badge, onClick }) {
  const { over, dropProps } = useDrop(NAV_DROPS[n.id] || (() => {}), { enabled: Boolean(NAV_DROPS[n.id]) });
  return (
    <button className={`nav-item ${on ? 'on' : ''} ${over ? 'drag-over' : ''}`} onClick={onClick} title={n.label} {...dropProps}>
      <n.icon size={20} />
      <span>{n.label}</span>
      {badge > 0 && <b className="nav-badge">{badge}</b>}
    </button>
  );
}

function NavList() {
  const route = useRoute();
  const go = useNav((s) => s.go);
  const jobs = useDownloads((s) => s.jobs.filter((j) => j.status !== 'error').length);
  const friendRequests = useFriends((s) => s.requests.length);
  const listeners = useRoom((s) => Object.values(s.members).filter((m) => m.listening).length);
  const list = useRef(null);
  const pill = useRef(null);
  const active = NAV.findIndex((n) => n.id === route.name || (n.id === 'library' && ['liked', 'local'].includes(route.name)));

  // Slide the highlight pill to the active item with a spring.
  useLayoutEffect(() => {
    const items = list.current?.querySelectorAll('.nav-item');
    if (!items || active < 0) { if (pill.current) pill.current.style.opacity = 0; return undefined; }
    pill.current.style.opacity = 1;
    animate(pill.current, { translateY: items[active].offsetTop, height: items[active].offsetHeight, ease: ease.bouncy });
    // The items get shorter in a low window, and the pill has to follow.
    const follow = () => animate(pill.current, { translateY: items[active].offsetTop, height: items[active].offsetHeight, duration: 1 });
    window.addEventListener('resize', follow);
    return () => window.removeEventListener('resize', follow);
  }, [active]);

  return (
    <nav className="nav" ref={list}>
      <span className="nav-pill" ref={pill} />
      {NAV.map((n, i) => (
        <NavItem key={n.id} n={n} on={i === active} onClick={() => go(n.id, {})} badge={{ downloads: jobs, room: listeners, friends: friendRequests }[n.id] || 0} />
      ))}
    </nav>
  );
}

// Lives outside Sidebar: a component defined during render remounts all its rows each time.
function Row({ active, onClick, onContextMenu, art, name, sub, drag, land }) {
  const isPlaying = usePlayer((s) => s.context?.name === name);
  const playing = usePlayer((s) => s.playing);
  const { over, dropProps } = useDrop(land || (() => {}), { enabled: Boolean(land) });
  return (
    <div
      className={`lib-row ${active ? 'active' : ''} ${over ? 'drag-over' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={name}
      {...(drag ? dragProps(drag) : {})}
      {...dropProps}
    >
      {art}
      <div className="lib-text">
        <div className={`lib-name ${isPlaying ? 'playing' : ''}`}>{name}</div>
        <div className="lib-sub">{sub}</div>
      </div>
      {isPlaying && <Equalizer playing={playing} />}
    </div>
  );
}

export default function Sidebar() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const route = useRoute();
  const openMenu = useUI((s) => s.openMenu);
  const prompt = useUI((s) => s.prompt);
  const [tab, setTab] = useState('playlists');
  const sideOpen = useUI((s) => s.sideOpen);
  const toggleSide = useUI((s) => s.toggleSide);
  const newDrop = useDrop(dropOnNewPlaylist);
  const savedDrop = useDrop(dropOnLibrary);

  const isActive = (name, id) => route.name === name && (id == null || route.params.id === id);
  const newPlaylist = () => go('local', { id: lib.createPlaylist() });

  const playlistMenu = (e, p) => openMenu(e, [
    ...(canEditPlaylist(p) ? [{ label: tr('이름 바꾸기'), icon: Pencil, onClick: () => prompt({ title: tr('플레이리스트 이름 바꾸기'), value: p.name, submitLabel: tr('저장'), onSubmit: (v) => v.trim() && lib.renamePlaylist(p.id, v.trim()) }) }] : []),
    { label: tr('삭제'), icon: Trash2, onClick: () => confirmDeletePlaylist(p, () => { if (isActive('local', p.id)) go('home'); }) },
  ]);

  return (
    <aside className="sidebar">
      <div className="brand">
        {sideOpen && <img src={logo} alt="" onClick={() => go('home')} />}
        {sideOpen && <span onClick={() => go('home')}>T-Music</span>}
        <button className="icon-btn side-toggle" onClick={toggleSide} title={sideOpen ? tr('사이드바 접기') : tr('사이드바 펴기')} aria-label={sideOpen ? tr('사이드바 접기') : tr('사이드바 펴기')}>
          {sideOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>
      <NavList />

      <div className="lib-head">
        <div className="seg">
          <button className={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>{tr('플레이리스트')}</button>
          <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>{tr('저장됨')}</button>
        </div>
        <div className="lib-actions">
          <button className={`icon-btn circle accent ${newDrop.over ? 'drag-over' : ''}`} title={tr('새 플레이리스트')} onClick={newPlaylist} {...newDrop.dropProps}>
            <Plus size={17} />
          </button>
        </div>
      </div>

      <div className={`lib-list ${tab === 'saved' && savedDrop.over ? 'drag-over' : ''}`} {...(tab === 'saved' ? savedDrop.dropProps : {})}>
        {tab === 'playlists' ? (
          <>
            <Row
              active={isActive('liked')}
              onClick={() => go('liked')}
              name={tr('좋아요 표시한 곡')}
              sub={tr('{0}곡', lib.liked.length)}
              art={<div className="lib-art liked-art"><Heart size={18} fill="#fff" /></div>}
              drag={() => itemPayload({ kind: 'liked', title: tr('좋아요 표시한 곡') })}
              land={dropOnLiked}
            />
            {lib.playlists.map((p) => (
              <Row
                key={p.id}
                active={isActive('local', p.id)}
                onClick={() => go('local', { id: p.id })}
                onContextMenu={(e) => playlistMenu(e, p)}
                name={p.name}
                sub={tr('플레이리스트 · {0}곡', p.tracks.length)}
                art={p.thumb || p.tracks[0]?.thumb ? <Thumb src={p.thumb || p.tracks[0]?.thumb} className="lib-art" /> : <div className="lib-art"><ListMusic size={18} /></div>}
                drag={() => itemPayload({ kind: 'local', id: p.id, title: p.name })}
                land={canEditPlaylist(p) ? (payload) => dropOnPlaylist(p, payload) : null}
              />
            ))}
            {!lib.playlists.length && (
              <div className="lib-cta">
                <p>{tr('나만의 플레이리스트를 만들어 보세요')}</p>
                <button className="btn sm grad" onClick={newPlaylist}><Plus size={14} />{' '}{tr('새로 만들기')}</button>
              </div>
            )}
          </>
        ) : (
          <>
            {lib.savedAlbums.map((a) => (
              <Row key={'al' + a.id} active={isActive('album', a.id)} onClick={() => go('album', { id: a.id })} name={a.title} sub={`${a.type || tr('앨범')} · ${a.artists?.map((x) => x.name).join(', ')}`} art={<Thumb src={a.thumb} className="lib-art" />} drag={() => itemPayload({ ...a, kind: 'album' })} />
            ))}
            {lib.followed.map((a) => (
              <Row key={'ar' + a.id} active={isActive('artist', a.id)} onClick={() => go('artist', { id: a.id })} name={a.name} sub={tr('아티스트')} art={<Thumb src={a.thumb} round className="lib-art" />} drag={() => itemPayload({ ...a, kind: 'artist' })} />
            ))}
            {!lib.savedAlbums.length && !lib.followed.length && (
              <div className="lib-cta">
                <Disc3 size={26} />
                <p>{tr('앨범을 저장하거나 아티스트를 팔로우하면 여기에 모입니다')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
