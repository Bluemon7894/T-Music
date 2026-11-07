// The main window's side of the quick menu (electron/quickMenu.js). While the menu is open, what's
// playing goes to it a few times a second; what's pressed there comes back here and runs as if it had
// been pressed in the app.
import { api } from './api.js';
import { usePlayer } from '../store/player.js';
import { useLibrary } from '../store/library.js';
import { useRadio } from '../store/radio.js';
import { useDeck } from '../store/deck.js';
import { useUI } from '../store/ui.js';
import { useFriends } from '../store/friends.js';
import { useRoom } from '../store/room.js';
import { artistNames } from './util.js';
import { IS_ANDROID } from './platform.js';
import { tr } from './i18n.js';

const SEND_EVERY_MS = 250;
const NEXT_COUNT = 3;

const station = (s) => (s ? { id: s.id, name: s.name, freq: s.freq, band: s.band, logo: s.logo || null } : null);

function snapshot() {
  const p = usePlayer.getState();
  const lib = useLibrary.getState();
  const radio = useRadio.getState();
  const room = useRoom.getState();
  const track = p.current();
  const next = [];
  if (room.attached && room.queue.length) {
    for (const item of room.queue.slice(0, NEXT_COUNT)) next.push({ key: item.key, title: item.track.title, artist: artistNames(item.track), thumb: item.track.thumb || null });
  } else {
    for (let i = p.index + 1; i < p.queue.length && next.length < NEXT_COUNT; i++) {
      const t = p.queue[i];
      if (t.isAutoplay && !p.autoplay) continue;
      next.push({ index: i, title: t.title, artist: artistNames(t), thumb: t.thumb || null });
    }
  }
  const friends = Object.entries(useFriends.getState().friends)
    .filter(([, f]) => f.online)
    .slice(0, 6)
    .map(([uid, f]) => ({ uid, name: f.name, photo: f.photo || null }));
  return {
    track: track ? { id: track.id, title: track.title, artist: artistNames(track), thumb: track.thumb || null } : null,
    time: p.getPreciseTime(),
    duration: p.duration || track?.duration || 0,
    playing: p.playing,
    volume: p.volume,
    muted: p.muted,
    liked: track ? lib.isLiked(track.id) : false,
    shuffle: p.shuffle,
    repeat: p.repeat,
    next,
    deck: useDeck.getState().style,
    mini: useUI.getState().mini,
    radio: {
      on: radio.on,
      phase: radio.phase,
      station: station(radio.station),
      saved: radio.station ? lib.isStationSaved(radio.station.id) : false,
      stations: lib.savedStations.slice(0, NEXT_COUNT).map(station),
    },
    friends,
    room: room.code ? { name: room.meta?.name || tr('같이 듣기'), count: Object.values(room.members).filter((m) => m.listening).length, attached: room.attached } : null,
  };
}

const COMMANDS = {
  toggle: () => (useRadio.getState().on ? useRadio.getState().toggle() : usePlayer.getState().toggle()),
  prev: () => (useRadio.getState().on ? useRadio.getState().step(-1) : usePlayer.getState().prev()),
  next: () => (useRadio.getState().on ? useRadio.getState().step(1) : usePlayer.getState().next()),
  volume: (v) => usePlayer.getState().setVolume(Math.max(0, Math.min(1, Number(v) || 0))),
  mute: () => usePlayer.getState().toggleMute(),
  like: () => {
    if (useRadio.getState().on) return useRadio.getState().toggleSave();
    const track = usePlayer.getState().current();
    if (track) useLibrary.getState().toggleLike(track);
    return undefined;
  },
  shuffle: () => usePlayer.getState().toggleShuffle(),
  repeat: () => usePlayer.getState().cycleRepeat(),
  radio: () => useRadio.getState().toggle(),
  deck: () => useDeck.getState().setStyle(useDeck.getState().style === 'turntable' ? 'cassette' : 'turntable'),
  mini: () => useUI.getState().setMini(!useUI.getState().mini),
  jump: (index) => { if (Number.isInteger(index)) usePlayer.getState().jumpTo(index); },
  tune: (id) => {
    const s = useLibrary.getState().savedStations.find((x) => x.id === id);
    if (s) useRadio.getState().tune(s);
  },
  invite: (uid) => { if (typeof uid === 'string') useFriends.getState().inviteFriend(uid); },
  room: () => {
    const room = useRoom.getState();
    if (!room.code) room.create();
  },
};

export function startQuickBridge() {
  if (IS_ANDROID) return;
  let timer = null;
  const send = () => api.quickState(snapshot()).catch(() => {});
  api.onQuick('quick-active', (on) => {
    clearInterval(timer);
    timer = null;
    if (!on) return;
    send();
    timer = setInterval(send, SEND_EVERY_MS);
  });
  api.onQuick('quick-command', (command, arg) => {
    COMMANDS[command]?.(arg);
    setTimeout(send, 30);
  });
}
