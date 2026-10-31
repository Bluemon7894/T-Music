import { create } from 'zustand';
import { api, streamUrl } from '../lib/api.js';
import { attach, setMusicFade, startAudioOnsetDetection } from '../lib/audio.js';
import { pressDeckKey, cancelSound, commitEnd, endLead, hasStarted, isEndCommitted, isEnding, isStarting, isWaitingForMusic, playEndSound, playStartSound, setDeckLevel, setStarted, startLength, useDeck } from './deck.js';
import { useLibrary } from './library.js';
import { usePrefs } from './prefs.js';
import { toast } from './ui.js';
import { IS_ANDROID } from '../lib/platform.js';
import { tr } from '../lib/i18n.js';

// Phones set the volume with their own buttons, so the app stays at full level there.
const DEFAULT_VOLUME = IS_ANDROID ? 1 : 0.8;

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

// A room's shuffle and repeat belong to the room. What the listener had alone waits here for them.
let soloModes = null;

function savePlayerState(extra = {}) {
  try {
    const s = usePlayer.getState();
    const curTrack = s.current();
    const a = active();
    const currentTime = isFinite(a.currentTime) && a.currentTime > 0 ? a.currentTime : (s.time || 0);
    // Long queues are saved as a window around the current track so the index stays valid.
    const windowStart = Math.max(0, s.index - 20);
    const data = {
      volume: s.volume,
      muted: s.muted,
      repeat: soloModes?.repeat ?? s.repeat,
      autoplay: s.autoplay,
      queue: (s.queue || []).slice(windowStart, windowStart + 100).map((t) => ({
        id: t.id,
        title: t.title,
        artists: t.artists || [],
        album: t.album || null,
        duration: t.duration || 0,
        thumb: t.thumb || '',
        isAutoplay: Boolean(t.isAutoplay),
      })),
      index: s.index - windowStart,
      context: s.context,
      time: currentTime,
      duration: curTrack?.duration || s.duration || 0,
      wasPlaying: s.playing && !a.paused,
      lastSaved: Date.now(),
      ...extra,
    };
    localStorage.setItem('t-music-player', JSON.stringify(data));
  } catch {
    /* ignore */
  }
}
const persistPrefs = () => savePlayerState();

const initialQueue = Array.isArray(saved.queue)
  ? saved.queue
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({ ...t, isAutoplay: Boolean(t.isAutoplay) }))
      .filter((t, i) => saved.autoplay !== false || i <= (saved.index ?? -1) || !t.isAutoplay)
  : [];
const initialIndex = (typeof saved.index === 'number' && saved.index >= 0 && saved.index < initialQueue.length)
  ? saved.index
  : (initialQueue.length > 0 ? 0 : -1);
const initialTrack = initialIndex >= 0 ? initialQueue[initialIndex] : null;
const initialTime = (typeof saved.time === 'number' && isFinite(saved.time) && saved.time > 0)
  ? saved.time
  : 0;
const initialDuration = (typeof saved.duration === 'number' && isFinite(saved.duration) && saved.duration > 0)
  ? saved.duration
  : (initialTrack?.duration || 0);

const shuffled = (list) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

let extendingPromise = null;
const usedRadioSeeds = new Set();
let retried = new Set();

// Set while in a listen-together room. Playback commands then go through the room, and the room
// starts, stops and moves playback for everyone through roomPlayer. See store/room.js.
let room = null;
export function bindRoom(hooks) {
  room = hooks;
}

const soundsOn = () => (room ? room.soundsOn() : useDeck.getState().sounds);

// The music comes up once it's really playing, however long the stream took to get ready.
let riseOnPlaying = 0;
function riseMusic(seconds) {
  const a = active();
  if (!a.paused && a.readyState >= 3) setMusicFade(1, seconds);
  else riseOnPlaying = seconds;
}

function dropSound() {
  riseOnPlaying = 0;
  cancelSound();
}

