// Listen-together rooms. No audio is shared: the room holds which track is playing, from what
// position and at what server time, and every member streams it themselves and follows along.
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
import { auth, rtdb } from '../lib/firebase.js';
import { bindRoom, roomPlayer, usePlayer } from './player.js';
import { toast } from './ui.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 20;
const START_LEAD_MS = 1500; // everyone gets this long to buffer before a new track starts
const SYNC_TICK_MS = 1000;
const HOST_GRACE_MS = 30000;
const IGNORE_DRIFT = 0.05;
const NUDGE_DRIFT = 0.15;
const SEEK_DRIFT = 1.5;
const SOURCE_STALL = 0.8;
const CATCH_UP_RATE = 1.03;
const SLOW_DOWN_RATE = 0.97;

const roomPath = (code, ...rest) => ['rooms', code, ...rest].join('/');
const dbRef = (code, ...rest) => ref(rtdb, roomPath(code, ...rest));
const myUid = () => auth.currentUser?.uid ?? null;

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const normalizeCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
export const inviteLink = (code) => `tmusic://join/${code}`;

function myProfile() {
  const user = auth.currentUser;
  const google = user.providerData.find((p) => p.providerId === 'google.com');
  const name = user.displayName || google?.displayName || `게스트 ${user.uid.slice(0, 4).toUpperCase()}`;
  const photo = user.photoURL || google?.photoURL || null;
  return { name: name.slice(0, 40), ...(photo ? { photo: photo.slice(0, 500) } : {}), joinedAt: serverTimestamp() };
}

const shorten = (value, max) => String(value || '').slice(0, max);
const TRUSTED_THUMB = /^https:\/\/([\w-]+\.)*(ytimg\.com|ggpht\.com|googleusercontent\.com)\//;

// Tracks come from other people's computers: keep only what we expect before using them.
function safeTrack(t) {
  if (!t || !/^[\w-]{11}$/.test(t.id)) return null;
  const thumb = TRUSTED_THUMB.test(t.thumb || '') ? t.thumb : null;
  return {
    id: t.id,
    title: shorten(t.title, 200) || '제목 없음',
    artists: (Array.isArray(t.artists) ? t.artists : Object.values(t.artists || {})).slice(0, 8).map((a) => ({ name: shorten(a?.name, 100), id: /^[\w-]+$/.test(a?.id || '') ? a.id : null })),
    album: null,
    duration: Number(t.duration) || 0,
    thumb,
  };
}

