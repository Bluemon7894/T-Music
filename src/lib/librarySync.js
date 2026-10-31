// Keeps the signed-in account's library in Firestore. The UI keeps reading the useLibrary store:
// local changes are diffed and written out, and Firestore snapshots replace the local copy.
// Firestore's on-disk cache queues writes made offline, so its view is always the truth.
import { create } from 'zustand';
import { collection, doc, documentId, getDocs, onSnapshot, query, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';
import { LISTEN_RETENTION_DAYS, RECENT_LIMIT, SEARCH_LIMIT, dayKey, needsFullMerge, normalizeListens, syncedFlag, uniqueStrings, useLibrary } from '../store/library.js';
import { toast } from '../store/ui.js';

const DAY = 24 * 60 * 60 * 1000;
const BATCH_LIMIT = 400;
const STATE_DELAY_MS = 3000;
const LISTENS_DELAY_MS = 15000;
const MAX_DOC_CHARS = 900000; // Firestore documents are limited to 1 MiB
const STATE_DOC = 'recent';

const newestFirst = (field) => (a, b) => (b[field] || 0) - (a[field] || 0);
const KEYED = {
  liked: newestFirst('addedAt'),
  savedAlbums: newestFirst('addedAt'),
  followed: newestFirst('addedAt'),
  playlists: newestFirst('created'),
};
const COLLECTIONS = [...Object.keys(KEYED), 'listens', 'state'];

export const useSync = create(() => ({ state: 'idle' })); // idle | syncing | synced | error

function createSession(uid) {
  const col = (name) => collection(db, 'users', uid, name);
  const timers = {};
  const remoteListens = new Map();
  let remoteState = '';
  let applying = false;
  let tooLargeWarned = false;
  let merged = false;
  try { merged = localStorage.getItem(syncedFlag(uid)) === '1'; } catch { /* treated as a first sync */ }
  const unmerged = new Set(COLLECTIONS);

  useSync.setState({ state: merged ? 'synced' : 'syncing' });

  const fail = (e) => {
    console.warn('[sync]', e?.code || e);
    useSync.setState({ state: 'error' });
  };

  const applyLocal = (patch) => {
    applying = true;
    try { useLibrary.setState(patch); } finally { applying = false; }
  };

  const commit = (ops) => {
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
      batch.commit().catch(fail);
    }
  };

  const markMerged = (name) => {
    if (merged) return;
    unmerged.delete(name);
    if (unmerged.size) return;
    merged = true;
    try { localStorage.setItem(syncedFlag(uid), '1'); } catch { /* merges again next time, harmlessly */ }
    useSync.setState({ state: 'synced' });
  };

  const setOp = (name, item, index = 0) => (batch) => {
    const data = name === 'playlists' || item.addedAt ? item : { ...item, addedAt: Date.now() - index };
    batch.set(doc(col(name), item.id), data);
  };

  const fitsInDoc = (item) => {
    if (JSON.stringify(item).length <= MAX_DOC_CHARS) return true;
    if (!tooLargeWarned) toast('플레이리스트가 너무 커서 계정에 저장하지 못했습니다');
    tooLargeWarned = true;
    return false;
  };

  const writeKeyed = (name, next, prev) => {
    const before = new Map(prev.map((x) => [x.id, x]));
    const ops = [];
    next.forEach((item, i) => {
      const old = before.get(item.id);
      before.delete(item.id);
      if (old !== item && JSON.stringify(old) !== JSON.stringify(item) && fitsInDoc(item)) ops.push(setOp(name, item, i));
    });
    for (const id of before.keys()) ops.push((batch) => batch.delete(doc(col(name), id)));
    commit(ops);
  };

  const flushState = () => {
    clearTimeout(timers.state);
    timers.state = null;
    const { recent, searches } = useLibrary.getState();
    const json = JSON.stringify({ recent, searches });
    if (json === remoteState) return;
    remoteState = json;
    commit([(batch) => batch.set(doc(col('state'), STATE_DOC), { recent, searches })]);
  };

  // Each day's listens are a map so two computers adding to the same day don't overwrite each other.
  const flushListens = () => {
    clearTimeout(timers.listens);
    timers.listens = null;
    const byDay = {};
    for (const entry of normalizeListens(useLibrary.getState().listens)) {
      const json = JSON.stringify(entry);
      if (remoteListens.get(entry.key) === json) continue;
      remoteListens.set(entry.key, json);
      (byDay[entry.day] ??= {})[entry.key] = entry;
    }
    commit(Object.entries(byDay).map(([day, entries]) => (batch) => batch.set(doc(col('listens'), day), { entries }, { merge: true })));
  };

  const schedule = (name, delay, flush) => {
    clearTimeout(timers[name]);
    timers[name] = setTimeout(flush, delay);
  };

  const flushAll = () => {
    if (timers.state) flushState();
    if (timers.listens) flushListens();
  };

  const stopWatchingStore = useLibrary.subscribe((next, prev) => {
    if (applying) return;
    for (const name of Object.keys(KEYED)) if (next[name] !== prev[name]) writeKeyed(name, next[name], prev[name]);
    if (next.recent !== prev.recent || next.searches !== prev.searches) schedule('state', STATE_DELAY_MS, flushState);
    if (next.listens !== prev.listens) schedule('listens', LISTENS_DELAY_MS, flushListens);
  });

  // The first answer from the server is merged with what's on this computer, so nothing made
  // before signing in is lost. After that the remote copy simply wins.
  const watchKeyed = (name, sort) => onSnapshot(col(name), { includeMetadataChanges: true }, (snap) => {
    if (!merged && snap.metadata.fromCache) return;
    const remote = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    if (merged) {
      const sorted = remote.sort(sort);
      if (JSON.stringify(sorted) !== JSON.stringify(useLibrary.getState()[name])) applyLocal({ [name]: sorted });
      return;
    }
    const ids = new Set(remote.map((x) => x.id));
    const localOnly = useLibrary.getState()[name].filter((x) => !ids.has(x.id) && fitsInDoc(x));
    applyLocal({ [name]: [...remote, ...localOnly].sort(sort) });
    commit(localOnly.map((item, i) => setOp(name, item, i)));
    markMerged(name);
  }, fail);

  const watchState = () => onSnapshot(doc(col('state'), STATE_DOC), { includeMetadataChanges: true }, (snap) => {
    if ((!merged && snap.metadata.fromCache) || timers.state) return;
    const remote = { recent: [], searches: [], ...snap.data() };
    if (merged) {
      remoteState = JSON.stringify({ recent: remote.recent, searches: remote.searches });
      const { recent, searches } = useLibrary.getState();
      if (remoteState !== JSON.stringify({ recent, searches })) applyLocal({ recent: remote.recent, searches: remote.searches });
      return;
    }
    const local = useLibrary.getState();
    const seen = new Set();
    const recent = [...local.recent, ...remote.recent].filter((t) => !seen.has(t.id) && seen.add(t.id)).slice(0, RECENT_LIMIT);
    applyLocal({ recent, searches: uniqueStrings([...local.searches, ...remote.searches]).slice(0, SEARCH_LIMIT) });
    flushState();
    markMerged('state');
  }, fail);

  const watchListens = () => {
    const since = dayKey(Date.now() - LISTEN_RETENTION_DAYS * DAY);
    return onSnapshot(query(col('listens'), where(documentId(), '>=', since)), { includeMetadataChanges: true }, (snap) => {
      if ((!merged && snap.metadata.fromCache) || timers.listens) return;
      const remote = snap.docs.flatMap((d) => Object.values(d.data().entries || {}));
      remoteListens.clear();
      for (const entry of remote) remoteListens.set(entry.key, JSON.stringify(entry));
      const byKey = new Map(remote.map((e) => [e.key, e]));
      if (!merged) for (const entry of normalizeListens(useLibrary.getState().listens)) if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
      const listens = [...byKey.values()].sort(newestFirst('at'));
      if (JSON.stringify(listens) !== JSON.stringify(useLibrary.getState().listens)) applyLocal({ listens });
      if (!merged) {
        flushListens();
        markMerged('listens');
      }
    }, fail);
  };

  // Days past the retention window would otherwise stay in the account forever.
  const dropExpiredListens = () => {
    const before = dayKey(Date.now() - LISTEN_RETENTION_DAYS * DAY);
    getDocs(query(col('listens'), where(documentId(), '<', before)))
      .then((snap) => commit(snap.docs.map((d) => (batch) => batch.delete(d.ref))))
      .catch(() => {});
  };

  const stopWatchingCloud = [
    ...Object.entries(KEYED).map(([name, sort]) => watchKeyed(name, sort)),
    watchState(),
    watchListens(),
  ];
  dropExpiredListens();
  window.addEventListener('beforeunload', flushAll);

  return {
    stop() {
      flushAll();
      stopWatchingStore();
      for (const stop of stopWatchingCloud) stop();
      window.removeEventListener('beforeunload', flushAll);
    },
  };
}

let session = null;

export function stopLibrarySync() {
  session?.stop();
  session = null;
  useSync.setState({ state: 'idle' });
}

export function startLibrarySync(uid) {
  stopLibrarySync();
  session = createSession(uid);
}

export async function deleteCloudData(uid) {
  for (const name of COLLECTIONS) {
    const snap = await getDocs(collection(db, 'users', uid, name));
    for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
      await batch.commit();
    }
  }
  needsFullMerge(uid);
}
