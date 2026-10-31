import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// The signed-in account's saved data. It's kept on this computer per account for instant loading,
// and lib/librarySync.js mirrors it to the account. No YouTube account is involved.
export const slim = (t) => ({ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null });
const newId = () => Math.random().toString(36).slice(2, 10);
const DAY = 24 * 60 * 60 * 1000;

const STORE_KEY = 't-music-library';
const LEGACY_SEARCHES_KEY = 't-music-search-history';
const IMPORTED_BY_KEY = 't-music-library-imported-by';

export const RECENT_LIMIT = 60;
export const SEARCH_LIMIT = 14;
export const LISTEN_RETENTION_DAYS = 60;
const LISTEN_LIMIT = 2000;

export const EMPTY_LIBRARY = { liked: [], playlists: [], recent: [], savedAlbums: [], followed: [], listens: [], searches: [] };

export const uniqueStrings = (list) => [...new Set(list)];

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Listens saved before accounts existed have no key or day.
export const normalizeListens = (list) => list.map((l) => (l.key && l.day ? l : { ...l, key: l.key || String(l.at), day: l.day || dayKey(l.at) }));

export const useLibrary = create(
  persist(
    (set, get) => ({
      ...EMPTY_LIBRARY,

      isLiked: (id) => get().liked.some((t) => t.id === id),
      toggleLike(track) {
        const liked = get().liked;
        set({ liked: liked.some((t) => t.id === track.id) ? liked.filter((t) => t.id !== track.id) : [{ ...slim(track), addedAt: Date.now() }, ...liked] });
      },

      pushRecent(track) {
        set({ recent: [slim(track), ...get().recent.filter((t) => t.id !== track.id)].slice(0, RECENT_LIMIT) });
      },
      removeRecent(id) {
        set({ recent: get().recent.filter((t) => t.id !== id) });
      },
      rememberSearch(text) {
        const q = String(text || '').trim();
        if (q) set({ searches: [q, ...get().searches.filter((x) => x !== q)].slice(0, SEARCH_LIMIT) });
      },
      forgetSearch(text) {
        set({ searches: get().searches.filter((x) => x !== text) });
      },
      clearSearches() {
        set({ searches: [] });
      },
      addListen(track, sec) {
        const s = Math.round(sec || 0);
        if (s <= 0) return;
        const now = Date.now();
        const cutoff = now - LISTEN_RETENTION_DAYS * DAY;
        const list = get().listens.filter((l) => l.at > cutoff);
        // If the most recent listen is the same track within 5 minutes, accumulate duration instead of duplicating play count
        const first = list[0];
        if (first && first.id === track.id && now - first.at < 5 * 60 * 1000) {
          set({ listens: [{ ...first, sec: first.sec + s, at: now }, ...list.slice(1)] });
        } else {
          const entry = { key: `${now.toString(36)}${newId().slice(0, 4)}`, day: dayKey(now), id: track.id, title: track.title, artist: track.artists?.[0]?.name || '', thumb: track.thumb, sec: s, at: now };
          set({ listens: [entry, ...list].slice(0, LISTEN_LIMIT) });
        }
      },

      createPlaylist(name, tracks = [], extra = {}) {
        const id = newId();
        set({ playlists: [{ id, name: name || `내 플레이리스트 #${get().playlists.length + 1}`, tracks: tracks.map(slim), created: Date.now(), ...extra }, ...get().playlists] });
        return id;
      },
      renamePlaylist(id, name) {
        set({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, name } : p)) });
      },
      deletePlaylist(id) {
        set({ playlists: get().playlists.filter((p) => p.id !== id) });
      },
      addToPlaylist(id, tracks) {
        const list = Array.isArray(tracks) ? tracks : [tracks];
        let addedCount = 0;
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== id) return p;
            const have = new Set(p.tracks.map((t) => t.id));
            const newTracks = list.filter((t) => !have.has(t.id)).map(slim);
            addedCount = newTracks.length;
            return { ...p, tracks: [...p.tracks, ...newTracks] };
          }),
        });
        return addedCount;
      },
      removeFromPlaylist(id, index) {
        set({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index) } : p)) });
      },
      reorderPlaylist(id, fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== id) return p;
            const nextTracks = [...p.tracks];
            if (fromIndex < 0 || toIndex < 0 || fromIndex >= nextTracks.length || toIndex >= nextTracks.length) return p;
            const [moved] = nextTracks.splice(fromIndex, 1);
            nextTracks.splice(toIndex, 0, moved);
            return { ...p, tracks: nextTracks };
          }),
        });
      },

      toggleSavedAlbum(album) {
        const list = get().savedAlbums;
        const item = { id: album.id, title: album.title, artists: album.artists || [], thumb: album.thumb, type: album.type, year: album.year, addedAt: Date.now() };
        set({ savedAlbums: list.some((a) => a.id === album.id) ? list.filter((a) => a.id !== album.id) : [item, ...list] });
      },
      toggleFollow(artist) {
        const list = get().followed;
        const item = { id: artist.id, name: artist.name, thumb: artist.thumb, addedAt: Date.now() };
        set({ followed: list.some((a) => a.id === artist.id) ? list.filter((a) => a.id !== artist.id) : [item, ...list] });
      },
    }),
    { name: STORE_KEY },
  ),
);

