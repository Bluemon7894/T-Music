// Synced lyrics, shared by the side panel and the fullscreen stage.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { ListMusic, Mic2, Minus, Plus, Search } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { api } from '../../lib/api.js';
import { getAudioOnset } from '../../lib/audio.js';
import LyricsPickerModal from './LyricsPickerModal.jsx';

const NUDGE_KEY = 't-music-lyric-nudge';
const NUDGE_STEP = 0.5;
const MAX_SAVED_NUDGES = 300;
// A manual scroll keeps the view where the user put it for this long.
const MANUAL_SCROLL_HOLD_MS = 4000;
// Captions come from the video itself, so they already line up with its audio.
const SOURCE_TIMED_TO_VIDEO = 'YouTube 자막';

function loadNudges() {
  try {
    return JSON.parse(localStorage.getItem(NUDGE_KEY)) || {};
  } catch {
    return {};
  }
}

const useNudges = create(() => ({ map: loadNudges() }));

function saveNudge(id, value) {
  const map = { ...useNudges.getState().map };
  delete map[id];
  if (value) map[id] = value;
  for (const old of Object.keys(map).slice(0, -MAX_SAVED_NUDGES)) delete map[old];
  useNudges.setState({ map });
  try { localStorage.setItem(NUDGE_KEY, JSON.stringify(map)); } catch { /* the nudge still applies this session */ }
}

function useTrackLyrics(track) {
  const [state, setState] = useState({ data: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true });
    api.lyrics(track)
      .then((data) => { if (!cancelled) setState({ data, loading: false }); })
      .catch(() => { if (!cancelled) setState({ data: null, loading: false }); });
    return () => { cancelled = true; };
  }, [track.id]);

  useEffect(() => {
    const onChanged = (e) => {
      if (e.detail?.trackId === track.id && e.detail?.lyrics) setState({ data: e.detail.lyrics, loading: false });
    };
    window.addEventListener('t-music:lyrics-changed', onChanged);
    return () => window.removeEventListener('t-music:lyrics-changed', onChanged);
  }, [track.id]);

  return state;
}

// Database timestamps count from the song's first second. Only when the audio runs longer than the
// lyrics were timed for (a video with an intro) can they start late, and the silence we measured
// tells us by how much. Anything else the listener can correct with the nudge.
function useLyricsOffset(track, data) {
  const nudge = useNudges((s) => s.map[track.id] || 0);
  const playerDuration = usePlayer((s) => s.duration);
  const [onset, setOnset] = useState(() => getAudioOnset(track.id));

  useEffect(() => {
    setOnset(getAudioOnset(track.id));
    const onDetected = (e) => { if (e.detail?.trackId === track.id) setOnset(e.detail.onset); };
    window.addEventListener('audio-onset-detected', onDetected);
    return () => window.removeEventListener('audio-onset-detected', onDetected);
  }, [track.id]);

  let lead = 0;
  if (data?.lyricsDuration && data.source !== SOURCE_TIMED_TO_VIDEO && onset >= 0.4) {
    const extra = (playerDuration || track.duration || 0) - data.lyricsDuration;
    if (extra >= 1.5) lead = Math.min(onset, extra);
  }

  return {
    offset: lead + nudge,
    nudge,
    setNudge: (value) => saveNudge(track.id, value),
  };
}

function useActiveLine(lines, offset) {
  const [active, setActive] = useState(-1);
  const playing = usePlayer((s) => s.playing);

  useEffect(() => {
    if (!lines.length) {
      setActive(-1);
      return undefined;
    }
    const update = () => {
      const t = usePlayer.getState().getPreciseTime();
      let best = -1;
      for (let i = 0; i < lines.length && lines[i].time + offset <= t + 0.05; i++) best = i;
      setActive(best);
    };
    let raf = 0;
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    if (playing) loop();
    else update();
    window.addEventListener('t-music:seeked', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('t-music:seeked', update);
    };
  }, [lines, offset, playing]);

  return active;
}

function LyricsSkeleton() {
  return (
    <div className="lyr-sk">
      {[52, 78, 40, 68, 60, 74].map((w) => <div key={w} className="sk" style={{ width: `${w}%` }} />)}
    </div>
  );
}

function SyncNudge({ value, onChange }) {
  const label = value ? `${value > 0 ? '+' : ''}${value.toFixed(1)}초` : '싱크';
  return (
    <div className="lyr-nudge">
      <button onClick={() => onChange(value - NUDGE_STEP)} title="가사를 0.5초 빠르게" aria-label="가사를 0.5초 빠르게"><Minus size={12} /></button>
      <button className="lyr-nudge-value" onClick={() => onChange(0)} disabled={!value} title={value ? '싱크 조정 초기화' : '가사가 어긋나면 양옆 버튼으로 맞춰 보세요'}>{label}</button>
      <button onClick={() => onChange(value + NUDGE_STEP)} title="가사를 0.5초 느리게" aria-label="가사를 0.5초 느리게"><Plus size={12} /></button>
    </div>
  );
}

export default function LyricsView({ track, variant = 'panel' }) {
  const { data, loading } = useTrackLyrics(track);
  const { offset, nudge, setNudge } = useLyricsOffset(track, data);
  const [pickerOpen, setPickerOpen] = useState(false);
  const seek = usePlayer((s) => s.seek);
  const lines = data?.lines || [];
  const active = useActiveLine(lines, offset);
  const scroller = useRef(null);
  const activeLine = useRef(null);
  const holdUntil = useRef(0);

  useEffect(() => {
    const box = scroller.current;
    const line = activeLine.current;
    if (!box || !line || performance.now() < holdUntil.current) return;
    const top = line.offsetTop - box.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [active]);

  const holdScroll = () => { holdUntil.current = performance.now() + MANUAL_SCROLL_HOLD_MS; };
  const openPicker = () => setPickerOpen(true);
  const hasSynced = lines.length > 0;
  const hasPlain = Boolean(data?.plainLyrics);

  return (
    <div className={`lyr lyr-${variant}`}>
      {loading && <LyricsSkeleton />}

      {!loading && !hasSynced && !hasPlain && (
        <div className="lyr-empty">
          <Mic2 size={34} opacity={0.35} />
          <p>가사를 찾을 수 없습니다</p>
          <button className="lyr-search" onClick={openPicker}><Search size={14} /> 가사 직접 찾기</button>
        </div>
      )}

      {!loading && (hasSynced || hasPlain) && (
        <>
          <div className="lyr-bar">
            {!hasSynced && <span className="lyr-pill"><Mic2 size={12} /> 싱크 미지원</span>}
            <button className="lyr-pill action" onClick={openPicker}><ListMusic size={12} /> 가사 직접 찾기</button>
            {hasSynced && <SyncNudge value={nudge} onChange={setNudge} />}
          </div>
          <div className="lyr-scroll" ref={scroller} onWheel={holdScroll} onPointerDown={holdScroll}>
            {hasSynced ? (
              <div className="lyr-lines">
                {lines.map((l, i) => (
                  <div
                    key={`${l.time}-${i}`}
                    ref={i === active ? activeLine : null}
                    className={`lyr-line ${i === active ? 'active' : ''}`}
                    onClick={() => { holdUntil.current = 0; seek(Math.max(0, l.time + offset)); }}
                  >
                    {l.text || '...'}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="lyr-plain">{data.plainLyrics}</div>
                {data.footer && <div className="lyr-footer">{data.footer}</div>}
              </>
            )}
          </div>
        </>
      )}

      {pickerOpen && <LyricsPickerModal track={track} currentData={data} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
