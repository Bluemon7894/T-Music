// Playlists shared by link. The shared copy lives in Firestore outside any account, and each
// person's library holds a normal playlist with a `share` field pointing to it. Everything that
// already edits playlists keeps working: changes are diffed and merged into the shared copy, and
// changes from others flow back the same way.
import { deleteDoc, doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { safeTrack } from './safeTrack.js';
import { useLibrary } from '../store/library.js';
import { toast, useUI } from '../store/ui.js';

const ID_LENGTH = 22;
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PUSH_DELAY_MS = 500;

const sharedDoc = (id) => doc(db, 'sharedPlaylists', id);
const myUid = () => auth.currentUser?.uid ?? null;
const idsOf = (tracks) => tracks.map((t) => t.id).join();

export const shareLink = (id) => `tmusic://playlist/${id}`;
export const parseShareId = (text) => String(text || '').trim().replace(/^.*playlist\//i, '').replace(/[^A-Za-z0-9]/g, '');
export const canEditPlaylist = (p) => !p.share || p.share.ownerUid === myUid() || p.share.editable === true;

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('');
}

function myName() {
  const user = auth.currentUser;
  const google = user?.providerData.find((p) => p.providerId === 'google.com');
  return (user?.displayName || google?.displayName || '게스트').slice(0, 40);
}

const remoteTracks = (data) => (Array.isArray(data?.tracks) ? data.tracks.map(safeTrack).filter(Boolean) : []);
const toShare = (id, data) => ({ id, ownerUid: data.ownerUid, ownerName: data.ownerName || '', editable: data.editable === true });

// Others may have changed the list since we last saw it: keep their changes and apply only ours.
function mergeTracks(base, mine, theirs) {
  const baseIds = new Set(base.map((t) => t.id));
  const mineIds = new Set(mine.map((t) => t.id));
  const reordered = base.length === mine.length && mine.every((t) => baseIds.has(t.id)) && idsOf(base) !== idsOf(mine);
  if (reordered) {
    const theirsOnly = theirs.filter((t) => !baseIds.has(t.id));
    const stillThere = new Set(theirs.map((t) => t.id));
    return [...mine.filter((t) => stillThere.has(t.id)), ...theirsOnly];
  }
  const kept = theirs.filter((t) => !baseIds.has(t.id) || mineIds.has(t.id));
  const present = new Set(kept.map((t) => t.id));
  return [...kept, ...mine.filter((t) => !baseIds.has(t.id) && !present.has(t.id))];
}

function createSession() {
  const watchers = new Map(); // share id -> stop listening
  const known = new Map(); // share id -> the shared copy as last seen
  const timers = new Map();
  let applying = false;

  const applyLocal = (update) => {
    applying = true;
    try { useLibrary.setState({ playlists: useLibrary.getState().playlists.map(update) }); } finally { applying = false; }
  };

  const restore = (shareId) => {
    const data = known.get(shareId);
    if (!data) return;
    applyLocal((p) => (p.share?.id === shareId ? { ...p, name: data.name, tracks: data.tracks } : p));
  };

  const onRemote = (shareId, snap) => {
    if (!snap.exists()) {
      known.delete(shareId);
      if (snap.metadata.fromCache) return;
      const had = useLibrary.getState().playlists.find((p) => p.share?.id === shareId);
      if (!had) return;
      applyLocal((p) => {
        if (p.share?.id !== shareId) return p;
        const { share, ...rest } = p;
        return rest;
      });
      if (had.share.ownerUid !== myUid()) toast(`'${had.name}' 공유가 끝나서 내 플레이리스트로 남겼습니다`);
      return;
    }
    const data = snap.data();
    const tracks = remoteTracks(data);
    const name = String(data.name || '').slice(0, 100) || '공유 플레이리스트';
    known.set(shareId, { name, tracks });
    if (timers.has(shareId)) return; // our own change is on its way; its result comes back here
    const share = toShare(shareId, data);
    const current = useLibrary.getState().playlists.find((p) => p.share?.id === shareId);
    if (!current || (current.name === name && idsOf(current.tracks) === idsOf(tracks) && JSON.stringify(current.share) === JSON.stringify(share))) return;
    applyLocal((p) => (p.share?.id === shareId ? { ...p, name, tracks, share } : p));
  };

  const push = async (shareId) => {
    timers.delete(shareId);
    const playlist = useLibrary.getState().playlists.find((p) => p.share?.id === shareId);
    const base = known.get(shareId);
    if (!playlist || !base) return;
    try {
      await runTransaction(db, async (tx) => {
        const ref = sharedDoc(shareId);
        const fresh = await tx.get(ref);
        if (!fresh.exists()) return;
        const data = fresh.data();
        tx.update(ref, {
          name: playlist.name !== base.name ? playlist.name.slice(0, 100) : data.name,
          tracks: mergeTracks(base.tracks, playlist.tracks, remoteTracks(data)).map(safeTrack).filter(Boolean),
          updatedAt: serverTimestamp(),
        });
      });
    } catch (e) {
      console.warn('[shared playlist]', e?.code || e);
      toast(e?.code === 'permission-denied' ? '이 플레이리스트를 편집할 권한이 없습니다' : '공유 플레이리스트를 저장하지 못했습니다');
      restore(shareId);
    }
  };

  const onLibrary = (next, prev) => {
    if (next.playlists === prev.playlists) return;
    const seen = new Set();
    for (const p of next.playlists) {
      if (!p.share) continue;
      seen.add(p.share.id);
      if (!watchers.has(p.share.id)) {
        watchers.set(p.share.id, onSnapshot(sharedDoc(p.share.id), (snap) => onRemote(p.share.id, snap), (e) => console.warn('[shared playlist]', e?.code)));
      }
      if (applying) continue;
      const base = known.get(p.share.id);
      if (!base || (base.name === p.name && idsOf(base.tracks) === idsOf(p.tracks))) continue;
      if (!canEditPlaylist(p)) {
        toast('이 플레이리스트를 편집할 권한이 없습니다');
        restore(p.share.id);
        continue;
      }
      clearTimeout(timers.get(p.share.id));
      timers.set(p.share.id, setTimeout(() => push(p.share.id), PUSH_DELAY_MS));
    }
    for (const [id, stop] of watchers) {
      if (seen.has(id)) continue;
      stop();
      watchers.delete(id);
      known.delete(id);
      // Deleting a playlist you own ends the share; for anyone else it only removes their copy.
      const removed = prev.playlists.find((p) => p.share?.id === id);
      if (!applying && removed?.share.ownerUid === myUid()) deleteDoc(sharedDoc(id)).catch(() => {});
    }
  };

  const stopWatchingLibrary = useLibrary.subscribe(onLibrary);
  const { playlists } = useLibrary.getState();
  onLibrary({ playlists }, { playlists: [] });

  return {
    stop() {
      stopWatchingLibrary();
      for (const [id, timer] of timers) { clearTimeout(timer); push(id); }
      timers.clear();
      for (const stop of watchers.values()) stop();
      watchers.clear();
    },
  };
}

let session = null;

export function stopSharedPlaylists() {
  session?.stop();
  session = null;
}

export function startSharedPlaylists() {
  stopSharedPlaylists();
  session = createSession();
}

export async function sharePlaylist(id) {
  const lib = useLibrary.getState();
  const playlist = lib.playlists.find((p) => p.id === id);
  if (!playlist || playlist.share) return playlist?.share?.id ?? null;
  const shareId = randomId();
  const data = { name: playlist.name.slice(0, 100), tracks: playlist.tracks.map(safeTrack).filter(Boolean), ownerUid: myUid(), ownerName: myName(), editable: false, updatedAt: serverTimestamp() };
  await setDoc(sharedDoc(shareId), data);
  useLibrary.setState({ playlists: useLibrary.getState().playlists.map((p) => (p.id === id ? { ...p, share: toShare(shareId, data) } : p)) });
  return shareId;
}

export const setPlaylistEditable = (shareId, editable) => updateDoc(sharedDoc(shareId), { editable });

// The owner ends sharing: everyone keeps their own copy, which stops updating.
export const stopSharing = (shareId) => deleteDoc(sharedDoc(shareId));

// Returns the playlist's id in this library, or null if the link points to nothing.
export async function openSharedPlaylist(text) {
  const shareId = parseShareId(text);
  if (shareId.length !== ID_LENGTH) return null;
  const existing = useLibrary.getState().playlists.find((p) => p.share?.id === shareId);
  if (existing) return existing.id;
  const snap = await getDoc(sharedDoc(shareId));
  if (!snap.exists()) return null;
  const data = snap.data();
  const id = useLibrary.getState().createPlaylist(String(data.name || '').slice(0, 100) || '공유 플레이리스트', remoteTracks(data), { share: toShare(shareId, data) });
  return id;
}

export function confirmDeletePlaylist(playlist, afterDelete) {
  const { share } = playlist;
  const shared = Boolean(share);
  const mine = share?.ownerUid === myUid();
  useUI.getState().prompt({
    title: shared && !mine ? '내 보관함에서 뺄까요?' : `'${playlist.name}' 플레이리스트를 삭제할까요?`,
    message: !shared
      ? '플레이리스트가 삭제되고 되돌릴 수 없습니다. 곡 자체는 지워지지 않아요.'
      : mine
        ? '공유도 함께 끝납니다. 링크를 받은 친구에게는 복사본만 남아요.'
        : '내 보관함에서만 사라지고, 공유 플레이리스트는 그대로 남아요.',
    submitLabel: shared && !mine ? '빼기' : '삭제',
    onSubmit: () => {
      useLibrary.getState().deletePlaylist(playlist.id);
      afterDelete?.();
      toast(shared && !mine ? '내 보관함에서 뺐습니다' : '플레이리스트를 삭제했습니다');
    },
  });
}

export async function deleteOwnedShares() {
  const uid = myUid();
  await Promise.all(useLibrary.getState().playlists
    .filter((p) => p.share?.ownerUid === uid)
    .map((p) => deleteDoc(sharedDoc(p.share.id)).catch(() => {})));
}
