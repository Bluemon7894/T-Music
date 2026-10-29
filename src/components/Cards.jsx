import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { useUI, toast } from '../store/ui.js';
import { useLibrary } from '../store/library.js';
import { api } from '../lib/api.js';
import { useTilt, useEnter, animate, ease, utils } from '../lib/motion.js';
import { Thumb, PlayButton } from './common.jsx';
import { trackMenuItems } from './TrackList.jsx';

// Loads an album/playlist/artist and plays it straight from a card.
export async function playItem(item) {
  try {
    const p = usePlayer.getState();
    if (item.kind === 'track') return p.playList([item], 0);
    const data = item.kind === 'album' ? await api.album(item.id)
      : item.kind === 'playlist' ? await api.playlist(item.id)
        : await api.artist(item.id);
    const tracks = data.tracks || data.songs || [];
    if (!tracks.length) return toast('재생할 곡이 없습니다');
    p.playList(tracks, 0, { name: data.title || data.name });
  } catch {
    toast('불러오지 못했습니다');
  }
}

export function openItem(item, go) {
  if (item.kind === 'album') go('album', { id: item.id });
  else if (item.kind === 'artist') go('artist', { id: item.id });
  else if (item.kind === 'playlist') go('playlist', { id: item.id });
  else if (item.kind === 'local') go('local', { id: item.id });
  else if (item.kind === 'liked') go('liked');
  else if (item.kind === 'track') usePlayer.getState().playList([item], 0);
}

export function subtitleOf(item) {
  if (item.kind === 'artist') return item.subtitle?.includes('아티스트') ? item.subtitle : '아티스트';
  if (item.kind === 'album') return [item.year, item.type || '앨범', item.artists?.map((a) => a.name).join(', ')].filter(Boolean).join(' · ');
  if (item.kind === 'playlist') return item.author || '플레이리스트';
  if (item.kind === 'track') return item.artists?.map((a) => a.name).join(', ');
  return item.subtitle || '';
}

export function Card({ item, size }) {
  const go = useNav((s) => s.go);
  const openMenu = useUI((s) => s.openMenu);
  const removeRecent = useLibrary((s) => s.removeRecent);
  const art = useRef(null);
  useTilt(art, { max: 9, scale: 1.04 });
  const round = item.kind === 'artist';

  const onContextMenu = (e) => {
    if (item.kind === 'track') {
      openMenu(e, trackMenuItems(item));
    }
  };

  const onRemove = (e) => {
    e.stopPropagation();
    removeRecent(item.id);
    toast('최근 들은 곡에서 삭제했습니다');
  };

  return (
    <div
      className={`card ${round ? 'is-artist' : ''}`}
      data-enter
      onClick={() => openItem(item, go)}
      onContextMenu={onContextMenu}
      style={size ? { width: size } : undefined}
    >
      <div className={`card-art ${round ? 'round' : ''}`} ref={art}>
        <Thumb src={item.thumb} round={round} />
        <span className="glare" />
        <PlayButton className="card-play" size={44} onClick={() => playItem(item)} />
        {item.isRecent && (
          <button className="card-remove" onClick={onRemove} title="최근 들은 곡에서 삭제" aria-label="최근 들은 곡에서 삭제">
            <X size={15} />
          </button>
        )}
      </div>
      <div className="card-title">{item.title || item.name}</div>
      <div className="card-sub">{subtitleOf(item)}</div>
    </div>
  );
}

export function Shelf({ title, subtitle, items, onMore, wide }) {
  const row = useRef(null);
  const wrap = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: true });
  useEnter(wrap, [items?.length]);
  const update = useCallback(() => {
    const el = row.current;
    if (el) setEdge({ l: el.scrollLeft > 8, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 });
  }, []);
  useEffect(update, [items, update]);
  const scroll = (dir) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.85, behavior: 'smooth' });
  if (!items?.length) return null;
  return (
    <section className={`shelf ${wide ? 'wide' : ''}`} ref={wrap}>
      <div className="shelf-head" data-enter>
        <div>
          <h2 onClick={onMore} className={onMore ? 'link' : ''}>{title}</h2>
          {subtitle && <p className="shelf-sub">{subtitle}</p>}
        </div>
        <div className="shelf-nav">
          {onMore && <button className="text-btn" onClick={onMore}>모두 보기</button>}
          <button className="icon-btn circle glass" disabled={!edge.l} onClick={() => scroll(-1)} aria-label="이전"><ChevronLeft size={18} /></button>
          <button className="icon-btn circle glass" disabled={!edge.r} onClick={() => scroll(1)} aria-label="다음"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className={`shelf-row ${edge.l ? 'fade-l' : ''} ${edge.r ? 'fade-r' : ''}`} ref={row} onScroll={update}>
        {items.map((it, i) => <Card key={it.kind + it.id + i} item={it} />)}
      </div>
    </section>
  );
}

export function Grid({ items }) {
  const ref = useRef(null);
  useEnter(ref, [items.length], { step: 24 });
  return <div className="grid" ref={ref}>{items.map((it, i) => <Card key={it.kind + it.id + i} item={it} />)}</div>;
}

// 3D carousel: the active cover faces forward, neighbours fan out behind it.
export function CoverFlow({ items, onActive }) {
  const [index, setIndex] = useState(0);
  const stage = useRef(null);
  const go = useNav((s) => s.go);
  const count = items.length;
  const timer = useRef(null);

  const layout = useCallback((i, instant) => {
    const cards = stage.current?.children;
    if (!cards) return;
    [...cards].forEach((el, k) => {
      let off = k - i;
      if (off > count / 2) off -= count;
      if (off < -count / 2) off += count;
      const abs = Math.abs(off);
      const props = {
        translateX: off * 120,
        translateZ: -abs * 140,
        rotateY: off === 0 ? 0 : off > 0 ? -42 : 42,
        scale: off === 0 ? 1 : 0.9,
        opacity: abs > 2 ? 0 : 1 - abs * 0.18,
      };
      el.style.zIndex = String(100 - abs);
      el.classList.toggle('active', off === 0);
      if (instant) utils.set(el, props);
      else animate(el, { ...props, ease: ease.soft });
    });
  }, [count]);

  useEffect(() => { layout(index, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { layout(index); onActive?.(items[index]); }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = useCallback(() => {
    clearInterval(timer.current);
    timer.current = setInterval(() => setIndex((i) => (i + 1) % count), 5200);
  }, [count]);
  useEffect(() => { restart(); return () => clearInterval(timer.current); }, [restart]);

  const step = (d) => { setIndex((i) => (i + d + count) % count); restart(); };

  return (
    <div className="coverflow" onWheel={(e) => { if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) step(e.deltaX > 0 ? 1 : -1); }}>
      <div className="cf-stage" ref={stage}>
        {items.map((it, k) => (
          <div key={it.kind + it.id} className="cf-card" onClick={() => (k === index ? openItem(it, go) : (setIndex(k), restart()))}>
            <Thumb src={it.thumb} />
            <span className="glare" />
            <div className="cf-caption"><b>{it.title || it.name}</b><small>{subtitleOf(it)}</small></div>
          </div>
        ))}
      </div>
      <button className="icon-btn circle glass cf-prev" onClick={() => step(-1)} aria-label="이전"><ChevronLeft size={20} /></button>
      <button className="icon-btn circle glass cf-next" onClick={() => step(1)} aria-label="다음"><ChevronRight size={20} /></button>
      <div className="cf-dots">{items.map((_, k) => <i key={k} className={k === index ? 'on' : ''} onClick={() => { setIndex(k); restart(); }} />)}</div>
    </div>
  );
}
