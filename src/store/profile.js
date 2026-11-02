// What this account shows about itself: a short introduction and the genres it picked, plus the summary of
// its listening that friends can open. Nothing goes into that summary unless its switch is on, so turning
// one off really takes the information away. Friends get a copy; the library itself stays private.
import { create } from 'zustand';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { get as dbGet, ref, remove, serverTimestamp, set as dbSet } from 'firebase/database';
import { auth, db, rtdb } from '../lib/firebase.js';
import { api } from '../lib/api.js';
import { safePhoto, safeTrack } from '../lib/safeTrack.js';
import { useLibrary } from './library.js';
import { record } from './undo.js';
import { tr } from '../lib/i18n.js';

export const MAX_BIO = 80;
export const MAX_GENRES = 6;
export const MAX_GENRE_LENGTH = 30;
// What friends are shown of someone's listening unless they turn it off.
export const DETAIL_SHARING = ['playlists', 'topTracks', 'time', 'artists', 'genres'];
const PUBLISH_DELAY_MS = 20000;
const TOP_TRACKS = 12;
const TOP_ARTISTS = 8;
const GENRE_ARTISTS = 6;
const PUBLIC_PLAYLISTS = 12;
const TRACKS_PER_PLAYLIST = 100;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// What's offered while typing a genre. Anything else can be typed as it is.
export const GENRE_CHOICES = ['K-Pop', 'J-Pop', 'C-Pop', tr('팝'), tr('발라드'), tr('댄스'), tr('힙합'), tr('랩'), 'R&B', tr('소울'), tr('인디'), tr('록'), tr('메탈'), tr('펑크'), tr('포크'), tr('어쿠스틱'), tr('트로트'), tr('재즈'), tr('블루스'), tr('클래식'), tr('로파이'), 'EDM', tr('하우스'), tr('테크노'), tr('신스팝'), tr('시티팝'), tr('레게'), tr('라틴'), tr('컨트리'), tr('뉴에이지'), 'OST', tr('게임 음악'), tr('애니메이션 음악'), tr('보컬로이드'), 'CCM'];

const profileDoc = () => doc(db, 'users', auth.currentUser.uid, 'state', 'profile');
const friendViewRef = (uid) => ref(rtdb, `friendProfiles/${uid}`);

// Kept on the device too, so the picture is there before the network answers.
const photoKey = (uid) => `t-music-photo-${uid}`;
const cachedPhoto = (uid) => {
  try { return safePhoto(localStorage.getItem(photoKey(uid))); } catch { return null; }
};
function cachePhoto(uid, photo) {
  try {
    if (photo) localStorage.setItem(photoKey(uid), photo);
    else localStorage.removeItem(photoKey(uid));
  } catch { /* it's only a head start */ }
}

// The picture this account goes by: one it uploaded, then its chosen address, then Google's.
export function photoToShow(user) {
  const google = user.providerData.find((p) => p.providerId === 'google.com');
  return useProfile.getState().photo || (user.photoURL || google?.photoURL || '').slice(0, 500) || null;
}

function topBy(entries, keyOf, limit) {
  const totals = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!key) continue;
    const row = totals.get(key) || { entry, sec: 0 };
    row.sec += entry.sec || 0;
    totals.set(key, row);
  }
  return [...totals.values()].sort((a, b) => b.sec - a.sec).slice(0, limit);
}

// What the listening history says, weighted by how much each artist gets played.
async function genresFromListening(listens) {
  const artists = topBy(listens, (l) => l.artist, GENRE_ARTISTS);
  if (!artists.length) return [];
  // Nice to have: failing here must not keep everything else from reaching friends.
  let found = {};
  try {
    found = await api.artistGenres(artists.map((a) => a.entry.artist));
  } catch (e) {
    console.warn('[profile]', e);
  }
  const weight = new Map();
  for (const { entry, sec } of artists) {
    const genre = found?.[entry.artist];
    if (genre) weight.set(genre, (weight.get(genre) || 0) + sec);
  }
  return [...weight].sort((a, b) => b[1] - a[1]).map(([genre]) => genre).slice(0, MAX_GENRES);
}

