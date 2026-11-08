import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Music, Play, Pause, RotateCw } from 'lucide-react';
import { useNav } from '../store/nav.js';
import { api, errorText } from '../lib/api.js';
import { pop } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';

const RETRY_DELAYS_MS = [1500, 5000];

// Most failures are a moment's trouble, so they're retried before anyone sees them. What still fails
// tries again by itself as soon as the connection returns.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer = null;
    let attempt = 0;
    const run = () => fn().then(
      (data) => alive && setState({ loading: false, data, error: null }),
      (error) => {
        if (!alive) return;
        if (attempt < RETRY_DELAYS_MS.length) {
          timer = setTimeout(run, RETRY_DELAYS_MS[attempt++]);
          return;
        }
        setState({ loading: false, data: null, error: errorText(error) });
      },
    );
    setState((s) => ({ loading: true, data: s.data, error: null }));
    run();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  useEffect(() => {
    if (!state.error) return undefined;
    const again = () => setNonce((n) => n + 1);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [state.error]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}

// From sharpest to the one every video has.
const SMALLER_THUMB = { 'maxresdefault.jpg': 'hq720.jpg', 'hq720.jpg': 'mqdefault.jpg', 'mqdefault.jpg': 'hqdefault.jpg', 'hqdefault.jpg': 'default.jpg', 'default.jpg': null };
const THUMB_RETRY_MS = 4000;
const THUMB_RETRIES = 2;

// Some addresses only work with the signature that was cut off them, so anything unknown starts over
// from the standard sizes.
function smallerThumb(url) {
  const m = /^(https:\/\/i\.ytimg\.com\/vi(?:_webp)?\/[\w-]+\/)([\w.]+)/.exec(url || '');
  if (!m) return null;
  return m[2] in SMALLER_THUMB ? (SMALLER_THUMB[m[2]] && m[1] + SMALLER_THUMB[m[2]]) : `${m[1].replace('vi_webp', 'vi')}hq720.jpg`;
}

// Pictures known to show nothing (no video picture and no album cover), so lists can leave those items
// out and take the next ones instead (see withCovers).
export const useNoCover = create(() => ({ srcs: {} }));
const noteNoCover = (src) => { if (src && !useNoCover.getState().srcs[src]) useNoCover.setState((s) => ({ srcs: { ...s.srcs, [src]: true } })); };
const coverOf = (item) => item?.thumb;
// A picture that keeps failing is dropped like a missing one, unless many are failing at once: then the
// picture server itself is in trouble, and dropping them all would empty the screen.
const FAIL_WINDOW_MS = 60 * 1000;
const FAIL_LIMIT = 8;
const failures = [];
function dropFailed(src) {
  const now = Date.now();
  while (failures.length && now - failures[0] > FAIL_WINDOW_MS) failures.shift();
  if (failures.length >= FAIL_LIMIT) return;
  failures.push(now);
  noteNoCover(src);
}
// The first `count` items that have a cover. Items of the `keep` kinds (your own playlists) always stay.
export function withCovers(items, count, noCover, keep = []) {
  return (items || []).filter((it) => keep.includes(it?.kind) || (coverOf(it) && !noCover[coverOf(it)])).slice(0, count);
}

// Album covers found for videos without a picture, shared by every Thumb on screen.
const arts = new Map();
const albumArt = (id) => {
  if (!arts.has(id)) arts.set(id, Promise.resolve(api.trackArt(id)).catch(() => null));
  return arts.get(id);
};

// `videoId`: when the picture it came with won't load, the video's own picture stands in.
export function Thumb({ src, round, className = '', size, alt = '', videoId }) {
  const [url, setUrl] = useState(src);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false); // YouTube has no picture at all for this video
  const tries = useRef(0);
  useEffect(() => { setUrl(src); setFailed(false); setMissing(false); tries.current = 0; }, [src]);
  // Many pictures loading at once can lose a few to the network. A picture that failed isn't a missing
  // picture, so it's asked for again, and again whenever the connection returns.
  useEffect(() => {
    if (!failed || !src) return undefined;
    const again = () => { tries.current = 0; setUrl(src); setFailed(false); };
    const timer = tries.current < THUMB_RETRIES ? setTimeout(() => { tries.current += 1; setUrl(src); setFailed(false); }, THUMB_RETRY_MS) : null;
    // Still failing with the connection up: treat it like a missing picture, so a row takes the next
    // item in its place instead of showing a blank one. Offline, everything fails, so nothing is dropped.
    if (!timer && navigator.onLine) dropFailed(src);
    window.addEventListener('online', again);
    return () => { clearTimeout(timer); window.removeEventListener('online', again); };
  }, [failed, src]);
  const style = size ? { width: size, height: size } : undefined;
  const fallback = () => {
    const next = smallerThumb(url) || (videoId && !url?.includes(`/vi/${videoId}/`) ? `https://i.ytimg.com/vi/${videoId}/hq720.jpg` : null);
    if (next) setUrl(next);
    else setFailed(true);
  };
  // Missing YouTube video thumbnails come back as a 120x90 grey picture with 3 dots, not a network error.
  // default.jpg is really that size, and album art can be too, so only sizes that should be larger count.
  // hqdefault exists for every video that has a picture, so the grey one there means there is none:
  // the video's own picture is tried once, and otherwise the app's own placeholder beats YouTube's.
  const onLoad = (e) => {
    if (e.currentTarget.naturalWidth > 120) return;
    if (!url.endsWith('/hqdefault.jpg')) {
      const next = smallerThumb(url);
      if (next) setUrl(next);
      return;
    }
    if (videoId && !url.includes(`/vi/${videoId}/`)) { setUrl(`https://i.ytimg.com/vi/${videoId}/hq720.jpg`); return; }
    // No video picture at all: ask YouTube Music for the album's cover before falling back to ours.
    const id = videoId || /\/vi(?:_webp)?\/([\w-]{11})\//.exec(url)?.[1];
    if (!id) { setMissing(true); noteNoCover(src); return; }
    setMissing(true);
    albumArt(id).then((art) => { if (art) { setUrl(art); setMissing(false); } else noteNoCover(src); });
  };
  if (!url || failed || missing) {
    return (
      <div className={`thumb placeholder ${round ? 'round' : ''} ${className}`} style={style}>
        <Music size={size ? size * 0.4 : 20} />
      </div>
    );
  }
  return <img className={`thumb ${round ? 'round' : ''} ${className}`} style={style} src={url} alt={alt} loading="lazy" draggable={false} onError={fallback} onLoad={onLoad} />;
}

