// Synced lyrics, shared by the side panel and the fullscreen stage.
import { useEffect, useRef, useState } from 'react';
import { ListMusic, Mic2, RefreshCw, Search } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useRoom } from '../../store/room.js';
import { lyricsKey, saveAlignment, useAlignments } from '../../store/lyricAlignments.js';
import { toast } from '../../store/ui.js';
import { api, streamUrl } from '../../lib/api.js';
import { getAudioOnset, getOutputLatency } from '../../lib/audio.js';
import { MIN_CONFIDENCE, measureLyricOffset } from '../../lib/lyricAlign.js';
import LyricsPickerModal from './LyricsPickerModal.jsx';
import { tr } from '../../lib/i18n.js';

const ALREADY_ALIGNED_SEC = 0.1;
// A manual scroll keeps the view where the user put it for this long.
const MANUAL_SCROLL_HOLD_MS = 4000;
// Captions come from the video itself, so they already line up with its audio.
const SOURCE_TIMED_TO_VIDEO = 'YouTube 자막';

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

// A resync's measurement wins. Until there is one, the only known difference is a video running
// longer than the lyrics were timed for, where the silence we measured says how late they start.
function useLyricsOffset(track, data) {
  const saved = useAlignments((s) => s.map[track.id]);
  const playerDuration = usePlayer((s) => s.duration);
  const [onset, setOnset] = useState(() => getAudioOnset(track.id));

  useEffect(() => {
    setOnset(getAudioOnset(track.id));
    const onDetected = (e) => { if (e.detail?.trackId === track.id) setOnset(e.detail.onset); };
    window.addEventListener('audio-onset-detected', onDetected);
    return () => window.removeEventListener('audio-onset-detected', onDetected);
  }, [track.id]);

  if (saved && saved.lyrics === lyricsKey(data)) return saved.offset;

  if (data?.lyricsDuration && data.source !== SOURCE_TIMED_TO_VIDEO && onset >= 0.4) {
    const extra = (playerDuration || track.duration || 0) - data.lyricsDuration;
    if (extra >= 1.5) return Math.min(onset, extra);
  }
  return 0;
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
      // What's playing now reaches the ears a little later, by a lot on Bluetooth.
      const t = usePlayer.getState().getPreciseTime() - getOutputLatency();
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

// Looks for the lyrics again, then lines them up with this recording. In a room, everyone gets the result.
async function resyncLyrics(track) {
  const data = await api.refreshLyrics(track);
  if (data) window.dispatchEvent(new CustomEvent('t-music:lyrics-changed', { detail: { trackId: track.id, lyrics: data } }));
  if (!data?.lines?.length) {
    toast(data?.plainLyrics ? tr('싱크 가사를 찾지 못했어요. 일반 가사로 보여드려요.') : tr('가사를 찾지 못했어요.'));
    return;
  }
  const measured = await measureLyricOffset(streamUrl(track.id), data.lines);
  if (!measured || measured.confidence < MIN_CONFIDENCE) {
    saveAlignment(track.id, data, null);
    useRoom.getState().shareLyrics(track.id, data, null);
    toast(tr('이 곡은 자동으로 맞추기 어려워요. 가사 직접 찾기로 다른 가사를 골라 보세요.'));
    return;
  }
  saveAlignment(track.id, data, measured.offset);
  useRoom.getState().shareLyrics(track.id, data, measured.offset);
  const size = Math.abs(measured.offset);
  if (size < ALREADY_ALIGNED_SEC) toast(tr('가사 싱크가 이미 잘 맞아요'));
  else toast(tr('가사를 {0}초 {1} 맞췄어요', size.toFixed(1), measured.offset > 0 ? tr('늦춰서') : tr('앞당겨서')));
}

export default function LyricsView({ track, variant = 'panel' }) {
  const { data, loading } = useTrackLyrics(track);
  const offset = useLyricsOffset(track, data);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resyncing, setResyncing] = useState(false);
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
    const top = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [active]);

  const holdScroll = () => { holdUntil.current = performance.now() + MANUAL_SCROLL_HOLD_MS; };
  const openPicker = () => setPickerOpen(true);
  const resync = async () => {
    setResyncing(true);
    try {
      await resyncLyrics(track);
    } catch (e) {
      console.warn('[lyrics]', e);
      toast(tr('재싱크하지 못했어요. 인터넷 연결을 확인해 주세요.'));
    } finally {
      setResyncing(false);
    }
  };
  const hasSynced = lines.length > 0;
  const hasPlain = Boolean(data?.plainLyrics);
  const resyncButton = (className) => (
    <button className={className} onClick={resync} disabled={resyncing} title={tr('가사를 다시 찾아 음원에 맞춥니다')}>
      <RefreshCw size={12} className={resyncing ? 'spin' : ''} /> {resyncing ? tr('맞추는 중...') : tr('재싱크')}
    </button>
  );

  return (
    <div className={`lyr lyr-${variant}`}>
      {loading && <LyricsSkeleton />}

      {!loading && !hasSynced && !hasPlain && (
        <div className="lyr-empty">
          <Mic2 size={34} opacity={0.35} />
          <p>{tr('가사를 찾을 수 없습니다')}</p>
          <div className="lyr-empty-actions">
            <button className="lyr-search" onClick={openPicker}><Search size={14} />{' '}{tr('가사 직접 찾기')}</button>
            {resyncButton('lyr-search')}
          </div>
        </div>
      )}

      {!loading && (hasSynced || hasPlain) && (
        <>
          <div className="lyr-bar">
            {!hasSynced && <span className="lyr-pill"><Mic2 size={12} />{' '}{tr('싱크 미지원')}</span>}
            <button className="lyr-pill action" onClick={openPicker}><ListMusic size={12} />{' '}{tr('가사 직접 찾기')}</button>
            {resyncButton('lyr-pill action')}
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
