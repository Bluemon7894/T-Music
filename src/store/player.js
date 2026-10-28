import { create } from 'zustand';
import { api, streamUrl } from '../lib/api.js';
import { attach } from '../lib/audio.js';
import { useLibrary } from './library.js';
import { toast } from './ui.js';

// Two <audio> elements: one plays, the other quietly buffers the next track so
// skipping (or the track ending) switches instantly.
const audios = [new Audio(), new Audio()];
let cur = 0;
const active = () => audios[cur];
const spare = () => audios[1 - cur];
for (const a of audios) {
  a.preload = 'auto';
  a.crossOrigin = 'anonymous'; // lets the visualizer read samples
}

const saved = (() => {
  try { return JSON.parse(localStorage.getItem('t-music-player') || '{}'); } catch { return {}; }
})();
const persistPrefs = (s) => {
  try { localStorage.setItem('t-music-player', JSON.stringify({ volume: s.volume, muted: s.muted, repeat: s.repeat, autoplay: s.autoplay })); } catch { /* ignore */ }
};

const shuffled = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

let radioFor = null; // track id we already fetched related tracks for
let retried = new Set();

export const usePlayer = create((set, get) => ({
  queue: [],
  index: -1,
  context: null, // { name, route } shown in the queue panel
  playing: false,
  loading: false,
  time: 0,
  duration: 0,
  buffered: 0,
  volume: saved.volume ?? 0.8,
  muted: saved.muted ?? false,
  shuffle: false,
  repeat: saved.repeat ?? 'off', // off | all | one
  autoplay: saved.autoplay ?? true,
  unshuffled: null,

  current: () => get().queue[get().index] || null,

  playList(tracks, start = 0, context = null) {
    if (!tracks?.length) return;
    let queue = tracks.slice();
    let index = start;
    if (get().shuffle) {
      const first = queue[start];
      queue = [first, ...shuffled(queue.filter((_, i) => i !== start))];
      index = 0;
      set({ unshuffled: tracks.slice() });
    } else {
      set({ unshuffled: null });
    }
    radioFor = null;
    set({ queue, index, context });
    get()._load();
  },

  playNext(track) {
    const { queue, index } = get();
    if (index < 0) return get().playList([track]);
    const q = queue.slice();
    q.splice(index + 1, 0, track);
    set({ queue: q });
    get()._preloadNext();
    toast('다음에 재생합니다');
  },

  addToQueue(tracks) {
    const list = Array.isArray(tracks) ? tracks : [tracks];
    if (get().index < 0) return get().playList(list);
    set({ queue: [...get().queue, ...list] });
    get()._preloadNext();
    toast(list.length > 1 ? `${list.length}곡을 대기열에 추가했습니다` : '대기열에 추가했습니다');
  },

  removeAt(i) {
    const { queue, index } = get();
    if (i === index) return;
    set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
    get()._preloadNext();
  },

  jumpTo(i) {
    set({ index: i });
    get()._load();
  },

  toggle() {
    const a = active();
    if (get().index < 0) return;
    if (a.paused) { attach(a); a.play().catch(() => {}); }
    else a.pause();
  },

  next(auto = false) {
    const { queue, index, repeat } = get();
    if (!auto) {
      // Count a skipped track once it has been listened to for a while.
      const t = queue[index];
      if (t && active().currentTime > 30) useLibrary.getState().addListen(t, active().currentTime);
    }
    if (auto && repeat === 'one') {
      active().currentTime = 0;
      active().play().catch(() => {});
      return;
    }
    if (index + 1 < queue.length) {
      set({ index: index + 1 });
      get()._load();
    } else if (repeat === 'all' && queue.length) {
      set({ index: 0 });
      get()._load();
    } else if (get().autoplay) {
      get()._extendWithRadio().then((added) => {
        if (added) { set({ index: get().index + 1 }); get()._load(); }
        else set({ playing: false });
      });
    } else {
      active().pause();
    }
  },

  prev() {
    const a = active();
    if (a.currentTime > 3 || get().index <= 0) {
      a.currentTime = 0;
      return;
    }
    set({ index: get().index - 1 });
    get()._load();
  },

  seek(t) {
    active().currentTime = t;
    set({ time: t });
  },

  setVolume(v) {
    set({ volume: v, muted: v === 0 });
    for (const a of audios) { a.volume = v; a.muted = v === 0; }
    persistPrefs(get());
  },
  toggleMute() {
    const muted = !get().muted;
    set({ muted });
    for (const a of audios) a.muted = muted;
    persistPrefs(get());
  },

  toggleShuffle() {
    const { shuffle, queue, index, unshuffled } = get();
    const cur = queue[index];
    if (!shuffle) {
      const rest = shuffled(queue.filter((_, i) => i !== index));
      set({ shuffle: true, unshuffled: queue.slice(), queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const base = unshuffled || queue;
      set({ shuffle: false, unshuffled: null, queue: base, index: cur ? Math.max(0, base.findIndex((t) => t.id === cur.id)) : -1 });
    }
    get()._preloadNext();
  },
  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
    persistPrefs(get());
    get()._preloadNext();
  },
  toggleAutoplay() {
    set({ autoplay: !get().autoplay });
    persistPrefs(get());
  },

  // ---- internals ----

  _load() {
    const track = get().current();
    if (!track) return;
    const src = streamUrl(track.id);
    retried.delete(track.id);
    if (spare().dataset.id === track.id) {
      // Already buffered by _preloadNext: just swap.
      active().pause();
      cur = 1 - cur;
    } else {
      active().pause();
      active().src = src;
      active().dataset.id = track.id;
    }
    const a = active();
    a.volume = get().volume;
    a.muted = get().muted;
    set({ time: a.currentTime || 0, duration: track.duration || 0, loading: a.readyState < 3 });
    for (const el of audios) attach(el);
    a.play().catch(() => {});
    useLibrary.getState().pushRecent(track);
    updateMediaSession(track);
    get()._preloadNext();
    // Fetch radio ahead of time so the queue never runs dry.
    if (get().autoplay && get().index >= get().queue.length - 2) get()._extendWithRadio();
  },

  _nextIndex() {
    const { queue, index, repeat } = get();
    if (repeat === 'one') return index;
    if (index + 1 < queue.length) return index + 1;
    if (repeat === 'all' && queue.length) return 0;
    return -1;
  },

  _preloadNext() {
    const i = get()._nextIndex();
    const track = get().queue[i];
    const s = spare();
    if (!track || i === get().index) {
      if (s.dataset.id) { s.removeAttribute('src'); s.load(); s.dataset.id = ''; }
      return;
    }
    if (s.dataset.id === track.id) return;
    s.pause();
    s.src = streamUrl(track.id);
    s.dataset.id = track.id;
    s.load();
    const after = get().queue[i + 1];
    if (after) api.prefetch(after.id);
  },

  async _extendWithRadio() {
    const seed = get().current();
    if (!seed || radioFor === seed.id) return false;
    radioFor = seed.id;
    try {
      const have = new Set(get().queue.map((t) => t.id));
      const more = (await api.related(seed.id)).filter((t) => !have.has(t.id)).slice(0, 15);
      if (!more.length) return false;
      set({ queue: [...get().queue, ...more] });
      get()._preloadNext();
      return true;
    } catch {
      return false;
    }
  },
}));

// Wire audio events. Events from the spare element are ignored.
audios.forEach((a, i) => {
  const isActive = () => i === cur;
  a.addEventListener('playing', () => isActive() && usePlayer.setState({ playing: true, loading: false }));
  a.addEventListener('pause', () => isActive() && usePlayer.setState({ playing: false }));
  a.addEventListener('waiting', () => isActive() && usePlayer.setState({ loading: true }));
  a.addEventListener('canplay', () => isActive() && usePlayer.setState({ loading: false }));
  a.addEventListener('timeupdate', () => {
    if (!isActive()) return;
    const b = a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0;
    usePlayer.setState({ time: a.currentTime, buffered: b });
    if ('mediaSession' in navigator && a.duration) {
      try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: 1 }); } catch { /* ignore */ }
    }
  });
  a.addEventListener('durationchange', () => isActive() && isFinite(a.duration) && usePlayer.setState({ duration: a.duration }));
  a.addEventListener('ended', () => {
    if (!isActive()) return;
    const t = usePlayer.getState().current();
    if (t) useLibrary.getState().addListen(t, a.duration || t.duration);
    usePlayer.getState().next(true);
  });
  a.addEventListener('error', () => {
    const id = a.dataset.id;
    if (!id) return;
    if (!isActive()) { a.dataset.id = ''; return; } // preload failed; retry when it becomes current
    if (!retried.has(id)) {
      // One retry: the main process picks a different method if the first URL died.
      retried.add(id);
      const t = a.currentTime;
      a.src = streamUrl(id) + '?retry=' + Date.now();
      a.currentTime = t;
      a.play().catch(() => {});
      return;
    }
    const track = usePlayer.getState().current();
    toast(`재생할 수 없어 건너뜁니다: ${track?.title || id}`);
    usePlayer.setState({ loading: false });
    usePlayer.getState().next(true);
  });
});

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: (track.artists || []).map((a) => a.name).join(', '),
    album: track.album?.name || '',
    artwork: track.thumb ? [{ src: track.thumb, sizes: '544x544' }] : [],
  });
}

if ('mediaSession' in navigator) {
  const p = () => usePlayer.getState();
  navigator.mediaSession.setActionHandler('play', () => p().toggle());
  navigator.mediaSession.setActionHandler('pause', () => p().toggle());
  navigator.mediaSession.setActionHandler('nexttrack', () => p().next());
  navigator.mediaSession.setActionHandler('previoustrack', () => p().prev());
  navigator.mediaSession.setActionHandler('seekto', (d) => p().seek(d.seekTime));
}
