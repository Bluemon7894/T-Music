import { useEffect, useState } from 'react';
import { Music, Play, Pause } from 'lucide-react';
import { useNav } from '../store/nav.js';
import { errorText } from '../api.js';

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ loading: true, data: s.data, error: null }));
    fn().then(
      (data) => alive && setState({ loading: false, data, error: null }),
      (error) => alive && setState({ loading: false, data: null, error: errorText(error) }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function Thumb({ src, round, className = '', size }) {
  const [url, setUrl] = useState(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setUrl(src); setFailed(false); }, [src]);
  const style = size ? { width: size, height: size } : undefined;
  const onError = () => {
    if (url?.includes('/hq720.jpg')) setUrl(url.replace('/hq720.jpg', '/mqdefault.jpg'));
    else setFailed(true);
  };
  if (!url || failed) {
    return (
      <div className={`thumb placeholder ${round ? 'round' : ''} ${className}`} style={style}>
        <Music size={size ? size * 0.4 : 20} />
      </div>
    );
  }
  return <img className={`thumb ${round ? 'round' : ''} ${className}`} style={style} src={url} alt="" loading="lazy" draggable={false} onError={onError} />;
}

export function ArtistLinks({ artists = [], className = '' }) {
  const go = useNav((s) => s.go);
  return (
    <span className={`artist-links ${className}`}>
      {artists.map((a, i) => (
        <span key={(a.id || a.name) + i}>
          {i > 0 && ', '}
          {a.id ? (
            <a onClick={(e) => { e.stopPropagation(); go('artist', { id: a.id }); }}>{a.name}</a>
          ) : (
            <span>{a.name}</span>
          )}
        </span>
      ))}
    </span>
  );
}

export function PlayButton({ playing, onClick, size = 48, className = '' }) {
  return (
    <button className={`play-btn ${className}`} style={{ width: size, height: size }} onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={playing ? '일시정지' : '재생'}>
      {playing ? <Pause size={size * 0.42} fill="currentColor" /> : <Play size={size * 0.42} fill="currentColor" style={{ marginLeft: size * 0.05 }} />}
    </button>
  );
}

export function Loading() {
  return (
    <div className="center-msg">
      <div className="spinner" />
    </div>
  );
}

export function ErrorMsg({ error, onRetry }) {
  return (
    <div className="center-msg">
      <p>{error}</p>
      {onRetry && <button className="pill" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}