export const useRoom = create((set, get) => {
  let stopListening = [];
  let tick = null;
  let startTimer = null;
  let hostTimer = null;
  let serverOffset = 0;
  let correcting = false;

  const serverNow = () => Date.now() + serverOffset;
  const isHost = () => get().meta?.hostUid === myUid();
  const canControl = () => isHost() || (get().meta?.controlMode === 'everyone' && Boolean(get().members[myUid()]));
  const positionOf = (pb) => (pb.positionMs + (pb.playing ? serverNow() - pb.updatedAt : 0)) / 1000;

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

  const applyPlayback = (pb) => {
    clearTimeout(startTimer);
    const track = safeTrack(pb?.track);
    if (!track) return;
    if (usePlayer.getState().current()?.id !== track.id) roomPlayer.load(track, !canControl());
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
    if (!pb?.playing || !track || track.id !== pb.track?.id) {
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
      roomPlayer.setRate(drift > 0 ? CATCH_UP_RATE : SLOW_DOWN_RATE);
    } else {
      correcting = false;
      roomPlayer.setRate(1);
    }
    set({ driftMs: Math.round(drift * 1000) });
  };

  // If the host is gone for a while, the member who has been here longest takes over.
  const watchHost = (members) => {
    const { meta, code } = get();
    if (!meta || members[meta.hostUid]) {
      clearTimeout(hostTimer);
      hostTimer = null;
      return;
    }
    if (hostTimer) return;
    hostTimer = setTimeout(() => {
      hostTimer = null;
      const current = get();
      if (!current.meta || current.members[current.meta.hostUid]) return;
      const [oldest] = Object.entries(current.members).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || (a[0] < b[0] ? -1 : 1));
      if (oldest?.[0] === myUid()) update(dbRef(code, 'meta'), { hostUid: myUid() }).catch(() => {});
    }, HOST_GRACE_MS);
  };

  const hooks = {
    following: () => !canControl(),
    allowAuto: () => isHost(),
    allowTrackChange: () => canControl() || refuse(),
    togglePlay() {
      if (!canControl()) { refuse(); return; }
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
    enqueue(tracks) {
      const code = get().code;
      const profile = myProfile();
      for (const track of tracks) {
        const safe = safeTrack(track);
        if (safe) dbSet(push(dbRef(code, 'queue')), { track: safe, by: myUid(), byName: profile.name }).catch(() => toast('대기열에 추가하지 못했습니다'));
      }
      toast(tracks.length > 1 ? `같이듣기 대기열에 ${tracks.length}곡을 추가했습니다` : '같이듣기 대기열에 추가했습니다');
    },
  };

  const stopRoom = () => {
    for (const stop of stopListening) stop();
    stopListening = [];
    clearInterval(tick);
    clearTimeout(startTimer);
    clearTimeout(hostTimer);
    tick = null;
    hostTimer = null;
    correcting = false;
    bindRoom(null);
    roomPlayer.setRate(1);
    set({ code: null, meta: null, members: {}, playback: null, queue: [], connected: false, driftMs: null });
  };

  const enter = (code) => {
    set({ code });
    bindRoom(hooks);
    const memberRef = dbRef(code, 'members', myUid());
    const profile = myProfile();
    stopListening = [
      onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => { serverOffset = snap.val() || 0; }),
      onValue(ref(rtdb, '.info/connected'), (snap) => {
        const connected = snap.val() === true;
        set({ connected });
        if (!connected) return;
        onDisconnect(memberRef).remove().catch(() => {});
        dbSet(memberRef, profile).catch(() => {});
      }),
      onValue(dbRef(code, 'meta'), (snap) => {
        if (!snap.exists()) {
          toast('같이듣기 방이 닫혔습니다');
          stopRoom();
          return;
        }
        set({ meta: snap.val() });
        watchHost(get().members);
      }),
      onValue(dbRef(code, 'members'), (snap) => {
        const members = snap.val() || {};
        set({ members });
        watchHost(members);
      }),
      onValue(dbRef(code, 'playback'), (snap) => {
        const playback = snap.val();
        set({ playback });
        if (playback) applyPlayback(playback);
      }),
      onValue(dbRef(code, 'queue'), (snap) => {
        set({ queue: Object.entries(snap.val() || {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, item]) => ({ key, ...item })) });
      }),
    ];
    tick = setInterval(followTick, SYNC_TICK_MS);
  };

  return {
    code: null,
    meta: null,
    members: {},
    playback: null,
    queue: [],
    connected: false,
    driftMs: null, // how far behind the room we are, in milliseconds
    busy: false,
    error: null,

    async create(name) {
      if (get().code || !myUid()) return;
      set({ busy: true, error: null });
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = randomCode();
          const meta = {
            hostUid: myUid(),
            name: shorten(name, 40) || `${myProfile().name}의 방`,
            controlMode: 'host',
            createdAt: Date.now(),
            expiresAt: Date.now() + ROOM_LIFETIME_MS,
          };
          const { committed } = await runTransaction(dbRef(code, 'meta'), (current) => (current && current.expiresAt > Date.now() ? undefined : meta));
          if (!committed) continue;
          // The code may have belonged to an expired room.
          await update(dbRef(code), { members: null, playback: null, queue: null });
          const player = usePlayer.getState();
          const track = player.current();
          const position = roomPlayer.time();
          const wasPlaying = player.playing;
          enter(code);
          if (track) publish({ track, positionMs: position * 1000, playing: wasPlaying });
          return;
        }
        throw new Error('no free code');
      } catch (e) {
        console.warn('[room]', e);
        set({ error: '방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.' });
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
      if (get().code === code) return;
      set({ busy: true, error: null });
      try {
        await get().leave();
        const snap = await dbGet(dbRef(code));
        const room = snap.val();
        if (!room?.meta || room.meta.expiresAt < Date.now()) {
          set({ error: '방을 찾을 수 없습니다. 코드를 확인해 주세요.' });
          return;
        }
        if (Object.keys(room.members || {}).length >= MAX_MEMBERS) {
          set({ error: '방이 가득 찼습니다.' });
          return;
        }
        enter(code);
      } catch (e) {
        console.warn('[room]', e);
        set({ error: '방에 들어가지 못했습니다. 인터넷 연결을 확인해 주세요.' });
      } finally {
        set({ busy: false });
      }
    },

    async leave() {
      const code = get().code;
      if (!code) return;
      const uid = myUid();
      const memberRef = dbRef(code, 'members', uid);
      stopRoom();
      try {
        await onDisconnect(memberRef).cancel();
        await remove(memberRef);
        // The last one out closes the room. Rules only allow this once it's empty.
        const others = await dbGet(dbRef(code, 'members'));
        if (!others.exists()) await remove(dbRef(code));
      } catch (e) {
        console.warn('[room]', e);
      }
    },

    setControlMode(mode) {
      if (isHost()) update(dbRef(get().code, 'meta'), { controlMode: mode }).catch(() => toast('변경하지 못했습니다'));
    },
    makeHost(uid) {
      if (isHost()) update(dbRef(get().code, 'meta'), { hostUid: uid }).catch(() => toast('변경하지 못했습니다'));
    },
    removeFromQueue(key) {
      remove(dbRef(get().code, 'queue', key)).catch(() => toast('삭제하지 못했습니다'));
    },
    clearError() { set({ error: null }); },
  };
});
