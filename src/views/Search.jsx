import { useRef, useState } from 'react';
import { History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useNav } from '../store/nav.js';
import { useLibrary } from '../store/library.js';
import { useAsync, Thumb, PlayButton, ArtistLinks, SkeletonRows, SkeletonCards, ErrorMsg, Empty } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { Shelf, Grid, openItem, playItem } from '../components/Cards.jsx';
import { useEnter, useTilt } from '../lib/motion.js';
import { Search as SearchIcon } from 'lucide-react';

const BROWSE = [
  ['K-POP', 'K-POP 히트곡', '#8b5cf6', '#ec4899'], ['발라드', '발라드 명곡', '#6366f1', '#a78bfa'], ['힙합', '국내 힙합', '#f97316', '#be185d'],
  ['R&B', 'R&B 감성', '#a855f7', '#4f46e5'], ['인디', '인디 음악', '#14b8a6', '#6366f1'], ['록', '록 밴드 명곡', '#ef4444', '#7c3aed'],
  ['팝', 'pop hits', '#ec4899', '#8b5cf6'], ['J-POP', 'J-POP 인기곡', '#f43f5e', '#f59e0b'], ['OST', '드라마 OST', '#0ea5e9', '#8b5cf6'],
  ['재즈', '재즈 카페', '#d97706', '#7c2d12'], ['클래식', '클래식 명곡', '#64748b', '#6d28d9'], ['로파이', 'lofi hip hop', '#7c3aed', '#0f766e'],
  ['운동', '운동할 때 듣는 노래', '#dc2626', '#9333ea'], ['드라이브', '드라이브 음악', '#2563eb', '#db2777'], ['잠잘 때', '잠잘 때 듣는 음악', '#312e81', '#7c3aed'], ['공부', '공부할 때 듣는 음악', '#0d9488', '#4338ca'],
];

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'songs', label: '노래' },
  { id: 'artists', label: '아티스트' },
  { id: 'albums', label: '앨범' },
  { id: 'playlists', label: '플레이리스트' },
];

const HISTORY_KEY = 't-music-search-history';
const readHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
function remember(q) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([q, ...readHistory().filter((x) => x !== q)].slice(0, 12))); } catch { /* ignore */ }
}

function TopResult({ item }) {
  const go = useNav((s) => s.go);
  const ref = useRef(null);
  useTilt(ref, { max: 6, scale: 1.01 });
  const label = { artist: '아티스트', album: item.type || '앨범', track: '노래', playlist: '플레이리스트' }[item.kind];
  return (
    <div className="top-result" ref={ref} onClick={() => openItem(item, go)}>
      <span className="glare" />
      <Thumb src={item.thumb} round={item.kind === 'artist'} className="tr-art" />
      <div className="tr-name">{item.title || item.name}</div>
      <div className="tr-sub">
        <span className="tag">{label}</span>
        {item.artists?.length > 0 && <ArtistLinks artists={item.artists} />}
      </div>
      <PlayButton className="tr-play" size={52} onClick={() => playItem(item)} />
    </div>
  );
}

function Results({ q }) {
  const [tab, setTab] = useState('all');
  const res = useAsync(() => api.search(q).then((r) => { remember(q); return r; }), [q]);
  const ref = useRef(null);
  useEnter(ref, [res.data ? 1 : 0, tab]);
  if (res.loading) return <div className="search-loading"><SkeletonRows count={5} /><SkeletonCards /></div>;
  if (res.error) return <ErrorMsg error={res.error} onRetry={res.retry} />;
  const { top, songs, artists, albums, playlists } = res.data;
  const ctx = { name: `'${q}' 검색 결과` };
  const counts = { songs: songs.length, artists: artists.length, albums: albums.length, playlists: playlists.length };

  if (!songs.length && !artists.length && !albums.length && !playlists.length) {
    return <Empty icon={SearchIcon} title={`'${q}'에 대한 결과가 없어요`} text="철자를 확인하거나 다른 검색어로 찾아보세요." />;
  }

  return (
    <div ref={ref}>
      <div className="chips sticky-chips">
        {TABS.map((t) => (
          <button key={t.id} className={`chip ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}{counts[t.id] ? <small>{counts[t.id]}</small> : null}
          </button>
        ))}
      </div>
      {tab === 'all' && (
        <>
          <div className="search-top">
            {top && (
              <section data-enter>
                <h2>상위 결과</h2>
                <TopResult item={top} />
              </section>
            )}
            {songs.length > 0 && (
              <section className="search-songs" data-enter>
                <h2 className="link" onClick={() => setTab('songs')}>노래</h2>
                <TrackList tracks={songs.slice(0, 5)} context={ctx} showAlbum={false} numbered={false} compact animate={false} />
              </section>
            )}
          </div>
          <Shelf title="아티스트" items={artists} onMore={() => setTab('artists')} />
          <Shelf title="앨범" items={albums} onMore={() => setTab('albums')} />
          <Shelf title="플레이리스트" items={playlists} onMore={() => setTab('playlists')} />
          {songs.length > 5 && (
            <section data-enter>
              <h2>노래 더 보기</h2>
              <TrackList tracks={songs.slice(5, 15)} context={ctx} showAlbum={false} compact animate={false} />
            </section>
          )}
        </>
      )}
      {tab === 'songs' && <TrackList tracks={songs} context={ctx} />}
      {tab === 'artists' && <Grid items={artists} />}
      {tab === 'albums' && <Grid items={albums} />}
      {tab === 'playlists' && <Grid items={playlists} />}
    </div>
  );
}

function Browse() {
  const go = useNav((s) => s.go);
  const recent = useLibrary((s) => s.recent).slice(0, 8);
  const [history, setHistory] = useState(readHistory);
  const ref = useRef(null);
  useEnter(ref, [], { step: 22 });
  const clear = () => { try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } setHistory([]); };
  return (
    <div ref={ref}>
      {history.length > 0 && (
        <section className="history" data-enter>
          <div className="row-between"><h2>최근 검색</h2><button className="text-btn" onClick={clear}>모두 지우기</button></div>
          <div className="chips">
            {history.map((h) => (
              <button key={h} className="chip ghost" onClick={() => go('search', { q: h })}><History size={13} /> {h}</button>
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && <Shelf title="최근 들은 곡" items={recent.map((t) => ({ ...t, kind: 'track', isRecent: true }))} />}
      <section>
        <h2 data-enter>모두 둘러보기</h2>
        <div className="browse-grid">
          {BROWSE.map(([label, query, c1, c2]) => (
            <div key={label} data-enter className="browse-tile" style={{ '--c1': c1, '--c2': c2 }} onClick={() => go('search', { q: query })}>
              <span>{label}</span>
              <i className="bt-shape a" /><i className="bt-shape b" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function Search({ q }) {
  return <div className="page search">{q ? <Results key={q} q={q} /> : <Browse />}</div>;
}

