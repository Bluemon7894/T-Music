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
import { api } from '../lib/api.js';
import { useDeck } from './deck.js';
import { saveAlignment } from './lyricAlignments.js';
import { bindRoom, roomPlayer, usePlayer } from './player.js';
import { toast } from './ui.js';
import { tr } from '../lib/i18n.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_MEMBERS = 20;
const START_LEAD_MS = 1500; // everyone gets this long to buffer before a new track starts
const SOUND_LEAD_MS = 5500; // and long enough for the deck's start sound to finish first
const MARK_ENDING_S = 6; // ahead of the end of the last track, members are told nothing follows it
const MAX_SHARED_LYRICS = 200000;
const TRACK_ID = /^[A-Za-z0-9_-]{11}$/;
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
  const name = user.displayName || google?.displayName || tr('게스트 {0}', user.uid.slice(0, 4).toUpperCase());
  const photo = user.photoURL || google?.photoURL || null;
  return { name: name.slice(0, 40), ...(photo ? { photo: photo.slice(0, 500) } : {}) };
}

// A lost connection can write `listening` over a member the host just removed, leaving no name behind.
const realMembers = (members) => Object.fromEntries(Object.entries(members || {}).filter(([, m]) => m?.name));

// Lyrics someone else chose are only ever shown as text; take the parts that are.
function safeLyrics(json) {
  let data = null;
  try { data = JSON.parse(json); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const lines = (Array.isArray(data.lines) ? data.lines : [])
    .filter((l) => Number.isFinite(l?.time) && typeof l?.text === 'string')
    .map((l) => ({ time: l.time, text: l.text }));
  const plainLyrics = typeof data.plainLyrics === 'string' ? data.plainLyrics : '';
  if (!lines.length && !plainLyrics) return null;
  return {
    lines,
    plainLyrics,
    ...(typeof data.source === 'string' ? { source: data.source } : {}),
    ...(typeof data.footer === 'string' ? { footer: data.footer } : {}),
    ...(Number.isFinite(data.lyricsDuration) ? { lyricsDuration: data.lyricsDuration } : {}),
  };
}

const oldestFirst = (a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || (a[0] < b[0] ? -1 : 1);

export const useRoom = create((set, get) => {
  useDeck.subscribe((s, prev) => { if (s.sounds !== prev.sounds) syncSounds(); });
  let stopListening = [];
  let stopListeningPresence = null;
  let tick = null;
  let startTimer = null;
  let hostTimer = null;
  let serverOffset = 0;
  let correcting = false;
  let pausedAlone = false; // came back to a room nobody is listening in
  let seenLyrics = new Map();
  let lyricsLoaded = false;

  const serverNow = () => Date.now() + serverOffset;
  const isHost = () => get().meta?.hostUid === myUid();
  const canControl = () => isHost() || (get().meta?.controlMode === 'everyone' && Boolean(get().members[myUid()]));
  const positionOf = (pb) => (pb.positionMs + (pb.playing ? serverNow() - pb.updatedAt : 0)) / 1000;
  const othersListening = () => Object.entries(get().members).some(([uid, m]) => uid !== myUid() && m.listening);

  const refuse = () => { toast(tr('방장만 곡을 추가하고 재생을 조작할 수 있어요.')); return false; };

  // The host's choice is what the whole room goes by.
  const syncSounds = () => {
    const { code, meta, attached } = get();
    const sounds = useDeck.getState().sounds;
    if (code && attached && meta && isHost() && meta.sounds !== sounds) update(dbRef(code, 'meta'), { sounds }).catch(() => {});
  };

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
      ...(patch.ending ? { ending: true } : {}),
    }).catch(() => toast(tr('같이듣기 상태를 보내지 못했습니다')));
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
      if (pb.ending) roomPlayer.finished();
      return;
    }
    if (position < 0) {
      roomPlayer.hold(-position);
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
    soundsOn: () => get().meta?.sounds === true,
    hasQueued: () => get().queue.length > 0,
    setModes(patch) {
      if (!canControl()) { refuse(); return; }
      update(dbRef(get().code, 'modes'), patch).catch(() => toast(tr('변경하지 못했습니다')));
    },
    // Put at the back of the shared queue, after anything already in it.
    loopQueue(current, waiting) {
      const { code, queue } = get();
      const list = [...waiting, current].map(safeTrack).filter(Boolean).slice(-MAX_ADD_AT_ONCE);
      if (!list.length) return;
      const { name } = myProfile();
      let order = Math.max(0, ...queue.map((q) => q.order).filter(Number.isFinite));
      const items = {};
      for (const track of list) items[push(dbRef(code, 'queue')).key] = { track, by: myUid(), byName: name, order: ++order };
      update(dbRef(code, 'queue'), items).catch(() => toast(tr('같이듣기 대기열에 넣지 못했습니다')));
      const added = Object.entries(items).map(([key, item]) => ({ key, ...item }));
      if (!get().queue.some((q) => q.key === added[0].key)) set({ queue: [...get().queue, ...added] });
    },
    // Only the host knows nothing follows this track, since the next one would come from its queue.
    endingSoon(left, stopsHere) {
      const pb = get().playback;
      if (isHost() && !pausedAlone && pb?.playing) {
        const marked = pb.ending === true;
        if (stopsHere && left <= MARK_ENDING_S && !marked) publish({ positionMs: roomPlayer.time() * 1000, ending: true });
        else if (!stopsHere && marked) publish({ positionMs: roomPlayer.time() * 1000 });
      }
      return Boolean(pb?.playing && pb.ending === true);
    },
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
      const firstSound = hooks.soundsOn() && !get().playback?.playing;
      publish({ track, positionMs: -(firstSound ? SOUND_LEAD_MS : START_LEAD_MS), playing: true });
    },
    onStopped() {
      publish({ playing: false, positionMs: roomPlayer.time() * 1000, ending: true });
    },
    takeQueued() {
      const { code, queue, modes } = get();
      if (!queue.length) return null;
      // Shuffling ignores the order on screen. When going round, the track that just ended sits last
      // and doesn't come straight back unless it's the only one.
      const choices = modes?.repeat === 'all' && queue.length > 1 ? queue.slice(0, -1) : queue;
      const next = modes?.shuffle ? choices[Math.floor(Math.random() * choices.length)] : queue[0];
      remove(dbRef(code, 'queue', next.key)).catch(() => {});
      set({ queue: get().queue.filter((q) => q.key !== next.key) });
      return safeTrack(next.track);
    },
    // Written together so a long album arrives in one piece and in order.
    enqueue(tracks, { next = false } = {}) {
      if (!canControl()) { refuse(); return; }
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
      update(dbRef(code, 'queue'), items).catch(() => toast(tr('대기열에 추가하지 못했습니다')));
      if (safe.length > list.length) toast(tr('한 번에 {0}곡까지 추가할 수 있어요. 앞의 {1}곡만 넣었습니다.', MAX_ADD_AT_ONCE, MAX_ADD_AT_ONCE));
      else if (next) toast(tr('같이듣기 대기열 맨 앞에 추가했습니다'));
      else toast(list.length > 1 ? tr('같이듣기 대기열에 {0}곡을 추가했습니다', list.length) : tr('같이듣기 대기열에 추가했습니다'));
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
    roomPlayer.release();
    roomPlayer.setRate(1);
    set({ attached: false, connected: false, driftMs: null });
  };

  const stopRoom = () => {
    stopFollowing();
    for (const stop of stopListening) stop();
    stopListening = [];
    set({ code: null, meta: null, members: {}, playback: null, queue: [], modes: null });
  };

  // Someone in the room resynced the lyrics or picked different ones.
  const applySharedLyrics = async (trackId, entry, announce) => {
    const lyrics = TRACK_ID.test(trackId) && typeof entry.data === 'string' ? safeLyrics(entry.data) : null;
    if (!lyrics) return;
    await api.setCustomLyrics(trackId, lyrics);
    saveAlignment(trackId, lyrics, Number.isFinite(entry.offset) ? entry.offset : null);
    window.dispatchEvent(new CustomEvent('t-music:lyrics-changed', { detail: { trackId, lyrics } }));
    if (announce && usePlayer.getState().current()?.id === trackId) {
      toast(tr('{0}님이 가사를 다시 맞췄어요', get().members[entry.by]?.name || tr('멤버')));
    }
  };

  const watchRoom = (code) => {
    set({ code });
    seenLyrics = new Map();
    lyricsLoaded = false;
    stopListening = [
      onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => { serverOffset = snap.val() || 0; }),
      onValue(dbRef(code, 'meta'), (snap) => {
        if (!snap.exists()) {
          toast(tr('같이듣기 방이 닫혔습니다'));
          stopRoom();
          deleteDoc(myRoomDoc()).catch(() => {});
          return;
        }
        set({ meta: snap.val() });
        watchHost();
        syncSounds();
        // We came back to a silent room and have now become its host: stop its clock.
        if (pausedAlone && isHost() && get().playback?.playing) {
          publish({ playing: false, positionMs: restingPosition(get().playback) * 1000 });
          pausedAlone = false;
        }
      }),
      onValue(dbRef(code, 'members'), (snap) => {
        set({ members: realMembers(snap.val()) });
        watchHost();
      }),
      onValue(dbRef(code, 'modes'), (snap) => {
        set({ modes: snap.val() });
        if (get().attached) roomPlayer.setModes(snap.val());
      }),
      onValue(dbRef(code, 'kicked', myUid()), (snap) => {
        if (snap.val() !== true) return;
        onDisconnect(dbRef(code, 'members', myUid())).cancel().catch(() => {});
        toast(tr('방장이 이 방에서 내보냈어요'));
        stopRoom();
        deleteDoc(myRoomDoc()).catch(() => {});
      }),
      onValue(dbRef(code, 'lyrics'), (snap) => {
        const announce = lyricsLoaded;
        lyricsLoaded = true;
        for (const [trackId, entry] of Object.entries(snap.val() || {})) {
          if (seenLyrics.get(trackId) === entry.at) continue;
          seenLyrics.set(trackId, entry.at);
          if (entry.by !== myUid()) applySharedLyrics(trackId, entry, announce).catch((e) => console.warn('[room]', e));
        }
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
        set({ queue: sorted.map(([key, item]) => ({ key, ...item, track: safeTrack(item.track) })).filter((item) => item.track) });
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
    let freshModes;
    try {
      await waitForConnection();
      [freshMeta, freshMembers, freshPlayback, freshModes] = await Promise.all(['meta', 'members', 'playback', 'modes'].map((part) => dbGet(dbRef(code, part))));
    } catch (e) {
      console.warn('[room]', e);
      toast(tr('같이 듣기에 합류하지 못했습니다. 인터넷 연결을 확인해 주세요.'));
      return;
    }
    if (get().code !== code || get().attached) return;
    set({ meta: freshMeta.val(), members: realMembers(freshMembers.val()), playback: freshPlayback.val(), modes: freshModes.val(), attached: true });
    bindRoom(hooks);
    roomPlayer.setModes(freshModes.val());
    startPresence(code);
    tick = setInterval(followTick, SYNC_TICK_MS);
    const { meta, playback } = get();
    if (meta?.ownerUid === myUid() && meta.hostUid !== myUid()) update(dbRef(code, 'meta'), { hostUid: myUid() }).catch(() => {});
    syncSounds();
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
    modes: null, // the room's shuffle and repeat, the same for everyone
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
          const meta = { hostUid: uid, ownerUid: uid, name: String(name || '').slice(0, 40) || tr('{0}의 방', myProfile().name), controlMode: 'everyone', sounds: useDeck.getState().sounds, createdAt: Date.now() };
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
        set({ error: e.message === OFFLINE_MESSAGE ? OFFLINE_MESSAGE : tr('방을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.') });
      } finally {
        set({ busy: false });
      }
    },

    async join(rawCode) {
      const code = normalizeCode(rawCode);
      if (!myUid()) return;
      if (code.length !== CODE_LENGTH) {
        set({ error: tr('초대 코드는 {0}자리입니다.', CODE_LENGTH) });
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
          set({ error: tr('방을 찾을 수 없습니다. 코드를 확인해 주세요.') });
          return;
        }
        // Whoever left last was interrupted before closing it.
        if (!room.members) {
          await remove(dbRef(code)).catch(() => {});
          set({ error: tr('방을 찾을 수 없습니다. 코드를 확인해 주세요.') });
          return;
        }
        if (room.kicked?.[myUid()]) {
          set({ error: tr('방장이 내보낸 방이에요. 방장이 다시 초대하면 들어올 수 있어요.') });
          return;
        }
        if (!room.members[myUid()] && Object.keys(room.members).length >= MAX_MEMBERS) {
          set({ error: tr('방이 가득 찼습니다.') });
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
        if (!member.val()?.name) {
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
        const everyone = realMembers((await dbGet(dbRef(code, 'members'))).val());
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
      if (isHost()) update(dbRef(get().code, 'meta'), { controlMode: mode }).catch(() => toast(tr('변경하지 못했습니다')));
    },
    makeHost(uid) {
      if (isHost()) update(dbRef(get().code, 'meta'), { hostUid: uid, ownerUid: uid }).catch(() => toast(tr('변경하지 못했습니다')));
    },
    kick(uid) {
      const { code, meta } = get();
      if (!isHost() || uid === myUid() || uid === meta?.ownerUid) return;
      update(dbRef(code), { [`members/${uid}`]: null, [`kicked/${uid}`]: true }).catch(() => toast(tr('내보내지 못했습니다')));
    },
    // Inviting someone back is how the host takes it back.
    pardon(uid) {
      if (get().code && isHost()) remove(dbRef(get().code, 'kicked', uid)).catch(() => {});
    },
    // Goes to everyone who may control the room's playback; anyone else keeps it to themselves.
    shareLyrics(trackId, lyrics, offset = null) {
      const { code, attached } = get();
      if (!code || !attached || !canControl() || !lyrics || !TRACK_ID.test(trackId)) return;
      const data = JSON.stringify(lyrics);
      if (data.length > MAX_SHARED_LYRICS) return;
      dbSet(dbRef(code, 'lyrics', trackId), {
        data,
        ...(Number.isFinite(offset) ? { offset } : {}),
        by: myUid(),
        at: serverTimestamp(),
      }).catch(() => toast(tr('가사를 방에 공유하지 못했습니다')));
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
      update(dbRef(code, 'queue'), orders).catch(() => toast(tr('순서를 바꾸지 못했습니다')));
    },
    removeFromQueue(key) {
      if (!canControl()) { refuse(); return; }
      remove(dbRef(get().code, 'queue', key)).catch(() => toast(tr('삭제하지 못했습니다')));
    },
    clearError() { set({ error: null }); },
  };
});
