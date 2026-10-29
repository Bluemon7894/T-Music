import { useEffect, useRef, useState } from 'react';
import { Music, Play, Pause, RotateCw } from 'lucide-react';
import { useNav } from '../store/nav.js';
import { errorText } from '../lib/api.js';
import { pop } from '../lib/motion.js';
import { getAudioOnset } from '../lib/audio.js';

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ loading: true, data: s.data, error: null }));
    fn().then(
      (data) => alive && setState({ loading: false, data, error: null }),
      (error) => alive && setState({ loading: false, data: null, error: errorText(error) }),
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}

export function Thumb({ src, round, className = '', size, alt = '' }) {
  const [url, setUrl] = useState(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setUrl(src); setFailed(false); }, [src]);
  const style = size ? { width: size, height: size } : undefined;
  const fallback = () => {
    if (url?.includes('/hq720.jpg')) setUrl(url.replace('/hq720.jpg', '/mqdefault.jpg'));
    else setFailed(true);
  };
  // Missing YouTube thumbnails come back as a 120x90 grey placeholder with 3 dots, not a network error.
  const onLoad = (e) => {
    if (e.currentTarget.naturalWidth <= 120) {
      if (url?.includes('/hq720.jpg')) {
        setUrl(url.replace('/hq720.jpg', '/mqdefault.jpg'));
      } else {
        setFailed(true);
      }
    }
  };
  if (!url || failed) {
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
      aria-label={label || (playing ? '일시정지' : '재생')}
    >
      {playing ? <Pause size={size * 0.4} fill="currentColor" /> : <Play size={size * 0.4} fill="currentColor" style={{ marginLeft: size * 0.05 }} />}
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
      {onRetry && <button className="btn" onClick={onRetry}><RotateCw size={15} /> 다시 시도</button>}
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

// Zero-configuration automatic lyrics sync engine
// Automatically aligns YouTube audio with LRC timestamps using audio onset and calibrated duration
export function useAutoLyricsSync(track, data) {
  const [autoOffset, setAutoOffset] = useState(0);

  useEffect(() => {
    if (!track?.id || !data) {
      setAutoOffset(0);
      return;
    }

    const computeOffset = () => {
      // 1. Audio hardware onset detected during playback (e.g. 2.1s intro card before audio starts)
      const onset = getAudioOnset(track.id);
      if (onset >= 0.4 && onset <= 12.0) {
        return onset;
      }

      // 2. Calibrated duration difference between YouTube video and studio LRC
      const trackDur = track.duration || 0;
      const lyricsDur = data.lyricsDuration || 0;
      if (trackDur > 0 && lyricsDur > 0) {
        const diff = trackDur - lyricsDur;
        if (diff >= 0.8 && diff <= 10.0) {
          return Math.round(diff * 10) / 10;
        } else if (diff <= -0.8 && diff >= -8.0) {
          return Math.round(diff * 10) / 10;
        }
      }

      return data.autoOffset || 0;
    };

    setAutoOffset(computeOffset());

    const onOnset = (e) => {
      if (e.detail?.trackId === track.id && typeof e.detail?.onset === 'number') {
        setAutoOffset(e.detail.onset);
      }
    };
    window.addEventListener('audio-onset-detected', onOnset);
    return () => window.removeEventListener('audio-onset-detected', onOnset);
  }, [track?.id, track?.duration, data]);

  return autoOffset;
}
