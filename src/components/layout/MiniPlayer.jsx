// The whole window shrinks to this small always-on-top player. It's the same page and the same
// audio, so playback carries on without a gap.
import { useEffect } from 'react';
import { Maximize2, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { usePlayer } from '../../store/player.js';
import { useUI } from '../../store/ui.js';
import { api } from '../../lib/api.js';
import { artistNames, fmtTime } from '../../lib/util.js';
import { PlayButton, Thumb } from '../common.jsx';
import { Slider } from './PlayerDock.jsx';
import logo from '../../assets/logo-mark.png';
import { tr } from '../../lib/i18n.js';

export default function MiniPlayer() {
  const track = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const time = usePlayer((s) => s.time);
  const buffered = usePlayer((s) => s.buffered);
  const duration = usePlayer((s) => s.duration) || track?.duration || 0;
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const { toggle, next, prev, seek, setVolume, toggleMute } = usePlayer.getState();
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const setMini = useUI((s) => s.setMini);

  useEffect(() => {
    api.setMiniMode(true).catch(() => {});
    return () => { api.setMiniMode(false).catch(() => {}); };
  }, []);

  return (
    <div className="mini">
      <div className="mini-art">{track ? <Thumb src={track.thumb} /> : <img className="thumb" src={logo} alt="" draggable={false} />}</div>
      <div className="mini-body">
        <div className="mini-text">
          <b title={track?.title}>{track?.title || 'T-Music'}</b>
          <small>{track ? artistNames(track) : tr('재생할 곡을 골라보세요')}</small>
        </div>
        <div className="mini-controls">
          <button className="icon-btn" onClick={prev} aria-label={tr('이전 곡')}><SkipBack size={18} fill="currentColor" /></button>
          <PlayButton size={36} playing={playing} onClick={toggle} />
          <button className="icon-btn" onClick={() => next()} aria-label={tr('다음 곡')}><SkipForward size={18} fill="currentColor" /></button>
          <div className="mini-volume">
            <button className="icon-btn" onClick={toggleMute} aria-label={muted ? tr('음소거 해제') : tr('음소거')}><VolumeIcon size={16} /></button>
            <Slider className="volume" value={muted ? 0 : volume} max={1} onChange={setVolume} />
          </div>
          <button className="icon-btn mini-expand" onClick={() => setMini(false)} title={tr('큰 화면으로')} aria-label={tr('큰 화면으로')}><Maximize2 size={16} /></button>
        </div>
        <div className="mini-seek">
          <span>{fmtTime(time)}</span>
          <Slider className="seek" value={time} max={duration} buffered={buffered} onCommit={(v) => seek(v)} />
          <span>{fmtTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
