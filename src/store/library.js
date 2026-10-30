import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Everything the user saves lives on this computer only; no YouTube account involved.
export const slim = (t) => ({ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null });
const newId = () => Math.random().toString(36).slice(2, 10);
const DAY = 24 * 60 * 60 * 1000;

export const useLibrary = create(
  persist(
    (set, get) => ({
      liked: [],
      playlists: [],
      recent: [],
      savedAlbums: [],
      followed: [],
      listens: [], // { id, title, artist, sec, at } — powers the listening stats

      isLiked: (id) => get().liked.some((t) => t.id === id),
      toggleLike(track) {
        const liked = get().liked;
        set({ liked: liked.some((t) => t.id === track.id) ? liked.filter((t) => t.id !== track.id) : [slim(track), ...liked] });
      },

      pushRecent(track) {
        set({ recent: [slim(track), ...get().recent.filter((t) => t.id !== track.id)].slice(0, 60) });
      },
      removeRecent(id) {
        set({ recent: get().recent.filter((t) => t.id !== id) });
      },
      addListen(track, sec) {
        const s = Math.round(sec || 0);
        if (s <= 0) return;
        const cutoff = Date.now() - 60 * DAY;
        const list = get().listens.filter((l) => l.at > cutoff);
        // If the most recent listen is the same track within 5 minutes, accumulate duration instead of duplicating play count
        const first = list[0];
        if (first && first.id === track.id && Date.now() - first.at < 5 * 60 * 1000) {
          first.sec += s;
          first.at = Date.now();
          set({ listens: [...list] });
        } else {
          const entry = { id: track.id, title: track.title, artist: track.artists?.[0]?.name || '', thumb: track.thumb, sec: s, at: Date.now() };
          set({ listens: [entry, ...list].slice(0, 2000) });
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
        const item = { id: album.id, title: album.title, artists: album.artists || [], thumb: album.thumb, type: album.type, year: album.year };
        set({ savedAlbums: list.some((a) => a.id === album.id) ? list.filter((a) => a.id !== album.id) : [item, ...list] });
      },
      toggleFollow(artist) {
        const list = get().followed;
        const item = { id: artist.id, name: artist.name, thumb: artist.thumb };
        set({ followed: list.some((a) => a.id === artist.id) ? list.filter((a) => a.id !== artist.id) : [item, ...list] });
      },
    }),
    { name: 't-music-library' },
  ),
);

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
