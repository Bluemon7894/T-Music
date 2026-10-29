import { useEffect, useMemo, useRef, useState } from 'react';
import { History, Music, Play, Search as SearchIcon, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useNav } from '../store/nav.js';
import { useLibrary } from '../store/library.js';
import { usePlayer } from '../store/player.js';
import { useUI } from '../store/ui.js';
import { useAsync, Thumb, PlayButton, ArtistLinks, SkeletonRows, SkeletonCards, ErrorMsg, Empty } from '../components/common.jsx';
import TrackList from '../components/TrackList.jsx';
import { Shelf, Grid, openItem, playItem } from '../components/Cards.jsx';
import { useEnter, useTilt } from '../lib/motion.js';

const BROWSE_CATEGORIES = [
  {
    label: 'K-POP', query: 'K-POP 히트곡', c1: '#8b5cf6', c2: '#ec4899',
    tracks: [
      { id: '11cta61Wi0g', title: 'Hype Boy', artist: 'NewJeans' },
      { id: '6ZUIwj3FgUY', title: 'I AM', artist: 'IVE' },
      { id: 'phuiiNCxRMg', title: 'Supernova', artist: 'aespa' },
      { id: 'gdZLi9oWNZg', title: 'Dynamite', artist: 'BTS' },
    ],
  },
  {
    label: '발라드', query: '발라드 명곡', c1: '#6366f1', c2: '#a78bfa',
    tracks: [
      { id: 'BBdC1rl5sKY', title: '사건의 지평선', artist: '윤하' },
      { id: 'YBzJ0jmgev8', title: '너를 만나', artist: '폴킴' },
      { id: 'O6vBfUq6KqQ', title: '헤어지자 말해요', artist: '박재정' },
      { id: '6744glqD6lk', title: '밤편지', artist: '아이유' },
    ],
  },
  {
    label: '힙합', query: '국내 힙합', c1: '#f97316', c2: '#be185d',
    tracks: [
      { id: 'lOrUUtgOzGs', title: 'METEOR', artist: '창모' },
      { id: 'fXFNFM80iMI', title: 'Better Than Yesterday', artist: 'MC Sniper' },
      { id: 'mS_0f3y_1m4', title: '새삥', artist: '지코' },
      { id: 'wS_gT2_Ue5E', title: 'Smoke', artist: '다이나믹 듀오' },
    ],
  },
  {
    label: 'R&B', query: 'R&B 감성', c1: '#a855f7', c2: '#4f46e5',
    tracks: [
      { id: 'eelfrHtmkEY', title: 'D (Half Moon)', artist: 'DEAN' },
      { id: '1bVb4kH7r3A', title: 'Rush Hour', artist: '크러쉬' },
      { id: 'AF3p0_xZ2pA', title: '비도 오고 그래서', artist: '헤이즈' },
      { id: '2yqYAsUpdSc', title: 'Out of Time', artist: 'The Weeknd' },
    ],
  },
  {
    label: '인디', query: '인디 음악', c1: '#14b8a6', c2: '#6366f1',
    tracks: [
      { id: 'w4ZkcxH76fI', title: '주저하는 연인들을 위해', artist: '잔나비' },
      { id: '9lJ_5bY8L3E', title: '그라데이션', artist: '10CM' },
      { id: 'Oskv3E4y89A', title: '그대만 있다면', artist: '너드커넥션' },
      { id: 'BB1v0zPVSdg', title: 'Trying too hard', artist: '치즈' },
    ],
  },
  {
    label: '록', query: '록 밴드 명곡', c1: '#ef4444', c2: '#7c3aed',
    tracks: [
      { id: 'vnS_6zGheEg', title: '한 페이지가 될 수 있게', artist: 'DAY6' },
      { id: 'n1hZ8g7bN9Y', title: '가시', artist: '버즈' },
      { id: 'gsgq3A5i9dc', title: '담배가게 아가씨', artist: 'YB' },
      { id: 'zrtwnrFefwA', title: '사랑앓이', artist: 'FT아일랜드' },
    ],
  },
  {
    label: '팝', query: 'pop hits', c1: '#ec4899', c2: '#8b5cf6',
    tracks: [
      { id: '4NRXx6U8ABQ', title: 'Blinding Lights', artist: 'The Weeknd' },
      { id: 'ic8j13piAhQ', title: 'Cruel Summer', artist: 'Taylor Swift' },
      { id: 'TUVcZfQe-Kw', title: 'Levitating', artist: 'Dua Lipa' },
      { id: 'PMivT7MJ41M', title: "That's What I Like", artist: 'Bruno Mars' },
    ],
  },
  {
    label: 'J-POP', query: 'J-POP 인기곡', c1: '#f43f5e', c2: '#f59e0b',
    tracks: [
      { id: 'ZRtdQ81jPUQ', title: 'アイドル (Idol)', artist: 'YOASOBI' },
      { id: 'zuO2fClon98', title: 'Lemon', artist: 'Kenshi Yonezu' },
      { id: 'kffacxfA7G4', title: 'NIGHT DANCER', artist: 'imase' },
      { id: 'cbqvxbfP_X0', title: '베텔기우스', artist: '유우리' },
    ],
  },
  {
    label: 'OST', query: '드라마 OST', c1: '#0ea5e9', c2: '#8b5cf6',
    tracks: [
      { id: 'O0StKlRHVeE', title: '시작 (이태원 클라쓰)', artist: '가호' },
      { id: 'MBYY_IA_-qU', title: '너였다면', artist: '정승환' },
      { id: '1k8c-3pA4xM', title: '첫눈처럼 너에게 가겠다', artist: '에일리' },
      { id: '9k7L_2u8b8E', title: '흔들리는 꽃들 속에서', artist: '장범준' },
    ],
  },
  {
    label: '재즈', query: '재즈 카페', c1: '#d97706', c2: '#7c2d12',
    tracks: [
      { id: 'ZEcqHA7dbwM', title: 'Fly Me To The Moon', artist: 'Frank Sinatra' },
      { id: 'dH3GSrPpXtA', title: 'Waltz for Debby', artist: 'Bill Evans' },
      { id: 'b_y3k5qW_x0', title: "Don't Know Why", artist: 'Norah Jones' },
      { id: 'f8k3y5P_w_M', title: 'Take Five', artist: 'Dave Brubeck' },
    ],
  },
  {
    label: '클래식', query: '클래식 명곡', c1: '#64748b', c2: '#6d28d9',
    tracks: [
      { id: 'pyX-lxPkYbE', title: 'G 선상의 아리아', artist: 'J.S. Bach' },
      { id: 'WNcsUNKlAKw', title: '달빛 (Clair de Lune)', artist: 'Debussy' },
      { id: '4Tr0otuiQuU', title: '월광 소나타', artist: 'Beethoven' },
      { id: 'GUsLNP4ck8U', title: '녹턴 Op.9 No.2', artist: 'Chopin' },
    ],
  },
  {
    label: '로파이', query: 'lofi hip hop', c1: '#7c3aed', c2: '#0f766e',
    tracks: [
      { id: 'jfKfPfyJRdk', title: 'lofi hip hop radio', artist: 'Lofi Girl' },
      { id: '1WM3MHtEjrM', title: 'Lofi Chill Beats', artist: 'Sad Music' },
      { id: '5qap5aO4i9A', title: 'morning coffee', artist: 'potsu' },
      { id: 'HwIA1t8rmcY', title: 'Rainy Days', artist: 'Lofi Paris' },
    ],
  },
  {
    label: '운동', query: '운동할 때 듣는 노래', c1: '#dc2626', c2: '#9333ea',
    tracks: [
      { id: '9HDEHj2yzew', title: 'Physical', artist: 'Dua Lipa' },
      { id: '_Yhyp-_hX2s', title: 'Lose Yourself', artist: 'Eminem' },
      { id: 'btPJPFnesV4', title: 'Eye of the Tiger', artist: 'Survivor' },
      { id: 'PsO6Zn4V00M', title: 'Stronger', artist: 'Kanye West' },
    ],
  },
  {
    label: '드라이브', query: '드라이브 음악', c1: '#2563eb', c2: '#db2777',
    tracks: [
      { id: 'RmuL-AglgOR', title: 'Weekend', artist: '태연' },
      { id: 'xRbPAVnqtcs', title: '여행', artist: '볼빨간사춘기' },
      { id: 'tQ0yjYUFKAE', title: 'Peaches', artist: 'Justin Bieber' },
      { id: '7q6b8Vj1y2U', title: 'Celebrity', artist: '아이유' },
    ],
  },
  {
    label: '잠잘 때', query: '잠잘 때 듣는 음악', c1: '#312e81', c2: '#7c3aed',
    tracks: [
      { id: 'zrtwnrFefwA', title: '무릎', artist: '아이유' },
      { id: 'NwI8Qp2txSA', title: '수면 음악 자장가', artist: 'Sweet Dreams' },
      { id: 'qU7B9_v8A4M', title: '스토커', artist: '10CM' },
      { id: 'm4k2p8Y_x1M', title: '초록빛', artist: '폴킴' },
    ],
  },
  {
    label: '공부', query: '공부할 때 듣는 음악', c1: '#0d9488', c2: '#4338ca',
    tracks: [
      { id: '7maJOI3QMu0', title: 'River Flows in You', artist: 'Yiruma' },
      { id: 'l0GN40EL1VU', title: 'Summer', artist: 'Joe Hisaishi' },
      { id: 'HwIA1t8rmcY', title: '시험 공부할 때 듣는 음악', artist: 'Lofi Paris' },
      { id: '1K8g_8u9p0Y', title: 'Kiss The Rain', artist: 'Yiruma' },
    ],
  },
];

