// Connects the player to the phone: what's playing goes to the notification and lock screen, and
// what's pressed there, on a headset or by the system comes back here.
import { Native, onNative } from './native.js';
import { usePlayer } from '../store/player.js';
import { useRadio } from '../store/radio.js';
import { tr } from '../lib/i18n.js';
import { useRoom } from '../store/room.js';
import { useNav } from '../store/nav.js';
import { useUI } from '../store/ui.js';
import { useUpdater } from '../store/updater.js';
import { artistNames } from '../lib/util.js';
import { rememberPlayback } from '../lib/resume.js';
import { safeTrack } from '../lib/safeTrack.js';

const POSITION_EVERY_MS = 5000;

function publish() {
  const r = useRadio.getState();
  if (r.on && r.station) {
    Native.playbackState(JSON.stringify({
      playing: !r.paused && r.phase !== 'ending',
      title: r.station.name,
      artist: `${r.station.band} ${r.station.freq}`,
      album: tr('라디오'),
      thumb: r.station.logo || '',
      duration: 0,
      position: 0,
    }));
    return;
  }
  const p = usePlayer.getState();
  const track = p.current();
  rememberPlayback(track ? { id: track.id, track: safeTrack(track), time: p.getPreciseTime(), playing: p.playing, at: Date.now() } : null);
  Native.playbackState(JSON.stringify(track ? {
    playing: p.playing,
    title: track.title,
    artist: artistNames(track),
    album: track.album?.name || '',
    thumb: track.thumb || '',
    duration: p.duration || track.duration || 0,
    position: p.getPreciseTime(),
  } : { playing: false }));
}

let last = {};
usePlayer.subscribe((p) => {
  const trackId = p.queue[p.index]?.id;
  if (p.playing === last.playing && trackId === last.trackId && p.duration === last.duration) return;
  last = { playing: p.playing, trackId, duration: p.duration };
  publish();
});
window.addEventListener('t-music:seeked', publish);
setInterval(() => { if (usePlayer.getState().playing) publish(); }, POSITION_EVERY_MS);

// In a room, stopping is about this phone only: a phone call shouldn't pause everyone.
function pause() {
  const p = usePlayer.getState();
  if (!p.playing) return;
  if (useRoom.getState().attached) useRoom.getState().pause();
  usePlayer.getState().toggle();
}

function play() {
  const p = usePlayer.getState();
  if (p.playing) return;
  if (useRoom.getState().code && !useRoom.getState().attached) useRoom.getState().follow();
  else p.toggle();
}

useRadio.subscribe((s, prev) => { if (s.on !== prev.on || s.station !== prev.station || s.phase !== prev.phase || s.paused !== prev.paused) publish(); });

onNative('media', ({ action, seconds }) => {
  const r = useRadio.getState();
  if (r.on) {
    if (action === 'play' || action === 'pause') r.togglePause();
    else if (action === 'next') r.step(1);
    else if (action === 'prev') r.step(-1);
    return;
  }
  const p = usePlayer.getState();
  if (action === 'play') play();
  else if (action === 'pause') pause();
  else if (action === 'next') p.next();
  else if (action === 'prev') p.prev();
  else if (action === 'seek') p.seek(seconds);
});

// ---- the back button closes what's on top, then goes back, then leaves the app running ----
function closeLyricsPicker() {
  document.querySelector('.lyrics-picker-close')?.click();
}

onNative('back', () => {
  const ui = useUI.getState();
  if (document.querySelector('.lyrics-picker-backdrop')) return closeLyricsPicker();
  if (ui.dialog) return ui.closeDialog();
  if (ui.menu) return ui.closeMenu();
  if (useUpdater.getState().modalOpen) return useUpdater.getState().closeModal();
  if (ui.stage) return ui.setStage(false);
  const nav = useNav.getState();
  if (nav.index > 0) return nav.back();
  return Native.moveToBack();
});