export function ArtistLinks({ artists = [], className = '' }) {
  const go = useNav((s) => s.go);
  return (
    <span className={`artist-links ${className}`}>
      {artists.map((a, i) => (
        <span key={(a.id || a.name) + i}>
          {i > 0 && ', '}
          {a.id ? <a onClick={(e) => { e.stopPropagation(); go('artist', { id: a.id }); }}>{a.name}</a> : <span>{a.name}</span>}
        </span>
      ))}
    </span>
  );
}

export function PlayButton({ playing, onClick, size = 48, className = '', label }) {
  const ref = useRef(null);
  return (
    <button
      ref={ref}
      className={`play-btn ${className}`}
      style={{ width: size, height: size }}
      onClick={(e) => { e.stopPropagation(); pop(ref.current, 0.86); onClick(); }}
      aria-label={label || (playing ? tr('일시정지') : tr('재생'))}
    >
      {/* A new key on each change lets the new icon morph in (see .play-icon). */}
      <span className="play-icon" key={playing ? 'pause' : 'play'}>
        {playing ? <Pause size={size * 0.4} fill="currentColor" /> : <Play size={size * 0.4} fill="currentColor" style={{ marginLeft: size * 0.05 }} />}
      </span>
    </button>
  );
}

export function Equalizer({ playing = true }) {
  return <span className={`eq ${playing ? '' : 'paused'}`}><i /><i /><i /><i /></span>;
}

export function SkeletonRows({ count = 8 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-row" style={{ animationDelay: `${i * 60}ms` }}>
          <i className="sk sk-thumb" /><span><i className="sk sk-line" /><i className="sk sk-line short" /></span>
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 6 }) {
  return (
    <div className="skeleton-cards">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-card" style={{ animationDelay: `${i * 70}ms` }}>
          <i className="sk sk-art" /><i className="sk sk-line" /><i className="sk sk-line short" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="page">
      <div className="sk-hero"><i className="sk sk-art-big" /><span><i className="sk sk-line" /><i className="sk sk-title" /><i className="sk sk-line short" /></span></div>
      <SkeletonRows count={7} />
    </div>
  );
}

export function ErrorMsg({ error, onRetry }) {
  return (
    <div className="center-msg">
      <div className="err-orb" />
      <p>{error}</p>
      {onRetry && <button className="btn" onClick={onRetry}><RotateCw size={15} />{' '}{tr('다시 시도')}</button>}
    </div>
  );
}

export function Empty({ icon: Icon, title, text, children }) {
  return (
    <div className="empty" data-enter>
      <div className="empty-icon">{Icon && <Icon size={30} />}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
