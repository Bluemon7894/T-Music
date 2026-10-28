import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Everything the user saves lives on this computer only; no YouTube account involved.
const slim = (t) => ({ id: t.id, title: t.title, artists: t.artists || [], album: t.album || null, duration: t.duration || 0, thumb: t.thumb || null });
const newId = () => Math.random().toString(36).slice(2, 10);

export const useLibrary = create(
  persist(
    (set, get) => ({
      liked: [],
      playlists: [],
      recent: [],
      savedAlbums: [],
      followed: [],

      isLiked: (id) => get().liked.some((t) => t.id === id),
      toggleLike(track) {
        const liked = get().liked;
        set({ liked: liked.some((t) => t.id === track.id) ? liked.filter((t) => t.id !== track.id) : [slim(track), ...liked] });
      },

      pushRecent(track) {
        set({ recent: [slim(track), ...get().recent.filter((t) => t.id !== track.id)].slice(0, 60) });
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
        set({
          playlists: get().playlists.map((p) => {
            if (p.id !== id) return p;
            const have = new Set(p.tracks.map((t) => t.id));
            return { ...p, tracks: [...p.tracks, ...list.filter((t) => !have.has(t.id)).map(slim)] };
          }),
        });
      },
      removeFromPlaylist(id, index) {
        set({ playlists: get().playlists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((_, i) => i !== index) } : p)) });
      },

      toggleSavedAlbum(album) {
        const list = get().savedAlbums;
        const item = { id: album.id, title: album.title, artists: album.artists || [], thumb: album.thumb, type: album.type };
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
