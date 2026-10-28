// Album, YouTube playlist, liked songs and local playlist pages share one layout.
import { useState } from 'react';
import { Heart, ListMusic, Shuffle, PlusCircle, CheckCircle2, Pencil, Trash2, Search as SearchIcon } from 'lucide-react';
import { api } from '../api.js';
import { usePlayer } from '../store/player.js';
import { useLibrary } from '../store/library.js';
import { useNav } from '../store/nav.js';
import { useUI, toast } from '../store/ui.js';
import { totalTime, colorFor } from '../util.js';
import { useAsync, Thumb, PlayButton, ArtistLinks, Loading, ErrorMsg } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { Shelf } from '../components/Cards.jsx';

function Header({ kind, title, thumb, art, color, meta, description }) {
  return (
    <div className="page-header" style={{ '--hdr': color }}>
      {art || <Thumb src={thumb} className="ph-art" />}
      <div className="ph-text">
        <span className="ph-kind">{kind}</span>
        <h1 className={title.length > 24 ? 'long' : ''}>{title}</h1>
        {description && <p className="ph-desc">{description}</p>}
        <div className="ph-meta">{meta}</div>
      </div>
    </div>
  );
}

function ActionBar({ tracks, context, children }) {
  const playing = usePlayer((s) => s.playing);
  const ctxName = usePlayer((s) => s.context?.name);
  const isThis = ctxName === context.name;
  const p = usePlayer.getState();
  const playAll = () => {
    if (isThis) return p.toggle();
    p.playList(tracks, 0, context);
  };
  const shuffleAll = () => {
    if (!p.shuffle) p.toggleShuffle();
    p.playList(tracks, Math.floor(Math.random() * tracks.length), context);
  };
  return (
    <div className="action-bar">
      <PlayButton size={56} playing={isThis && playing} onClick={playAll} />
      <button className="icon-btn big" title="셔플 재생" onClick={shuffleAll}><Shuffle size={26} /></button>
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

export function Album({ id }) {
  const res = useAsync(() => api.album(id), [id]);
  const saved = useLibrary((s) => s.savedAlbums.some((a) => a.id === id));
  const toggleSaved = useLibrary((s) => s.toggleSavedAlbum);
  if (res.loading && !res.data) return <Loading />;
  if (res.error) return <ErrorMsg error={res.error} />;
  const a = res.data;
  const context = { name: a.title };
  return (
    <div className="page collection">
      <Header
        kind={a.type}
        title={a.title}
        thumb={a.thumb}
        color={colorFor(a.id)}
        meta={<><ArtistLinks artists={a.artists} className="strong" />{a.year && <span> • {a.year}</span>}<span> • {a.tracks.length}곡, {totalTime(a.tracks)}</span></>}
      />
      <div className="page-body">
        <ActionBar tracks={a.tracks} context={context}>
          <button className={`icon-btn big ${saved ? 'on' : ''}`} title={saved ? '라이브러리에서 삭제' : '라이브러리에 저장'} onClick={() => { toggleSaved(a); toast(saved ? '라이브러리에서 삭제했습니다' : '라이브러리에 저장했습니다'); }}>
            {saved ? <CheckCircle2 size={30} /> : <PlusCircle size={30} />}
          </button>
        </ActionBar>
        <TrackList tracks={a.tracks} context={context} showAlbum={false} showThumb={false} />
        {a.description && <p className="album-desc">{a.description}</p>}
        {a.more.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
      </div>
    </div>
  );
}

export function Playlist({ id }) {
  const res = useAsync(() => api.playlist(id), [id]);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const go = useNav((s) => s.go);
  if (res.loading && !res.data) return <Loading />;
  if (res.error) return <ErrorMsg error={res.error} />;
  const pl = res.data;
  const context = { name: pl.title };
  return (
    <div className="page collection">
      <Header
        kind="플레이리스트"
        title={pl.title}
        thumb={pl.thumb}
        color={colorFor(pl.id)}
        description={pl.description?.slice(0, 160)}
        meta={<>{pl.author && <b>{pl.author} • </b>}<span>{pl.tracks.length}곡, {totalTime(pl.tracks)}</span></>}
      />
      <div className="page-body">
        <ActionBar tracks={pl.tracks} context={context}>
          <button className="icon-btn big" title="내 라이브러리에 복사" onClick={() => { const nid = createPlaylist(pl.title, pl.tracks, { source: pl.id, thumb: pl.thumb }); toast('내 라이브러리에 저장했습니다'); go('local', { id: nid }); }}>
            <PlusCircle size={30} />
          </button>
        </ActionBar>
        <Filterable tracks={pl.tracks}>{(shown) => <TrackList tracks={shown} context={context} />}</Filterable>
      </div>
    </div>
  );
}

export function Liked() {
  const liked = useLibrary((s) => s.liked);
  const context = { name: '좋아요 표시한 곡' };
  return (
    <div className="page collection">
      <Header
        kind="플레이리스트"
        title="좋아요 표시한 곡"
        color="hsl(250 55% 45%)"
        art={<div className="ph-art liked-art big"><Heart size={72} fill="#fff" /></div>}
        meta={<span>{liked.length}곡</span>}
      />
      <div className="page-body">
        {liked.length ? (
          <>
            <ActionBar tracks={liked} context={context} />
            <Filterable tracks={liked}>{(shown) => <TrackList tracks={shown} context={context} />}</Filterable>
          </>
        ) : (
          <div className="center-msg"><p>좋아하는 곡에 하트를 눌러 여기에 모아보세요.</p></div>
        )}
      </div>
    </div>
  );
}

export function LocalPlaylist({ id }) {
  const pl = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const { removeFromPlaylist, renamePlaylist, deletePlaylist } = useLibrary.getState();
  const prompt = useUI((s) => s.prompt);
  const go = useNav((s) => s.go);
  if (!pl) return <ErrorMsg error="플레이리스트를 찾을 수 없습니다." />;
  const context = { name: pl.name };
  const rename = () => prompt({ title: '플레이리스트 이름 바꾸기', value: pl.name, submitLabel: '저장', onSubmit: (v) => v.trim() && renamePlaylist(pl.id, v.trim()) });
  return (
    <div className="page collection">
      <Header
        kind="플레이리스트"
        title={pl.name}
        color={colorFor(pl.id)}
        art={pl.thumb || pl.tracks[0]?.thumb ? <Thumb src={pl.thumb || pl.tracks[0].thumb} className="ph-art" /> : <div className="ph-art empty-art" onClick={rename}><ListMusic size={64} /></div>}
        meta={<span>{pl.tracks.length}곡{pl.tracks.length ? `, ${totalTime(pl.tracks)}` : ''}</span>}
      />
      <div className="page-body">
        <ActionBar tracks={pl.tracks} context={context}>
          <button className="icon-btn big" title="이름 바꾸기" onClick={rename}><Pencil size={22} /></button>
          <button className="icon-btn big" title="삭제" onClick={() => { deletePlaylist(pl.id); go('home'); toast('플레이리스트를 삭제했습니다'); }}><Trash2 size={22} /></button>
        </ActionBar>
        {pl.tracks.length ? (
          <Filterable tracks={pl.tracks}>
            {(shown, filtered) => (
              <TrackList tracks={shown} context={context} onRemove={filtered ? undefined : (i) => removeFromPlaylist(pl.id, i)} />
            )}
          </Filterable>
        ) : (
          <div className="center-msg"><p>곡을 우클릭하고 '플레이리스트에 추가'를 눌러 곡을 담아보세요.</p></div>
        )}
      </div>
    </div>
  );
}
