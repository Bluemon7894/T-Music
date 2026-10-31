import { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Heart, Clock, Mic2, ArrowDownToLine, Play, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLibrary, weeklyStats } from '../store/library.js';
import { useDownloads } from '../store/downloads.js';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { dailyOrder, greeting, fmtBytes } from '../lib/util.js';
import { artistsOfTheDay, hasTaste, mixSeeds, rankMix, recentlyPlayedIds, tasteProfile } from '../lib/taste.js';
import { useEnter, animate, stagger, ease } from '../lib/motion.js';
import { splitText } from 'animejs';
import { useAsync, Thumb, PlayButton, SkeletonCards } from '../components/common.jsx';
import { Shelf, CoverFlow, openItem, playItem, subtitleOf } from '../components/Cards.jsx';

const MOODS = [
  { label: '신나는', q: '신나는 노래', c: ['#f472b6', '#8b5cf6'] },
  { label: '감성', q: '감성 발라드', c: ['#818cf8', '#c084fc'] },
  { label: '집중', q: '집중할 때 듣는 음악', c: ['#22d3ee', '#6366f1'] },
  { label: '드라이브', q: '드라이브 음악', c: ['#fb923c', '#db2777'] },
  { label: '운동', q: '운동할 때 듣는 노래', c: ['#f43f5e', '#a855f7'] },
  { label: '새벽', q: '새벽 감성 노래', c: ['#6366f1', '#0ea5e9'] },
  { label: '힐링', q: '힐링 음악', c: ['#34d399', '#6366f1'] },
  { label: '파티', q: '파티 음악', c: ['#e879f9', '#f59e0b'] },
];

function Greeting() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    try {
      const { chars } = splitText(ref.current, { chars: true });
      animate(chars, { opacity: [0, 1], translateY: [40, 0], rotateX: [-90, 0], delay: stagger(28), ease: ease.bouncy });
    } catch { /* plain text fallback */ }
  }, []);
  return <h1 className="greeting" ref={ref}>{greeting()}</h1>;
}

function QuickTile({ item, onPlay }) {
  const go = useNav((s) => s.go);
  return (
    <div className="quick-tile" data-enter onClick={() => openItem(item, go)}>
      {item.icon ? <div className="quick-art liked-art">{item.icon}</div> : <Thumb src={item.thumb} className="quick-art" />}
      <span className="quick-name">{item.title || item.name}</span>
      <PlayButton size={34} className="quick-play" onClick={onPlay} />
    </div>
  );
}