// Alone, the music waits for the start sound to finish.
function playWithDeck() {
  const a = active();
  if (isWaitingForMusic()) return; // the end of the sound starts whichever track is current by then
  if (isEnding()) dropSound();
  if (hasStarted() || !soundsOn()) {
    setStarted(true);
    a.play().catch(() => {});
    return;
  }
  setStarted(true);
  usePlayer.setState({ playing: true });
  attach(a);
  playStartSound((seconds) => {
    const el = active();
    attach(el);
    el.play().catch(() => {});
    riseMusic(seconds);
  });
}

// In a room the track runs on the room's clock. The sound only plays when the room is holding the track
// for it: music already under way can't wait, and it would be silly to talk over it.
function firstPlayInRoom(secondsUntilMusic) {
  if (hasStarted()) return;
  setStarted(true);
  if (!soundsOn() || secondsUntilMusic < startLength()) return;
  playStartSound(riseMusic, secondsUntilMusic - startLength());
}

// Nothing plays after this track unless something changes before it ends.
function queueStopsHere() {
  const { queue, index, repeat, autoplay } = usePlayer.getState();
  if (repeat !== 'off' || room?.hasQueued()) return false;
  const next = queue[index + 1];
  return next ? !autoplay && next.isAutoplay : !autoplay;
}

function queueFinished() {
  if (isEnding()) commitEnd();
  else if (hasStarted() && soundsOn()) playEndSound();
  setStarted(false);
}

// The end sound has to begin before the last track ends, for the two to cross.
function watchQueueEnd(a) {
  if (!isFinite(a.duration) || !a.duration) return;
  const left = a.duration - a.currentTime;
  const stops = room ? room.endingSoon(left, queueStopsHere()) : queueStopsHere();
  if (isEnding()) {
    if (!isEndCommitted() && (!stops || left > endLead() + 1)) dropSound();
    return;
  }
  if (stops && !a.paused && !isStarting() && left <= endLead() && left > 0.25 && hasStarted() && soundsOn()) playEndSound(left);
}

// Actual listening time tracker (measures real wall-clock listening duration while audio is playing)
let currentListenTrack = null;
let listenStartTime = null;
let accumulatedListenSec = 0;

function commitListen() {
  if (listenStartTime != null) {
    accumulatedListenSec += (performance.now() - listenStartTime) / 1000;
    listenStartTime = null;
  }
  const sec = Math.round(accumulatedListenSec);
  if (currentListenTrack && sec >= 3) {
    useLibrary.getState().addListen(currentListenTrack, sec);
  }
  accumulatedListenSec = 0;
}

function startListening(track) {
  if (!track) return;
  if (currentListenTrack && currentListenTrack.id !== track.id) {
    commitListen();
  }
  currentListenTrack = track;
  if (listenStartTime == null) {
    listenStartTime = performance.now();
  }
}

function pauseListening() {
  if (listenStartTime != null) {
    accumulatedListenSec += (performance.now() - listenStartTime) / 1000;
    listenStartTime = null;
  }
}

window.addEventListener('beforeunload', () => {
  commitListen();
  savePlayerState({
    time: active().currentTime,
    wasPlaying: !active().paused,
  });
});

export async function applyOutputDevice(deviceId) {
  for (const a of audios) {
    if (typeof a.setSinkId === 'function') {
      try {
        await a.setSinkId(deviceId || '');
      } catch (e) {
        console.warn('a.setSinkId failed:', e);
      }
    }
  }
}

const savedSinkId = (() => {
  try { return localStorage.getItem('t-music-sink-id') || ''; } catch { return ''; }
})();
if (savedSinkId) {
  applyOutputDevice(savedSinkId).catch(() => {});
}