const TABS = [
  { id: 'all', label: '전체' },
  { id: 'songs', label: '노래' },
  { id: 'artists', label: '아티스트' },
  { id: 'albums', label: '앨범' },
  { id: 'playlists', label: '플레이리스트' },
];

export const HISTORY_KEY = 't-music-search-history';
export const readHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
export function remember(q) {
  if (!q || !q.trim()) return;
  try {
    const next = [q.trim(), ...readHistory().filter((x) => x !== q.trim())].slice(0, 14);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('search-history-changed'));
  } catch { /* ignore */ }
}
export function removeHistory(item) {
  try {
    const next = readHistory().filter((x) => x !== item);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('search-history-changed'));
    return next;
  } catch {
    return [];
  }
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

function BrowseTile({ item }) {
  const go = useNav((s) => s.go);
  const playList = usePlayer((s) => s.playList);

  // Random representative track chosen once when the tile mounts
  const randomTrack = useMemo(() => {
    if (!item.tracks || item.tracks.length === 0) return null;
    const idx = Math.floor(Math.random() * item.tracks.length);
    const tr = item.tracks[idx];
    return {
      ...tr,
      thumb: `https://i.ytimg.com/vi/${tr.id}/mqdefault.jpg`,
    };
  }, [item]);

  const onPlayTrack = (e) => {
    e.stopPropagation();
    if (randomTrack) {
      playList(
        [{ id: randomTrack.id, title: randomTrack.title, thumb: randomTrack.thumb, artists: [{ name: randomTrack.artist }] }],
        0,
        { name: `${item.label} 대표곡` }
      );
    }
  };

  return (
    <div
      data-enter
      className="browse-tile"
      style={{ '--c1': item.c1, '--c2': item.c2 }}
      onClick={() => go('search', { q: item.query })}
    >
      {randomTrack && (
        <div
          className="browse-tile-bg"
          style={{ backgroundImage: `url(${randomTrack.thumb})` }}
        />
      )}

      <div className="browse-tile-head">
        <span>{item.label}</span>
      </div>

      {randomTrack && (
        <div className="browse-tile-sub" title={`${randomTrack.title} - ${randomTrack.artist}`}>
          <Music size={12} />
          <span>{randomTrack.title} · {randomTrack.artist}</span>
        </div>
      )}

      {randomTrack ? (
        <div className="browse-tile-art-wrap">
          <img src={randomTrack.thumb} alt="" className="browse-tile-art" loading="lazy" />
          <div className="browse-tile-play" onClick={onPlayTrack} title={`${randomTrack.title} 바로 재생`}>
            <Play size={18} fill="currentColor" />
          </div>
        </div>
      ) : (
        <>
          <i className="bt-shape a" />
          <i className="bt-shape b" />
        </>
      )}
    </div>
  );
}