function StatsRow() {
  const listens = useLibrary((s) => s.listens);
  const liked = useLibrary((s) => s.liked.length);
  const dl = { n: useDownloads((s) => s.items.length), size: useDownloads((s) => s.totalSize) };
  const go = useNav((s) => s.go);
  const st = useMemo(() => weeklyStats(listens), [listens]);
  const max = Math.max(1, ...st.days.map((d) => d.min));
  return (
    <section className="stats">
      <div className="stat-card wide" data-enter>
        <div className="stat-top"><Clock size={16} /> 이번 주 청취</div>
        <div className="stat-big">
          {st.hours > 0 ? (
            <>
              {st.hours}<small>시간</small> {st.mins}<small>분</small>
            </>
          ) : (
            <>
              {st.mins}<small>분</small>
            </>
          )}
        </div>
        <div className="stat-bars">
          {st.days.map((d, i) => (
            <div key={i} className="stat-bar" title={`${d.label}요일: ${d.min >= 60 ? `${Math.floor(d.min / 60)}시간 ${d.min % 60}분` : `${d.min}분`}`}>
              <i style={{ height: `${Math.max(6, (d.min / max) * 100)}%` }} className={i === 6 ? 'today' : ''} />
              <span>{d.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="stat-card" data-enter>
        <div className="stat-top"><Mic2 size={16} /> 가장 많이 들은 아티스트</div>
        <div className="stat-mid">{st.topArtist || '아직 없어요'}</div>
        <p className="stat-note">{st.plays ? `이번 주 ${st.plays}곡 재생` : '곡을 들으면 여기에 기록돼요'}</p>
      </div>
      <div className="stat-card link" data-enter onClick={() => go('liked')}>
        <div className="stat-top"><Heart size={16} /> 좋아요</div>
        <div className="stat-big">{liked}<small>곡</small></div>
        <p className="stat-note">하트를 누른 곡 모아보기 <ArrowRight size={13} /></p>
      </div>
      <div className="stat-card link" data-enter onClick={() => go('downloads')}>
        <div className="stat-top"><ArrowDownToLine size={16} /> 오프라인 저장</div>
        <div className="stat-big">{dl.n}<small>곡</small></div>
        <p className="stat-note">{fmtBytes(dl.size)} 사용 중 <ArrowRight size={13} /></p>
      </div>
    </section>
  );
}

const SHELF_ITEMS = 12;
const RECOMMEND_SEEDS = 10;
const MIN_FRESH_PICKS = 6;

export default function Home() {
  const lib = useLibrary();
  const go = useNav((s) => s.go);
  const playList = usePlayer((s) => s.playList);
  const recentIds = lib.recent.slice(0, RECOMMEND_SEEDS).map((t) => t.id).join();
  const seed = useMemo(() => dailyOrder(lib.recent.slice(0, RECOMMEND_SEEDS), 'seed')[0], [recentIds]);
  const home = useAsync(() => api.home(), []);
  const taste = useMemo(() => tasteProfile(lib.listens, lib.liked), [lib.listens, lib.liked]);
  const seeds = useMemo(() => (hasTaste(taste) ? mixSeeds(taste) : []), [taste]);
  const seedKey = seeds.map((s) => s.id).join();
  const excluded = () => new Set([...recentlyPlayedIds(lib.listens), ...lib.liked.map((t) => t.id)]);
  const mix = useAsync(async () => {
    if (!seeds.length) return [];
    const lists = await Promise.allSettled(seeds.map((s) => api.related(s.id)));
    return rankMix(lists.filter((r) => r.status === 'fulfilled').map((r) => r.value), taste, excluded());
  }, [seedKey]);
  const favoriteArtists = useMemo(() => (hasTaste(taste) ? artistsOfTheDay(taste).filter((a) => a.name) : []), [taste]);
  const artistKey = favoriteArtists.map((a) => a.name).join();
  const byArtist = useAsync(async () => {
    const skip = excluded();
    const found = await Promise.allSettled(favoriteArtists.map(async (a) => {
      const { songs } = await api.search(a.name);
      const items = songs.filter((t) => t.artists?.some((x) => x.name === a.name) && !skip.has(t.id));
      return { name: a.name, items: items.slice(0, SHELF_ITEMS) };
    }));
    return found.filter((r) => r.status === 'fulfilled' && r.value.items.length >= MIN_FRESH_PICKS).map((r) => r.value);
  }, [artistKey]);
  const forYou = useAsync(async () => {
    if (!seed) return [];
    const heard = new Set(lib.recent.map((t) => t.id));
    const related = await api.related(seed.id);
    const fresh = related.filter((t) => !heard.has(t.id));
    return dailyOrder(fresh.length >= MIN_FRESH_PICKS ? fresh : related, seed.id);
  }, [seed?.id]);
  const [hero, setHero] = useState(null);
  const ref = useRef(null);
  useEnter(ref, [home.data ? 1 : 0]);

  const shelves = useMemo(() => (home.data?.shelves || []).map((s) => ({ ...s, items: dailyOrder(s.items, s.title).slice(0, SHELF_ITEMS) })), [home.data]);
  const featured = useMemo(() => shelves.map((s) => s.items[0]).concat(shelves.map((s) => s.items[1])).filter(Boolean).slice(0, 9), [shelves]);

  const quick = useMemo(() => {
    const items = [{ kind: 'liked', title: '좋아요 표시한 곡', icon: <Heart size={20} fill="#fff" /> }];
    if (mix.data?.length) items.push({ kind: 'mix', title: '오늘의 믹스', thumb: mix.data[0].thumb });
    for (const p of lib.playlists.slice(0, 3)) items.push({ kind: 'local', id: p.id, title: p.name, thumb: p.thumb || p.tracks[0]?.thumb, tracks: p.tracks });
    for (const a of lib.savedAlbums.slice(0, 2)) items.push({ kind: 'album', ...a });
    for (const t of lib.recent) {
      if (items.length >= 8) break;
      items.push({ ...t, kind: 'track' });
    }
    for (const it of featured) {
      if (items.length >= 8) break;
      if (!items.some((x) => x.id === it.id)) items.push(it);
    }
    return items.slice(0, 8);
  }, [lib.playlists, lib.savedAlbums, lib.recent, featured, mix.data]);

  const playQuick = (it) => {
    if (it.kind === 'mix') return playList(mix.data, 0, { name: '오늘의 믹스' });
    if (it.kind === 'liked') return lib.liked.length ? playList(lib.liked, 0, { name: '좋아요 표시한 곡' }) : go('liked');
    if (it.kind === 'local') return playList(it.tracks, 0, { name: it.title });
    return playItem(it);
  };

  const now = new Date();
  return (
    <div className="page home" ref={ref}>
      <section className="hero">
        <div className="hero-text">
          <span className="hero-date" data-enter>{now.getMonth() + 1}월 {now.getDate()}일 {'일월화수목금토'[now.getDay()]}요일</span>
          <Greeting />
          {hero ? (
            <div className="hero-pick" data-enter key={hero.id}>
              <span className="hero-label">오늘의 추천</span>
              <h2>{hero.title || hero.name}</h2>
              <p>{subtitleOf(hero)}</p>
              <div className="hero-actions">
                <button className="btn grad lg" onClick={() => playItem(hero)}><Play size={16} fill="currentColor" /> 재생</button>
                <button className="btn lg" onClick={() => openItem(hero, go)}>자세히 보기</button>
              </div>
            </div>
          ) : (
            <div className="hero-pick"><i className="sk sk-line" /><i className="sk sk-title" /><i className="sk sk-line short" /></div>
          )}
        </div>
        <div className="hero-flow">
          {featured.length > 2 ? <CoverFlow items={featured} onActive={setHero} /> : <div className="cf-skeleton"><i className="sk" /><i className="sk" /><i className="sk" /></div>}
        </div>
      </section>

      <div className="quick-grid">
        {quick.map((it, i) => <QuickTile key={it.kind + (it.id || i)} item={it} onPlay={() => playQuick(it)} />)}
      </div>

      <div className="moods" data-enter>
        {MOODS.map((m) => (
          <button key={m.label} className="mood" style={{ '--c1': m.c[0], '--c2': m.c[1] }} onClick={() => go('search', { q: m.q })}>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <StatsRow />

      {lib.recent.length > 0 && <Shelf title="최근 재생한 곡" items={lib.recent.slice(0, 20).map((t) => ({ ...t, kind: 'track', isRecent: true }))} />}
      {mix.data?.length > 0 && <Shelf title="오늘의 믹스" subtitle={`자주 듣는 ${taste.artists.slice(0, 2).map((a) => a.name).filter(Boolean).join(', ')} 취향으로 골랐어요`} items={mix.data.map((t) => ({ ...t, kind: 'track' }))} />}
      {byArtist.data?.map((a) => <Shelf key={a.name} title={`자주 듣는 ${a.name}`} subtitle="아직 안 들어본 곡" items={a.items.map((t) => ({ ...t, kind: 'track' }))} />)}
      {!mix.data?.length && forYou.data?.length > 0 && <Shelf title="취향 저격 추천" subtitle={`'${seed?.title}'를 좋아한다면`} items={forYou.data.map((t) => ({ ...t, kind: 'track' }))} />}
      {lib.followed.length > 0 && <Shelf title="팔로우한 아티스트" items={lib.followed.map((a) => ({ ...a, kind: 'artist' }))} />}

      {home.loading && !home.data && <><div className="sk-shelf-title sk" /><SkeletonCards /><div className="sk-shelf-title sk" /><SkeletonCards /></>}
      {home.error && <div className="inline-error">추천을 불러오지 못했어요. <button className="text-btn" onClick={home.retry}>다시 시도</button></div>}
      {shelves.map((s) => <Shelf key={s.title} title={s.title} items={s.items} />)}
    </div>
  );
}