// ---- Which account the data on this computer belongs to ----

export const syncedFlag = (uid) => `t-music-synced:${uid}`;
const storeKey = (uid) => (uid ? `${STORE_KEY}:${uid}` : STORE_KEY);

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key))?.state || null;
  } catch {
    return null;
  }
}

function readLegacySearches() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_SEARCHES_KEY)) || [];
  } catch {
    return [];
  }
}

// Keep each item's place: items from before accounts have no timestamp to sort by.
const stamped = (list, base) => list.map((x, i) => (x.addedAt ? x : { ...x, addedAt: base - i }));

function unionById(a = [], b = []) {
  const seen = new Set();
  return [...a, ...b].filter((x) => x?.id && !seen.has(x.id) && seen.add(x.id));
}

function mergeLibraries(a, b) {
  const now = Date.now();
  const byKey = new Map([...normalizeListens(b.listens || []), ...normalizeListens(a.listens || [])].map((l) => [l.key, l]));
  return {
    liked: stamped(unionById(a.liked, b.liked), now),
    playlists: unionById(a.playlists, b.playlists),
    savedAlbums: stamped(unionById(a.savedAlbums, b.savedAlbums), now),
    followed: stamped(unionById(a.followed, b.followed), now),
    recent: unionById(a.recent, b.recent).slice(0, RECENT_LIMIT),
    searches: uniqueStrings([...(a.searches || []), ...(b.searches || [])]).slice(0, SEARCH_LIMIT),
    listens: [...byKey.values()].sort((x, y) => y.at - x.at).slice(0, LISTEN_LIMIT),
  };
}

// The data as plain values, without the store's methods.
export function libraryData() {
  const state = useLibrary.getState();
  return Object.fromEntries(Object.keys(EMPTY_LIBRARY).map((k) => [k, state[k]]));
}

// Point the store at an account's data. The first account to sign in on this computer takes over
// what was saved before accounts existed; `carriedOver` is a guest's data moving to this account.
export function setLibraryOwner(uid, carriedOver = null) {
  const key = storeKey(uid);
  let data = readStored(key) || EMPTY_LIBRARY;
  let mustMerge = Boolean(carriedOver);
  try {
    if (uid && !localStorage.getItem(IMPORTED_BY_KEY)) {
      const legacy = readStored(STORE_KEY);
      data = mergeLibraries(data, { ...legacy, searches: readLegacySearches() });
      localStorage.setItem(IMPORTED_BY_KEY, uid);
      mustMerge = true;
    }
  } catch { /* storage unavailable: nothing to import */ }
  if (carriedOver) data = mergeLibraries(data, carriedOver);
  if (mustMerge && uid) needsFullMerge(uid);
  useLibrary.persist.setOptions({ name: key });
  useLibrary.setState({ ...EMPTY_LIBRARY, ...data });
}

// The next sync combines this computer's copy with the account's instead of replacing it.
export function needsFullMerge(uid) {
  try { localStorage.removeItem(syncedFlag(uid)); } catch { /* the merge simply happens anyway */ }
}

// Removes an account's copy from this computer. When a guest who took over the pre-account data
// leaves, it stays available for the next account; deleting a real account removes it for good.
export function forgetLibrary(uid, { everything = false } = {}) {
  try {
    localStorage.removeItem(storeKey(uid));
    localStorage.removeItem(syncedFlag(uid));
    if (localStorage.getItem(IMPORTED_BY_KEY) !== uid) return;
    localStorage.removeItem(IMPORTED_BY_KEY);
    if (everything) {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(LEGACY_SEARCHES_KEY);
    }
  } catch { /* nothing more to clean up */ }
}

// Last-7-days listening summary for the home dashboard.
export function weeklyStats(listens) {
  const since = Date.now() - 7 * DAY;
  const week = listens.filter((l) => l.at > since);
  const minutes = Math.round(week.reduce((n, l) => n + l.sec, 0) / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const byArtist = {};
  for (const l of week) if (l.artist) byArtist[l.artist] = (byArtist[l.artist] || 0) + l.sec;
  const topArtist = Object.entries(byArtist).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const byTrack = {};
  for (const l of week) (byTrack[l.id] ??= { ...l, count: 0 }).count++;
  const topTracks = Object.values(byTrack).sort((a, b) => b.count - a.count).slice(0, 5);
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (6 - i));
    const end = start.getTime() + DAY;
    return { label: '일월화수목금토'[start.getDay()], min: Math.round(week.filter((l) => l.at >= start.getTime() && l.at < end).reduce((n, l) => n + l.sec, 0) / 60) };
  });
  return { minutes, hours, mins, plays: week.length, topArtist, topTracks, days };
}
