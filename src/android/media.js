// Connects the player to the phone: what's playing goes to the notification and lock screen, and
// what's pressed there, on a headset or by the system comes back here.
import { Native, onNative } from './native.js';
import { usePlayer } from '../store/player.js';
import { useRoom } from '../store/room.js';
import { useNav } from '../store/nav.js';
import { useUI } from '../store/ui.js';
import { useUpdater } from '../store/updater.js';
import { artistNames } from '../lib/util.js';

const POSITION_EVERY_MS = 5000;

function publish() {
  const p = usePlayer.getState();
  const track = p.current();
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

onNative('media', ({ action, seconds }) => {
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