export const usePlayer = create((set, get) => ({
  queue: initialQueue,
  index: initialIndex,
  context: saved.context || null, // { name, route } shown in the queue panel
  playing: false,
  loading: false,
  time: initialTime,
  duration: initialDuration,
  buffered: 0,
  volume: saved.volume ?? DEFAULT_VOLUME,
  muted: saved.muted ?? false,
  shuffle: false,
  repeat: saved.repeat ?? 'off', // off | all | one
  autoplay: saved.autoplay ?? true,
  unshuffled: null,

  current: () => get().queue[get().index] || null,
  getPreciseTime: () => {
    try {
      const a = active();
      if (a && isFinite(a.currentTime)) return a.currentTime;
    } catch {}
    return get().time;
  },

  playList(tracks, start = 0, context = null) {
    if (!tracks?.length) return;
    if (room && !room.allowTrackChange()) return;
    commitListen();
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
    usedRadioSeeds.clear();
    extendingPromise = null;
    set({ queue, index, context });
    savePlayerState({ time: 0, wasPlaying: true });
    get()._load();
  },

  playNext(track) {
    if (room) { room.enqueue([track], { next: true }); return; }
    const { queue, index } = get();
    const cleanTrack = { ...track, isAutoplay: false };
    if (index < 0) return get().playList([cleanTrack]);
    const q = queue.slice();
    q.splice(index + 1, 0, cleanTrack);
    set({ queue: q });
    savePlayerState();
    get()._preloadNext();
    toast(tr('다음에 재생합니다'));
  },

  addToQueue(tracks) {
    const list = (Array.isArray(tracks) ? tracks : [tracks]).map((t) => ({ ...t, isAutoplay: false }));
    if (!list.length) return;
    if (room) { room.enqueue(list); return; }
    const { queue, index } = get();
    if (index < 0) return get().playList(list);
    const q = queue.slice();

    // Priority insertion: user manually added tracks must appear BEFORE any auto-recommended tracks
    const firstAutoIndex = q.findIndex((t, i) => i > index && t.isAutoplay);
    if (firstAutoIndex !== -1) {
      q.splice(firstAutoIndex, 0, ...list);
    } else {
      q.push(...list);
    }

    set({ queue: q });
    savePlayerState();
    get()._preloadNext();
    toast(list.length > 1 ? tr('{0}곡을 대기열에 추가했습니다', list.length) : tr('대기열에 추가했습니다'));
  },

  removeAt(i) {
    const { queue, index } = get();
    if (i === index) return;
    set({ queue: queue.filter((_, j) => j !== i), index: i < index ? index - 1 : index });
    savePlayerState();
    get()._preloadNext();
  },

  reorderQueue(fromIndex, toIndex) {
    const { queue, index } = get();
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= queue.length || toIndex >= queue.length) return;
    const q = queue.slice();
    const [moved] = q.splice(fromIndex, 1);
    q.splice(toIndex, 0, moved);

    let nextIndex = index;
    if (index === fromIndex) {
      nextIndex = toIndex;
    } else if (fromIndex < index && toIndex >= index) {
      nextIndex = index - 1;
    } else if (fromIndex > index && toIndex <= index) {
      nextIndex = index + 1;
    }

    set({ queue: q, index: nextIndex });
    savePlayerState();
    get()._preloadNext();
  },

  jumpTo(i) {
    if (room && !room.allowTrackChange()) return;
    commitListen();
    set({ index: i });
    savePlayerState({ time: 0, wasPlaying: true });
    get()._load();
  },

  toggle() {
    if (room) { room.togglePlay(); return; }
    const a = active();
    if (get().index < 0) return;
    if (isWaitingForMusic()) {
      dropSound();
      setStarted(false);
      set({ playing: false });
      return;
    }
    if (a.paused) {
      attach(a);
      const targetTime = get().time;
      if (targetTime > 0 && Math.abs(a.currentTime - targetTime) > 1) {
        try { a.currentTime = targetTime; } catch {}
      }
      playWithDeck();
    } else {
      a.pause();
    }
  },

  async next(auto = false) {
    if (room && !(auto ? room.allowAuto() : room.allowTrackChange())) return;
    if (!auto) pressDeckKey('next');
    const { index, repeat, autoplay } = get();
    let { queue } = get();
    if (auto && repeat === 'one') {
      commitListen();
      if (room) { room.seek(0); return; }
      active().currentTime = 0;
      active().play().catch(() => {});
      return;
    }
    commitListen();

    // Repeat-all in a room: the shared queue is what goes round, so this track rejoins it at the back,
    // along with anything still waiting in this person's own queue.
    if (room && repeat === 'all') {
      room.loopQueue(queue[index], queue.slice(index + 1).filter((t) => !t.isAutoplay));
      queue = queue.filter((t, i) => i <= index || t.isAutoplay);
      set({ queue });
    }

    const queued = room?.takeQueued();
    if (queued) {
      const q = queue.slice();
      q.splice(index + 1, 0, queued);
      set({ queue: q, index: index + 1 });
      get()._load();
      return;
    }

    if (room && get().shuffle) {
      const waiting = queue.map((t, i) => (i > index && !t.isAutoplay ? i : -1)).filter((i) => i >= 0);
      if (waiting.length > 1) {
        const pick = waiting[Math.floor(Math.random() * waiting.length)];
        queue = queue.slice();
        const [track] = queue.splice(pick, 1);
        queue.splice(index + 1, 0, track);
        set({ queue });
      }
    }

    // Check if next track is an auto-recommended track while autoplay is turned off
    const nextTrack = queue[index + 1];
    if (nextTrack) {
      if (!autoplay && nextTrack.isAutoplay) {
        // Autoplay is OFF: do not play auto-recommended tracks!
        room?.onStopped();
        queueFinished();
        active().pause();
        active().currentTime = 0;
        set({ playing: false, loading: false, time: 0 });
        savePlayerState({ time: 0, wasPlaying: false });
        if (!auto) {
          toast(tr('자동 재생이 꺼져 있어 재생을 마쳤습니다.'));
        }
        return;
      }
      set({ index: index + 1 });
      get()._load();
      return;
    }

    if (repeat === 'all' && queue.length) {
      set({ index: 0 });
      get()._load();
      return;
    }

    // End of queue reached:
    // If autoplay is OFF, stop playback cleanly!
    if (!autoplay) {
      room?.onStopped();
      queueFinished();
      active().pause();
      active().currentTime = 0;
      set({ playing: false, loading: false, time: 0 });
      savePlayerState({ time: 0, wasPlaying: false });
      if (!auto) {
        toast(tr('대기열의 마지막 곡입니다.'));
      }
      return;
    }

    // End of queue reached with autoplay ON: fetch related recommendations
    set({ loading: true });
    await get()._ensureNextTracks(true);
    const updated = get();
    if (updated.index + 1 < updated.queue.length) {
      set({ index: updated.index + 1 });
      get()._load();
    } else {
      // If truly all network/fallback attempts failed:
      room?.onStopped();
      queueFinished();
      active().pause();
      active().currentTime = 0;
      set({ playing: false, loading: false, time: 0 });
      savePlayerState({ time: 0, wasPlaying: false });
      toast(tr('추천곡을 불러올 수 없습니다 (네트워크 확인)'));
    }
  },

  prev() {
    if (room && !room.allowTrackChange()) return;
    pressDeckKey('prev');
    commitListen();
    const a = active();
    if (a.currentTime > 3 || get().index <= 0) {
      if (room) room.seek(0);
      else a.currentTime = 0;
      return;
    }
    set({ index: get().index - 1 });
    get()._load();
  },

  seek(t) {
    if (room) { room.seek(t); return; }
    const a = active();
    const dur = a.duration || get().duration || 0;
    const safeT = Math.max(0, dur > 0 ? Math.min(t, Math.max(0, dur - 0.5)) : t);
    a.currentTime = safeT;
    set({ time: safeT });
    savePlayerState({ time: safeT });
  },

  setVolume(v) {
    set({ volume: v, muted: v === 0 });
    for (const a of audios) { a.volume = v; a.muted = v === 0; }
    setDeckLevel(v);
    persistPrefs();
  },
  toggleMute() {
    const muted = !get().muted;
    set({ muted });
    for (const a of audios) a.muted = muted;
    setDeckLevel(muted ? 0 : get().volume);
    persistPrefs();
  },

  toggleShuffle() {
    if (room) { room.setModes({ shuffle: !get().shuffle }); return; }
    const { shuffle, queue, index, unshuffled } = get();
    const cur = queue[index];
    if (!shuffle) {
      const rest = shuffled(queue.filter((_, i) => i !== index));
      set({ shuffle: true, unshuffled: queue.slice(), queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
    } else {
      const base = unshuffled || queue;
      set({ shuffle: false, unshuffled: null, queue: base, index: cur ? Math.max(0, base.findIndex((t) => t.id === cur.id)) : -1 });
    }
    savePlayerState();
    get()._preloadNext();
  },
  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    const repeat = order[(order.indexOf(get().repeat) + 1) % 3];
    if (room) { room.setModes({ repeat }); return; }
    set({ repeat });
    persistPrefs();
    get()._preloadNext();
  },
  toggleAutoplay() {
    const next = !get().autoplay;
    set({ autoplay: next });
    persistPrefs();
    savePlayerState();

    toast(next ? tr('추천곡 자동 재생을 켰습니다') : tr('추천곡 자동 재생을 껐습니다'));

    if (!next) {
      // Switched OFF: prune any unplayed auto-added recommendation tracks from queue
      const { queue, index } = get();
      const pruned = queue.filter((t, i) => i <= index || !t.isAutoplay);
      if (pruned.length !== queue.length) {
        set({ queue: pruned });
        get()._preloadNext();
        savePlayerState();
      }
    } else {
      // Switched ON: proactively fetch recommendations if queue has no upcoming auto tracks
      const { queue, index } = get();
      const hasUpcomingAutoplay = queue.slice(index + 1).some((t) => t.isAutoplay);
      if (!hasUpcomingAutoplay && queue.length > 0) {
        get()._ensureNextTracks(true);
      }
    }
  },

  // ---- internals ----

  // `fromRoom`: the room asked for this track, so it isn't announced back to the room.
  _load(fromRoom = false) {
    commitListen();
    const track = get().current();
    if (!track) return;
    currentListenTrack = track;
    const src = streamUrl(track.id);
    retried.delete(track.id);
    if (isEnding()) dropSound();
    if (spare().dataset.id === track.id) {
      // Already buffered by _preloadNext: just swap.
      active().pause();
      cur = 1 - cur;
      if (active().currentTime > 0) active().currentTime = 0; // it may have played before (short repeat loops)
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
    if (!room) playWithDeck();
    else if (!fromRoom) room.onLoad(track);
    useLibrary.getState().pushRecent(track);
    updateMediaSession(track);
    savePlayerState({ time: 0, wasPlaying: true });
    get()._preloadNext();
    // Fetch related songs ahead of time ONLY when autoplay is enabled
    if (get().autoplay && get().index >= get().queue.length - 4) {
      get()._ensureNextTracks();
    }
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

  async _ensureNextTracks(force = false) {
    if (!get().autoplay || room?.following()) return false;
    if (extendingPromise) return extendingPromise;
    extendingPromise = (async () => {
      try {
        const { queue, index, autoplay } = get();
        if (!autoplay || !queue.length) return false;

        const have = new Set(queue.map((t) => t.id));

        // Candidates to seed recommendations from:
        // 1. Current track
        // 2. The last track in queue
        // 3. Other recent tracks in queue (moving backwards)
        const candidates = [];
        const cur = queue[index];
        const last = queue[queue.length - 1];
        if (cur) candidates.push(cur);
        if (last && last.id !== cur?.id) candidates.push(last);
        for (let i = index - 1; i >= 0 && candidates.length < 5; i--) {
          if (queue[i] && !candidates.some((c) => c.id === queue[i].id)) {
            candidates.push(queue[i]);
          }
        }

        if (force) {
          usedRadioSeeds.clear();
        }

        // Pick seeds that haven't been fetched yet
        let seed = candidates.find((c) => !usedRadioSeeds.has(c.id));
        if (!seed) {
          usedRadioSeeds.clear();
          seed = last || cur;
        }

        if (seed) {
          usedRadioSeeds.add(seed.id);
          try {
            const rel = await api.related(seed.id);
            const more = (rel || [])
              .filter((t) => t && t.id && !have.has(t.id))
              .slice(0, 15)
              .map((t) => ({ ...t, isAutoplay: true }));
            if (more.length > 0 && get().autoplay) {
              set({ queue: [...get().queue, ...more] });
              get()._preloadNext();
              savePlayerState();
              return true;
            }
          } catch (err) {
            console.warn('Failed to fetch related for seed', seed.id, err);
          }
        }

        // Secondary fallback: try another seed from candidates
        for (const alt of candidates) {
          if (alt.id === seed?.id || usedRadioSeeds.has(alt.id)) continue;
          usedRadioSeeds.add(alt.id);
          try {
            const rel = await api.related(alt.id);
            const more = (rel || [])
              .filter((t) => t && t.id && !have.has(t.id))
              .slice(0, 15)
              .map((t) => ({ ...t, isAutoplay: true }));
            if (more.length > 0 && get().autoplay) {
              set({ queue: [...get().queue, ...more] });
              get()._preloadNext();
              savePlayerState();
              return true;
            }
          } catch { /* ignore */ }
        }

        // Tertiary fallback: tracks from a featured playlist (shelves hold playlists, not songs)
        try {
          const homeData = await api.home();
          const shelfItems = (homeData?.shelves || []).flatMap((s) => s.items || []);
          const pick = shelfItems.find((i) => i.kind === 'playlist') || null;
          const pl = pick ? await api.playlist(pick.id) : null;
          const more = (pl?.tracks || [])
            .filter((t) => t && t.id && !have.has(t.id))
            .slice(0, 15)
            .map((t) => ({ ...t, isAutoplay: true }));
          if (more.length > 0 && get().autoplay) {
            set({ queue: [...get().queue, ...more] });
            get()._preloadNext();
            savePlayerState();
            return true;
          }
        } catch { /* ignore */ }

        // Quaternary fallback: popular tracks search
        try {
          const searchData = await api.search(tr('인기곡 차트'));
          const searchItems = (searchData?.tracks || searchData?.songs || []).filter(Boolean);
          const more = searchItems
            .filter((t) => t && t.id && !have.has(t.id))
            .slice(0, 15)
            .map((t) => ({ ...t, isAutoplay: true }));
          if (more.length > 0 && get().autoplay) {
            set({ queue: [...get().queue, ...more] });
            get()._preloadNext();
            savePlayerState();
            return true;
          }
        } catch { /* ignore */ }

        return false;
      } finally {
        extendingPromise = null;
      }
    })();
    return extendingPromise;
  },

}));

setDeckLevel(usePlayer.getState().muted ? 0 : usePlayer.getState().volume);

// Changing the style or turning the sounds off mid-sound: drop it, and don't leave the music waiting.
useDeck.subscribe((s, prev) => {
  if (s.style === prev.style && s.sounds === prev.sounds) return;
  if (s.sounds && s.style === prev.style) return;
  const waiting = isWaitingForMusic() && !room;
  if (isStarting() || isEnding()) dropSound();
  if (waiting) active().play().catch(() => {});
});

// How the listen-together room drives playback; these skip the checks above on purpose.
export const roomPlayer = {
  // People who can't control playback just show the room's track; controllers keep their queue.
  load(track, replaceQueue) {
    const { queue, index } = usePlayer.getState();
    const found = replaceQueue ? -1 : queue.findIndex((t) => t.id === track.id);
    if (replaceQueue) {
      usePlayer.setState({ queue: [track], index: 0, context: null });
    } else if (found >= 0) {
      usePlayer.setState({ index: found });
    } else {
      const q = queue.slice();
      q.splice(index + 1, 0, track);
      usePlayer.setState({ queue: q, index: index + 1 });
    }
    usePlayer.getState()._load(true);
  },
  play() {
    const a = active();
    attach(a);
    firstPlayInRoom(0);
    if (a.paused) a.play().catch(() => {});
  },
  pause() {
    if (isWaitingForMusic()) {
      dropSound();
      setStarted(false);
    }
    active().pause();
  },
  // Waiting for the moment the room's new track starts.
  hold(secondsUntilMusic) {
    attach(active());
    active().pause();
    firstPlayInRoom(secondsUntilMusic);
  },
  finished: queueFinished,
  // Not following the room any more: whatever it was doing to the sound is over.
  release() {
    if (isStarting() || isEnding()) dropSound();
    if (soloModes) {
      usePlayer.setState(soloModes);
      soloModes = null;
      usePlayer.getState()._preloadNext();
    }
  },
  setModes(modes) {
    if (!soloModes) {
      const { repeat, shuffle } = usePlayer.getState();
      soloModes = { repeat, shuffle };
    }
    usePlayer.setState({ repeat: modes?.repeat || 'off', shuffle: modes?.shuffle === true });
    usePlayer.getState()._preloadNext();
  },
  seekTo(t) {
    try {
      active().currentTime = t;
      usePlayer.setState({ time: t });
    } catch { /* not loaded yet; the room's next correction tries again */ }
  },
  setRate(rate) {
    for (const a of audios) if (a.playbackRate !== rate) a.playbackRate = rate;
  },
  time: () => active().currentTime || 0,
  isPaused: () => active().paused,
};

// Once per launch, when the app is ready to be used and the settings ask for it.
let launchResumeChecked = false;
export function resumeOnLaunch() {
  if (launchResumeChecked) return;
  launchResumeChecked = true;
  if (!usePrefs.getState().resumeOnLaunch || room) return;
  const player = usePlayer.getState();
  if (player.current() && !player.playing) playWithDeck();
}

// Signing out: what was playing belonged to that account.
export function resetPlayer() {
  commitListen();
  currentListenTrack = null;
  dropSound();
  setStarted(false);
  for (const a of audios) {
    a.pause();
    a.removeAttribute('src');
    a.load();
    a.dataset.id = '';
  }
  usePlayer.setState({ queue: [], index: -1, context: null, playing: false, loading: false, time: 0, duration: 0, buffered: 0 });
  savePlayerState({ time: 0, wasPlaying: false });
  updateMediaSession(null);
}

// Wire audio events. Events from the spare element are ignored.
let lastTimeSave = 0;
let consecutiveErrors = 0;
let errorSkipTimer = null;

audios.forEach((a, i) => {
  const isActive = () => i === cur;
  a.addEventListener('playing', () => {
    if (isActive()) {
      consecutiveErrors = 0;
      clearTimeout(errorSkipTimer);
      usePlayer.setState({ playing: true, loading: false });
      if (riseOnPlaying) {
        setMusicFade(1, riseOnPlaying);
        riseOnPlaying = 0;
      }
      const curTrack = usePlayer.getState().current();
      startListening(curTrack);
      startAudioOnsetDetection(a, curTrack?.id);
      savePlayerState({ wasPlaying: true, time: a.currentTime });
    }
  });
  a.addEventListener('pause', () => {
    if (isActive()) {
      usePlayer.setState({ playing: false });
      if (isEnding() && !isEndCommitted() && a.duration - a.currentTime > 0.5) dropSound();
      if (isStarting() && !isWaitingForMusic()) dropSound();
      pauseListening();
      savePlayerState({ wasPlaying: false, time: a.currentTime });
    }
  });
  a.addEventListener('waiting', () => {
    if (isActive()) {
      usePlayer.setState({ loading: true });
      pauseListening();
    }
  });
  a.addEventListener('canplay', () => {
    if (isActive()) {
      usePlayer.setState({ loading: false });
      if (!a.paused) startListening(usePlayer.getState().current());
    }
  });
  a.addEventListener('timeupdate', () => {
    if (!isActive()) return;
    if (a.currentTime > 1) {
      consecutiveErrors = 0;
    }
    const b = a.buffered.length ? a.buffered.end(a.buffered.length - 1) : 0;
    usePlayer.setState({ time: a.currentTime, buffered: b });
    watchQueueEnd(a);
    if ('mediaSession' in navigator && a.duration) {
      try { navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: 1 }); } catch { /* ignore */ }
    }
    // Flush listening progress periodically every 30 seconds of actual playback
    if (listenStartTime != null && performance.now() - listenStartTime >= 30000) {
      commitListen();
      listenStartTime = performance.now();
    }
    // Throttle saving playback position to localStorage every 1.5 seconds
    const now = performance.now();
    if (now - lastTimeSave > 1500) {
      lastTimeSave = now;
      savePlayerState({ time: a.currentTime, wasPlaying: !a.paused });
    }
  });
  a.addEventListener('seeked', () => { if (isActive()) window.dispatchEvent(new CustomEvent('t-music:seeked')); });
  a.addEventListener('durationchange', () => isActive() && isFinite(a.duration) && usePlayer.setState({ duration: a.duration }));
  a.addEventListener('ended', () => {
    if (!isActive()) return;
    consecutiveErrors = 0;
    const dur = a.duration || 0;
    // Guard against premature 'ended' events caused by network truncations:
    if (dur > 0 && dur - a.currentTime > 3) {
      console.warn('Playback ended prematurely at', a.currentTime, 'of', dur);
      a.play().catch(() => {});
      return;
    }
    commitListen();
    savePlayerState({ time: 0, wasPlaying: true });
    usePlayer.getState().next(true);
  });
  a.addEventListener('error', () => {
    const id = a.dataset.id;
    if (!id) return;
    if (!isActive()) { a.dataset.id = ''; return; } // preload failed; retry when it becomes current
    if (!retried.has(id)) {
      // One retry: the main process fetches a fresh URL if the first one died.
      retried.add(id);
      const t = a.currentTime;
      a.src = streamUrl(id) + '?retry=' + Date.now();
      a.currentTime = t;
      a.play().catch(() => {});
      return;
    }
    consecutiveErrors++;
    const track = usePlayer.getState().current();
    usePlayer.setState({ loading: false });

    // Circuit breaker: prevent rapid cascading skip of entire queue on network/stream outage
    if (consecutiveErrors >= 3) {
      active().pause();
      usePlayer.setState({ playing: false, loading: false });
      toast(tr('연속으로 음원을 재생할 수 없어 재생을 일시정지했습니다. 네트워크 연결을 확인해주세요.'));
      consecutiveErrors = 0;
      clearTimeout(errorSkipTimer);
      return;
    }

    toast(tr('재생할 수 없어 건너뜁니다: {0}', track?.title || id));
    clearTimeout(errorSkipTimer);
    errorSkipTimer = setTimeout(() => {
      usePlayer.getState().next(true);
    }, 600);
  });
});

