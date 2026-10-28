import { useState } from 'react';
import { api } from '../api.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { useAsync, Thumb, PlayButton, ArtistLinks, Loading, ErrorMsg } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { Shelf, Grid, openItem, playItem } from '../components/Cards.jsx';
import { colorFor } from '../util.js';

const BROWSE = [
  ['K-POP', 'K-POP 히트곡'], ['발라드', '발라드 명곡'], ['힙합', '국내 힙합'], ['R&B', 'R&B 감성'],
  ['인디', '인디 음악'], ['록', '록 밴드 명곡'], ['팝', 'pop hits'], ['J-POP', 'J-POP 인기곡'],
  ['OST', '드라마 OST'], ['재즈', '재즈 카페'], ['클래식', '클래식 명곡'], ['로파이', 'lofi hip hop'],
  ['운동', '운동할 때 듣는 노래'], ['드라이브', '드라이브 음악'], ['잠잘 때', '잠잘 때 듣는 음악'], ['공부', '공부할 때 듣는 음악'],
];

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'songs', label: '노래' },
  { id: 'artists', label: '아티스트' },
  { id: 'albums', label: '앨범' },
  { id: 'playlists', label: '플레이리스트' },
];

function TopResult({ item }) {
  const go = useNav((s) => s.go);
  const label = { artist: '아티스트', album: item.type || '앨범', track: '노래', playlist: '플레이리스트' }[item.kind];
  return (
    <div className="top-result" onClick={() => openItem(item, go)}>
      <Thumb src={item.thumb} round={item.kind === 'artist'} className="tr-art" />
      <div className="tr-name">{item.title || item.name}</div>
      <div className="tr-sub">
        <span className="tag">{label}</span>
        {item.artists?.length > 0 && <ArtistLinks artists={item.artists} />}
      </div>
      <PlayButton className="tr-play" onClick={() => playItem(item)} />
    </div>
  );
}

function Results({ q }) {
  const [tab, setTab] = useState('all');
  const res = useAsync(() => api.search(q), [q]);
  if (res.loading) return <Loading />;
  if (res.error) return <ErrorMsg error={res.error} />;
  const { top, songs, artists, albums, playlists } = res.data;
  const ctx = { name: `'${q}' 검색 결과` };

  return (
    <>
      <div className="chips sticky-chips">
        {TABS.map((t) => <button key={t.id} className={`chip ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === 'all' && (
        <>
          <div className="search-top">
            {top && (
              <section>
                <h2>상위 결과</h2>
                <TopResult item={top} />
              </section>
            )}
            {songs.length > 0 && (
              <section className="search-songs">
                <h2 className="link" onClick={() => setTab('songs')}>노래</h2>
                <TrackList tracks={songs.slice(0, 4)} context={ctx} showAlbum={false} numbered={false} compact />
              </section>
            )}
          </div>
          <Shelf title="아티스트" items={artists} onMore={() => setTab('artists')} />
          <Shelf title="앨범" items={albums} onMore={() => setTab('albums')} />
          <Shelf title="플레이리스트" items={playlists} onMore={() => setTab('playlists')} />
        </>
      )}
      {tab === 'songs' && <TrackList tracks={songs} context={ctx} />}
      {tab === 'artists' && <Grid items={artists} />}
      {tab === 'albums' && <Grid items={albums} />}
      {tab === 'playlists' && <Grid items={playlists} />}
      {!songs.length && !artists.length && !albums.length && !playlists.length && <div className="center-msg"><p>'{q}'에 대한 결과가 없습니다.</p></div>}
    </>
  );
}

export default function Search({ q }) {
  const go = useNav((s) => s.go);
  if (q) return <div className="page search"><Results key={q} q={q} /></div>;
  return (
    <div className="page search">
      <h2>모두 둘러보기</h2>
      <div className="browse-grid">
        {BROWSE.map(([label, query]) => (
          <div key={label} className="browse-tile" style={{ background: colorFor(label + 'x') }} onClick={() => go('search', { q: query })}>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
