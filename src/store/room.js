// Listen-together rooms. No audio is shared: the room holds which track is playing, from what
// position and at what server time, and every member streams it themselves and follows along.
// A room lasts until its members leave. Closing the app only stops listening: the member stays
// in the room, and on the next launch can join back in with one click.
import { create } from 'zustand';
import {
  get as dbGet,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set as dbSet,
  update,
} from 'firebase/database';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, rtdb } from '../lib/firebase.js';
import { OFFLINE_MESSAGE, waitForConnection } from '../lib/online.js';
import { safeTrack } from '../lib/safeTrack.js';
import { bindRoom, roomPlayer, usePlayer } from './player.js';
import { toast } from './ui.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_MEMBERS = 20;
const START_LEAD_MS = 1500; // everyone gets this long to buffer before a new track starts
const SYNC_TICK_MS = 1000;
const MAX_ADD_AT_ONCE = 200;
const HOST_GRACE_MS = 30000;
const IGNORE_DRIFT = 0.05;
const NUDGE_DRIFT = 0.15;
const FAST_DRIFT = 0.4;
const SEEK_DRIFT = 1;
const SOURCE_STALL = 0.8;
const GENTLE_RATE_CHANGE = 0.03;
const FAST_RATE_CHANGE = 0.06;

const roomPath = (code, ...rest) => ['rooms', code, ...rest].join('/');
const dbRef = (code, ...rest) => ref(rtdb, roomPath(code, ...rest));
const myUid = () => auth.currentUser?.uid ?? null;
const myRoomDoc = () => doc(db, 'users', myUid(), 'state', 'room');

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const normalizeCode = (text) => String(text || '').replace(/^.*join\//i, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
export const inviteLink = (code) => `tmusic://join/${code}`;

function myProfile() {
  const user = auth.currentUser;
  const google = user.providerData.find((p) => p.providerId === 'google.com');
  const name = user.displayName || google?.displayName || `게스트 ${user.uid.slice(0, 4).toUpperCase()}`;
  const photo = user.photoURL || google?.photoURL || null;
  return { name: name.slice(0, 40), ...(photo ? { photo: photo.slice(0, 500) } : {}) };
}

const oldestFirst = (a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || (a[0] < b[0] ? -1 : 1);

export const useRoom = create((set, get) => {
  let stopListening = [];
  let stopListeningPresence = null;
  let tick = null;
  let startTimer = null;
  let hostTimer = null;
  let serverOffset = 0;
  let correcting = false;
  let pausedAlone = false; // came back to a room nobody is listening in

  const serverNow = () => Date.now() + serverOffset;
  const isHost = () => get().meta?.hostUid === myUid();
  const canControl = () => isHost() || (get().meta?.controlMode === 'everyone' && Boolean(get().members[myUid()]));
  const positionOf = (pb) => (pb.positionMs + (pb.playing ? serverNow() - pb.updatedAt : 0)) / 1000;
  const othersListening = () => Object.entries(get().members).some(([uid, m]) => uid !== myUid() && m.listening);

  const refuse = () => { toast('방장만 조작할 수 있어요. 곡은 대기열에 추가해 보세요.'); return false; };

  const publish = (patch) => {
    const pb = get().playback;
    const code = get().code;
    const track = patch.track ?? pb?.track;
    if (!code || !track) return;
    dbSet(dbRef(code, 'playback'), {
      track: safeTrack(track),
      positionMs: Math.round(patch.positionMs ?? (pb ? positionOf(pb) * 1000 : 0)),
      playing: patch.playing ?? pb?.playing ?? true,
      updatedAt: serverTimestamp(),
      rev: (pb?.rev || 0) + 1,
      by: myUid(),
    }).catch(() => toast('같이듣기 상태를 보내지 못했습니다'));
  };

  // Where a stopped room's clock would be makes no sense after hours away: stay inside the track.
  const restingPosition = (pb) => {
    const duration = Number(pb.track?.duration) || 0;
    const position = positionOf(pb);
    return duration && position >= duration - 1 ? 0 : Math.max(0, position);
  };

  const applyPlayback = (pb) => {
    clearTimeout(startTimer);
    const track = safeTrack(pb?.track);
    if (!track) return;
    if (usePlayer.getState().current()?.id !== track.id) roomPlayer.load(track, !canControl());
    if (pausedAlone) {
      roomPlayer.pause();
      roomPlayer.seekTo(restingPosition(pb));
      return;
    }
    const position = positionOf(pb);
    if (!pb.playing) {
      roomPlayer.pause();
      roomPlayer.setRate(1);
      roomPlayer.seekTo(Math.max(0, position));
      return;
    }
    if (position < 0) {
      roomPlayer.pause();
      roomPlayer.seekTo(0);
      startTimer = setTimeout(() => roomPlayer.play(), -position * 1000);
      return;
    }
    if (Math.abs(roomPlayer.time() - position) > SEEK_DRIFT) roomPlayer.seekTo(position);
    roomPlayer.play();
  };

  // Small differences are closed by playing slightly faster or slower so nobody hears a jump.
  const followTick = () => {
    const pb = get().playback;
    const player = usePlayer.getState();
    const track = player.current();
    if (pausedAlone || !pb?.playing || !track || track.id !== pb.track?.id) {
      roomPlayer.setRate(1);
      if (get().driftMs !== null) set({ driftMs: null });
      return;
    }
    const expected = positionOf(pb);
    const duration = player.duration || track.duration || 0;
    if (expected < 0 || (duration && expected >= duration - 0.5) || player.loading) return;
    const drift = expected - roomPlayer.time();

    // Whoever made the last change is the reference; if they stall, everyone waits for them.
    if (pb.by === myUid()) {
      if (Math.abs(drift) > SOURCE_STALL) publish({ positionMs: roomPlayer.time() * 1000, playing: true });
      if (get().driftMs !== 0) set({ driftMs: 0 });
      return;
    }
    if (roomPlayer.isPaused()) roomPlayer.play();
    const size = Math.abs(drift);
    if (size > SEEK_DRIFT) {
      roomPlayer.seekTo(expected);
      roomPlayer.setRate(1);
      correcting = false;
    } else if (size > NUDGE_DRIFT || (correcting && size > IGNORE_DRIFT)) {
      correcting = true;
      const change = size > FAST_DRIFT ? FAST_RATE_CHANGE : GENTLE_RATE_CHANGE;
      roomPlayer.setRate(drift > 0 ? 1 + change : 1 - change);
    } else {
      correcting = false;
      roomPlayer.setRate(1);
    }
    set({ driftMs: Math.round(drift * 1000) });
  };

  // If the host stops listening for a while, the member who has been here longest takes over.
  const watchHost = () => {
    const { meta, members, code, attached } = get();
    if (!meta || !attached || members[meta.hostUid]?.listening) {
      clearTimeout(hostTimer);
      hostTimer = null;
      return;
    }
    if (hostTimer) return;
    hostTimer = setTimeout(() => {
      hostTimer = null;
      const current = get();
      if (!current.meta || current.members[current.meta.hostUid]?.listening) return;
      const [oldest] = Object.entries(current.members).filter(([, m]) => m.listening).sort(oldestFirst);
      if (oldest?.[0] === myUid()) update(dbRef(code, 'meta'), { hostUid: myUid() }).catch(() => {});
    }, HOST_GRACE_MS);
  };

  const hooks = {
    following: () => !canControl(),
    allowAuto: () => isHost(),
    allowTrackChange: () => canControl() || refuse(),
    togglePlay() {
      if (!canControl()) { refuse(); return; }
      pausedAlone = false;
      const pb = get().playback;
      const track = usePlayer.getState().current();
      if (!pb) {
        if (track) publish({ track, positionMs: roomPlayer.time() * 1000, playing: true });
        return;
      }
      publish({ playing: !pb.playing, positionMs: roomPlayer.time() * 1000 });
    },
    seek(t) {
      if (!canControl()) { refuse(); return; }
      publish({ positionMs: Math.max(0, t) * 1000 });
    },
    onLoad(track) {
      pausedAlone = false;
      publish({ track, positionMs: -START_LEAD_MS, playing: true });
    },
    onStopped() {
      publish({ playing: false, positionMs: roomPlayer.time() * 1000 });
    },
    takeQueued() {
      const { code, queue } = get();
      if (!queue.length) return null;
      const [first] = queue;
      remove(dbRef(code, 'queue', first.key)).catch(() => {});
      set({ queue: queue.slice(1) });
      return safeTrack(first.track);
    },
    // Written together so a long album arrives in one piece and in order.
    enqueue(tracks, { next = false } = {}) {
      const { code, queue } = get();
      const { name } = myProfile();
      const safe = tracks.map(safeTrack).filter(Boolean);
      const list = safe.slice(0, MAX_ADD_AT_ONCE);
      if (!list.length) return;
      const first = next
        ? Math.min(Date.now(), ...queue.map((q) => q.order).filter(Number.isFinite)) - list.length
        : Date.now();
      const items = {};
      list.forEach((track, i) => {
        items[push(dbRef(code, 'queue')).key] = { track, by: myUid(), byName: name, order: first + i };
      });
      update(dbRef(code, 'queue'), items).catch(() => toast('대기열에 추가하지 못했습니다'));
      if (safe.length > list.length) toast(`한 번에 ${MAX_ADD_AT_ONCE}곡까지 추가할 수 있어요. 앞의 ${MAX_ADD_AT_ONCE}곡만 넣었습니다.`);
      else if (next) toast('같이듣기 대기열 맨 앞에 추가했습니다');
      else toast(list.length > 1 ? `같이듣기 대기열에 ${list.length}곡을 추가했습니다` : '같이듣기 대기열에 추가했습니다');
    },
  };

  const startPresence = (code) => {
    const memberRef = dbRef(code, 'members', myUid());
    const profile = myProfile();
    stopListeningPresence = onValue(ref(rtdb, '.info/connected'), async (snap) => {
      const connected = snap.val() === true;
      set({ connected });
      if (!connected) return;
      try {
        const existing = await dbGet(memberRef);
        await update(memberRef, { ...profile, listening: true, ...(existing.exists() ? {} : { joinedAt: serverTimestamp() }) });
        // Only now: the rules check this against the member's whole entry, which must exist first.
        await onDisconnect(memberRef).update({ listening: false });
      } catch (e) {
        console.warn('[room]', e);
      }
    });
  };

  // Stop following the room but stay a member of it.
  const stopFollowing = () => {
    stopListeningPresence?.();
    stopListeningPresence = null;
    clearInterval(tick);
    clearTimeout(startTimer);
    clearTimeout(hostTimer);
    tick = null;
    hostTimer = null;
    correcting = false;
    pausedAlone = false;
    bindRoom(null);
    roomPlayer.setRate(1);
    set({ attached: false, connected: false, driftMs: null });
  };

  const stopRoom = () => {
    stopFollowing();
    for (const stop of stopListening) stop();
    stopListening = [];
    set({ code: null, meta: null, members: {}, playback: null, queue: [] });
  };

  const watchRoom = (code) => {
    set({ code });
    stopListening = [
      onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => { serverOffset = snap.val() || 0; }),
      onValue(dbRef(code, 'meta'), (snap) => {
        if (!snap.exists()) {
          toast('같이듣기 방이 닫혔습니다');
          stopRoom();
          deleteDoc(myRoomDoc()).catch(() => {});
          return;
        }
        set({ meta: snap.val() });
        watchHost();
        // We came back to a silent room and have now become its host: stop its clock.
        if (pausedAlone && isHost() && get().playback?.playing) {
          publish({ playing: false, positionMs: restingPosition(get().playback) * 1000 });
          pausedAlone = false;
        }
      }),
      onValue(dbRef(code, 'members'), (snap) => {
        set({ members: snap.val() || {} });
        watchHost();
      }),
      onValue(dbRef(code, 'playback'), (snap) => {
        const playback = snap.val();
        set({ playback });
        if (playback && get().attached) applyPlayback(playback);
      }),
      onValue(dbRef(code, 'queue'), (snap) => {
        // Items from older versions have no order and go after the rest, oldest first.
        const orderOf = (item) => (Number.isFinite(item.order) ? item.order : Infinity);
        const sorted = Object.entries(snap.val() || {}).sort(([a, x], [b, y]) => {
          const diff = orderOf(x) - orderOf(y);
          return Number.isNaN(diff) || diff === 0 ? (a < b ? -1 : 1) : diff;
        });
        set({ queue: sorted.map(([key, item]) => ({ key, ...item })) });
      }),
    ];
  };

  const follow = async () => {
    const code = get().code;
    if (!code || get().attached) return;
    // Decide from the room as it is now: its listeners may not have delivered anything yet.
    let freshMeta;
    let freshMembers;
    let freshPlayback;
    try {
      await waitForConnection();
      [freshMeta, freshMembers, freshPlayback] = await Promise.all(['meta', 'members', 'playback'].map((part) => dbGet(dbRef(code, part))));
    } catch (e) {
      console.warn('[room]', e);
      toast('같이 듣기에 합류하지 못했습니다. 인터넷 연결을 확인해 주세요.');
      return;
    }
    if (get().code !== code || get().attached) return;
    set({ meta: freshMeta.val(), members: freshMembers.val() || {}, playback: freshPlayback.val(), attached: true });
    bindRoom(hooks);
    startPresence(code);
    tick = setInterval(followTick, SYNC_TICK_MS);
    const { meta, playback } = get();
    if (meta?.ownerUid === myUid() && meta.hostUid !== myUid()) update(dbRef(code, 'meta'), { hostUid: myUid() }).catch(() => {});
    if (playback?.playing && !othersListening()) {
      pausedAlone = true;
      if (isHost() || meta?.ownerUid === myUid()) {
        publish({ playing: false, positionMs: restingPosition(playback) * 1000 });
        pausedAlone = false;
      }
    }
    if (get().playback) applyPlayback(get().playback);
  };

  const rememberRoom = (code) => setDoc(myRoomDoc(), { code }).catch(() => {});

  return {
    code: null,
    meta: null,
    members: {},
    playback: null,
    queue: [],
    attached: false, // following the room's playback right now
    connected: false,
    driftMs: null, // how far behind the room we are, in milliseconds
    busy: false,
    error: null,

    async create(name) {
      if (get().code || !myUid()) return;
      set({ busy: true, error: null });
      try {
        await waitForConnection();
        const uid = myUid();
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = randomCode();
          const meta = { hostUid: uid, ownerUid: uid, name: String(name || '').slice(0, 40) || `${myProfile().name}의 방`, controlMode: 'host', createdAt: Date.now() };
          const { committed } = await runTransaction(dbRef(code, 'meta'), (current) => (current ? undefined : meta));
          if (!committed) continue;
          const player = usePlayer.getState();
          const track = player.current();
          const position = roomPlayer.time();
          const wasPlaying = player.playing;
          watchRoom(code);
          set({ meta });
          rememberRoom(code);
          await follow();
          if (track) publish({ track, positionMs: position * 1000, playing: wasPlaying });
          return;
        }
        throw new Error('no free code');
      } catch (e) {
        console.warn('[room]', e);
        set({ error: e.message === OFFLINE_MESSAGE ? OFFLINE_MESSAGE : '방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' });
      } finally {
        set({ busy: false });
      }
    },

    async join(rawCode) {
      const code = normalizeCode(rawCode);
      if (!myUid()) return;
      if (code.length !== CODE_LENGTH) {
        set({ error: `초대 코드는 ${CODE_LENGTH}자리입니다.` });
        return;
      }
      if (get().code === code) {
        follow();
        return;
      }
      set({ busy: true, error: null });
      try {
        await waitForConnection();
        const snap = await dbGet(dbRef(code));
        const room = snap.val();
        if (!room?.meta) {
          set({ error: '방을 찾을 수 없습니다. 코드를 확인해 주세요.' });
          return;
        }
        // Whoever left last was interrupted before closing it.
        if (!room.members) {
          await remove(dbRef(code)).catch(() => {});
          set({ error: '방을 찾을 수 없습니다. 코드를 확인해 주세요.' });
          return;
        }
        if (!room.members[myUid()] && Object.keys(room.members).length >= MAX_MEMBERS) {
          set({ error: '방이 가득 찼습니다.' });
          return;
        }
        await get().leave();
        watchRoom(code);
        rememberRoom(code);
        await follow();
      } catch (e) {
        console.warn('[room]', e);
        set({ error: OFFLINE_MESSAGE });
      } finally {
        set({ busy: false });
      }
    },

    // After signing in: show the room this account is still a member of, without any sound yet.
    async resume() {
      if (get().code || !myUid()) return;
      try {
        const saved = await getDoc(myRoomDoc());
        const code = saved.data()?.code;
        if (!code || get().code) return;
        const member = await dbGet(dbRef(code, 'members', myUid()));
        if (!member.exists()) {
          await deleteDoc(myRoomDoc()).catch(() => {});
          return;
        }
        watchRoom(code);
      } catch (e) {
        console.warn('[room]', e);
      }
    },

    follow,

    // Back to listening alone, still a member of the room.
    pause() {
      const { code, attached } = get();
      if (!code || !attached) return;
      const memberRef = dbRef(code, 'members', myUid());
      stopFollowing();
      onDisconnect(memberRef).cancel().catch(() => {});
      update(memberRef, { listening: false }).catch(() => {});
    },

    // Stop following for this session without giving up the room (signing out, closing).
    disconnect() {
      if (!get().code) return;
      const memberRef = dbRef(get().code, 'members', myUid());
      update(memberRef, { listening: false }).catch(() => {});
      stopRoom();
    },

    // Really leaving. The last one out closes the room, so empty rooms don't pile up.
    async leave() {
      const code = get().code;
      if (!code) return;
      const uid = myUid();
      const memberRef = dbRef(code, 'members', uid);
      const { meta } = get();
      stopRoom();
      try {
        await onDisconnect(memberRef).cancel();
        const everyone = (await dbGet(dbRef(code, 'members'))).val() || {};
        const others = Object.entries(everyone).filter(([id]) => id !== uid).sort(oldestFirst);
        if (others.length) {
          const next = (others.find(([, m]) => m.listening) || others[0])[0];
          const handover = {
            ...(meta?.hostUid === uid ? { hostUid: next } : {}),
            ...(meta?.ownerUid === uid ? { ownerUid: next } : {}),
          };
          if (Object.keys(handover).length) await update(dbRef(code, 'meta'), handover);
        }
        await remove(memberRef);
        if (!others.length) await remove(dbRef(code));
        await deleteDoc(myRoomDoc()).catch(() => {});
      } catch (e) {
        console.warn('[room]', e);
      }
    },

    setControlMode(mode) {
      if (isHost()) update(dbRef(get().code, 'meta'), { controlMode: mode }).catch(() => toast('변경하지 못했습니다'));
    },
    makeHost(uid) {
      if (isHost()) update(dbRef(get().code, 'meta'), { hostUid: uid, ownerUid: uid }).catch(() => toast('변경하지 못했습니다'));
    },
    moveInQueue(from, to) {
      const { code, queue } = get();
      if (!canControl()) { refuse(); return; }
      if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
      const next = queue.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ queue: next });
      const orders = {};
      next.forEach((item, i) => { orders[`${item.key}/order`] = i; });
      update(dbRef(code, 'queue'), orders).catch(() => toast('순서를 바꾸지 못했습니다'));
    },
    removeFromQueue(key) {
      remove(dbRef(get().code, 'queue', key)).catch(() => toast('삭제하지 못했습니다'));
    },
    clearError() { set({ error: null }); },
  };
});