export const useProfile = create((set, get) => {
  let timer = null;
  let lastPublished = '';
  let stopWatching = null;

  const build = async (sharing) => {
    const { listens, playlists } = useLibrary.getState();
    const { bio, genres } = get();
    const now = Date.now();
    const recent = listens.filter((l) => now - l.at < MONTH_MS);
    // So a friend can tell "kept private" from "nothing to show yet".
    const view = { hidden: DETAIL_SHARING.filter((key) => !sharing[key]) };
    if (bio) view.bio = bio;
    if (sharing.time) {
      const minutes = (list) => Math.round(list.reduce((n, l) => n + (l.sec || 0), 0) / 60);
      view.time = { week: minutes(listens.filter((l) => now - l.at < WEEK_MS)), month: minutes(recent), total: minutes(listens) };
    }
    if (sharing.topTracks) {
      view.topTracks = topBy(recent, (l) => l.id, TOP_TRACKS)
        .map(({ entry, sec }) => ({ ...safeTrack({ id: entry.id, title: entry.title, artists: [{ name: entry.artist }], thumb: entry.thumb }), minutes: Math.round(sec / 60) }))
        .filter((t) => t.id);
    }
    if (sharing.artists) {
      view.artists = topBy(recent, (l) => l.artist, TOP_ARTISTS).map(({ entry, sec }) => ({ name: String(entry.artist).slice(0, 100), minutes: Math.round(sec / 60) }));
    }
    if (sharing.genres) {
      const heard = await genresFromListening(recent);
      const merged = [...new Set([...genres, ...heard])].slice(0, MAX_GENRES);
      if (merged.length) view.genres = merged;
    }
    if (sharing.playlists) {
      view.playlists = playlists.filter((p) => p.public !== false).slice(0, PUBLIC_PLAYLISTS).map((p) => ({
        name: String(p.name).slice(0, 100),
        count: p.tracks.length,
        tracks: p.tracks.slice(0, TRACKS_PER_PLAYLIST).map(safeTrack).filter(Boolean),
      }));
    }
    return view;
  };

  const publishNow = async (sharing) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const view = await build(sharing);
    const json = JSON.stringify(view);
    if (json === lastPublished) return;
    lastPublished = json;
    await dbSet(friendViewRef(uid), { ...view, updatedAt: serverTimestamp() });
  };

  return {
    bio: '',
    genres: [],
    photo: null,

    async start(getSharing) {
      lastPublished = '';
      clearTimeout(timer);
      timer = null;
      const uid = auth.currentUser?.uid;
      set({ photo: cachedPhoto(uid) });
      // Not pushed back by each new change: while music plays there's always another one coming.
      const schedule = () => {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          publishNow(getSharing()).catch((e) => console.warn('[profile]', e));
        }, PUBLISH_DELAY_MS);
      };
      try {
        const saved = (await getDoc(profileDoc())).data() || {};
        set({ bio: String(saved.bio || '').slice(0, MAX_BIO), genres: Array.isArray(saved.genres) ? saved.genres.slice(0, MAX_GENRES) : [], photo: safePhoto(saved.photo) });
        cachePhoto(uid, get().photo);
      } catch (e) {
        console.warn('[profile]', e);
      }
      stopWatching?.();
      stopWatching = useLibrary.subscribe((next, prev) => {
        if (next.listens !== prev.listens || next.playlists !== prev.playlists) schedule();
      });
      schedule();
    },

    stop() {
      clearTimeout(timer);
      timer = null;
      stopWatching?.();
      stopWatching = null;
      set({ bio: '', genres: [], photo: null });
    },

    // Settings changed: friends should see it now, not in twenty seconds.
    publishSoon(sharing) {
      clearTimeout(timer);
      timer = null;
      publishNow(sharing).catch((e) => console.warn('[profile]', e));
    },

    save(patch, sharing) {
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, get()[key]]));
      set(patch);
      setDoc(profileDoc(), patch, { merge: true }).catch((e) => console.warn('[profile]', e));
      get().publishSoon(sharing);
      record(tr('프로필 변경'), () => get().save(before, sharing));
    },

    setPhoto(photo) {
      cachePhoto(auth.currentUser?.uid, photo);
      set({ photo });
      setDoc(profileDoc(), { photo }, { merge: true }).catch((e) => console.warn('[profile]', e));
    },

    async remove(uid) {
      cachePhoto(uid, null);
      await remove(friendViewRef(uid)).catch(() => {});
    },
  };
});

export async function loadFriendView(uid) {
  const snap = await dbGet(friendViewRef(uid));
  return snap.val();
}
