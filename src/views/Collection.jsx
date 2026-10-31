// Album, YouTube playlist, liked songs and local playlist pages share one layout.
import { ListEnd } from 'lucide-react';
import SharePanel from '../components/SharePanel.jsx';
import { auth } from '../lib/firebase.js';
import { canEditPlaylist } from '../lib/sharedPlaylists.js';
import { useRef, useState } from 'react';
import { Heart, ListMusic, Shuffle, PlusCircle, CheckCircle2, Pencil, Trash2, Search as SearchIcon, Radio } from 'lucide-react';
import { api } from '../lib/api.js';
import { usePlayer } from '../store/player.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { useUI, toast } from '../store/ui.js';
import { totalTime, colorFor } from '../lib/util.js';
import { useEnter, useTilt } from '../lib/motion.js';
import { useAsync, Thumb, PlayButton, ArtistLinks, PageSkeleton, ErrorMsg, Empty } from '../components/common.jsx';
import TrackList, { startRadio } from '../components/TrackList.jsx';
import { DownloadAllButton } from '../components/DownloadButton.jsx';
import { Shelf } from '../components/Cards.jsx';

function Header({ kind, title, thumb, art, color, meta, description }) {
  const artRef = useRef(null);
  useTilt(artRef, { max: 10, scale: 1.02 });
  return (
    <div className="page-header" style={{ '--hdr': color }}>
      {thumb && <div className="ph-backdrop" style={{ backgroundImage: `url("${thumb}")` }} />}
      <div className="ph-art-wrap" ref={artRef} data-enter>
        {art || <Thumb src={thumb} className="ph-art" />}
        <span className="glare" />
      </div>
      <div className="ph-text">
        <span className="ph-kind" data-enter>{kind}</span>
        <h1 className={title.length > 22 ? 'long' : ''} data-enter>{title}</h1>
        {description && <p className="ph-desc" data-enter>{description}</p>}
        <div className="ph-meta" data-enter>{meta}</div>
      </div>
    </div>
  );
}

function ActionBar({ tracks, context, children }) {
  const playing = usePlayer((s) => s.playing);
  const ctxName = usePlayer((s) => s.context?.name);
  const isThis = ctxName === context.name;
  const playAll = () => {
    const p = usePlayer.getState();
    if (isThis) return p.toggle();
    p.playList(tracks, 0, context);
  };
  const shuffleAll = () => {
    const p = usePlayer.getState();
    if (!p.shuffle) p.toggleShuffle();
    p.playList(tracks, Math.floor(Math.random() * tracks.length), context);
  };
  return (
    <div className="action-bar" data-enter>
      <PlayButton size={58} playing={isThis && playing} onClick={playAll} />
      <button className="icon-btn big" title="셔플 재생" onClick={shuffleAll}><Shuffle size={24} /></button>
      {tracks[0] && <button className="icon-btn big" title="비슷한 곡 라디오" onClick={() => startRadio(tracks[0])}><Radio size={24} /></button>}
      {tracks.length > 0 && <button className="icon-btn big" title="전체를 대기열에 추가" onClick={() => usePlayer.getState().addToQueue(tracks)}><ListEnd size={24} /></button>}
      <DownloadAllButton tracks={tracks} />
      {children}
    </div>
  );
}

