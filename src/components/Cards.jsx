import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNav } from '../store/nav.js';
import { usePlayer } from '../store/player.js';
import { api } from '../api.js';
import { toast } from '../store/ui.js';
import { Thumb, PlayButton } from './common.jsx';

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

function subtitleOf(item) {
  if (item.kind === 'artist') return item.subtitle?.includes('아티스트') ? item.subtitle : '아티스트';
  if (item.kind === 'album') return [item.year, item.type || '앨범', item.artists?.map((a) => a.name).join(', ')].filter(Boolean).join(' • ');
  if (item.kind === 'playlist') return item.author || '재생목록';
  if (item.kind === 'track') return item.artists?.map((a) => a.name).join(', ');
  return item.subtitle || '';
}

export function Card({ item }) {
  const go = useNav((s) => s.go);
  return (
    <div className="card" onClick={() => openItem(item, go)}>
      <div className="card-art">
        <Thumb src={item.thumb} round={item.kind === 'artist'} />
        <PlayButton className="card-play" onClick={() => playItem(item)} />
      </div>
      <div className="card-title">{item.title || item.name}</div>
      <div className="card-sub">{subtitleOf(item)}</div>
    </div>
  );
}

export function Shelf({ title, items, onMore }) {
  const ref = useRef(null);
  const scroll = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });
  if (!items?.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-head">
        <h2 onClick={onMore} className={onMore ? 'link' : ''}>{title}</h2>
        <div className="shelf-nav">
          <button className="icon-btn circle" onClick={() => scroll(-1)} aria-label="이전"><ChevronLeft size={18} /></button>
          <button className="icon-btn circle" onClick={() => scroll(1)} aria-label="다음"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="shelf-row" ref={ref}>
        {items.map((it, i) => <Card key={it.kind + it.id + i} item={it} />)}
      </div>
    </section>
  );
}

export function Grid({ items }) {
  return <div className="grid">{items.map((it, i) => <Card key={it.kind + it.id + i} item={it} />)}</div>;
}