function updateMediaSession(track) {
  if (track) {
    const artistStr = (track.artists || []).map((a) => a.name).join(', ');
    const tip = artistStr ? `${track.title} - ${artistStr}` : (track.title || 'T-Music');
    try { api.updateTrayTooltip(tip); } catch { /* ignore */ }
  } else {
    try { api.updateTrayTooltip('T-Music'); } catch { /* ignore */ }
  }
  if (!('mediaSession' in navigator) || !track) return;
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

// Restore playback session on startup
if (initialTrack) {
  const a = active();
  const src = streamUrl(initialTrack.id);
  a.src = src;
  a.dataset.id = initialTrack.id;
  a.volume = saved.volume ?? DEFAULT_VOLUME;
  a.muted = saved.muted ?? false;
  currentListenTrack = initialTrack;

  updateMediaSession(initialTrack);

  let restored = false;
  const restorePosition = () => {
    if (restored) return;
    restored = true;
    try {
      const dur = a.duration || initialDuration;
      const safeT = Math.max(0, Math.min(initialTime, dur > 0 ? dur - 0.5 : initialTime));
      a.currentTime = safeT;
      usePlayer.setState({ time: safeT, duration: dur });
      // Always restore session in a paused state when reopening the app
      attach(a);
      usePlayer.setState({ playing: false, time: safeT, duration: dur });
      savePlayerState({ wasPlaying: false, time: safeT });
    } catch (e) {
      console.warn('Failed to restore position:', e);
    }
  };

  a.addEventListener('loadedmetadata', restorePosition, { once: true });
  a.addEventListener('canplay', restorePosition, { once: true });
  setTimeout(() => {
    if (!restored && (a.readyState >= 1 || isFinite(a.duration))) restorePosition();
  }, 1200);

  setTimeout(() => {
    try { usePlayer.getState()._preloadNext(); } catch {}
  }, 2000);
}