function Filterable({ tracks, children }) {
  const [q, setQ] = useState('');
  const shown = q ? tracks.filter((t) => (t.title + ' ' + (t.artists || []).map((a) => a.name).join(' ')).toLowerCase().includes(q.toLowerCase())) : tracks;
  return (
    <>
      {tracks.length > 8 && (
        <div className="filter-box">
          <SearchIcon size={15} />
          <input value={q} placeholder="목록에서 찾기" onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {children(shown, !!q)}
    </>
  );
}

function usePage(deps) {
  const ref = useRef(null);
  useEnter(ref, deps);
  return ref;
}

export function Album({ id }) {
  const res = useAsync(() => api.album(id), [id]);
  const saved = useLibrary((s) => s.savedAlbums.some((a) => a.id === id));
  const toggleSaved = useLibrary((s) => s.toggleSavedAlbum);
  const ref = usePage([res.data ? 1 : 0]);
  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error) return <ErrorMsg error={res.error} onRetry={res.retry} />;
  const a = res.data;
  const context = { name: a.title };
  return (
    <div className="page collection" ref={ref}>
      <Header
        kind={a.type}
        title={a.title}
        thumb={a.thumb}
        color={colorFor(a.id)}
        meta={<><ArtistLinks artists={a.artists} className="strong" />{a.year && <span> · {a.year}</span>}<span> · {a.tracks.length}곡, {totalTime(a.tracks)}</span></>}
      />
      <div className="page-body">
        <ActionBar tracks={a.tracks} context={context}>
          <button className={`icon-btn big ${saved ? 'on' : ''}`} title={saved ? '보관함에서 삭제' : '보관함에 저장'} onClick={() => { toggleSaved(a); toast(saved ? '보관함에서 삭제했습니다' : '보관함에 저장했습니다'); }}>
            {saved ? <CheckCircle2 size={28} /> : <PlusCircle size={28} />}
          </button>
        </ActionBar>
        <TrackList tracks={a.tracks} context={context} showAlbum={false} showThumb={false} />
        {a.description && <p className="album-desc" data-enter>{a.description}</p>}
        {a.more.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
      </div>
    </div>
  );
}

export function Playlist({ id }) {
  const res = useAsync(() => api.playlist(id), [id]);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const go = useNav((s) => s.go);
  const ref = usePage([res.data ? 1 : 0]);
  if (res.loading && !res.data) return <PageSkeleton />;
  if (res.error) return <ErrorMsg error={res.error} onRetry={res.retry} />;
  const pl = res.data;
  const context = { name: pl.title };
  return (
    <div className="page collection" ref={ref}>
      <Header
        kind="플레이리스트"
        title={pl.title}
        thumb={pl.thumb}
        color={colorFor(pl.id)}
        description={pl.description?.slice(0, 160)}
        meta={<>{pl.author && <b>{pl.author} · </b>}<span>{pl.tracks.length}곡, {totalTime(pl.tracks)}</span></>}
      />
      <div className="page-body">
        <ActionBar tracks={pl.tracks} context={context}>
          <button className="icon-btn big" title="내 보관함에 복사" onClick={() => { const nid = createPlaylist(pl.title, pl.tracks, { source: pl.id, thumb: pl.thumb }); toast('내 플레이리스트로 저장했습니다'); go('local', { id: nid }); }}>
            <PlusCircle size={28} />
          </button>
        </ActionBar>
        <Filterable tracks={pl.tracks}>{(shown) => <TrackList tracks={shown} context={context} />}</Filterable>
      </div>
    </div>
  );
}

export function Liked() {
  const liked = useLibrary((s) => s.liked);
  const go = useNav((s) => s.go);
  const ref = usePage([]);
  const context = { name: '좋아요 표시한 곡' };
  return (
    <div className="page collection" ref={ref}>
      <Header
        kind="플레이리스트"
        title="좋아요 표시한 곡"
        color="hsl(262 60% 45%)"
        art={<div className="ph-art liked-art big"><Heart size={76} fill="#fff" /></div>}
        meta={<span>{liked.length}곡{liked.length ? `, ${totalTime(liked)}` : ''}</span>}
      />
      <div className="page-body">
        {liked.length ? (
          <>
            <ActionBar tracks={liked} context={context} />
            <Filterable tracks={liked}>{(shown) => <TrackList tracks={shown} context={context} />}</Filterable>
          </>
        ) : (
          <Empty icon={Heart} title="좋아하는 곡을 모아보세요" text="곡 옆의 하트를 누르면 여기에 저장돼요.">
            <button className="btn grad" onClick={() => go('search', {})}>곡 찾아보기</button>
          </Empty>
        )}
      </div>
    </div>
  );
}

const isOwnShare = (p) => p.share?.ownerUid === auth.currentUser?.uid;

export function LocalPlaylist({ id }) {
  const pl = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const { addToPlaylist, removeFromPlaylist, renamePlaylist, deletePlaylist, reorderPlaylist } = useLibrary.getState();
  const prompt = useUI((s) => s.prompt);
  const go = useNav((s) => s.go);
  const ref = usePage([id]);
  const [dragOver, setDragOver] = useState(false);
  if (!pl) return <ErrorMsg error="플레이리스트를 찾을 수 없습니다." />;
  const context = { name: pl.name };
  const editable = canEditPlaylist(pl);
  const rename = () => prompt({ title: '플레이리스트 이름 바꾸기', value: pl.name, submitLabel: '저장', onSubmit: (v) => v.trim() && renamePlaylist(pl.id, v.trim()) });
  const cover = pl.thumb || pl.tracks[0]?.thumb;
  return (
    <div
      className={`page collection ${dragOver ? 'playlist-drag-over' : ''}`}
      ref={ref}
      onDragOver={(e) => {
        if (editable && e.dataTransfer.types.includes('application/json')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!dragOver) setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        try {
          if (e.dataTransfer.getData('text/reorder-from')) return;
          const raw = e.dataTransfer.getData('application/json');
          if (raw) {
            const track = JSON.parse(raw);
            if (track?.id) {
              const added = addToPlaylist(pl.id, track);
              if (added > 0) {
                toast(`'${pl.name}'에 '${track.title}'을(를) 추가했습니다`);
              } else {
                toast(`'${pl.name}'에 이미 있는 곡입니다`);
              }
            }
          }
        } catch {}
      }}
    >
      <Header
        kind={pl.share ? '공유 플레이리스트' : '내 플레이리스트'}
        title={pl.name}
        thumb={cover}
        color={colorFor(pl.id)}
        art={cover ? undefined : <div className="ph-art empty-art" onClick={editable ? rename : undefined}><ListMusic size={64} /></div>}
        meta={<span>{pl.tracks.length}곡{pl.tracks.length ? `, ${totalTime(pl.tracks)}` : ''}</span>}
      />
      <div className="page-body">
        <ActionBar tracks={pl.tracks} context={context}>
          {editable && <button className="icon-btn big" title="이름 바꾸기" onClick={rename}><Pencil size={21} /></button>}
          <button className="icon-btn big" title={pl.share && !isOwnShare(pl) ? '내 보관함에서 빼기' : '삭제'} onClick={() => { deletePlaylist(pl.id); go('home'); toast('플레이리스트를 삭제했습니다'); }}><Trash2 size={21} /></button>
        </ActionBar>
        <SharePanel playlist={pl} />
        {pl.tracks.length ? (
          <Filterable tracks={pl.tracks}>
            {(shown, filtered) => (
              <TrackList
                tracks={shown}
                context={context}
                onRemove={filtered || !editable ? undefined : (i) => removeFromPlaylist(pl.id, i)}
                onReorder={filtered || !editable ? undefined : (from, to) => reorderPlaylist(pl.id, from, to)}
              />
            )}
          </Filterable>
        ) : (
          <Empty icon={ListMusic} title="아직 비어 있어요" text="곡을 우클릭하고 '플레이리스트에 추가'를 눌러 담아보세요.">
            <button className="btn grad" onClick={() => go('search', {})}>곡 찾아보기</button>
          </Empty>
        )}
      </div>
    </div>
  );
}
