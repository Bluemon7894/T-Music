import { useLayoutEffect, useRef, useState } from 'react';
import { Home, Search, Library, ArrowDownToLine, Users, Plus, Heart, ListMusic, Trash2, Pencil, Disc3 } from 'lucide-react';
import { useLibrary } from '../../store/library.js';
import { useNav, useRoute } from '../../store/nav.js';
import { useUI, toast } from '../../store/ui.js';
import { usePlayer } from '../../store/player.js';
import { useDownloads } from '../../store/downloads.js';
import { useRoom } from '../../store/room.js';
import { animate, ease } from '../../lib/motion.js';
import { Thumb, Equalizer } from '../common.jsx';
import logo from '../../assets/logo-mark.png';

const NAV = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'search', label: '검색', icon: Search },
  { id: 'library', label: '보관함', icon: Library },
  { id: 'downloads', label: '다운로드', icon: ArrowDownToLine },
  { id: 'room', label: '같이 듣기', icon: Users },
];

function NavList() {
  const route = useRoute();
  const go = useNav((s) => s.go);
  const jobs = useDownloads((s) => s.jobs.filter((j) => j.status !== 'error').length);
  const listeners = useRoom((s) => (s.code ? Object.keys(s.members).length : 0));
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
          {n.id === 'room' && listeners > 0 && <b className="nav-badge">{listeners}</b>}
        </button>
      ))}
    </nav>
  );
}

// Lives outside Sidebar: a component defined during render remounts all its rows each time.
function Row({ active, onClick, onContextMenu, art, name, sub, isDragOver, onDragOver, onDragLeave, onDrop }) {
  const isPlaying = usePlayer((s) => s.context?.name === name);
  const playing = usePlayer((s) => s.playing);
  return (
    <div
      className={`lib-row ${active ? 'active' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
  const [dragOverId, setDragOverId] = useState(null);

  const isActive = (name, id) => route.name === name && (id == null || route.params.id === id);
  const newPlaylist = () => go('local', { id: lib.createPlaylist() });

  const playlistMenu = (e, p) => openMenu(e, [
    { label: '이름 바꾸기', icon: Pencil, onClick: () => prompt({ title: '플레이리스트 이름 바꾸기', value: p.name, submitLabel: '저장', onSubmit: (v) => v.trim() && lib.renamePlaylist(p.id, v.trim()) }) },
    { label: '삭제', icon: Trash2, onClick: () => { lib.deletePlaylist(p.id); if (isActive('local', p.id)) go('home'); toast('플레이리스트를 삭제했습니다'); } },
  ]);

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
          <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>저장됨</button>
        </div>
        <div className="lib-actions">
          <button
            className={`icon-btn circle accent ${dragOverId === 'new-pl' ? 'drag-over' : ''}`}
            title="새 플레이리스트"
            onClick={newPlaylist}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              if (dragOverId !== 'new-pl') setDragOverId('new-pl');
            }}
            onDragLeave={() => {
              if (dragOverId === 'new-pl') setDragOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverId(null);
              try {
                const raw = e.dataTransfer.getData('application/json');
                if (raw) {
                  const track = JSON.parse(raw);
                  if (track?.id) {
                    const id = lib.createPlaylist(track.title, [track]);
                    go('local', { id });
                    toast(`새 플레이리스트에 '${track.title}'을(를) 추가했습니다`);
                  }
                }
              } catch {}
            }}
          >
            <Plus size={17} />
          </button>
        </div>
      </div>

      <div className="lib-list">
        {tab === 'playlists' ? (
          <>
            <Row
              active={isActive('liked')}
              onClick={() => go('liked')}
              name="좋아요 표시한 곡"
              sub={`${lib.liked.length}곡`}
              art={<div className="lib-art liked-art"><Heart size={18} fill="#fff" /></div>}
              isDragOver={dragOverId === 'liked'}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                if (dragOverId !== 'liked') setDragOverId('liked');
              }}
              onDragLeave={() => {
                if (dragOverId === 'liked') setDragOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverId(null);
                try {
                  const raw = e.dataTransfer.getData('application/json');
                  if (raw) {
                    const track = JSON.parse(raw);
                    if (track?.id) {
                      if (!lib.isLiked(track.id)) {
                        lib.toggleLike(track);
                        toast(`'좋아요 표시한 곡'에 '${track.title}'을(를) 추가했습니다`);
                      } else {
                        toast(`'좋아요 표시한 곡'에 이미 있는 곡입니다`);
                      }
                    }
                  }
                } catch {}
              }}
            />
            {lib.playlists.map((p) => (
              <Row
                key={p.id}
                active={isActive('local', p.id)}
                onClick={() => go('local', { id: p.id })}
                onContextMenu={(e) => playlistMenu(e, p)}
                name={p.name}
                sub={`플레이리스트 · ${p.tracks.length}곡`}
                art={p.thumb || p.tracks[0]?.thumb ? <Thumb src={p.thumb || p.tracks[0]?.thumb} className="lib-art" /> : <div className="lib-art"><ListMusic size={18} /></div>}
                isDragOver={dragOverId === p.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                  if (dragOverId !== p.id) setDragOverId(p.id);
                }}
                onDragLeave={() => {
                  if (dragOverId === p.id) setDragOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverId(null);
                  try {
                    const raw = e.dataTransfer.getData('application/json');
                    if (raw) {
                      const track = JSON.parse(raw);
                      if (track?.id) {
                        const added = lib.addToPlaylist(p.id, track);
                        if (added > 0) {
                          toast(`'${p.name}'에 '${track.title}'을(를) 추가했습니다`);
                        } else {
                          toast(`'${p.name}'에 이미 있는 곡입니다`);
                        }
                      }
                    }
                  } catch (err) {
                    console.error('Drop error', err);
                  }
                }}
              />
            ))}
            {!lib.playlists.length && (
              <div className="lib-cta">
                <p>나만의 플레이리스트를 만들어 보세요</p>
                <button className="btn sm grad" onClick={newPlaylist}><Plus size={14} /> 새로 만들기</button>
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