function Browse() {
  const go = useNav((s) => s.go);
  const openMenu = useUI((s) => s.openMenu);
  const recent = useLibrary((s) => s.recent).slice(0, 8);
  const [history, setHistory] = useState(readHistory);
  const ref = useRef(null);
  useEnter(ref, [], { step: 22 });

  useEffect(() => {
    const onHist = () => setHistory(readHistory());
    window.addEventListener('search-history-changed', onHist);
    return () => window.removeEventListener('search-history-changed', onHist);
  }, []);

  const clear = () => {
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
    setHistory([]);
    window.dispatchEvent(new CustomEvent('search-history-changed'));
  };

  const removeItem = (item, e) => {
    e?.stopPropagation();
    const next = removeHistory(item);
    setHistory(next);
  };

  return (
    <div ref={ref}>
      {history.length > 0 && (
        <section className="history" data-enter>
          <div className="row-between">
            <h2>최근 검색</h2>
            <button className="text-btn" onClick={clear}>모두 지우기</button>
          </div>
          <div className="chips">
            {history.map((h) => (
              <div
                key={h}
                className="chip ghost history-chip"
                onClick={() => go('search', { q: h })}
                onContextMenu={(e) => {
                  openMenu(e, [
                    { label: `'${h}' 검색`, icon: SearchIcon, onClick: () => go('search', { q: h }) },
                    { divider: true },
                    { label: '이 검색 기록 삭제', icon: X, onClick: (ev) => removeItem(h, ev) },
                  ]);
                }}
              >
                <History size={13} className="h-icon" />
                <span className="h-text">{h}</span>
                <button
                  className="chip-del-btn"
                  onClick={(e) => removeItem(h, e)}
                  title={`'${h}' 검색 기록 삭제`}
                  aria-label="삭제"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && <Shelf title="최근 들은 곡" items={recent.map((t) => ({ ...t, kind: 'track', isRecent: true }))} />}
      <section>
        <h2 data-enter>모두 둘러보기</h2>
        <div className="browse-grid">
          {BROWSE_CATEGORIES.map((cat) => (
            <BrowseTile key={cat.label} item={cat} />
          ))}
        </div>
      </section>
    </div>
  );
}

export default function Search({ q }) {
  return <div className="page search">{q ? <Results key={q} q={q} /> : <Browse />}</div>;
}

